import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { addHullDetail } from './hullDetail.js';

// Salvage you work by hand on EVA: equipment lockers bolted to station hulls. Each one has a cover held
// by four bolts. Cut the bolts with the multi-tool and the cover kicks off; inside sits a cargo core.
// Hold the tool on the core to clamp a tow tag on it and your ship's winch reels it in.
// Lockers are placed at load by raycasting the real station surface (only flat, open spots), spread
// over several frames so a phone never stalls. Lockers go on every wreck site, bolted to (parented to) the
// chunk they sit on, so they ride along when a wreck breaks apart. Chunks that are tow salvage get none.

const W = 1.06, H = 0.72, D = 0.3;              // locker outer size (local: x across, y up the face, z out of the hull)
const BOLTS = [[-0.43, -0.27], [0.43, -0.27], [0.43, 0.27], [-0.43, 0.27]];
const KINDS = [{ kind: 'cell', value: 120 }, { kind: 'core', value: 240 }, { kind: 'drive', value: 400 }];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _p = new THREE.Plane();

let seed = 4242;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

function stencilTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 176; const x = c.getContext('2d');
  x.fillStyle = '#cbc4b1'; x.fillRect(0, 0, 256, 176);
  for (let i = 0; i < 1400; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '40,36,30' : '255,250,240'},${Math.random() * 0.08})`; x.fillRect(Math.random() * 256, Math.random() * 176, 1 + Math.random() * 3, 1 + Math.random() * 3); }
  // hazard band along the top, a lift arrow, stencil blocks (no words: shapes only)
  x.save(); x.beginPath(); x.rect(0, 0, 256, 22); x.clip(); x.fillStyle = '#16181c'; x.fillRect(0, 0, 256, 22);
  x.fillStyle = '#ff5a1f'; for (let i = -2; i < 14; i++) { x.beginPath(); x.moveTo(i * 22, 22); x.lineTo(i * 22 + 11, 22); x.lineTo(i * 22 + 33, 0); x.lineTo(i * 22 + 22, 0); x.fill(); } x.restore();
  x.fillStyle = 'rgba(28,26,22,.8)';
  x.beginPath(); x.moveTo(128, 50); x.lineTo(150, 78); x.lineTo(138, 78); x.lineTo(138, 112); x.lineTo(118, 112); x.lineTo(118, 78); x.lineTo(106, 78); x.closePath(); x.fill();
  for (let i = 0; i < 5; i++) x.fillRect(24 + i * 9, 140, 6, 14);
  x.fillRect(180, 140, 50, 5); x.fillRect(180, 149, 34, 5);
  x.strokeStyle = 'rgba(28,26,22,.55)'; x.lineWidth = 2; x.strokeRect(8, 30, 240, 138);
  // grime run-off
  for (let i = 0; i < 30; i++) { const gx = Math.random() * 256, gr = x.createLinearGradient(gx, 100, gx, 176); gr.addColorStop(0, 'rgba(60,50,40,0)'); gr.addColorStop(1, `rgba(60,50,40,${Math.random() * 0.25})`); x.fillStyle = gr; x.fillRect(gx, 100, 2 + Math.random() * 6, 76); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function tint(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo;
}

let dotTex = null;
function glowDot() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, '#fff'); g.addColorStop(0.2, 'rgba(255,255,255,.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return (dotTex = new THREE.CanvasTexture(c));
}

export class Lockers {
  constructor(scene, world, { coarse }) {
    this.scene = scene; this.world = world; this.coarse = coarse;
    this.lockers = []; this.towing = []; this.loose = [];
    this.onStow = () => {};
    this.M = {
      shell: addHullDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.25 }), { scale: 3, grime: 0.7, scratch: 0.5, bump: 0.8 }),
      inner: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8, metalness: 0.4, side: THREE.DoubleSide }),
      plate: new THREE.MeshStandardMaterial({ map: stencilTexture(), roughness: 0.62, metalness: 0.3 }),
      bolt: new THREE.MeshStandardMaterial({ color: 0x8d8a83, roughness: 0.35, metalness: 0.9 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x26282c, roughness: 0.45, metalness: 0.8 }),
      core: new THREE.MeshStandardMaterial({ color: 0x9c978c, roughness: 0.3, metalness: 0.85 }),
      glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(4.5, 1.4, 0.35) }),
      beacon: new THREE.SpriteMaterial({ map: glowDot(), color: 0xffa040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    };
    this.geo = {
      shell: this.shellGeo(), plate: new RoundedBoxGeometry(W - 0.06, H - 0.06, 0.03, 2, 0.008),
      bolt: new THREE.CylinderGeometry(0.03, 0.03, 0.035, 6).rotateX(Math.PI / 2),
      washer: new THREE.CylinderGeometry(0.042, 0.042, 0.006, 16).rotateX(Math.PI / 2),
    };
    // tow lines: one segment each, updated per frame
    this.lineGeo = new THREE.BufferGeometry(); this.lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * 8), 3));
    this.lines = new THREE.LineSegments(this.lineGeo, new THREE.LineBasicMaterial({ color: 0xff7a3a, transparent: true, opacity: 0.55 }));
    this.lines.frustumCulled = false; scene.add(this.lines);
    this.t = 0;
    this.placer = this.place();
  }

  shellGeo() {
    // open-front box: back plate + four walls (merged by hand into one geometry with tinted vertex colours)
    const parts = [], wt = 0.035;
    const add = (w, h, d, x, y, z) => { const g = new RoundedBoxGeometry(w, h, d, 1, 0.008); g.translate(x, y, z); parts.push(g); };
    add(W, H, wt, 0, 0, wt / 2);
    add(W, wt, D, 0, H / 2 - wt / 2, D / 2); add(W, wt, D, 0, -H / 2 + wt / 2, D / 2);
    add(wt, H, D, W / 2 - wt / 2, 0, D / 2); add(wt, H, D, -W / 2 + wt / 2, 0, D / 2);
    // mounting feet
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) add(0.12, 0.12, 0.03, sx * (W / 2 + 0.03), sy * (H / 2 - 0.08), 0.015);
    const merged = mergeGeos(parts); tint(merged, 0x9a968c); return merged;
  }

  // incremental placement: a generator that does a few rays per call
  *place() {
    const rc = new THREE.Raycaster();
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    const placed = [];
    for (const site of this.world.sites) {
      if (site.kind !== 'wreck') continue;
      site.group.updateMatrixWorld(true);
      const ring = site.ringNode, meshes = [];
      site.group.traverse((o) => { if (!o.isMesh) return; let p = o; while (p) { if (p === ring) return; p = p.parent; } meshes.push(o); });
      const cast = (o, d, far = 60) => { rc.set(o, d); rc.far = far; const h = rc.intersectObjects(meshes, false)[0]; if (!h || !h.face) return null; return { p: h.point, n: h.face.normal.clone().transformDirection(h.object.matrixWorld), d: h.distance }; };
      const cands = [];
      for (const part of site.parts) {
        if (part.salvage) continue;
        part.sync(0);
        for (const o of part.obbs) for (let a = 0; a < 3; a++) for (const sgn of [-1, 1]) {
          const hn = o.h.getComponent(a), t1 = (a + 1) % 3, t2 = (a + 2) % 3, h1 = o.h.getComponent(t1), h2 = o.h.getComponent(t2);
          if (h1 < 0.9 || h2 < 0.9) continue;
          for (let k = 0; k < 2; k++) cands.push({ part, o, a, sgn, hn, t1, t2, u: (rnd() * 2 - 1) * Math.max(0, h1 - 1), v: (rnd() * 2 - 1) * Math.max(0, h2 - 1), r: rnd() });
        }
      }
      cands.sort((a, b) => b.r - a.r);
      const want = (site.id === 'meridian' ? 10 : 6) * (this.coarse ? 0.75 : 1);
      let n = 0;
      for (const c of cands) {
        if (n >= want) break;
        const q = c.o.q, nrm = axes[c.a].clone().multiplyScalar(c.sgn).applyQuaternion(q);
        const t1 = axes[c.t1].clone().applyQuaternion(q), t2 = axes[c.t2].clone().applyQuaternion(q);
        const base = c.o.c.clone().addScaledVector(t1, c.u).addScaledVector(t2, c.v);
        const origin = base.clone().addScaledVector(nrm, c.hn + 8), dir = nrm.clone().negate();
        const hit = cast(origin, dir); yield;
        if (!hit || hit.n.dot(nrm) < 0.92 || hit.d > c.hn + 9.5) continue;
        const p = hit.p;
        // keep clear of a spinning ring's sweep (ring lies in the site's local xy plane) and of other lockers
        if (ring) { const lp = site.group.worldToLocal(p.clone()); if (Math.abs(lp.z) < 7 && Math.hypot(lp.x, lp.y) > 10) continue; }
        if (placed.some((x) => x.distanceTo(p) < 13)) continue;
        let flat = true;
        for (const [su, sv] of [[-0.62, -0.45], [0.62, -0.45], [0.62, 0.45], [-0.62, 0.45]]) {
          const o2 = origin.clone().addScaledVector(t1, su).addScaledVector(t2, sv); const h2 = cast(o2, dir);
          if (!h2 || Math.abs(h2.d - hit.d) > 0.1 || h2.n.dot(nrm) < 0.85) { flat = false; break; }
        }
        yield;
        if (!flat) continue;
        if (cast(p.clone().addScaledVector(nrm, 0.05), nrm, 2.5)) continue;   // open space in front
        placed.push(p.clone()); n++;
        this.addLocker(p, nrm, t1, this.lockers.length, c.part.node);
      }
    }
  }

  addLocker(p, n, up, i, parent) {
    const g = new THREE.Group();
    // local z = surface normal, local y = one of the box axes
    const x = new THREE.Vector3().crossVectors(up, n).normalize(), y = new THREE.Vector3().crossVectors(n, x);
    _m.makeBasis(x, y, n); g.quaternion.setFromRotationMatrix(_m); g.position.copy(p).addScaledVector(n, 0.004);
    const shell = new THREE.Mesh(this.geo.shell, this.M.shell); shell.castShadow = shell.receiveShadow = true; g.add(shell);
    const inner = new THREE.Mesh(new THREE.BoxGeometry(W - 0.07, H - 0.07, D - 0.04), this.M.inner); inner.position.z = D / 2 + 0.01; g.add(inner);
    const K = KINDS[i % 3 === 2 && i > 3 ? 2 : i % 2];
    const core = this.buildCore(K.kind); core.position.z = 0.16; g.add(core);
    const cover = new THREE.Group(); cover.position.z = D + 0.016; g.add(cover);
    const plate = new THREE.Mesh(this.geo.plate, this.M.plate); plate.castShadow = plate.receiveShadow = true; cover.add(plate);
    const bolts = BOLTS.map(([bx, by]) => {
      const m = new THREE.Mesh(this.geo.bolt, this.M.bolt.clone()); m.position.set(bx, by, 0.03); cover.add(m);
      const w = new THREE.Mesh(this.geo.washer, this.M.dark); w.position.set(bx, by, 0.017); cover.add(w);
      return { m, heat: 0, cut: false, local: new THREE.Vector3(bx, by, D + 0.05) };
    });
    const beacon = new THREE.Sprite(this.M.beacon.clone()); beacon.scale.setScalar(0.5); beacon.position.set(W / 2 - 0.05, H / 2 + 0.03, D * 0.7); g.add(beacon);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), this.M.glow); lamp.position.copy(beacon.position); g.add(lamp);
    this.scene.add(g); g.updateMatrixWorld(true);
    if (parent) { parent.updateWorldMatrix(true, false); parent.attach(g); }
    const L = { g, cover, plate, bolts, core, beacon, lamp, kind: K.kind, value: K.value, state: 'bolted', ph: rnd() * 6, tag: 0, n: n.clone(), nL: new THREE.Vector3(0, 0, 1), wp: new THREE.Vector3(), wq: new THREE.Quaternion(), coverV: new THREE.Vector3(), coverW: new THREE.Vector3() };
    this.track(L); this.lockers.push(L);
  }

  // world pose of a locker (its chunk may be drifting)
  track(L) { L.g.updateWorldMatrix(true, false); L.g.matrixWorld.decompose(L.wp, L.wq, _v); L.n.set(0, 0, 1).applyQuaternion(L.wq); }

  buildCore(kind) {
    const g = new THREE.Group(), M = this.M;
    const m = (geo, mat, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
    if (kind === 'cell') {
      m(new THREE.CylinderGeometry(0.1, 0.1, 0.62, 18).rotateZ(Math.PI / 2), M.core);
      for (const x of [-0.2, 0, 0.2]) m(new THREE.CylinderGeometry(0.104, 0.104, 0.03, 18).rotateZ(Math.PI / 2), x === 0 ? M.glow : M.dark, x);
      for (const x of [-0.33, 0.33]) m(new THREE.CylinderGeometry(0.06, 0.08, 0.04, 14).rotateZ(Math.PI / 2), M.dark, x);
    } else if (kind === 'core') {
      m(new THREE.SphereGeometry(0.15, 20, 14), M.core);
      m(new THREE.TorusGeometry(0.16, 0.012, 6, 28), M.glow);
      for (let i = 0; i < 4; i++) { const b = m(new THREE.BoxGeometry(0.03, 0.4, 0.03), M.dark); b.rotation.z = i * Math.PI / 4; }
    } else {
      for (let i = 0; i < 3; i++) m(tint(new RoundedBoxGeometry(0.5, 0.12, 0.2, 2, 0.015), 0x5c5a55), M.shell, 0, -0.14 + i * 0.14);
      for (let i = 0; i < 3; i++) m(new THREE.BoxGeometry(0.06, 0.02, 0.005), M.glow, 0.18, -0.14 + i * 0.14, 0.101);
      m(new THREE.BoxGeometry(0.04, 0.44, 0.24), M.dark, -0.27);
    }
    g.userData.kind = kind;
    return g;
  }

  // What does a ray from the eye hit? Lockers only (cheap plane test). Returns the closest workable target.
  pick(o, d, far) {
    let best = null;
    for (const L of this.lockers) {
      if (L.state === 'empty' || L.state === 'towing') continue;
      _v.copy(L.wp).sub(o); if (_v.lengthSq() > (far + 2) * (far + 2)) continue;
      // into locker space
      _q.copy(L.wq).invert();
      const lo = _v.copy(o).sub(L.wp).applyQuaternion(_q), ld = _v2.copy(d).applyQuaternion(_q);
      if (ld.z >= -1e-4) continue;
      const zf = L.state === 'bolted' ? D + 0.05 : D * 0.6, t = (zf - lo.z) / ld.z;
      if (t < 0 || t > far) continue;
      const hx = lo.x + ld.x * t, hy = lo.y + ld.y * t;
      if (Math.abs(hx) > W / 2 + 0.1 || Math.abs(hy) > H / 2 + 0.1) continue;
      if (best && best.dist < t) continue;
      if (L.state === 'bolted') {
        // the nearest uncut bolt to where you aim
        let bi = -1, bd = 1e9; L.bolts.forEach((b, i) => { if (b.cut) return; const dd = Math.hypot(b.local.x - hx, b.local.y - hy); if (dd < bd) { bd = dd; bi = i; } });
        if (bi < 0) continue;
        best = { kind: 'bolt', L, i: bi, dist: t, point: L.g.localToWorld(L.bolts[bi].local.clone()), normal: L.n };
      } else best = { kind: 'core', L, dist: t, point: L.g.localToWorld(new THREE.Vector3(hx, hy, D * 0.55)), normal: L.n };
    }
    return best;
  }

  // apply the tool to a target for dt. Returns an event name when something gives.
  work(T, dt) {
    const L = T.L;
    if (T.kind === 'bolt') {
      const b = L.bolts[T.i]; b.heat = Math.min(1, b.heat + dt / 0.7);
      if (b.heat >= 1 && !b.cut) {
        b.cut = true; b.m.visible = false;
        if (L.bolts.every((x) => x.cut)) { L.state = 'open'; L.coverV.copy(L.n).multiplyScalar(1.4).add(_v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.5)); L.coverW.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2.4); this.detachCover(L); return 'pop'; }
        return 'bolt';
      }
      return null;
    }
    if (T.kind === 'core') {
      L.tag = Math.min(1, L.tag + dt / 0.6);
      if (L.tag >= 1) { this.startTow(L); return 'tag'; }
    }
    return null;
  }

  detachCover(L) {
    // the cover becomes a free body in world space
    L.cover.updateMatrixWorld(true); const c = L.cover;
    c.matrixWorld.decompose(c.position, c.quaternion, c.scale); this.scene.add(c);
    this.loose.push({ o: c, v: L.coverV, w: L.coverW, life: 40 });
  }

  startTow(L) {
    L.state = 'towing';
    const c = L.core; c.updateMatrixWorld(true); c.matrixWorld.decompose(c.position, c.quaternion, c.scale); this.scene.add(c);
    // tag: a blinking clamp on the core
    const tag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), this.M.glow); tag.position.set(0, 0.12, 0.08); c.add(tag);
    this.towing.push({ L, o: c, v: L.n.clone().multiplyScalar(0.6), t: 0, tag });
  }

  update(dt, ship, shipPos) {
    this.t += dt;
    // finish placing (time-sliced)
    if (this.placer) { const t0 = performance.now(); while (performance.now() - t0 < 5) { if (this.placer.next().done) { this.placer = null; break; } } }
    for (const L of this.lockers) {
      if (L.state !== 'empty') this.track(L);
      const on = L.state === 'bolted' || L.state === 'open';
      const blink = on ? (Math.sin(this.t * 2.6 + L.ph) > 0.55 ? 1 : 0.08) : 0;
      L.beacon.material.opacity = blink; L.lamp.visible = on;
      // bolt heat glow cools when not worked
      for (const b of L.bolts) if (!b.cut) { b.heat = Math.max(0, b.heat - dt * 0.35); b.m.material.emissive.setRGB(b.heat * 3.2, b.heat * 1.0, b.heat * 0.25); }
      if (L.state === 'open') { const k = 0.5 + 0.5 * Math.sin(this.t * 5); L.core.scale.setScalar(1 + L.tag * 0.04 * k); }
    }
    for (let i = this.loose.length - 1; i >= 0; i--) {
      const f = this.loose[i]; f.o.position.addScaledVector(f.v, dt);
      f.o.rotation.x += f.w.x * dt; f.o.rotation.y += f.w.y * dt; f.o.rotation.z += f.w.z * dt;
      f.life -= dt; if (f.life < 0) { this.scene.remove(f.o); this.loose.splice(i, 1); }
    }
    // tow: spring toward the ship's belly latch, speed capped
    const pos = this.lineGeo.attributes.position.array; let n = 0;
    const latch = _v2.set(0, -0.55, 0.7).applyQuaternion(ship.quat).add(shipPos);
    for (let i = this.towing.length - 1; i >= 0; i--) {
      const T = this.towing[i]; T.t += dt;
      _v.copy(latch).sub(T.o.position); const d = _v.length();
      const want = _v.multiplyScalar(Math.min(7, 0.4 + d * 0.8) / Math.max(d, 1e-3)).add(ship.vel);
      T.v.lerp(want, 1 - Math.exp(-(T.t < 0.6 ? 1.2 : 2.4) * dt));
      T.o.position.addScaledVector(T.v, dt); T.o.rotation.x += dt * 0.6; T.o.rotation.y += dt * 0.4;
      T.tag.visible = (this.t * 4) % 1 < 0.5;
      if (n < 8) { pos.set([latch.x, latch.y, latch.z, T.o.position.x, T.o.position.y, T.o.position.z], n * 6); n++; }
      if (d < 0.9) { this.scene.remove(T.o); this.towing.splice(i, 1); T.L.state = 'empty'; this.onStow(T.L); }
    }
    this.lineGeo.setDrawRange(0, n * 2); this.lineGeo.attributes.position.needsUpdate = true;
  }

  nearest(p) { let best = null, bd = 1e9; for (const L of this.lockers) { if (L.state !== 'bolted' && L.state !== 'open') continue; const d = L.wp.distanceTo(p); if (d < bd) { bd = d; best = L; } } return best ? { L: best, d: bd } : null; }
}

function mergeGeos(list) {
  // minimal merge for non-indexed / indexed geometries with position, normal, uv
  let nv = 0, ni = 0; for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), I = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    P.set(g.attributes.position.array, ov * 3); N.set(g.attributes.normal.array, ov * 3); if (g.attributes.uv) U.set(g.attributes.uv.array, ov * 2);
    if (g.index) { for (let k = 0; k < g.index.count; k++) I[oi + k] = g.index.array[k] + ov; oi += g.index.count; } else { for (let k = 0; k < c; k++) I[oi + k] = ov + k; oi += c; }
    ov += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  out.setIndex(new THREE.BufferAttribute(I, 1)); return out;
}
