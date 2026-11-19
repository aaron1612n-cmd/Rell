import * as THREE from 'three';

// Small rigid body for salvage: a compound of spheres with a scalar inertia. Enough for towing,
// tumbling and knocking into things; contact and rope impulses act at points, so a tow line hooked
// off-centre swings the load the way you'd expect.
const _r = new THREE.Vector3(), _t = new THREE.Vector3(), _dq = new THREE.Quaternion(), _ax = new THREE.Vector3();

export class Body {
  constructor({ mass = 1, spheres = [[0, 0, 0, 1]], pos, quat } = {}) {
    this.pos = pos ? pos.clone() : new THREE.Vector3();
    this.quat = quat ? quat.clone() : new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();     // world space rad/s
    this.setShape(mass, spheres);
    this.wp = this.spheres.map(() => new THREE.Vector3());
    this.sleeping = false;
    this.updateSpheres();
  }

  setShape(mass, spheres) {
    this.mass = mass; this.invMass = 1 / mass;
    this.spheres = spheres.map(([x, y, z, r]) => ({ o: new THREE.Vector3(x, y, z), r }));
    // bounding radius and a solid-ish inertia (spheres spread along an axis act like a rod)
    let R = 0; for (const s of this.spheres) R = Math.max(R, s.o.length() + s.r);
    this.radius = R;
    this.invI = 1 / (0.3 * mass * R * R);
  }

  updateSpheres() { for (let i = 0; i < this.spheres.length; i++) this.wp[i].copy(this.spheres[i].o).applyQuaternion(this.quat).add(this.pos); }

  velAt(p, out) { _r.copy(p).sub(this.pos); return out.crossVectors(this.angVel, _r).add(this.vel); }

  // impulse J (world) at world point p
  impulse(J, p) {
    this.vel.addScaledVector(J, this.invMass);
    _r.copy(p).sub(this.pos); _t.crossVectors(_r, J).multiplyScalar(this.invI);
    this.angVel.add(_t);
  }

  // inverse effective mass along n at point p
  kInv(p, n) { _r.copy(p).sub(this.pos); _t.crossVectors(_r, n); return this.invMass + this.invI * _t.lengthSq(); }

  integrate(dt) {
    this.pos.addScaledVector(this.vel, dt);
    const w = this.angVel.length();
    if (w > 1e-6) { _dq.setFromAxisAngle(_ax.copy(this.angVel).divideScalar(w), w * dt); this.quat.premultiply(_dq).normalize(); }
    if (w > 4) this.angVel.multiplyScalar(4 / w);
    this.updateSpheres();
  }
}

// One-sided rope (can pull, can't push) between a point on A and a point on B, with a little give.
// A may be the ship (anything with pos/vel and a mass); B is a Body, or null for a fixed anchor point.
const _rn = new THREE.Vector3(), _rv = new THREE.Vector3(), _rj = new THREE.Vector3();
export function solveRope(rope, dt) {
  const a = rope.a, b = rope.b;
  const pa = rope.pa, pb = rope.pb;          // world anchor points (caller keeps them current)
  _rn.copy(pb).sub(pa); const d = _rn.length();
  rope.len = d;
  if (d <= rope.rest || d < 1e-4) { rope.tension = 0; return 0; }
  const n = _rn.divideScalar(d);
  const va = a.vel, vb = b ? b.velAt(pb, _rv) : _rv.set(0, 0, 0);
  const vrel = vb.dot(n) - va.dot(n);     // >0 means stretching
  const stretch = d - rope.rest;
  const bias = Math.min(18, stretch * 4.5);
  const want = vrel + bias * 0.9;
  if (want <= 0) { rope.tension = 0; return 0; }
  const kA = 1 / a.towMass, kB = b ? b.kInv(pb, n) : 0;
  const j = want / (kA + kB);
  a.vel.addScaledVector(n, j * kA);
  if (b) { _rj.copy(n).multiplyScalar(-j); b.impulse(_rj, pb); }
  rope.tension = j / dt;
  return j;
}
