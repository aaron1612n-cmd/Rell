import * as THREE from 'three';

// RCS nozzle layout, in ship-local space (nose = -Z). `dir` is the exhaust direction;
// the thruster pushes the ship the opposite way. Re-map these when the authored .glb ship lands.
const N = (x, y, z, dx, dy, dz) => ({ pos: new THREE.Vector3(x, y, z), dir: new THREE.Vector3(dx, dy, dz) });
export const NOZZLES = [
  // nose cluster: sideways, up/down, and forward-facing (retro) jets
  N(0.5, 0, -1.2, 1, 0, 0), N(-0.5, 0, -1.2, -1, 0, 0),
  N(0, 0.46, -1.3, 0, 1, 0), N(0, -0.46, -1.3, 0, -1, 0),
  N(0.2, 0, -1.75, 0, 0, -1), N(-0.2, 0, -1.75, 0, 0, -1),
  // tail cluster
  N(0.8, 0, 1.0, 1, 0, 0), N(-0.8, 0, 1.0, -1, 0, 0),
  N(0, 0.82, 1.0, 0, 1, 0), N(0, -0.82, 1.0, 0, -1, 0),
  // wingtips: roll
  N(2.3, 0.02, 0.9, 0, 1, 0), N(2.3, -0.2, 0.9, 0, -1, 0),
  N(-2.3, 0.02, 0.9, 0, 1, 0), N(-2.3, -0.2, 0.9, 0, -1, 0),
];

// Main engines are separate (glow cones in shipMesh); they fire for any -Z acceleration.
const A_REF = 10, ALPHA_REF = 2.2, LEVER = 1.2;
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
}
