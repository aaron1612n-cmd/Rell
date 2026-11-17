import * as THREE from 'three';

// Tunables, in meters / seconds.
export const CFG = {
  main: 20, reverse: 11, strafe: 11, vert: 11, boostMul: 2.4,
  assistDecel: 16, brakeDecel: 26,
  maxAssist: 58, maxBoost: 100, maxFree: 190,
  lookGain: 0.0105,        // rad/s of angular velocity added per pixel of look input
  keyTurn: 3.2,            // rad/s^2 from arrow keys
  rollAccel: 4.2,
  angDamp: 3.4,            // assist: per-second decay of angular velocity when axis idle
  maxAng: 3.4,
  radius: 1.5,
};

const _lv = new THREE.Vector3(), _inv = new THREE.Quaternion(), _dq = new THREE.Quaternion(), _ax = new THREE.Vector3();

const approach = (v, target, step) => (v > target ? Math.max(target, v - step) : Math.min(target, v + step));

export class Ship {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.angVel = new THREE.Vector3();   // local-space rad/s (x=pitch, y=yaw, z=roll)
    this.radius = CFG.radius;
    this.mass = 1;
    this.assist = true;
    this.hull = 1;
    // Visual feedback for engines: -1..1 per local axis, plus main burn 0..1.
    this.fx = { main: 0, x: 0, y: 0, z: 0, boost: false };
    // Measured corrective effort (local accel m/s^2, angular accel rad/s^2), summed over substeps; read with takeFx().
    this.sumA = new THREE.Vector3(); this.sumW = new THREE.Vector3(); this.sumT = 0;
  }

  forward(out = new THREE.Vector3()) { return out.set(0, 0, -1).applyQuaternion(this.quat); }

  // Average local accel / angular accel since the last call.
  takeFx(accel, alpha) {
    const t = this.sumT || 1;
    accel.copy(this.sumA).divideScalar(t); alpha.copy(this.sumW).divideScalar(t);
    this.sumA.set(0, 0, 0); this.sumW.set(0, 0, 0); this.sumT = 0;
  }

  step(dt, cmd) {
    const boost = cmd.boost && cmd.fwd > 0;
    // --- linear: work in the ship's local frame so assist can damp each axis independently ---
    _inv.copy(this.quat).invert();
    const lv = _lv.copy(this.vel).applyQuaternion(_inv);

    const lv0x = lv.x, lv0y = lv.y, lv0z = lv.z;
    const az = cmd.fwd > 0 ? CFG.main * (boost ? CFG.boostMul : 1) : CFG.reverse;
    const thrust = { x: cmd.strafe * CFG.strafe, y: cmd.vert * CFG.vert, z: -cmd.fwd * az };
    lv.x += thrust.x * dt; lv.y += thrust.y * dt; lv.z += thrust.z * dt;

    // Brake always works, even with flight assist off: it is a hard stop on every axis.
    if (cmd.brake) {
      const d = CFG.brakeDecel * dt, k = Math.exp(-2.4 * dt);
      lv.x = approach(lv.x * k, 0, d); lv.y = approach(lv.y * k, 0, d); lv.z = approach(lv.z * k, 0, d);
    } else if (this.assist) {
      const d = CFG.assistDecel * dt;
      if (Math.abs(cmd.strafe) < 0.05) lv.x = approach(lv.x, 0, d);
      if (Math.abs(cmd.vert) < 0.05) lv.y = approach(lv.y, 0, d);
      if (Math.abs(cmd.fwd) < 0.05) lv.z = approach(lv.z, 0, d);
    }
    this.sumA.x += (lv.x - lv0x); this.sumA.y += (lv.y - lv0y); this.sumA.z += (lv.z - lv0z);
    this.vel.copy(lv).applyQuaternion(this.quat);

    const max = this.assist ? (boost ? CFG.maxBoost : CFG.maxAssist) : CFG.maxFree;
    const sp = this.vel.length();
    if (sp > max) this.vel.multiplyScalar(this.assist ? Math.max(max / sp, 1 - 0.9 * dt * 4) : max / sp);

    this.fx.main = THREE.MathUtils.damp(this.fx.main, cmd.fwd > 0 ? (boost ? 1 : 0.55 + 0.45 * cmd.fwd) : 0, 14, dt);
    this.fx.x = Math.sign(thrust.x) * Math.min(1, Math.abs(cmd.strafe));
    this.fx.y = Math.sign(thrust.y) * Math.min(1, Math.abs(cmd.vert));
    this.fx.z = cmd.fwd < 0 ? Math.min(1, -cmd.fwd) : 0;
    this.fx.boost = boost;

    this.pos.addScaledVector(this.vel, dt);

    // --- angular ---
    const w = this.angVel; const w0x = w.x, w0y = w.y, w0z = w.z;
    const yawIn = cmd.dx || cmd.yawKey, pitchIn = cmd.dy || cmd.pitchKey, rollIn = cmd.roll;
    w.y += -cmd.dx * CFG.lookGain - cmd.yawKey * CFG.keyTurn * dt;
    w.x += -cmd.dy * CFG.lookGain + cmd.pitchKey * CFG.keyTurn * dt;
    w.z += -cmd.roll * CFG.rollAccel * dt;
    if (this.assist || cmd.brake) {
      const k = Math.exp(-CFG.angDamp * (cmd.brake ? 1.8 : 1) * dt);
      if (!yawIn) w.y *= k;
      if (!pitchIn) w.x *= k;
      if (!rollIn) w.z *= k;
    }
    this.sumW.x += w.x - w0x; this.sumW.y += w.y - w0y; this.sumW.z += w.z - w0z; this.sumT += dt;
    const m = w.length();
    if (m > CFG.maxAng) w.multiplyScalar(CFG.maxAng / m);
    if (m > 1e-5) {
      _dq.setFromAxisAngle(_ax.copy(w).divideScalar(m), m * dt);
      this.quat.multiply(_dq).normalize();
    }
  }
}
