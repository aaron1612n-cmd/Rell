import * as THREE from 'three';
import shipData from './assets/ship.json';

// RCS nozzle layout, in ship-local space (nose = -Z). `dir` is the exhaust direction;
// the thruster pushes the ship the opposite way. Authored with the ship model (tools/blender/ship.py).
export const NOZZLES = shipData.nozzles.map((n) => ({ pos: new THREE.Vector3(...n.pos), dir: new THREE.Vector3(...n.dir) }));

// Main engines are separate (glow cones in shipMesh); they fire for any -Z acceleration.
const A_REF = 14, ALPHA_REF = 3.2, LEVER = 1.2;
export const RCS_MIN = 0.22, RCS_MAX_ACTIVE = 4;
const _t = new THREE.Vector3(), _f = new THREE.Vector3(), _an = new THREE.Vector3(), _wn = new THREE.Vector3();

// Given measured local acceleration (m/s^2) and angular acceleration (rad/s^2), fill `out[i]` with 0..1 per nozzle.
export function solveRcs(accel, alpha, out) {
  _an.copy(accel).divideScalar(A_REF); _wn.copy(alpha).divideScalar(ALPHA_REF);
  for (let i = 0; i < NOZZLES.length; i++) {
    const n = NOZZLES[i];
    _f.copy(n.dir).negate();                  // force on the ship
    _t.copy(n.pos).cross(_f);                 // torque about the centre
    const s = Math.max(0, _f.dot(_an)) + Math.max(0, _t.dot(_wn) / LEVER);
    out[i] = Math.min(1, s);
  }
  // dead zone: ignore small corrections, then keep only the strongest few jets so it never looks like a firework
  for (let i = 0; i < out.length; i++) out[i] = out[i] < RCS_MIN ? 0 : (out[i] - RCS_MIN) / (1 - RCS_MIN);
  if (RCS_MAX_ACTIVE < out.length) {
    const sorted = Array.from(out).sort((a, b) => b - a), cut = sorted[RCS_MAX_ACTIVE - 1];
    let kept = 0;
    for (let i = 0; i < out.length; i++) { if (out[i] > 0 && out[i] >= cut && kept < RCS_MAX_ACTIVE) kept++; else out[i] = 0; }
  }
}
