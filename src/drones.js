import * as THREE from 'three';
import { K } from './gpufx.js';

// Rival salvage drones. They hunt loose cargo near the wrecks, hook it, and haul it off to a den far away.
// Beat them to it: or catch one mid-haul and hook the cargo with your own line, and it lets go and flees.
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const SPEED = 15, HAUL = 9;

function buildDrone() {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x8b867a, roughness: 0.45, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.6, metalness: 0.5 });
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.55, 18, 12), body); core.scale.set(1, 0.78, 1.25); g.add(core);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 8, 28), dark); band.rotation.x = Math.PI / 2; g.add(band);
  const eyeM = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.3, 0.1), toneMapped: false });
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), eyeM); eye.position.set(0, 0.05, -0.78); g.add(eye);
  const arms = [];
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3 + Math.PI / 2, arm = new THREE.Group();
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.1, 8), dark); leg.position.set(0, -0.45, 0); leg.rotation.x = 0.0;
    const claw = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 12, Math.PI * 1.4), dark); claw.position.set(0, -1.0, 0); claw.rotation.x = Math.PI / 2;
    arm.add(leg, claw); arm.position.set(Math.cos(a) * 0.4, -0.2, Math.sin(a) * 0.5); arm.rotation.z = Math.cos(a) * 0.5; arm.rotation.x = -Math.sin(a) * 0.5; g.add(arm); arms.push(arm);
  }
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.3, 12), dark); nozzle.rotation.x = Math.PI / 2; nozzle.position.z = 0.78; g.add(nozzle);
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  g.scale.setScalar(1.7); g.userData = { eyeM, arms };
  return g;
}

export class Drones {
  constructor({ scene, world, salvage, ship, fx, getFxT, onTheft, onLost }) {
    Object.assign(this, { scene, world, salvage, ship, fx, getFxT, onTheft, onLost });
    this.enabled = false; this.list = [];
    const homes = [world.site.field.pos, world.site.meridian.pos];
    homes.forEach((h, i) => {
      const mesh = buildDrone(); scene.add(mesh);
      this.list.push({ mesh, pos: h.clone().add(_v.set(30 + i * 40, 10, 60)), vel: new THREE.Vector3(), mode: 'idle', t: 2 + i * 3, item: null, home: null, spawn: h.clone(), acc: 0 });
      mesh.position.copy(this.list[i].pos);
    });
  }

  pick(d) {
    let best = null, bd = 1000;
    for (const it of this.salvage.items) {
      if (it.state !== 'free' || it.hidden || (it.kind !== 'canister' && it.kind !== 'crate')) continue;
      if (this.list.some((o) => o.item === it)) continue;
      const dd = it.body.pos.distanceTo(d.pos); if (dd < bd) { bd = dd; best = it; }
    }
    return best;
  }

  steer(d, target, speed, dt) {
    _v.copy(target).sub(d.pos); const L = _v.length(); if (L < 1e-3) return L;
    _v.multiplyScalar(speed / L); d.vel.lerp(_v, 1 - Math.exp(-1.6 * dt)); return L;
  }

  update(dt, time) {
    for (const d of this.list) {
      d.mesh.visible = this.enabled;
      if (!this.enabled) continue;
      d.t -= dt;
      if (d.mode === 'idle') {
        d.vel.multiplyScalar(Math.exp(-0.8 * dt));
        if (d.t <= 0) { const it = this.pick(d); if (it) { d.item = it; d.mode = 'seek'; } d.t = 4; }
      } else if (d.mode === 'seek') {
        const it = d.item;
        if (!it || it.state !== 'free') { d.mode = 'idle'; d.item = null; d.t = 5; }
        else if (this.steer(d, it.body.pos, SPEED, dt) < 3.2) {
          it.state = 'carried'; d.mode = 'haul';
          _w.copy(d.pos).sub(this.ship.pos); if (_w.lengthSq() < 1) _w.set(1, 0.2, 0); _w.setY(_w.y * 0.2).normalize();
          d.home = d.pos.clone().addScaledVector(_w, 650); this.onTheft?.(d, it);
        }
      } else if (d.mode === 'haul') {
        const it = d.item;
        if (!it || it.state !== 'carried') { d.mode = 'flee'; d.t = 14; d.item = null; }
        else {
          this.steer(d, d.home, HAUL, dt);
          it.body.pos.copy(d.pos).add(_v.set(0, -1.7, 0)); it.body.vel.copy(d.vel); it.body.angVel.multiplyScalar(0.98); it.body.updateSpheres();
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
      d.pos.addScaledVector(d.vel, dt);
      const m = d.mesh; m.position.copy(d.pos);
      if (d.vel.lengthSq() > 0.5) { _v.copy(d.pos).sub(d.vel); m.lookAt(_v); }
      m.rotation.z += dt * 0.0;
      m.userData.eyeM.color.setScalar(0.5 + 2 * (0.5 + 0.5 * Math.sin(time * (d.mode === 'haul' ? 9 : 3))));
      m.userData.arms.forEach((a, i) => { a.rotation.x += (Math.sin(time * 2 + i) * 0.1 - 0.0) * dt; });
      // engine gas
      const sp = d.vel.length(); d.acc += dt * Math.min(30, sp * 3);
      while (d.acc > 1) { d.acc--; _v.set(0, 0, 0.8).applyQuaternion(m.quaternion).add(d.pos); _w.copy(d.vel).multiplyScalar(-0.3).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6)); this.fx.emit(_v, _w, this.getFxT(), 0.35, 0.03, 0.12, K.RCS, 2, 0); }
    }
  }
}
