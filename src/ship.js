import * as THREE from 'three';

// Tunables, in meters / seconds.
export const CFG = {
  main: 20, reverse: 11, strafe: 11, vert: 11, boostMul: 2.6, boostPunch: 0.9, // boostPunch: extra multiplier bleeding off over ~0.5s
  assistDecel: 16, brakeDecel: 26,
  maxAssist: 58, maxBoost: 100, maxFree: 190,
  lookGain: 0.0105,        // rad/s of angular velocity added per pixel of look input
  keyTurn: 3.2,            // rad/s^2 from arrow keys
  rollAccel: 4.2,
  angDamp: 3.0, angStop: 0.9, // assist: exponential decay plus a constant rad/s^2 brake so spin stops cleanly
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
    // flight assist: 'damped' (thrusters kill drift you aren't commanding), 'hold' (cruise: holds a set speed
    // along the nose and swings your velocity round as you turn), 'drift' (pure Newtonian, higher top speed)
    this.mode = 'damped'; this.holdSpd = 0;
    // subsystem multipliers (systems.js): broken engines / RCS weaken thrust and turning
    this.eff = { main: 1, rcs: 1, boost: true };
    this.hull = 1;
    // Visual feedback for engines: -1..1 per local axis, plus main burn 0..1.
    this.th = { fwd: 0, strafe: 0, vert: 0 }; this.boostT = 0; this.wasBoost = false;
    this.fx = { main: 0, x: 0, y: 0, z: 0, boost: false };
    // Measured corrective effort (local accel m/s^2, angular accel rad/s^2), summed over substeps; read with takeFx().
    this.sumA = new THREE.Vector3(); this.sumW = new THREE.Vector3(); this.sumT = 0;
  }

  get assist() { return this.mode !== 'drift'; }
  set assist(v) { this.setMode(v ? 'damped' : 'drift'); }
  setMode(m) {
    if (m === this.mode) return;
    if (m === 'hold') { _inv.copy(this.quat).invert(); this.holdSpd = Math.max(0, -_lv.copy(this.vel).applyQuaternion(_inv).z); }
    this.mode = m;
  }

  forward(out = new THREE.Vector3()) { return out.set(0, 0, -1).applyQuaternion(this.quat); }

  // Average local accel / angular accel since the last call.
  takeFx(accel, alpha) {
    const t = this.sumT || 1;
    accel.copy(this.sumA).divideScalar(t); alpha.copy(this.sumW).divideScalar(t);
    this.sumA.set(0, 0, 0); this.sumW.set(0, 0, 0); this.sumT = 0;
  }

  step(dt, cmd) {
    const E = this.eff, boost = cmd.boost && cmd.fwd > 0 && E.boost;
    // throttle ramp: thrust builds in ~0.13s and cuts faster, so the ship has weight but never feels laggy
    const th = this.th, ramp = (cur, tgt) => approach(cur, tgt, (Math.abs(tgt) > Math.abs(cur) ? 7.5 : 14) * dt);
    th.fwd = ramp(th.fwd, cmd.fwd); th.strafe = ramp(th.strafe, cmd.strafe); th.vert = ramp(th.vert, cmd.vert);
    if (boost && !this.wasBoost) this.boostT = 1;           // punch on the rising edge
    this.wasBoost = boost; this.boostT = Math.max(0, this.boostT - dt * 2.2);
    const bmul = boost ? CFG.boostMul * (1 + CFG.boostPunch * this.boostT) : 1;
    // --- linear: work in the ship's local frame so assist can damp each axis independently ---
    _inv.copy(this.quat).invert();
    const lv = _lv.copy(this.vel).applyQuaternion(_inv);

    const lv0x = lv.x, lv0y = lv.y, lv0z = lv.z;
    const az = th.fwd > 0 ? CFG.main * bmul * E.main : CFG.reverse * E.rcs;
    const thrust = { x: th.strafe * CFG.strafe * E.rcs, y: th.vert * CFG.vert * E.rcs, z: -th.fwd * az };
    const hold = this.mode === 'hold' && !cmd.brake;
    if (hold) {
      // cruise: the stick sets the speed, the ship holds it along the nose
      const cap = boost ? CFG.maxBoost : CFG.maxAssist;
      this.holdSpd = Math.max(0, Math.min(cap, this.holdSpd + th.fwd * (th.fwd > 0 ? az : CFG.reverse * E.rcs) * dt));
      if (!boost && this.holdSpd > CFG.maxAssist) this.holdSpd = Math.max(CFG.maxAssist, this.holdSpd - CFG.assistDecel * dt);
      thrust.z = 0;
    }
    lv.x += thrust.x * dt; lv.y += thrust.y * dt; lv.z += thrust.z * dt;

    // Brake always works, even with flight assist off: it is a hard stop on every axis.
    if (cmd.brake) {
      const d = CFG.brakeDecel * dt * E.rcs, k = Math.exp(-2.4 * E.rcs * dt);
      lv.x = approach(lv.x * k, 0, d); lv.y = approach(lv.y * k, 0, d); lv.z = approach(lv.z * k, 0, d);
      if (this.mode === 'hold') this.holdSpd = Math.max(0, -lv.z);
    } else if (hold) {
      const d = CFG.assistDecel * 1.4 * dt * E.rcs;
      if (Math.abs(cmd.strafe) < 0.05) lv.x = approach(lv.x, 0, d);
      if (Math.abs(cmd.vert) < 0.05) lv.y = approach(lv.y, 0, d);
      const want = -this.holdSpd;
      lv.z = approach(lv.z, want, (lv.z > want ? CFG.main * (boost ? bmul : 1) * E.main : CFG.reverse * E.rcs) * dt);
    } else if (this.assist) {
      const d = CFG.assistDecel * dt * E.rcs;
      if (Math.abs(cmd.strafe) < 0.05) lv.x = approach(lv.x, 0, d);
      if (Math.abs(cmd.vert) < 0.05) lv.y = approach(lv.y, 0, d);
      if (Math.abs(cmd.fwd) < 0.05) lv.z = approach(lv.z, 0, d);
    }
    this.sumA.x += (lv.x - lv0x); this.sumA.y += (lv.y - lv0y); this.sumA.z += (lv.z - lv0z);
    this.vel.copy(lv).applyQuaternion(this.quat);

    const max = this.assist ? (boost ? CFG.maxBoost : CFG.maxAssist) : CFG.maxFree;
    const sp = this.vel.length();
    if (sp > max) this.vel.multiplyScalar(this.assist ? Math.max(max / sp, 1 - 0.9 * dt * 4) : max / sp);

    const burn = hold ? (lv0z - lv.z) / Math.max(1e-4, CFG.main * dt) : cmd.fwd;
    this.fx.main = THREE.MathUtils.damp(this.fx.main, burn > 0.02 ? (boost ? 1 : 0.55 + 0.45 * Math.min(1, burn)) * Math.min(1, 0.3 + E.main) : 0, 14, dt);
    this.fx.x = Math.sign(thrust.x) * Math.min(1, Math.abs(cmd.strafe));
    this.fx.y = Math.sign(thrust.y) * Math.min(1, Math.abs(cmd.vert));
    this.fx.z = cmd.fwd < 0 ? Math.min(1, -cmd.fwd) : 0;
    this.fx.boost = boost;

    this.pos.addScaledVector(this.vel, dt);

    // --- angular ---
    const w = this.angVel; const w0x = w.x, w0y = w.y, w0z = w.z;
    const yawIn = cmd.dx || cmd.yawKey, pitchIn = cmd.dy || cmd.pitchKey, rollIn = cmd.roll;
    const tg = 0.35 + 0.65 * E.rcs;      // broken RCS: sluggish turns
    w.y += (-cmd.dx * CFG.lookGain - cmd.yawKey * CFG.keyTurn * dt) * tg;
    w.x += (-cmd.dy * CFG.lookGain + cmd.pitchKey * CFG.keyTurn * dt) * tg;
    w.z += -cmd.roll * CFG.rollAccel * dt * tg;
    {
      // drift keeps a light rotational damper (a pure free spin is unflyable with a mouse); the others stop clean
      const g = (cmd.brake ? 1.8 : this.assist ? 1 : 0.3) * tg;
      const k = Math.exp(-CFG.angDamp * g * dt), st = CFG.angStop * g * dt;
      if (!yawIn) w.y = approach(w.y * k, 0, st);
      if (!pitchIn) w.x = approach(w.x * k, 0, st);
      if (!rollIn) w.z = approach(w.z * k, 0, st);
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
