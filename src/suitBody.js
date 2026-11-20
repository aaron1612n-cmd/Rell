import * as THREE from 'three';
import { HINGE, canopyAt } from './cockpit.js';
import sdf from './assets/shipsdf.json';

// The suit's collision body. The whole suit collides, not a point at its chest: helmet, torso, pack, hips,
// thighs, shins and boots are spheres pinned to the posed skeleton, and they push the pilot out of walls,
// hulls and debris. The arms don't shove the body around; they give way instead (the wrist target slides
// out of the wall, so the elbow and glove fold back along it), and in first person the hands lower out of
// the way when the wall is closer than they are.

// ---- the ship's hull: a baked signed distance field (scripts/shipsdf.mjs) + the hinged canopy shell ------
const SKIN = 0.035;   // the field's zero sits on the hull; thin parts (wings, vanes) get this much thickness
const F = (() => {
  const b = Uint8Array.from(atob(sdf.rle), (c) => c.charCodeAt(0)), [NX, NY, NZ] = sdf.dim, q = new Float32Array(NX * NY * NZ);
  let o = 0; const k = sdf.band / 127;
  for (let i = 0; i < b.length; i += 2) { const v = ((b[i] << 24) >> 24) * k; q.fill(v, o, o + b[i + 1]); o += b[i + 1]; }
  return { q, NX, NY, NZ, c: sdf.cell, ox: sdf.org[0], oy: sdf.org[1], oz: sdf.org[2], band: sdf.band };
})();
export function field(x, y, z) {
  const gx = (x - F.ox) / F.c, gy = (y - F.oy) / F.c, gz = (z - F.oz) / F.c;
  if (gx < 0 || gy < 0 || gz < 0 || gx >= F.NX - 1 || gy >= F.NY - 1 || gz >= F.NZ - 1) return F.band;
  const ix = gx | 0, iy = gy | 0, iz = gz | 0, fx = gx - ix, fy = gy - iy, fz = gz - iz, NX = F.NX, S = NX * F.NY, q = F.q;
  const i = ix + NX * iy + S * iz;
  const a = q[i] + (q[i + 1] - q[i]) * fx, b = q[i + NX] + (q[i + NX + 1] - q[i + NX]) * fx;
  const c = q[i + S] + (q[i + S + 1] - q[i + S]) * fx, d = q[i + S + NX] + (q[i + S + NX + 1] - q[i + S + NX]) * fx;
  const e = a + (b - a) * fy, f = c + (d - c) * fy;
  return e + (f - e) * fz - SKIN;
}
// canopy (closed pose, ship space): the glass + frame shell, the same cross-section the glass is lofted from
const CZ0 = -1.5, CZ1 = 0.72, CT = 0.04;
function canopy(x, y, z) {
  const zc = Math.min(CZ1, Math.max(CZ0, z)), [cw, ch, y0] = canopyAt(zc);
  const P = [[cw, y0], [cw * 0.8, y0 + ch * 0.7], [cw * 0.35, y0 + ch], [-cw * 0.35, y0 + ch], [-cw * 0.8, y0 + ch * 0.7], [-cw, y0]];
  let best = 1e9;
  for (let i = 0; i < P.length - 1; i++) {
    const [ax, ay] = P[i], [bx, by] = P[i + 1], ex = bx - ax, ey = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
    const dx = x - ax - ex * t, dy = y - ay - ey * t; best = Math.min(best, dx * dx + dy * dy);
  }
  const dz = z - zc; return Math.sqrt(best + dz * dz) - CT;
}
const _l = new THREE.Vector3(), _g = new THREE.Vector3(), _qi = new THREE.Quaternion(), _qc = new THREE.Quaternion(), _ax = new THREE.Vector3(1, 0, 0);
function grad(fn, p, out, h = 0.02) {
  return out.set(fn(p.x + h, p.y, p.z) - fn(p.x - h, p.y, p.z), fn(p.x, p.y + h, p.z) - fn(p.x, p.y - h, p.z), fn(p.x, p.y, p.z + h) - fn(p.x, p.y, p.z - h)).normalize();
}

// ---- contacts ------------------------------------------------------------------------------------
// every contact of a world-space sphere: fn(normal, pen, surfaceVel|null). Static world (station, wrecks,
// relay rooms and doors) as boxes and as their real meshes, debris, the ship's hull and its canopy.
// env: { world, ship, angle (canopy open), mesh (MeshCollide), frame }
const _n = new THREE.Vector3(), _zero = new THREE.Vector3();
export function sphereContacts(env, c, r, fn) {
  const { world, ship, angle, mesh } = env;
  world.sphereContacts(c, r, (n, pen, pt, sv) => fn(n, pen, sv || null, null));
  if (mesh) mesh.contacts(c, r, (n, pen) => fn(n, pen, null, null), env.frame);
  for (const d of world.debris) {
    _n.copy(c).sub(d.pos); const dist = _n.length(), R = r + d.radius;
    if (dist >= R || dist < 1e-6) continue;
    fn(_n.divideScalar(dist), R - dist, d.vel, d);
  }
  if (!ship) return;
  _qi.copy(ship.quat).invert();
  _l.copy(c).sub(ship.pos).applyQuaternion(_qi);
  const d = field(_l.x, _l.y, _l.z);
  if (d < r) { grad(field, _l, _g); if (_g.lengthSq() > 0.5) fn(_g.applyQuaternion(ship.quat), r - d, ship.vel, null); }
  // canopy: bring the point into the closed canopy's frame
  _qc.setFromAxisAngle(_ax, -angle);
  _l.sub(HINGE).applyQuaternion(_qc).add(HINGE);
  const dc = canopy(_l.x, _l.y, _l.z);
  if (dc < r) { grad(canopy, _l, _g); if (_g.lengthSq() > 0.5) fn(_g.applyQuaternion(_qc.invert()).applyQuaternion(ship.quat), r - dc, ship.vel, null); }
}

// ---- the suit's spheres -----------------------------------------------------------------------------
// [bone, local centre, radius]; bones from buildAstronaut's userData
function coreSpheres(u) {
  const S = (o, x, y, z, r) => ({ o, l: new THREE.Vector3(x, y, z), r, w: new THREE.Vector3() });
  const out = [
    S(u.head, 0, 0.15, -0.01, 0.205),                      // helmet
    S(u.body, 0, 0.16, -0.05, 0.25), S(u.body, 0, -0.12, -0.04, 0.23),   // chest, belly
    S(u.body, 0.23, 0.2, -0.01, 0.15), S(u.body, -0.23, 0.2, -0.01, 0.15), // shoulder cups
    S(u.body, 0, 0.3, 0.24, 0.22), S(u.body, 0, 0.0, 0.25, 0.22), S(u.body, 0, 0.5, 0.25, 0.14), // pack, its top
    S(u.body, 0.13, -0.38, 0.0, 0.16), S(u.body, -0.13, -0.38, 0.0, 0.16), // hips
  ];
  for (const L of [u.legR, u.legL]) {
    out.push(S(L.hip, 0, -0.14, 0, 0.115), S(L.hip, 0, -0.33, 0, 0.105), S(L.knee, 0, -0.02, 0, 0.1), S(L.knee, 0, -0.24, 0, 0.09),
      S(L.ankle, 0, -0.07, -0.03, 0.08), S(L.ankle, 0, -0.08, -0.15, 0.065));
  }
  return out;
}
function armSpheres(arm) {
  const S = (o, x, y, z, r) => ({ o, l: new THREE.Vector3(x, y, z), r, w: new THREE.Vector3() });
  const out = [S(arm.upper, 0, -0.16, 0, 0.085), S(arm.mid, 0, 0, 0, 0.085), S(arm.fore, 0, -0.13, 0, 0.075),
    S(arm.wrist, 0, -0.03, 0, 0.065), S(arm.wrist, -0.005, -0.1, -0.015, 0.07)];
  if (arm.tool) out.push(S(arm.tool, -0.01, 0.0, -0.03, 0.085), S(arm.tool, -0.01, 0.03, -0.18, 0.06));
  return out;
}

const _c = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _corr = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
export class SuitBody {
  constructor(astro) {
    const u = astro.userData;
    this.u = u; this.core = coreSpheres(u);
    this.arms = { R: { arm: u.armR, s: armSpheres(u.armR), fix: new THREE.Vector3() }, L: { arm: u.armL, s: armSpheres(u.armL), fix: new THREE.Vector3() } };
    this.off = this.core.map(() => new THREE.Vector3());   // core sphere centres, pilot space
    this.hit = null; this.touching = 0;
    this.ready = false;
  }

  // after the suit is posed: remember where each core sphere sits relative to the pilot (they ride along
  // through the next frame's physics substeps)
  capture(pilot) {
    _q.copy(pilot.quat).invert();
    for (let i = 0; i < this.core.length; i++) {
      const s = this.core[i]; s.w.copy(s.l).applyMatrix4(s.o.matrixWorld);
      this.off[i].copy(s.w).sub(pilot.pos).applyQuaternion(_q);
    }
    this.ready = true;
  }

  // push the pilot out of everything the body overlaps (Gauss-Seidel over the spheres, a few passes).
  // Returns the hardest impact { speed, normal } or null.
  collide(env, p, e = 0.2) {
    if (!this.ready) return null;
    let hit = null; this.touching = 0;
    for (let it = 0; it < 3; it++) {
      let moved = false;
      for (let i = 0; i < this.core.length; i++) {
        _c.copy(this.off[i]).applyQuaternion(p.quat).add(p.pos);
        const r = this.core[i].r;
        sphereContacts(env, _c, r, (n, pen, sv, deb) => {
          if (!(pen > 1e-4) || pen > 1.5) return;
          if (deb) {
            // a loose piece: share the push and the bump by mass
            const ia = 1 / p.mass, ib = 1 / deb.mass, tot = ia + ib;
            p.pos.addScaledVector(n, pen * ia / tot); _c.addScaledVector(n, pen * ia / tot); deb.pos.addScaledVector(n, -pen * ib / tot);
            const vn = _a.copy(p.vel).sub(deb.vel).dot(n);
            if (vn < 0) { const j = -(1 + e) * vn / tot; p.vel.addScaledVector(n, j * ia); deb.vel.addScaledVector(n, -j * ib); if (!hit || -vn > hit.speed) hit = { speed: -vn, normal: n.clone() }; }
            moved = true; this.touching++; return;
          }
          p.pos.addScaledVector(n, pen); _c.addScaledVector(n, pen); moved = true; this.touching++;
          const vn = _a.copy(p.vel).sub(sv || _zero).dot(n);
          if (vn < 0) { p.vel.addScaledVector(n, -(1 + e) * vn); if (!hit || -vn > hit.speed) hit = { speed: -vn, normal: n.clone() }; }
        });
      }
      if (!moved) break;
    }
    return hit;
  }

  // arms give way: after the suit is posed, find where the arm (and tool) overlaps something, slide the wrist
  // target out by that much (in the arm's own space) and pose again. The give eases off when the arm is clear.
  // repose() re-runs the pose with arms.R.fix / arms.L.fix applied.
  relax(dt) { for (const k of ['R', 'L']) this.arms[k].fix.multiplyScalar(Math.exp(-2.2 * dt)); }
  fitArms(env, repose) {
    for (let pass = 0; pass < 2; pass++) {
      let any = false;
      for (const k of ['R', 'L']) {
        const A = this.arms[k], root = A.arm.root;
        _corr.set(0, 0, 0);
        for (const s of A.s) {
          if (s.o === A.arm.tool && A.arm.tool.parent !== A.arm.glove.group) continue;   // holstered
          _c.copy(s.l).applyMatrix4(s.o.matrixWorld).add(_corr);
          sphereContacts(env, _c, s.r + 0.01, (n, pen, sv, deb) => {
            if (!(pen > 1e-4) || pen > 0.8) return;
            _corr.addScaledVector(n, pen); _c.addScaledVector(n, pen);
          });
        }
        if (_corr.lengthSq() < 1e-8) continue;
        // world offset -> arm space (the root may be mirrored)
        _m.copy(root.matrixWorld).invert();
        _a.copy(A.arm.wrist.position); _b.setFromMatrixPosition(A.arm.wrist.matrixWorld).add(_corr).applyMatrix4(_m);
        A.fix.add(_b.sub(_a)); if (A.fix.length() > 0.5) A.fix.setLength(0.5);
        any = true;
      }
      if (!any) break;
      repose();
    }
  }
}

// is a world point inside anything (with margin r)? the largest penetration, 0 when clear
export function penetration(env, c, r) {
  let m = 0; sphereContacts(env, c, r, (n, pen) => { if (pen > m) m = pen; }); return m;
}
