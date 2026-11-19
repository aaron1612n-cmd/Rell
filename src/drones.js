import * as THREE from 'three';
import { K } from './gpufx.js';
import { addHullDetail } from './hullDetail.js';

// Rival salvage drones. They pick up loose cargo near the wrecks, and they go after cargo you've claimed:
// a drone runs down your tow, clamps onto the load and drags against you while it cuts your line.
// Fight back three ways:
//  - ram it: hit a drone faster than RAM m/s and it breaks apart (bounty paid); slower just knocks it off
//  - outrun it: drones top out at CHASE m/s, so boost away (Hold cruise helps on a long haul)
//  - jam it (J, needs the hangar's jammer): a pulse that stuns every drone in range, and it lets go
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const SPEED = 16, CHASE = 34, HAUL = 9, RAM = 9, R = 2.2, CUT = 8;
const R0 = () => Math.random() - 0.5;

// ---- the model: an angular, armoured tug, not a ball. Extruded hull with a chined nose and a dark sensor slit,
// side sponsons, twin thruster bells, and three jointed grab arms with hooked claws underneath.
function extrudeSide(pts, depth, bevel = 0.06) {
  const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -depth / 2); g.rotateY(-Math.PI / 2);   // profile drawn in (z, y); extruded across x
  g.computeVertexNormals(); return g;
}
function lathe(pts, seg = 20) { return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg); }

let M = null;
function mats() {
  if (M) return M;
  M = {
    hull: addHullDetail(new THREE.MeshStandardMaterial({ color: 0x6f6a62, roughness: 0.55, metalness: 0.55 }), { scale: 2.2, grime: 0.9, scratch: 0.7, bump: 0.9 }),
    paint: addHullDetail(new THREE.MeshStandardMaterial({ color: 0x7a2c1c, roughness: 0.6, metalness: 0.35 }), { scale: 2.2, grime: 1.0, scratch: 0.9, bump: 0.6 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.5, metalness: 0.75 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8e8b84, roughness: 0.32, metalness: 0.95 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.08, metalness: 0.9 }),
    burn: new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.7, metalness: 0.6, emissive: new THREE.Color(1, 0.35, 0.1), emissiveIntensity: 0 }),
  };
  return M;
}

function buildArm(mt) {
  // shoulder hub -> upper bar -> elbow -> forearm -> hooked claw; returns the groups to animate
  const arm = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.16, 12).rotateZ(Math.PI / 2), mt.dark); arm.add(hub);
  const upper = new THREE.Group(); arm.add(upper);
  const bar = new THREE.Mesh(extrudeSide([[-0.07, 0.02], [0.07, 0.02], [0.05, -0.62], [-0.05, -0.62]], 0.1, 0.02), mt.hull); upper.add(bar);
  const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.5, 8), mt.steel); piston.position.set(0.08, -0.3, 0.06); upper.add(piston);
  const elbow = new THREE.Group(); elbow.position.y = -0.62; upper.add(elbow);
  elbow.add(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.15, 12).rotateZ(Math.PI / 2), mt.dark));
  const fore = new THREE.Mesh(extrudeSide([[-0.05, 0], [0.05, 0], [0.04, -0.5], [-0.035, -0.5]], 0.08, 0.018), mt.paint); elbow.add(fore);
  const wrist = new THREE.Group(); wrist.position.y = -0.52; elbow.add(wrist);
  // claw: two opposed hooks
  const hook = (s) => {
    const g = extrudeSide([[0, 0], [0.05 * s, -0.04], [0.15 * s, -0.16], [0.13 * s, -0.3], [0.04 * s, -0.36], [0.07 * s, -0.27], [0.08 * s, -0.17], [0.01 * s, -0.08]].map(([a, b]) => [a, b]), 0.05, 0.012);
    const m = new THREE.Mesh(g, mt.steel); wrist.add(m); return m;
  };
  const jaws = [hook(1), hook(-1)];
  arm.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  arm.userData = { upper, elbow, jaws };
  return arm;
}

function buildDrone() {
  const mt = mats(), g = new THREE.Group();
  // main hull: side profile (z forward = -z, y up), extruded 1.1 m wide, chined nose
  const hull = new THREE.Mesh(extrudeSide([[-1.05, -0.18], [-0.92, 0.2], [-0.45, 0.5], [0.55, 0.48], [0.95, 0.18], [0.92, -0.25], [0.55, -0.48], [-0.35, -0.5]], 1.0, 0.1), mt.hull);
  // chine it: pull the upper and lower edges inboard so the cross-section is a flattened hexagon, not a box
  { const P = hull.geometry.attributes.position; for (let i = 0; i < P.count; i++) { const y = P.getY(i), k = y > 0 ? 1 - 0.3 * Math.min(1, y / 0.55) : 1 - 0.2 * Math.min(1, -y / 0.5); P.setX(i, P.getX(i) * k); } hull.geometry.computeVertexNormals(); }
  g.add(hull);
  // dorsal armour plate in the rival red, a raised spine and a sensor mast
  const plate = new THREE.Mesh(extrudeSide([[-0.5, 0.5], [0.52, 0.48], [0.62, 0.62], [-0.35, 0.66]], 0.72, 0.04), mt.paint); g.add(plate);
  const spine = new THREE.Mesh(extrudeSide([[-0.2, 0.66], [0.45, 0.62], [0.5, 0.74], [-0.05, 0.78]], 0.16, 0.02), mt.dark); g.add(spine);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.5, 6), mt.steel); mast.position.set(0.12, 0.98, 0.3); mast.rotation.x = -0.4; g.add(mast);
  // sensor slit across the nose: dark glass band with the eye strip inside
  const slit = new THREE.Mesh(extrudeSide([[-1.0, -0.02], [-0.9, 0.17], [-0.84, 0.15], [-0.94, -0.03]], 0.86, 0.015), mt.glass); slit.position.x = 0; g.add(slit);
  const eyeM = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.3, 0.1), toneMapped: false });
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.045, 0.03), eyeM); eye.position.set(0, 0.075, -0.97); eye.rotation.x = -0.9; g.add(eye);
  const lens = new THREE.Mesh(lathe([[0, 0.02], [0.07, 0.02], [0.08, 0], [0.06, -0.05], [0, -0.05]], 16).rotateX(Math.PI / 2), mt.dark); lens.position.set(0.32, -0.12, -1.0); g.add(lens);
  // side sponsons: fuel/RCS pods with intakes
  for (const s of [-1, 1]) {
    const pod = new THREE.Mesh(extrudeSide([[-0.55, -0.12], [-0.4, 0.12], [0.62, 0.1], [0.72, -0.05], [0.6, -0.2], [-0.35, -0.22]], 0.32, 0.05), mt.paint);
    pod.position.x = s * 0.68; g.add(pod);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 6, 16), mt.dark); rim.position.set(s * 0.68, -0.04, -0.58); g.add(rim);
    for (const z of [-0.2, 0.25]) { const q = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.12), mt.dark); q.position.set(s * 0.88, 0.02, z); g.add(q); }
  }
  // twin thruster bells
  const bells = [], burns = [];
  for (const s of [-1, 1]) {
    const bell = new THREE.Mesh(lathe([[0.1, 0], [0.13, -0.05], [0.2, -0.28], [0.23, -0.34], [0.21, -0.34], [0.12, -0.08], [0.06, -0.06]], 18), mt.dark);
    bell.rotation.x = -Math.PI / 2; bell.position.set(s * 0.3, 0.02, 0.92); g.add(bell); bells.push(bell);
    const burn = new THREE.Mesh(new THREE.CircleGeometry(0.17, 16), mt.burn.clone()); burn.position.set(s * 0.3, 0.02, 1.2); g.add(burn); burns.push(burn);
  }
  // grab arms under the belly
  const arms = [];
  for (let i = 0; i < 3; i++) {
    const a = buildArm(mt);
    const x = [-0.36, 0.36, 0][i], z = [-0.2, -0.2, 0.32][i];
    a.position.set(x, -0.46, z); a.rotation.y = [0.5, -0.5, Math.PI][i]; g.add(a); arms.push(a);
  }
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  g.scale.setScalar(1.7); g.userData = { eyeM, arms, burns, hull };
  return g;
}

export class Drones {
  constructor({ scene, world, salvage, ship, fx, getFxT, onTheft, onLost, onEvent }) {
    Object.assign(this, { scene, world, salvage, ship, fx, getFxT, onTheft, onLost, onEvent });
    this.enabled = false; this.list = []; this.jamLevel = 0; this.jamCool = 0; this.jamT = -1;
    const homes = [world.site.field.pos, world.site.meridian.pos, world.site.freighter.pos];
    homes.forEach((h, i) => {
      const mesh = buildDrone(); scene.add(mesh);
      const d = { mesh, pos: h.clone().add(_v.set(30 + i * 40, 10, 60)), vel: new THREE.Vector3(), mode: 'idle', t: 2 + i * 3, item: null, home: null, spawn: h.clone(), acc: 0, stun: 0, cutT: 0, spin: new THREE.Vector3(), id: i, grip: 0 };
      this.list.push(d); mesh.position.copy(d.pos);
    });
    // jam pulse: an orange shell racing out from the ship
    this.shell = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false, uniforms: { uA: { value: 0 } },
      vertexShader: 'varying vec3 vN, vV; void main(){ vN = normalize(normalMatrix * normal); vec4 m = modelViewMatrix * vec4(position, 1.); vV = normalize(-m.xyz); gl_Position = projectionMatrix * m; }',
      fragmentShader: 'varying vec3 vN, vV; uniform float uA; void main(){ float f = pow(1. - abs(dot(normalize(vN), normalize(vV))), 3.); gl_FragColor = vec4(vec3(1.5, .55, .18) * f * uA, f * uA); }',
    }));
    this.shell.visible = false; this.shell.frustumCulled = false; scene.add(this.shell);
  }

  get jamRange() { return this.jamLevel >= 2 ? 260 : 160; }
  get jamStun() { return this.jamLevel >= 2 ? 12 : 7; }

  // J: stun every drone in range. Returns false if not owned / cooling down.
  jam() {
    if (!this.jamLevel) { this.onEvent?.('nojammer'); return false; }
    if (this.jamCool > 0) return false;
    this.jamCool = 18; this.jamT = 0; this.shell.visible = true;
    let n = 0;
    for (const d of this.list) if (d.mesh.visible && d.mode !== 'dead' && d.pos.distanceTo(this.ship.pos) < this.jamRange) { this.stun(d, this.jamStun); n++; }
    this.onEvent?.('jam', n);
    return true;
  }

  stun(d, t) {
    this.release(d);
    d.stun = t; d.mode = 'stunned'; d.spin.set(R0(), R0(), R0()).multiplyScalar(2.5);
    for (let i = 0; i < 24; i++) this.fx.emit(d.pos, _w.set(R0(), R0(), R0()).multiplyScalar(8).add(d.vel), this.getFxT(), 0.3 + Math.random() * 0.5, 0.03, 0.02, K.SPARK, 0.7, 0.04);
  }

  // let go of whatever it holds: carried loot floats free, a latched load is yours again
  release(d) {
    const it = d.item;
    if (it && (d.mode === 'haul') && it.state === 'carried') { it.state = 'free'; it.body.vel.copy(d.vel).multiplyScalar(0.3); }
    d.item = null; d.cutT = 0; d.grip = 0;
  }

  destroy(d, impact) {
    this.release(d);
    d.mode = 'dead'; d.t = 90; d.mesh.visible = false;
    const fxT = this.getFxT();
    this.fx.emit(d.pos, d.vel, fxT, 0.35, 0.5, 9, K.FLASH, 1);
    for (let i = 0; i < 80; i++) this.fx.emit(d.pos, _w.set(R0(), R0(), R0()).multiplyScalar(26).add(d.vel).addScaledVector(impact, 0.4), fxT - Math.random() * 0.02, 0.4 + Math.random() * 0.9, 0.04, 0.03, Math.random() < 0.5 ? K.EMBER : K.SPARK, 0.8, 0.04);
    for (let i = 0; i < 30; i++) this.fx.emit(d.pos, _w.set(R0(), R0(), R0()).multiplyScalar(6).add(d.vel), fxT, 0.9 + Math.random(), 0.15, 0.12, K.CHIP);
    this.onEvent?.('kill', d);
  }

  // loose cargo for an idle drone to go after
  pick(d) {
    let best = null, bd = 1000;
    for (const it of this.salvage.items) {
      if (it.state !== 'free' || it.hidden || it.story || (it.kind !== 'canister' && it.kind !== 'crate')) continue;
      if (this.list.some((o) => o.item === it)) continue;
      const dd = it.body.pos.distanceTo(d.pos); if (dd < bd) { bd = dd; best = it; }
    }
    return best;
  }

  // something you're towing that this drone can reach and nobody else is on
  claimed(d) {
    for (const r of this.salvage.ropes) {
      const it = r.item; if (it.state !== 'towed' || it.story) continue;
      if (this.list.some((o) => o !== d && o.item === it)) continue;
      if (it.body.pos.distanceTo(d.pos) < 520) return it;
    }
    return null;
  }

  steer(d, target, speed, dt, k = 1.6) {
    _v.copy(target).sub(d.pos); const L = _v.length(); if (L < 1e-3) return L;
    _v.multiplyScalar(speed / L); d.vel.lerp(_v, 1 - Math.exp(-k * dt)); return L;
  }

  // the ship hits a drone: fast enough breaks it, slower knocks it away
  collide(d) {
    const ship = this.ship;
    _u.copy(d.pos).sub(ship.pos); const dist = _u.length(), rr = R + ship.radius;
    if (dist >= rr || dist < 1e-4) return;
    _u.divideScalar(dist);
    const vn = _w.copy(ship.vel).sub(d.vel).dot(_u);   // closing speed
    if (vn > RAM && ship.vel.dot(_u) - d.vel.dot(_u) * 0.3 > RAM * 0.7) { this.destroy(d, _w.copy(ship.vel)); ship.vel.multiplyScalar(0.82); this.onEvent?.('ram', vn); return; }
    d.pos.addScaledVector(_u, rr - dist);
    if (vn > 0) { d.vel.addScaledVector(_u, vn * 1.6); ship.vel.addScaledVector(_u, -vn * 0.3); this.stun(d, 1.5); this.onEvent?.('bump', vn); }
  }

  update(dt, time) {
    this.jamCool = Math.max(0, this.jamCool - dt);
    if (this.jamT >= 0) {
      this.jamT += dt; const k = this.jamT / 1.1;
      this.shell.position.copy(this.ship.pos); this.shell.scale.setScalar(Math.max(0.1, this.jamRange * (1 - Math.pow(1 - Math.min(1, k), 2))));
      this.shell.material.uniforms.uA.value = Math.max(0, 1 - k) * 1.3;
      if (k >= 1) { this.jamT = -1; this.shell.visible = false; }
    }
    this.chasing = null;
    for (const d of this.list) {
      const show = this.enabled && d.mode !== 'dead';
      d.mesh.visible = show;
      if (!this.enabled) continue;
      d.t -= dt;
      if (d.mode === 'dead') { if (d.t <= 0) { d.pos.copy(d.spawn).add(_v.set(40, 12, 70)); d.vel.set(0, 0, 0); d.mode = 'idle'; d.t = 5; } continue; }
      if (d.mode === 'stunned') {
        d.vel.multiplyScalar(Math.exp(-0.6 * dt)); d.stun -= dt;
        if (Math.random() < dt * 8) this.fx.emit(d.pos, _w.set(R0(), R0(), R0()).multiplyScalar(5).add(d.vel), this.getFxT(), 0.25, 0.03, 0.02, K.SPARK, 0.6, 0.04);
        if (d.stun <= 0) { d.mode = 'idle'; d.t = 3; d.spin.set(0, 0, 0); }
      } else if (d.mode === 'idle') {
        d.vel.multiplyScalar(Math.exp(-0.8 * dt));
        if (d.t <= 0) {
          const c = this.claimed(d);
          if (c) { d.item = c; d.mode = 'chase'; this.onEvent?.('chase', d); }
          else { const it = this.pick(d); if (it) { d.item = it; d.mode = 'seek'; } }
          d.t = 2.5;
        }
      } else if (d.mode === 'seek') {
        const it = d.item;
        if (d.t <= 0) { d.t = 2.5; const c = this.claimed(d); if (c) { d.item = c; d.mode = 'chase'; this.onEvent?.('chase', d); continue; } }
        if (!it || it.state !== 'free') { d.mode = 'idle'; d.item = null; d.t = 4; }
        else if (this.steer(d, it.body.pos, SPEED, dt) < 3.2) this.grab(d, it);
      } else if (d.mode === 'chase') {
        const it = d.item;
        if (!it || it.state !== 'towed' || it.body.pos.distanceTo(d.spawn) > 1400) { d.mode = 'idle'; d.item = null; d.t = 6; }
        else {
          this.chasing = d;
          // lead the target a little so it closes on a moving load
          _w.copy(it.body.pos).addScaledVector(it.body.vel, 0.6);
          if (this.steer(d, _w, CHASE, dt, 2.2) < it.body.radius + 2.5) { d.mode = 'latch'; d.cutT = 0; d.grip = 0; d.off = _u.copy(d.pos).sub(it.body.pos).setLength(it.body.radius + 1.6).clone(); this.onEvent?.('latch', d); }
        }
      } else if (d.mode === 'latch') {
        const it = d.item;
        if (!it || it.state !== 'towed') { d.mode = 'flee'; d.t = 8; d.item = null; }
        else {
          this.chasing = d;
          // ride on the load and drag it back toward the wrecks; cut the line after a while
          d.grip = Math.min(1, d.grip + dt * 2);
          d.pos.copy(it.body.pos).add(d.off); d.vel.copy(it.body.vel);
          _w.copy(it.body.pos).sub(this.ship.pos).normalize().multiplyScalar(it.body.mass * 7 * dt * d.grip);   // straight away from you
          it.body.impulse(_w, d.pos);
          d.cutT += dt;
          if (d.cutT > CUT) { this.salvage.drop(it); it.wasMine = true; this.grab(d, it); this.onEvent?.('cut', d); }
        }
      } else if (d.mode === 'haul') {
        const it = d.item;
        if (!it || it.state !== 'carried') { d.mode = 'flee'; d.t = 14; d.item = null; }
        else {
          this.steer(d, d.home, HAUL, dt);
          it.body.pos.copy(d.pos).add(_v.set(0, -2.6, 0)); it.body.vel.copy(d.vel); it.body.angVel.multiplyScalar(0.98); it.body.updateSpheres();
          if (d.pos.distanceTo(d.home) < 10 || d.pos.distanceTo(this.ship.pos) > 800) {
            it.state = 'gone'; it.obj.visible = false; d.item = null; d.mode = 'return'; d.t = 30; this.onLost?.(d, it);
          }
        }
      } else if (d.mode === 'flee') {
        _w.copy(d.pos).sub(this.ship.pos).normalize(); this.steer(d, _v.copy(d.pos).addScaledVector(_w, 100), SPEED * 1.2, dt);
        if (d.t <= 0) { d.mode = 'idle'; d.t = 6; }
      } else if (d.mode === 'return') {
        d.vel.multiplyScalar(0.9);
        if (d.t <= 0) { d.pos.copy(d.spawn).add(_v.set(40, 12, 70)); d.vel.set(0, 0, 0); d.mode = 'idle'; d.t = 5; }
      }
      if (d.mode !== 'latch') d.pos.addScaledVector(d.vel, dt);
      if (d.mode !== 'dead' && d.mode !== 'return') this.collide(d);
      if (d.mode === 'dead') continue;
      this.pose(d, dt, time);
    }
  }

  grab(d, it) {
    it.state = 'carried'; d.item = it; d.mode = 'haul'; d.cutT = 0;
    _w.copy(d.pos).sub(this.ship.pos); if (_w.lengthSq() < 1) _w.set(1, 0.2, 0); _w.setY(_w.y * 0.2).normalize();
    d.home = d.pos.clone().addScaledVector(_w, 650); this.onTheft?.(d, it);
  }

  pose(d, dt, time) {
    const m = d.mesh, U = m.userData; m.position.copy(d.pos);
    if (d.mode === 'stunned') { const w = d.spin.length(); if (w > 1e-4) m.quaternion.premultiply(_q.setFromAxisAngle(_u.copy(d.spin).divideScalar(w), w * dt)); }
    else {
      const look = d.mode === 'latch' && d.item ? _u.copy(d.item.body.pos) : d.vel.lengthSq() > 0.5 ? _u.copy(d.pos).add(d.vel) : null;
      if (look) { _m.lookAt(d.pos, look, _w.set(0, 1, 0)); _q.setFromRotationMatrix(_m); m.quaternion.slerp(_q, 1 - Math.exp(-6 * dt)); }
    }
    // eye: hunting = fast red pulse, stunned = dead flicker
    const hunt = d.mode === 'chase' || d.mode === 'latch' || d.mode === 'haul';
    const e = d.mode === 'stunned' ? (Math.random() < 0.1 ? 1 : 0.05) : 0.5 + 2 * (0.5 + 0.5 * Math.sin(time * (hunt ? 11 : 3)));
    U.eyeM.color.setRGB(2.4 * e, 0.3 * e, 0.1 * e);
    // arms reach forward to grab when closing, clamp on a load, fold back otherwise
    const reach = d.mode === 'latch' || d.mode === 'haul' ? 1 : (d.mode === 'chase' || d.mode === 'seek') && d.item && d.item.body.pos.distanceTo(d.pos) < 20 ? 0.7 : 0;
    d.reachSm = THREE.MathUtils.damp(d.reachSm || 0, reach, 4, dt);
    U.arms.forEach((a, i) => {
      const A = a.userData, wob = d.mode === 'stunned' ? Math.sin(time * 13 + i) * 0.5 : Math.sin(time * 1.7 + i * 2) * 0.06;
      A.upper.rotation.x = 0.55 + d.reachSm * 0.7 + wob; A.elbow.rotation.x = -1.25 + d.reachSm * 1.0 - wob;
      const close = d.mode === 'latch' || d.mode === 'haul' ? 0.05 : 0.45; A.jaws[0].rotation.z = close; A.jaws[1].rotation.z = -close;
    });
    // engine burn and gas
    const sp = d.vel.length(), b = d.mode === 'stunned' ? 0 : Math.min(1, sp / CHASE + (d.mode === 'latch' ? 0.6 : 0));
    for (const br of U.burns) br.material.emissiveIntensity = 0.4 + 5 * b;
    d.acc += dt * Math.min(30, sp * 1.2 + (d.mode === 'latch' ? 20 : 0));
    while (d.acc > 1) {
      d.acc--;
      for (const s of [-1, 1]) {
        _v.set(s * 0.3 * 1.7, 0.03, 2.05).applyQuaternion(m.quaternion).add(d.pos);
        _w.set(0, 0, 1).applyQuaternion(m.quaternion).multiplyScalar(6 + 10 * b).add(d.vel).add(_u.set(R0(), R0(), R0()).multiplyScalar(0.6));
        this.fx.emit(_v, _w, this.getFxT(), 0.3, 0.05, 0.22 + 0.2 * b, K.RCS, 2, 0);
      }
    }
  }
}
