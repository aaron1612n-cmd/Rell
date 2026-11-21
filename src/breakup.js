import * as THREE from 'three';
import { K } from './gpufx.js';
import { addHullDetail } from './hullDetail.js';

// Big wrecks you take apart. The freighter's bridge and engine block are held to the keel by heavy struts; on EVA,
// hold the cutter on a strut's collar until it parts. Cut every strut on a section and it drifts free as one huge
// piece of salvage: worth a lot, slow to tow. Choose what's worth the haul.
//
// The reactor core sits on the engines, held by two clamps and fed by a frosted coolant line.
//  - cut both clamps and the core lifts off clean: tow it home for a big payout
//  - cut the coolant line, or cut the engines loose with the core still clamped on, and it goes critical:
//    a meltdown countdown, then a blast that wrecks everything close by (and the freighter with it).
//    Get clear, or race it to the depot before it blows.
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _l = new THREE.Vector3(), _o = new THREE.Vector3();
const MELT = 22;
export const SECTIONS = [
  { name: 'bridge', frame: 'keel_fore', label: 'Bridge', value: 1400, mass: 45, n: 2 },
  { name: 'engines', frame: 'keel_aft', label: 'Engine block', value: 1800, mass: 60, n: 4 },
];

let M = null;
function mats() {
  if (M) return M;
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.0, 0.25), toneMapped: false });
  M = {
    beam: addHullDetail(new THREE.MeshStandardMaterial({ color: 0x5d564d, roughness: 0.6, metalness: 0.6 }), { scale: 1.2, grime: 1.1, scratch: 0.8, bump: 0.8 }),
    collar: new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.45, metalness: 0.8 }),
    bolt: new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 0.3, metalness: 0.95 }),
    stripe: new THREE.MeshStandardMaterial({ map: stripeTex(), roughness: 0.6, metalness: 0.3 }),
    frost: new THREE.MeshStandardMaterial({ color: 0xd6e9ee, roughness: 0.35, metalness: 0.2, emissive: new THREE.Color(0.18, 0.42, 0.52), emissiveIntensity: 0.6 }),
    hot: new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.6, metalness: 0.7, emissive: new THREE.Color(3, 0.9, 0.2), emissiveIntensity: 1 }),
    glow,
  };
  return M;
}
function stripeTex() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 32; const x = c.getContext('2d');
  x.fillStyle = '#16181c'; x.fillRect(0, 0, 128, 32); x.fillStyle = '#ff5a1f';
  for (let i = -2; i < 10; i++) { x.beginPath(); x.moveTo(i * 16, 32); x.lineTo(i * 16 + 8, 32); x.lineTo(i * 16 + 24, 0); x.lineTo(i * 16 + 16, 0); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
}

// closest point on an oriented box (c, q, h) to p
function onBox(o, p, out) {
  _q.copy(o.q).invert(); _l.copy(p).sub(o.c).applyQuaternion(_q);
  _l.clamp(_o.copy(o.h).negate(), o.h);
  return out.copy(_l).applyQuaternion(o.q).add(o.c);
}

// an I-beam from a to b (site-local), split around the middle where the collar sits
function iBeam(len, w = 1.0) {
  const s = new THREE.Shape(), f = w / 2, t = 0.13;
  s.moveTo(-f, -f); s.lineTo(f, -f); s.lineTo(f, -f + t); s.lineTo(t / 2, -f + t); s.lineTo(t / 2, f - t); s.lineTo(f, f - t); s.lineTo(f, f); s.lineTo(-f, f); s.lineTo(-f, f - t); s.lineTo(-t / 2, f - t); s.lineTo(-t / 2, -f + t); s.lineTo(-f, -f + t); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1 });
  g.computeVertexNormals(); return g;
}

export class Breakup {
  constructor({ scene, world, salvage, ship, fx, getFxT }) {
    Object.assign(this, { scene, world, salvage, ship, fx, getFxT });
    const site = this.site = world.site.freighter; this.seams = []; this.sections = []; this.t = 0;
    site.group.updateMatrixWorld(true);
    for (const S of SECTIONS) {
      const part = site.byName[S.name], frame = site.byName[S.frame]; if (!part || !frame) continue;
      const it = this.salvage.items.find((x) => x.part === part) || this.salvage.spawn(site, { type: 'chunk', part: S.name, value: S.value, mass: S.mass });
      it.weld = 1e9; it.section = S; it.label = S.label;
      const sec = { S, part, frame, it, seams: [] }; this.sections.push(sec);
      this.buildStruts(sec);
    }
    this.buildReactor();
  }

  // place n struts across the gap between a section and the keel it hangs on
  buildStruts(sec) {
    const { part, frame, S } = sec, A = frame.obbsL, B = part.obbsL;
    // closest pair of points between any of the section's boxes and the keel's main box
    const main = A.reduce((m, o) => (o.h.lengthSq() > m.h.lengthSq() ? o : m), A[0]);
    let best = null;
    for (const o of B) {
      const a = new THREE.Vector3().copy(o.c), b = new THREE.Vector3();
      for (let i = 0; i < 6; i++) { onBox(main, a.copy(b.lengthSq() ? b : o.c), a); onBox(o, a, b); }
      const d = a.distanceTo(b); if (!best || d < best.d) best = { a, b, d, o };
    }
    // spread the struts round the contact, perpendicular to the keel, braced outward
    const ax = new THREE.Vector3(0, 0, 1).applyQuaternion(main.q);           // keel axis (z of its box)
    const toward = Math.sign(_v.copy(best.b).sub(main.c).dot(ax)) || 1;
    const u = new THREE.Vector3(1, 0, 0).applyQuaternion(main.q), w = new THREE.Vector3(0, 1, 0).applyQuaternion(main.q);
    for (let i = 0; i < S.n; i++) {
      const ang = (i + 0.5) / S.n * Math.PI * 2 + (S.n === 2 ? Math.PI / 2 : Math.PI / 4);
      const off = _v.copy(u).multiplyScalar(Math.cos(ang)).addScaledVector(w, Math.sin(ang));
      // keel end: on the keel box, set back along it; section end: on the section box nearest that
      const pa = onBox(main, _w.copy(best.a).addScaledVector(off, 6).addScaledVector(ax, -toward * 7), new THREE.Vector3());
      const pb = onBox(best.o, _w.copy(best.b).addScaledVector(off, 6).addScaledVector(ax, toward * 2), new THREE.Vector3());
      if (pa.distanceTo(pb) < 2.5) pb.addScaledVector(ax, toward * (2.5 - pa.distanceTo(pb)));
      this.addStrut(sec, pa, pb);
    }
  }

  addStrut(sec, a, b) {
    const mt = mats(), site = this.site, L = a.distanceTo(b), mid = a.clone().lerp(b, 0.5);
    _m.lookAt(b, a, Math.abs(_v.copy(b).sub(a).normalize().y) > 0.9 ? _w.set(1, 0, 0) : _w.set(0, 1, 0)); _q.setFromRotationMatrix(_m);
    const gap = 1.2, half = (L - gap) / 2;
    const mk = (from, parent) => {
      const g = new THREE.Group(); const beam = new THREE.Mesh(iBeam(half), mt.beam); beam.castShadow = beam.receiveShadow = true; g.add(beam);
      // end foot: a bolted plate where it meets the hull
      const foot = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.7, 0.16), mt.collar); foot.position.z = 0.06; g.add(foot);
      for (const [x, y] of [[-0.65, -0.65], [0.65, -0.65], [0.65, 0.65], [-0.65, 0.65]]) { const bt = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 6).rotateX(Math.PI / 2), mt.bolt); bt.position.set(x, y, 0.18); g.add(bt); }
      // the cut end, glows hot once severed
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.02, 0.05), mt.collar); cap.position.z = half; g.add(cap);
      g.position.copy(from); g.quaternion.copy(_q);
      if (from === b) g.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(_w.set(1, 0, 0), Math.PI));
      site.group.add(g); g.updateMatrixWorld(true); parent.node.attach(g);
      return { g, cap };
    };
    const A = mk(a, sec.frame), B = mk(b, sec.part);
    // the collar: an octagonal sleeve with hazard band and a blinking cut marker
    const col = new THREE.Group(); col.position.copy(mid); col.quaternion.copy(_q);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, gap + 0.9, 8, 1).rotateX(Math.PI / 2), mt.collar); col.add(sleeve);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.975, 0.975, 0.45, 8, 1, true).rotateX(Math.PI / 2), mt.stripe); col.add(band);
    for (let k = 0; k < 8; k++) { const bt = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 6), mt.bolt); const a2 = k / 8 * Math.PI * 2 + 0.39; bt.position.set(Math.cos(a2) * 0.98, Math.sin(a2) * 0.98, (k % 2 ? 1 : -1) * 0.7); bt.rotation.z = a2 + Math.PI / 2; col.add(bt); }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), mt.glow); lamp.position.set(0, 1.0, 0); col.add(lamp);
    site.group.add(col); col.updateMatrixWorld(true); sec.frame.node.attach(col);
    const seam = { kind: 'strut', sec, col, lamp, A, B, heat: 0, cut: false, ph: Math.random() * 6, wp: new THREE.Vector3(), r: 1.3, hotT: 0 };
    sec.seams.push(seam); this.seams.push(seam);
  }

  buildReactor() {
    const site = this.site, core = site.core; if (!core) return;
    const eng = site.byName.engines, mt = mats();
    core.weld = 1e9; core.safe = false; this.core = core;
    const c = core.body.pos.clone(); site.group.worldToLocal(c);           // core centre, site-local
    const R = { clamps: [], line: null, core, melt: -1 };
    this.reactor = R;
    // two C-clamps gripping the lower cap of the core, bolted down to the pedestal
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.9, 0); sh.lineTo(0.9, 1.5); sh.lineTo(0.2, 1.5); sh.lineTo(0.2, 1.2); sh.lineTo(0.6, 1.2); sh.lineTo(0.6, 0.3); sh.lineTo(0, 0.3); sh.closePath();
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.7, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 1 }); geo.translate(-0.45, -0.75, -0.35);
      const body = new THREE.Mesh(geo, mt.collar); body.castShadow = true; g.add(body);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.9, 0.74), mt.stripe); band.position.set(0.3, 0, 0); g.add(band);
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 6), mt.bolt); bolt.position.set(-0.05, 0.55, 0); g.add(bolt);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), mt.glow); lamp.position.set(0.3, 0.6, 0.4); g.add(lamp);
      g.position.set(c.x + s * 2.6, 14.95, c.z); g.rotation.y = s > 0 ? Math.PI : 0; g.scale.setScalar(1.5);   // on the housing's top ring, biting the core's cage
      site.group.add(g); g.updateMatrixWorld(true); eng.node.attach(g);
      const seam = { kind: 'clamp', g, lamp, heat: 0, cut: false, ph: Math.random() * 6, wp: new THREE.Vector3(), r: 1.2, hotT: 0, mesh: body };
      R.clamps.push(seam); this.seams.push(seam);
    }
    // the coolant line: a ribbed, frosted pipe that climbs out of the engine block into the core's base
    const pts = [[5.6, 6.0, -98.5], [5.5, 9.6, -99.4], [4.6, 12.6, -101.2], [2.2, c.y - 1.6, c.z + 0.6]].map((p) => new THREE.Vector3(...p));
    const curve = new THREE.CatmullRomCurve3(pts);
    const line = new THREE.Group();
    const pipe = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.3, 12, false), mt.frost); pipe.castShadow = true; line.add(pipe);
    for (let i = 1; i < 12; i++) { const t = i / 12, p = curve.getPointAt(t), tg = curve.getTangentAt(t); const r = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.06, 6, 14), mt.collar); r.position.copy(p); r.quaternion.setFromUnitVectors(_v.set(0, 0, 1), tg); line.add(r); }
    // warning tag on the pipe
    const tagP = curve.getPointAt(0.5), tag = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.02), mt.stripe); tag.position.copy(tagP).add(_v.set(0, 0.3, 0)); tag.lookAt(tagP.clone().add(new THREE.Vector3(1, 0.5, 0.3))); line.add(tag);
    site.group.add(line); line.updateMatrixWorld(true); eng.node.attach(line);
    const mid = curve.getPointAt(0.45);
    const seam = { kind: 'coolant', g: line, pipe, heat: 0, cut: false, wp: new THREE.Vector3(), r: 1.0, local: mid, curve, ph: 0, hotT: 0 };
    R.line = seam; this.seams.push(seam);
  }

  // world position of a seam's cut point
  where(s) {
    if (s.kind === 'strut') return s.col.getWorldPosition(s.wp);
    if (s.kind === 'clamp') return s.g.getWorldPosition(s.wp);
    s.g.updateWorldMatrix(true, false); return s.wp.copy(s.local).applyMatrix4(s.g.matrixWorld);   // coolant: built in site frame, rides the engines
  }

  // EVA aim: nearest uncut seam the eye ray passes close to
  pick(o, d, far) {
    let best = null;
    for (const s of this.seams) {
      if (s.cut) continue;
      if (s.kind === 'coolant' && this.reactor.melt >= 0) continue;
      this.where(s);
      const t = _v.copy(s.wp).sub(o).dot(d); if (t < 0 || t > far + 1) continue;
      const miss = _v.copy(o).addScaledVector(d, t).distanceTo(s.wp); if (miss > s.r) continue;
      if (best && best.dist < t) continue;
      const n = _w.copy(o).sub(s.wp).normalize().clone();
      best = { kind: 'seam', seam: s, dist: t, point: s.wp.clone(), normal: n, work: (dt) => this.work(s, dt), prog: () => s.heat };
    }
    if (best) this.onAim?.(best.seam);
    return best;
  }

  work(s, dt) {
    if (s.cut) return null;
    s.heat = Math.min(1, s.heat + dt / (s.kind === 'coolant' ? 0.9 : 2.2));
    if (s.heat < 1) return null;
    s.cut = true; s.hotT = 1;
    if (s.kind === 'strut') {
      s.col.visible = false; for (const h of [s.A, s.B]) h.cap.material = mats().hot.clone();
      s.capMats = [s.A.cap.material, s.B.cap.material];
      const sec = s.sec;
      if (sec.seams.every((x) => x.cut)) { this.free(sec); return 'pop'; }
      this.onEvent?.('strut', sec);
      return 'bolt';
    }
    if (s.kind === 'clamp') {
      s.g.visible = false;
      this.spray(s.wp, 30);
      if (this.reactor.clamps.every((x) => x.cut) && this.reactor.melt < 0) {
        const it = this.core; it.safe = true; it.unweld(_v.set(0, 1.2, 0).applyQuaternion(this.site.group.quaternion), _w.set(0.05, 0.1, 0));
        this.onEvent?.('core-free');
        return 'pop';
      }
      return 'bolt';
    }
    // the coolant line: wrong cut
    s.pipe.material = mats().hot; this.spray(s.wp, 60, true);
    this.meltdown();
    return 'pop';
  }

  free(sec) {
    const it = sec.it;
    this.site.group.updateMatrixWorld(true);
    // a gentle shove away from the keel so the section visibly comes loose
    const away = _v.copy(sec.part.centerL).applyMatrix4(this.site.group.matrixWorld).sub(this.site.pos).normalize().multiplyScalar(0.8);
    it.unweld(away.clone(), _w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.05));
    this.onEvent?.('section', sec);
    // the engines leaving with the reactor still clamped on rips the coolant feed
    if (sec.S.name === 'engines' && this.core && this.core.state === 'welded' && this.reactor.melt < 0) {
      this.core.safe = true; this.core.unweld(away.clone().multiplyScalar(0.5), _w.set(0.1, 0.2, 0));
      this.meltdown();
    }
  }

  meltdown() {
    const R = this.reactor; if (R.melt >= 0) return;
    R.melt = MELT; this.onEvent?.('meltdown', this.core);
  }

  spray(p, n, cold = false) {
    const fxT = this.getFxT();
    for (let i = 0; i < n; i++) this.fx.emit(p, _w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(cold ? 9 : 6), fxT, 0.4 + Math.random() * 0.8, 0.04, cold ? 0.4 : 0.02, cold ? K.RCS : K.SPARK, cold ? 1.6 : 0.6, 0.03);
  }

  get melting() { return this.reactor && this.reactor.melt >= 0 && this.core.state !== 'gone' && this.core.state !== 'captured'; }

  update(dt, time) {
    this.t += dt; const R = this.reactor;
    for (const s of this.seams) {
      if (s.cut) {
        if (s.hotT > 0) { s.hotT = Math.max(0, s.hotT - dt * 0.12); for (const m of s.capMats || []) m.emissiveIntensity = s.hotT * 1.5; }
        continue;
      }
      s.heat = Math.max(0, s.heat - dt * 0.25);
      if (s.lamp) s.lamp.visible = Math.sin(this.t * 2.6 + s.ph) > 0.4;
    }
    if (!R) return;
    // frost venting from the coolant line (a tell: this one is different)
    if (!R.line.cut && Math.random() < dt * 1.6) { R.line.g.updateWorldMatrix(true, false); const t = Math.random(); _v.copy(R.line.curve.getPointAt(t)).applyMatrix4(R.line.g.matrixWorld); this.fx.emit(_v, _w.set(Math.random() - 0.5, 0.6, Math.random() - 0.5).multiplyScalar(1.6), this.getFxT(), 1.2, 0.05, 0.5, K.RCS, 1.2, 0.01); }
    if (this.melting) {
      R.melt -= dt;
      const k = 1 - R.melt / MELT, fl = 0.5 + 0.5 * Math.sin(time * (8 + 30 * k));
      if (this.core.glow) this.core.glow.color.setRGB(2 + 6 * k * fl, 0.6 + 1.6 * k * fl, 0.2 + 0.6 * k);
      if (Math.random() < dt * (6 + 30 * k)) this.spray(this.core.body.pos, 3);
      if (R.melt <= 0) { R.melt = -2; this.blast(); }
    }
  }

  blast() {
    const core = this.core, p = core.body.pos.clone();
    if (core.state === 'towed') this.salvage.drop(core);
    core.state = 'gone'; core.obj.visible = false;
    // the engines and anything still on the keel go with it
    for (const sec of this.sections) if (sec.it.state === 'welded' || sec.it.body.pos.distanceTo(p) < 80) { sec.it.integrity = 0.25; if (sec.it.state === 'welded') { for (const s of sec.seams) s.cut = true; sec.it.unweld(_v.copy(sec.it.body.pos).sub(p).setLength(5), _w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.3)); } }
    for (const s of this.seams) if (!s.cut) { s.cut = true; if (s.col) s.col.visible = false; }
    if (this.site.state === 'ok' && p.distanceTo(this.site.pos) < 200) this.site.collapse();
    this.onBlast?.(p);
  }
}
