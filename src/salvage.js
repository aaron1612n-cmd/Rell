import * as THREE from 'three';
import { Body, solveRope } from './body.js';
import salvageData from './assets/salvage.json';
import { mats } from './assets.js';

// Salvage loop: hook something with the tow line (F / grab button), haul it to the depot's catch,
// get paid by what it's worth and how intact it arrives.
//  - free props (canisters, crates) just come along
//  - welded chunks (station pods, freighter containers) and seated reactor cores have to be torn off:
//    keep the line taut and burn away until the weld gives (boost does it fastest)
//  - a reactor core leaving its wreck destabilises it: the wreck shakes, then breaks apart
// Hooks for EVA (out-of-ship) play: items are plain Bodies with a `hook` point; anything with
// { pos, vel, towMass } can be the puller end of a rope, so a jetpack pilot can tow too.

const TAIL = new THREE.Vector3(0, -0.3, 2.06);   // tow eye on the ship's rear face (hull at z 1.88), local

// the tow eye the line runs from: a bolted plate with a ring, on the centreline of the rear face
export function addHitch(shipMesh) {
  const steel = new THREE.MeshStandardMaterial({ color: 0x3b3f45, roughness: 0.45, metalness: 0.85 });
  const g = new THREE.Group(); g.name = 'hitch';
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.08), steel); plate.position.set(0, -0.3, 1.9);
  const lug = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.16), steel); lug.position.set(0, -0.3, 1.98);
  const eye = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.022, 8, 18), steel); eye.position.copy(TAIL); eye.rotation.y = Math.PI / 2;
  for (const m of [plate, lug, eye]) { m.castShadow = true; g.add(m); }
  shipMesh.add(g);
  return g;
}
const _rc = new THREE.Raycaster(); _rc.layers.enableAll();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _f = new THREE.Vector3(), _cam = new THREE.Vector3();

// approximate an oriented box with a row of spheres along its long axis
function boxSpheres(obbsL, centre) {
  const out = [];
  for (const o of obbsL) {
    const h = [o.h.x, o.h.y, o.h.z]; const ax = h.indexOf(Math.max(...h));
    const r = Math.min(...h.filter((_, i) => i !== ax)) * 1.02;
    const n = Math.max(1, Math.ceil(h[ax] / r)), span = Math.max(0, h[ax] - r);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : -span + 2 * span * i / (n - 1);
      const v = new THREE.Vector3().setComponent(ax, t).applyQuaternion(o.q).add(o.c).sub(centre);
      out.push([v.x, v.y, v.z, r]);
    }
  }
  return out;
}

class Item {
  constructor(o) { Object.assign(this, o); this.integrity = 1; this.strain = 0; this.cap = null; }
  get hot() { return this.state === 'free' || this.state === 'welded'; }
  unweld(vel, angVel) {
    if (this.state !== 'welded') return;
    this.mgr.detach(this);
    this.state = this.mgr.ropes.some((r) => r.item === this) ? 'towed' : 'free';
    if (vel) this.body.vel.copy(vel); if (angVel) this.body.angVel.copy(angVel);
  }
}

export class Salvage {
  constructor({ scene, world, ship, models, onSpark, onImpact, onDeliver, onEvent, coarse }) {
    Object.assign(this, { scene, world, ship, onSpark, onImpact, onDeliver, onEvent, coarse });
    this.items = []; this.ropes = [];
    this.capacity = 1; this.range = 42; ship.towMass = 6;
    this.candidate = null; this.cool = 0;
    this.props = {}; models.salvage.traverse((o) => { if (salvageData[o.name] && !this.props[o.name]) this.props[o.name] = o; });
    this.ropeMesh = this.makeRopeMesh();
    for (const site of world.sites) for (const spec of site.salvageSpec || []) this.spawn(site, spec);
  }

  spawn(site, spec) {
    if (spec.type === 'chunk') {
      const part = site.byName[spec.part]; if (!part) return null;
      const M = part.frame();
      const pos = part.centerL.clone().applyMatrix4(M);
      M.decompose(_a, _q, _s);
      const body = new Body({ mass: spec.mass, spheres: boxSpheres(part.obbsL, part.centerL), pos, quat: _q });
      const it = new Item({ mgr: this, kind: 'chunk', site, part, body, obj: part.node, value: spec.value, state: 'welded', weld: 1, home: pos.clone() });
      part.salvage = it; this.items.push(it); return it;
    }
    const d = salvageData[spec.type];
    const pos = new THREE.Vector3(...spec.at).applyMatrix4(site.group.matrixWorld);
    const obj = this.props[spec.type].clone(); obj.position.set(0, 0, 0); obj.rotation.set(0, 0, 0);
    obj.traverse((m) => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    if (spec.type === 'core') quat.copy(site.group.quaternion);
    const body = new Body({ mass: d.mass, spheres: d.spheres, pos, quat });
    this.clear(site, body);
    if (spec.type !== 'core') body.angVel.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.25);
    this.scene.add(obj);
    const it = new Item({ mgr: this, kind: spec.type, site, body, obj, value: d.value, state: spec.type === 'core' ? 'welded' : 'free', weld: spec.type === 'core' ? 0.55 : 0, home: pos.clone() });
    if (it.kind === 'core') { site.core = it; obj.traverse((m) => { if (m.isMesh && m.material === mats.lamp) { m.material = it.glow = it.glow || mats.lamp.clone(); } }); }
    this.items.push(it); this.sync(it);
    return it;
  }

  // nudge a freshly placed prop out of any structure it was dropped into
  clear(site, body) {
    for (let k = 0; k < 40; k++) {
      let moved = false;
      for (const p of site.parts) for (const o of p.obbs) for (let i = 0; i < body.wp.length; i++) {
        const r = body.spheres[i].r + 0.4;
        _a.copy(body.wp[i]).sub(o.c).applyQuaternion(o.qi);
        _b.copy(_a).clamp(_c.copy(o.h).negate(), o.h);
        const d = _a.distanceTo(_b);
        if (d >= r) continue;
        if (d < 1e-4) { const ax = ['x', 'y', 'z'].reduce((m, a) => (o.h[a] - Math.abs(_a[a]) < o.h[m] - Math.abs(_a[m]) ? a : m), 'y'); _n.set(0, 0, 0)[ax] = Math.sign(_a[ax]) || 1; _n.multiplyScalar(o.h[ax] - Math.abs(_a[ax]) + r); }
        else _n.copy(_a).sub(_b).normalize().multiplyScalar(r - d);
        body.pos.add(_n.applyQuaternion(o.q)); body.updateSpheres(); moved = true;
      }
      if (!moved) break;
    }
  }

  // weld broke (or the wreck fell apart): the chunk leaves the site's colliders and becomes a body
  detach(it) {
    if (it.kind === 'chunk') {
      const pv = it.part.free(this.scene);
      it.obj = pv; it.body.pos.copy(pv.position); it.body.quat.copy(pv.quaternion); it.body.updateSpheres();
      this.world.dirty = true;
    }
    if (it.kind === 'core' && it.site.state === 'ok') it.site.destabilise(24);
  }

  towed() { return this.ropes.length; }

  // pick the best thing in front of the nose, within reach
  findCandidate() {
    const ship = this.ship, f = ship.forward(_f);
    let best = null, bs = 1e9;
    for (const it of this.items) {
      if (!it.hot || this.ropes.some((r) => r.item === it)) continue;
      const dc = it.body.pos.distanceTo(ship.pos); if (dc > this.range + it.body.radius + 30) continue;
      // nearest sphere surface
      let dmin = 1e9, sp = null;
      for (let i = 0; i < it.body.wp.length; i++) { const d = it.body.wp[i].distanceTo(ship.pos) - it.body.spheres[i].r; if (d < dmin) { dmin = d; sp = it.body.wp[i]; } }
      if (dmin > this.range) continue;
      _d.copy(sp).sub(ship.pos); const L = _d.length() || 1; const cos = _d.dot(f) / L;
      const cosC = it.body.pos.clone().sub(ship.pos).normalize().dot(f);
      const c = Math.max(cos, cosC); if (c < 0.72 && dmin > 6) continue;
      const s = dmin * (1 + 3 * (1 - c));
      if (s < bs) { bs = s; best = it; }
    }
    return best;
  }

  // F / grab: hook the candidate if there's room on the winch, otherwise let everything go
  grab() {
    if (this.cool > 0) return false;
    const c = this.candidate;
    if (c && this.ropes.length < this.capacity) { this.attach(c); this.cool = 0.25; return true; }
    if (this.ropes.length) { this.releaseAll(); this.cool = 0.25; return 'release'; }
    this.onEvent?.('miss'); return false;
  }

  attach(it) {
    const ship = this.ship, b = it.body; b.updateSpheres();
    // hook on the near face
    let best = 0, bd = 1e9; for (let i = 0; i < b.wp.length; i++) { const d = b.wp[i].distanceTo(ship.pos) - b.spheres[i].r; if (d < bd) { bd = d; best = i; } }
    const pa = TAIL.clone().applyQuaternion(ship.quat).add(ship.pos);
    // bite on the real surface: cast from the ship's tow eye at the nearest collider sphere, then the
    // body's centre; fall back to the sphere surface if the mesh is missed
    let hookW = null; it.obj.updateWorldMatrix(true, true);
    const meshes = []; it.obj.traverseVisible((o) => { if (o.isMesh) meshes.push(o); });
    for (const t of [b.wp[best], b.pos]) {
      _rc.set(pa, _d.copy(t).sub(pa).normalize()); _rc.far = pa.distanceTo(t) + b.radius;
      const h = _rc.intersectObjects(meshes, false)[0];
      if (h) { hookW = _a.copy(h.point).addScaledVector(_d, 0.05); break; }
    }
    if (!hookW) hookW = _a.copy(ship.pos).sub(b.wp[best]).normalize().multiplyScalar(b.spheres[best].r * 0.92).add(b.wp[best]);
    const hookL = hookW.clone().sub(b.pos).applyQuaternion(_q.copy(b.quat).invert());
    const d0 = pa.distanceTo(hookW);
    const rope = { item: it, a: ship, b: it.state === 'welded' ? null : b, hookL, pa, pb: hookW.clone(), rest: Math.max(5, d0), target: 9 + b.radius * 0.6, len: d0, tension: 0, shoot: 0, d0 };
    this.ropes.push(rope);
    if (it.state === 'free') it.state = 'towed';
    this.onEvent?.('hook', it);
  }

  releaseAll() {
    for (const r of this.ropes) if (r.item.state === 'towed') r.item.state = 'free';
    this.ropes.length = 0; this.onEvent?.('release');
  }

  drop(it) { this.ropes = this.ropes.filter((r) => { if (r.item !== it) return true; return false; }); }

  // ---- physics, called every fixed step ----------------------------------------------------
  step(dt, depot) {
    const ship = this.ship;
    this.cool = Math.max(0, this.cool - dt);
    // ropes first so contacts get the last word
    for (const r of this.ropes) {
      const it = r.item, b = it.body;
      r.pa.copy(TAIL).applyQuaternion(ship.quat).add(ship.pos);
      r.pb.copy(r.hookL).applyQuaternion(b.quat).add(b.pos);
      r.shoot = Math.min(1, r.shoot + dt / Math.max(0.12, r.d0 / 140));
      if (r.shoot < 1) continue;
      r.rest += (r.target - r.rest) * Math.min(1, dt * 0.9);          // winch reels in
      r.b = it.state === 'welded' ? null : b;
      solveRope(r, dt);
      if (it.state === 'welded') {
        // tearing a weld: only real tension counts, boost gets it done
        const over = Math.max(0, r.tension - 90);
        it.strain += over * dt / (220 * (it.weld || 1));
        it.strainVis = Math.min(1, over / 200);
        if (it.strain >= 1) {
          it.state = 'towed'; this.detach(it); r.b = b;
          this.onEvent?.('snap', it, r.pb);
        }
      }
    }
    this.ropes = this.ropes.filter((r) => r.item.state === 'towed' || r.item.state === 'welded');

    const world = this.world;
    for (const it of this.items) {
      if (it.state === 'welded' && it.part && it.site.tumble && it.site.active) {   // welded to something that moves
        const M = it.part.frame();
        it.body.pos.copy(it.part.centerL).applyMatrix4(M); M.decompose(_a, it.body.quat, _s); it.body.updateSpheres();
      }
      if (it.state === 'welded' || it.state === 'gone') continue;
      const b = it.body;
      if (it.state === 'captured') { this.stepCapture(it, dt, depot); continue; }
      const near = b.pos.distanceToSquared(ship.pos) < 450 * 450;
      if (!near && it.state !== 'towed') continue;
      b.integrate(dt);
      let hit = 0;
      // static world
      for (let i = 0; i < b.wp.length; i++) {
        world.sphereContacts(b.wp[i], b.spheres[i].r, (n, pen, p, sv) => {
          b.pos.addScaledVector(n, pen * 0.8);
          b.velAt(p, _c); if (sv) _c.sub(sv);
          const vn = _c.dot(n); if (vn >= 0) return;
          const j = -(1.3) * vn / b.kInv(p, n);
          b.impulse(_d.copy(n).multiplyScalar(j), p);
          // a bit of friction so things tumble instead of skating
          _c.addScaledVector(n, -vn); const vt = _c.length();
          if (vt > 1e-3) { const jt = Math.min(vt / b.kInv(p, _c.normalize()), 0.3 * j); b.impulse(_d.copy(_c).multiplyScalar(-jt), p); }
          hit = Math.max(hit, -vn);
        });
      }
      if (hit) b.updateSpheres();
      // ship
      for (let i = 0; i < b.wp.length; i++) {
        _n.copy(ship.pos).sub(b.wp[i]); const dist = _n.length(), R = ship.radius + b.spheres[i].r;
        if (dist >= R || dist < 1e-5) continue;
        _n.divideScalar(dist); const pen = R - dist;
        const ks = 1 / ship.towMass, p = _a.copy(b.wp[i]).addScaledVector(_n, b.spheres[i].r);
        const kb = b.kInv(p, _n);
        ship.pos.addScaledVector(_n, pen * ks / (ks + b.invMass)); b.pos.addScaledVector(_n, -pen * b.invMass / (ks + b.invMass));
        const vn = _c.copy(ship.vel).sub(b.velAt(p, _d)).dot(_n);
        if (vn < 0) {
          const j = -1.4 * vn / (ks + kb);
          ship.vel.addScaledVector(_n, j * ks); b.impulse(_d.copy(_n).multiplyScalar(-j), p);
          if (-vn > 1.5) this.onImpact?.({ speed: -vn, normal: _n.clone(), point: p.clone() }, b.mass);
          hit = Math.max(hit, -vn);
        }
        b.updateSpheres();
      }
      // drifting debris nudges cargo around (and vice versa)
      if (near) for (const dbr of world.debris) {
        if (Math.abs(dbr.pos.x - b.pos.x) > b.radius + dbr.radius) continue;
        for (let i = 0; i < b.wp.length; i++) {
          _n.copy(dbr.pos).sub(b.wp[i]); const dist = _n.length(), R = dbr.radius + b.spheres[i].r;
          if (dist >= R || dist < 1e-5) continue;
          _n.divideScalar(dist); const p = _a.copy(b.wp[i]).addScaledVector(_n, b.spheres[i].r);
          const kd = 1 / dbr.mass, kb = b.kInv(p, _n), pen = R - dist;
          dbr.pos.addScaledVector(_n, pen * kd / (kd + b.invMass)); b.pos.addScaledVector(_n, -pen * b.invMass / (kd + b.invMass));
          const vn = _c.copy(dbr.vel).sub(b.velAt(p, _d)).dot(_n);
          if (vn < 0) { const j = -1.3 * vn / (kd + kb); dbr.vel.addScaledVector(_n, j * kd); b.impulse(_d.copy(_n).multiplyScalar(-j), p); hit = Math.max(hit, -vn); }
          b.updateSpheres();
        }
      }
      // hard knocks cost value
      if (hit > 5) { it.integrity = Math.max(0.25, it.integrity - (hit - 5) * 0.035); it.knock = 1; }
      // delivered?
      if (depot && it.state !== 'captured') {
        _a.copy(b.pos).applyMatrix4(depot.inv);
        const C = depot.catchL, mx = C.h.x, my = C.h.y;
        if (Math.abs(_a.x - C.c.x) < mx && Math.abs(_a.y - C.c.y) < my && _a.z > C.c.z - C.h.z && _a.z < C.mouth.z + 6) this.capture(it, depot);
      }
    }
    // towed loads knock each other
    for (let i = 0; i < this.ropes.length; i++) for (let j = i + 1; j < this.ropes.length; j++) this.pair(this.ropes[i].item.body, this.ropes[j].item.body);
  }

  pair(A, B) {
    for (let i = 0; i < A.wp.length; i++) for (let k = 0; k < B.wp.length; k++) {
      _n.copy(B.wp[k]).sub(A.wp[i]); const dist = _n.length(), R = A.spheres[i].r + B.spheres[k].r;
      if (dist >= R || dist < 1e-5) continue;
      _n.divideScalar(dist); const p = _a.copy(A.wp[i]).addScaledVector(_n, A.spheres[i].r), pen = R - dist;
      const ka = A.kInv(p, _n), kb = B.kInv(p, _n);
      A.pos.addScaledVector(_n, -pen * A.invMass / (A.invMass + B.invMass)); B.pos.addScaledVector(_n, pen * B.invMass / (A.invMass + B.invMass));
      const vn = _c.copy(B.velAt(p, _c)).sub(A.velAt(p, _d)).dot(_n);
      if (vn < 0) { const j = -1.2 * vn / (ka + kb); A.impulse(_d.copy(_n).multiplyScalar(-j), p); B.impulse(_d.copy(_n).multiplyScalar(j), p); }
      A.updateSpheres(); B.updateSpheres();
    }
  }

  capture(it, depot) {
    this.drop(it);
    it.state = 'captured'; it.capT = 0;
    // pull it to the grapple plate at the back of the catch
    it.capFrom = it.body.pos.clone(); it.capQ = it.body.quat.clone();
    it.capTo = depot.catchL.c.clone().setZ(depot.catchL.c.z - depot.catchL.h.z + 4 + Math.min(10, it.body.radius)).applyMatrix4(depot.group.matrixWorld);
    const v = Math.round(it.value * it.integrity / 10) * 10;
    it.paid = v;
    this.onDeliver?.(it, v);
  }

  stepCapture(it, dt) {
    it.capT += dt;
    const k = Math.min(1, it.capT / 2.2), e = 1 - Math.pow(1 - k, 3);
    it.body.pos.lerpVectors(it.capFrom, it.capTo, e);
    it.body.angVel.multiplyScalar(Math.exp(-3 * dt)); it.body.integrate(0);
    const w = it.body.angVel.length(); if (w > 1e-5) { _q.setFromAxisAngle(_a.copy(it.body.angVel).divideScalar(w), w * dt); it.body.quat.premultiply(_q); }
    if (it.capT > 3.4) { it.state = 'gone'; it.obj.visible = false; this.onEvent?.('processed', it); }
  }

  // ---- visuals, once per frame --------------------------------------------------------------
  sync(it) {
    const o = it.obj; if (!o || (it.state === 'welded' && it.part)) return;   // welded chunks are the site's own mesh
    o.position.copy(it.body.pos); o.quaternion.copy(it.body.quat);
    if (it.state === 'captured') { const s = it.capT > 2.6 ? Math.max(0.001, 1 - (it.capT - 2.6) / 0.8) : 1; o.scale.setScalar(s); }
  }

  update(dt, time, camera) {
    this.candidate = this.findCandidate();
    for (const it of this.items) {
      if (it.state !== 'welded' && it.state !== 'gone') this.sync(it);
      if (it.glow) {
        const unstable = it.site.state === 'unstable';
        const p = it.state === 'welded' ? 0.8 + 0.3 * Math.sin(time * 2.2) : 1.4 + 0.6 * Math.sin(time * (unstable ? 14 : 5));
        it.glow.color.setRGB(p * 1.6, p * 0.55, p * 0.2);
      }
    }
    this.drawRopes(camera, time);
  }

  // tow lines: camera-facing ribbons, slack ones bow, the active hook glows
  makeRopeMesh() {
    const MAXR = 4, SEG = 20;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(MAXR * (SEG + 1) * 2 * 3), uv = new Float32Array(MAXR * (SEG + 1) * 2 * 2), idx = [];
    for (let r = 0; r < MAXR; r++) for (let i = 0; i < SEG; i++) { const b = r * (SEG + 1) * 2 + i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uT: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: `varying vec2 vUv; uniform float uT;
        void main(){
          float edge = 1. - abs(vUv.y * 2. - 1.);
          float heat = floor(vUv.x / 1000.) / 9.;       // weld strain, packed into uv.x
          vec3 c = mix(vec3(.82,.78,.7), vec3(1.6,.6,.2), heat);
          gl_FragColor = vec4(c * (.55 + .45 * edge), smoothstep(0., .45, edge) * .95);
        }`,
    });
    const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 3; this.scene.add(m);
    m.userData = { MAXR, SEG };
    return m;
  }

  drawRopes(camera, time) {
    const m = this.ropeMesh, { MAXR, SEG } = m.userData;
    const pos = m.geometry.attributes.position.array, uv = m.geometry.attributes.uv.array;
    camera.getWorldPosition(_cam);
    let used = 0;
    for (const r of this.ropes.slice(0, MAXR)) {
      const a = r.pa, bEnd = _b.copy(r.pa).lerp(r.pb, r.shoot);
      const L = a.distanceTo(bEnd), slack = r.shoot < 1 ? 0 : Math.max(0, r.rest - r.len);
      // sag direction: perpendicular to the line, roughly "down" in the ship's frame
      _n.set(0, -1, 0).applyQuaternion(this.ship.quat); _d.copy(bEnd).sub(a).normalize(); _n.addScaledVector(_d, -_n.dot(_d)).normalize();
      const sag = Math.min(4, slack * 0.6 + 0.02 * L);
      const heat = Math.round((r.item.strainVis || 0) * 9) * 1000;
      const w = Math.max(0.07, a.distanceTo(_cam) * 0.0021);
      const base = used * (SEG + 1) * 2;
      for (let i = 0; i <= SEG; i++) {
        const t = i / SEG;
        const wob = r.item.state === 'welded' ? Math.sin(t * 40 + time * 60) * 0.04 * (r.item.strainVis || 0) : 0;
        _a.copy(a).lerp(bEnd, t).addScaledVector(_n, 4 * t * (1 - t) * sag + wob);
        // side vector facing the camera
        _c.copy(_a).sub(_cam); _s.crossVectors(_d, _c).normalize().multiplyScalar(w);
        const k = (base + i * 2) * 3;
        pos[k] = _a.x + _s.x; pos[k + 1] = _a.y + _s.y; pos[k + 2] = _a.z + _s.z;
        pos[k + 3] = _a.x - _s.x; pos[k + 4] = _a.y - _s.y; pos[k + 5] = _a.z - _s.z;
        const u = (base + i * 2) * 2; uv[u] = heat + t; uv[u + 1] = 0; uv[u + 2] = heat + t; uv[u + 3] = 1;
      }
      used++;
    }
    m.geometry.setDrawRange(0, used * SEG * 6);
    m.visible = used > 0;
    m.geometry.attributes.position.needsUpdate = true; m.geometry.attributes.uv.needsUpdate = true;
  }
}
