import * as THREE from 'three';

const _o = new THREE.Vector3(), _t = new THREE.Vector3(), _up = new THREE.Vector3(), _f = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0);
const _bq = new THREE.Quaternion();
const ease = (t) => 1 - Math.pow(1 - t, 3);

// Chase camera: orientation lags the ship (so you feel rotation), distance stretches with speed,
// FOV widens with speed, impacts shake it. Opens with a one-time sweep around the ship.
export class CamRig {
  constructor(camera, reduced) {
    this.cam = camera; this.reduced = reduced;
    this.qs = new THREE.Quaternion(); this.first = true;
    this.t = 0; this.shake = 0; this.baseFov = 66;
    this.tow = 0; this.towSm = 0;   // length of the tow line + load: the camera backs off and rises to keep the load in frame
    this.introDur = reduced ? 0 : 4.2;
  }

  // ease from a pose the camera is in now (the end of a cutscene) into the chase view over `dur` seconds
  blendFrom(cam, dur) { this.bf = { p: cam.position.clone(), q: cam.quaternion.clone(), t: 0, d: this.reduced ? 0 : dur }; }

  kick(a) { if (!this.reduced) this.shake = Math.min(1, this.shake + a); }

  update(dt, ship) {
    this.t += dt;
    if (this.first) { this.qs.copy(ship.quat); this.first = false; }
    this.qs.slerp(ship.quat, 1 - Math.exp(-(this.reduced ? 12 : 7) * dt));

    const speed = ship.vel.length();
    const k = this.introDur ? Math.min(1, this.t / this.introDur) : 1;
    const e = ease(k);
    this.towSm = THREE.MathUtils.damp(this.towSm, this.tow, 1.6, dt);
    const dist = 11 + speed * 0.035 + (ship.fx.boost ? 1.6 : 0) + this.towSm * 0.95;
    _o.set(0, 3.2 + this.towSm * 0.42, dist);
    // intro: start close and off to the side, then swing round behind
    _o.multiplyScalar(0.55 + 0.45 * e);
    if (k < 1) _o.applyAxisAngle(_y, (1 - e) * 2.1);
    _o.applyQuaternion(this.qs);
    // trail behind velocity a touch
    this.cam.position.copy(ship.pos).add(_o).addScaledVector(ship.vel, this.reduced ? 0 : -0.035);

    _up.set(0, 1, 0).applyQuaternion(this.qs);
    _f.set(0, 0, -1).applyQuaternion(this.qs);
    _t.copy(ship.pos).addScaledVector(_f, 22 * e + 1);
    this.cam.up.copy(_up);
    this.cam.lookAt(_t);

    if (this.bf) {
      const b = this.bf; b.t += dt; const k = b.d ? Math.min(1, b.t / b.d) : 1, e = k * k * k * (k * (6 * k - 15) + 10);
      this.cam.position.lerpVectors(b.p, this.cam.position, e); this.cam.quaternion.slerpQuaternions(b.q, _bq.copy(this.cam.quaternion), e);
      if (k >= 1) this.bf = null;
    }
    if (this.shake > 0.001) {
      const s = this.shake * 0.55;
      this.cam.position.x += (Math.random() - 0.5) * s; this.cam.position.y += (Math.random() - 0.5) * s; this.cam.position.z += (Math.random() - 0.5) * s;
      this.cam.rotateZ((Math.random() - 0.5) * this.shake * 0.04);
      this.shake *= Math.exp(-5.5 * dt);
    }
    const fov = this.baseFov + (this.reduced ? 0 : Math.min(22, speed * 0.2) + (ship.fx.boost ? 6 : 0) + ship.boostT * 5);
    if (Math.abs(fov - this.cam.fov) > 0.01) { this.cam.fov = THREE.MathUtils.damp(this.cam.fov, fov, ship.boostT > 0.5 ? 9 : 4, dt); this.cam.updateProjectionMatrix(); }
  }
}
