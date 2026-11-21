import * as THREE from 'three';
import { buildAirlockHatch, poseHatch, lampColor } from './airlock.js';

// Boarding a fleet ship on foot: a round hatch on its flank. It opens as you drift near, you float in under your own
// control, a scripted pull takes you the last metre into the lock chamber, the door swings shut and seals behind you,
// and only then do you take the helm. Leaving runs the same way backwards.
//
// ShipHatch  - the model on one ship, where it sits, and the open/shut logic.
// LockDrive  - the scripted glide through the hatch (drives the EVA pilot; Eva calls update/camera).

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smr = (a, b, t) => { const k = clamp01((t - a) / (b - a)); return k * k * k * (k * (6 * k - 15) + 10); };
const _v = V(0, 0, 0), _v2 = V(0, 0, 0), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _ray = new THREE.Raycaster();
const DEPTH = 1.3;   // pilot's centre this far below the hatch plane once inside

// find a flat-ish patch of hull on the starboard side, ahead of mid-ship, and the hatch size that fits it
function findSpot(S) {
  const d = S.d, g = S.site.group; g.updateMatrixWorld(true);
  const toW = (p, o) => o.copy(p).applyMatrix4(g.matrixWorld);
  const dirW = V(-1, 0, 0).transformDirection(g.matrixWorld), inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const nm = new THREE.Matrix3().getNormalMatrix(inv);
  const cast = (x, y, z) => {
    _ray.set(toW(V(x, y, z), _v), dirW); _ray.far = d.max[0] - d.min[0] + 40; _ray.firstHitOnly = true;
    const h = _ray.intersectObject(S.node, true)[0]; if (!h) return null;
    const p = h.point.clone().applyMatrix4(inv), n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld).transformDirection(inv) : V(1, 0, 0);
    if (n.dot(V(1, 0, 0)) < 0.05) n.negate();
    return { p, n };
  };
  const len = d.max[2] - d.min[2], pr = d.probes;
  const rAt = (z) => { let b = pr[0], bd = 1e9; for (const q of pr) { const dd = Math.abs(q[2] - z); if (dd < bd) { bd = dd; b = q; } } return b; };
  let best = null;
  for (const zf of [0.36, 0.3, 0.42, 0.24, 0.48, 0.56]) {
    const z = d.min[2] + len * zf, pb = rAt(z), rh = THREE.MathUtils.clamp(pb[3] * 0.42, 0.58, 1.5);
    for (const [yo, wide] of [[0.05, 0], [0.25, 0], [-0.2, 0], [0.45, 0], [-0.4, 0], [0.05, 1], [0.25, 1], [-0.2, 1], [0.45, 1], [-0.4, 1]]) {
      const y = pb[1] + pb[3] * yo, x0 = wide ? d.max[0] + 4 : Math.min(d.max[0] + 4, pb[3] * 1.7 + 1), c = cast(x0, y, z); if (!c) continue;
      let worst = 0, miss = 0; const n = c.n.clone();
      for (const [dy, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7]]) {
        const h = cast(x0, y + dy * rh * 1.4, z + dz * rh * 1.4); if (!h) { miss++; continue; }
        n.add(h.n); worst = Math.max(worst, Math.abs(_v2.copy(h.p).sub(c.p).dot(c.n)));
      }
      if (miss > 2) continue;
      n.normalize();
      const score = worst / rh + Math.abs(yo) * 0.05 + miss * 0.4;
      if (!best || score < best.score) best = { score, p: c.p, n, rh };
    }
  }
  return best;
}

export class ShipHatch {
  constructor(S) {
    this.S = S; this.k = 0; this.target = 0; this.state = 'shut'; this.t = 0; this.far = 0;
    const spot = findSpot(S); if (!spot) { this.ok = false; return; }
    this.ok = true; this.rh = spot.rh;
    // frame: Y out of the hull, X toward the bow, Z across
    const n = spot.n, X = V(0, 0, -1).addScaledVector(n, n.z).normalize();
    const Z = new THREE.Vector3().crossVectors(X, n);
    this.local = spot.p.clone().addScaledVector(n, 0.1 * spot.rh + Math.min(0.5 * spot.rh, spot.score * spot.rh * 0.5));
    this.nL = n.clone(); this.XL = X; this.ZL = Z;
    const grp = this.group = buildAirlockHatch();
    grp.scale.setScalar(spot.rh);
    grp.position.copy(this.local); grp.quaternion.setFromRotationMatrix(_m.makeBasis(X, n, Z));
    S.site.group.add(grp); this.world();
    poseHatch(grp, 0);
  }

  // world frame of the hatch: o (plane centre), n (out), x (toward the bow), u (a sensible "up" for the pilot)
  world() {
    const g = this.S.site.group; g.updateMatrixWorld(true);
    this.o = this.o || V(0, 0, 0); this.n = this.n || V(0, 0, 0); this.x = this.x || V(0, 0, 0); this.u = this.u || V(0, 0, 0);
    this.o.copy(this.local).applyMatrix4(g.matrixWorld);
    this.n.copy(this.nL).transformDirection(g.matrixWorld); this.x.copy(this.XL).transformDirection(g.matrixWorld);
    this.u.set(0, 1, 0).applyQuaternion(g.quaternion); this.u.addScaledVector(this.n, -this.u.dot(this.n));
    if (this.u.lengthSq() < 0.05) this.u.copy(this.x); this.u.normalize();
    return this;
  }
  anchorWorld(out) { this.world(); return out.copy(this.o).addScaledVector(this.n, 0.5 + this.rh * 0.4); }

  // where is a world point in the hatch frame? (x across the mouth, y out of it, z across)
  local3(p, out) { this.world(); _v.copy(p).sub(this.o); const z = _v2.crossVectors(this.x, this.n); return out.set(_v.dot(this.x), _v.dot(this.n), _v.dot(z)); }
  fromLocal3(l, out) { this.world(); const z = _v2.crossVectors(this.x, this.n); return out.copy(this.o).addScaledVector(this.x, l.x).addScaledVector(this.n, l.y).addScaledVector(z, l.z); }

  // is a world point inside the capture funnel? (above the mouth, close to its axis)
  inFunnel(p) {
    const l = this.local3(p, _v), r = Math.hypot(l.x, l.z);
    return l.y > -0.3 && l.y < 3.4 * this.rh + 1.4 && r < 1.0 * this.rh + 0.3 + Math.max(0, l.y) * 0.18;
  }

  update(dt, e, locked, hold) {
    if (!this.ok) return;
    // open when a suit drifts near, shut again once they've gone
    let want = this.target;
    if (e.state === 'eva' && !e.lock && !locked && !hold) {
      const dd = this.world().o.distanceTo(e.pilot.pos), near = 7 * this.rh + 6;
      if (dd < near) want = 1; else if (dd > near * 1.5) want = 0;
    } else if (!hold) want = 0;
    this.target = want;
    const sp = (this.target > this.k ? 0.75 : 0.6) * (e.reduced ? 3 : 1);
    this.k = this.k < this.target ? Math.min(this.target, this.k + dt * sp) : Math.max(this.target, this.k - dt * sp);
    this.state = locked ? 'locked' : this.k <= 0.001 && this.target === 0 ? 'shut' : this.k >= 0.999 ? 'open' : 'cycling';
    poseHatch(this.group, this.k); lampColor(this.group, this.state);
  }
}

// ---- the scripted glide ---------------------------------------------------------------------------------------
export class LockDrive {
  constructor(fleet, S, dir) {
    const e = this.e = fleet.eva; this.fleet = fleet; this.S = S; this.H = S.air; this.dir = dir; this.t = 0; this.sent = false;
    this.speed = e.reduced ? 2.4 : 1;
    const H = this.H.world(), p = e.pilot;
    this.q0 = p.quat.clone();
    this.p0 = H.local3(p.pos, V(0, 0, 0));
    if (dir === 'out') this.p0.set(0, -DEPTH, 0);
    this.B = V(0, -DEPTH, 0);
    this.T1 = dir === 'in' ? THREE.MathUtils.clamp(1.4 + 0.14 * this.p0.distanceTo(this.B), 1.8, 3.2) : 3.2;
    this.camP = null;
    e.safe = true; e.unclip = dir === 'in' ? 0 : 1;
    if (dir === 'in') { this.H.target = 1; this.H.hold = true; }
    else { this.H.k = 0; this.H.target = 1; this.H.hold = true; }
    this.q = { dn: new THREE.Quaternion(), up: new THREE.Quaternion() };
    this.basis(H);
  }

  basis(H) {
    const n = H.n, u = H.u, x = _v.crossVectors(u, n).normalize().clone();
    this.q.dn.setFromRotationMatrix(_m.makeBasis(x, u, n));                                   // forward = -n: into the hatch
    this.q.up.setFromRotationMatrix(_m.makeBasis(x, _v2.copy(u), _v.copy(n)).multiply(new THREE.Matrix4().makeRotationX(Math.PI)));   // forward = +n: looking out
    // (both keep the pilot's up along u; "up" is the pitch-flipped pose)
  }

  update(dt) {
    const e = this.e, H = this.H, p = e.pilot; this.t += dt * this.speed; const t = this.t;
    H.world(); this.basis(H);
    const L = _v;
    if (this.dir === 'in') {
      const k = smr(0, this.T1, t), h = Math.max(1.1, this.p0.y * 0.4 + 0.9);
      const A = V(0, h, 0), P = this.p0, B = this.B, a = (1 - k) * (1 - k), b = 2 * k * (1 - k), c = k * k;
      L.set(P.x * a + A.x * b + B.x * c, P.y * a + A.y * b + B.y * c, P.z * a + A.z * b + B.z * c);
      this.setPose(L, _q.slerpQuaternions(this.q0, this.q.dn, smr(0, this.T1 * 0.6, t)).slerp(this.q.up, smr(this.T1 * 0.75, this.T1 + 0.9, t)));
      if (t > this.T1 + 0.5) H.target = 0;
      if (!this.sent && H.k <= 0.001 && t > this.T1 + 0.6) { this.sent = true; setTimeout(() => this.fleet.finishBoard(this.S), 300); }
      return false;
    }
    // out: wait in the chamber looking up while the door swings, then rise through the mouth
    const k = smr(0.9, this.T1, t), A = V(0, 1.0, 0), B = V(0, -DEPTH, 0), C = V(0, 2.6 + 0.4 * H.rh, 0);
    const a = (1 - k) * (1 - k), b = 2 * k * (1 - k), c = k * k;
    L.set(0, B.y * a + A.y * b + C.y * c, 0);
    this.setPose(L, this.q.up);
    if (t >= this.T1) {
      p.vel.copy(this.S.V.vel).addScaledVector(H.n, 0.45);
      this.H.hold = false; e.safe = false; e.ropeReset = true; e.camPos.copy(e.camera.position); e.tpInit = true;
      return true;
    }
    return false;
  }

  setPose(l, q) {
    const e = this.e, p = e.pilot;
    this.H.fromLocal3(l, p.pos); p.vel.copy(this.S.V.vel); p.quat.copy(q);
    e.accB.set(0, 0, 0); e.spinB.set(0, 0, 0); e.prevRel.set(0, 0, 0);
  }

  // third person: a fixed shot above the hatch, easing in from wherever the camera was
  camera(cam, dt) {
    const e = this.e, H = this.H.world(), far = cam.aspect < 1 ? Math.min(1.9, 1.25 / Math.max(0.4, cam.aspect)) : 1;
    const want = _v.copy(H.o).addScaledVector(H.n, (2.0 + 1.5 * H.rh) * far).addScaledVector(H.x, (2.4 + H.rh) * far);
    if (!this.camP) this.camP = cam.position.clone();
    this.camP.lerp(want, 1 - Math.exp(-3 * dt));
    cam.position.copy(this.camP);
    _m.lookAt(cam.position, _v2.copy(H.o).addScaledVector(H.n, 0.25), H.n.clone().multiplyScalar(0.3).add(H.u));
    if (!this.camQ) this.camQ = cam.quaternion.clone();   // own smoothed orientation (the EVA camera also eases toward the pilot's heading every frame)
    this.camQ.slerp(_q.setFromRotationMatrix(_m), 1 - Math.exp(-6 * dt)); cam.quaternion.copy(this.camQ);
    cam.up.copy(H.u); cam.updateMatrixWorld();
  }
}
