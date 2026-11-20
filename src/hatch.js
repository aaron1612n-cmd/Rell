import * as THREE from 'three';
import { EYE, PITCH, canopyAt } from './cockpit.js';
import { SUIT, solveArm, handBasis, fpTargets } from './astronaut.js';
import { K } from './gpufx.js';
import { field } from './suitBody.js';

// Getting out of the seat and back in, as one continuous move rather than a camera lerp.
//
// Out: the visor seals, the canopy seal cracks with a puff of cabin air, the struts swing it up, both hands
// reach for the glareshield, you haul yourself up, push off the glareshield and float clear over the nose, then the suit
// takes over. In: the suit lines you up over the seat, you take the glareshield, lower yourself in and settle, the
// tether unclips and reels home, the canopy comes down and latches.
//
// First person (you were in the cockpit view): the camera is your eye the whole way, your arms are the same
// IK arms as on the EVA, so you see your gloves land on the glareshield. Third person (you were in the chase view):
// the camera swings round to watch from the side and ends over your shoulder, or back behind the ship.
//
// Everything is posed in ship space and timed on one clock, so it's the same animation from either view.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const SEAT = EYE.clone().sub(SUIT.eye);               // torso centre in the seat (eye exactly at the cockpit eye)
const LIFT = V(0, 0.55, 0.14), PUSH = V(0, 0.85, -0.08), CLEAR = V(0, 1.35, -0.35), FLOAT = V(0, 1.6, -0.72);
const HOVER = V(0, 1.42, -0.55);
// handholds: the top of the glareshield hood in front of the seat (tools/blender/cockpit.py HOOD), either side of the HUD
const HOLD = [V(0.26, 0.575, -0.31), V(-0.26, 0.575, -0.31)];
// legs: hip pitch (thigh forward), knee, ankle
const LEG = {
  seat: [1.42, -1.5, 0.15, 1.42, -1.5, 0.15],
  stand: [0.32, -0.42, -0.12, 0.22, -0.3, -0.1],
  float: [0.3, -0.62, -0.22, 0.16, -0.42, -0.18],
};
// hand rest poses in arm space (right side; the left is the same in its mirrored space)
const REST = {
  seat: { W: V(0.13, -0.33, -0.3), F: V(0.05, -0.5, -1), T: V(-1, 0.3, 0), P: V(0.8, -0.6, 0.35) },
  float: { W: V(0.2, -0.14, -0.3), F: V(0, -0.3, -1), T: V(-0.25, 1, -0.1), P: V(0.8, -0.6, 0.35) },
};
const GRAB_P = V(1, -0.3, 0.4), FP_SH = V(0.06, -0.1, 0.07);

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sm = (a, b, t) => { const k = clamp01((t - a) / (b - a)); return k * k * (3 - 2 * k); };
const smr = (a, b, t) => { const k = clamp01((t - a) / (b - a)); return k * k * k * (k * (6 * k - 15) + 10); };
const bez = (a, c, b, k, out) => out.copy(a).multiplyScalar((1 - k) * (1 - k)).addScaledVector(c, 2 * k * (1 - k)).addScaledVector(b, k * k);
const _v = V(0, 0, 0), _v2 = V(0, 0, 0), _v3 = V(0, 0, 0), _o = V(0, 0, 0), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _m = new THREE.Matrix4(), _mi = new THREE.Matrix4();
const _up = V(0, 1, 0), _qi = new THREE.Quaternion();
const FLOOR_Y = 0.06;   // a little under the cockpit floor (ship space): below this the fuselage is solid
// how far a sphere (ship space) pokes out through the hull's skin below the floor: its surface points must stay in
// the solid fuselage (squared, summed)
const DIRS = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, -1], [0, 0, 1], [0.7, -0.7, 0], [-0.7, -0.7, 0], [0, -0.7, -0.7]];
// corner points of each leg part's mesh, in its joint's frame (cached on the leg)
const _bb = new THREE.Box3();
export function legProbes(leg) {
  if (leg.probes) return leg.probes;
  leg.probes = [leg.hip, leg.knee, leg.ankle].map((j) => {
    const mesh = j.children.find((c) => !c.isBone && !(c === leg.knee || c === leg.ankle));
    j.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(j.matrixWorld).invert();
    _bb.makeEmpty();
    mesh.traverse((m) => { if (m.isMesh) { m.geometry.computeBoundingBox(); _bb.union(m.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld))); } });
    const c = _bb.getCenter(new THREE.Vector3()), h = _bb.getSize(new THREE.Vector3()).multiplyScalar(0.5), pts = [];
    for (const x of [-1, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 1]) pts.push(new THREE.Vector3(c.x + x * h.x, c.y + y * h.y, c.z + z * h.z));
    return [j, pts];
  });
  return leg.probes;
}
export function exposed(c, r) {
  let o = 0;
  for (const [x, y, z] of DIRS) {
    const py = c.y + y * r * 0.8; if (py > FLOOR_Y) continue;
    const f = field(c.x + x * r * 0.8, py, c.z + z * r * 0.8); if (f > 0) o += f * f;
  }
  return o;
}
// per-arm scratch
const tgt = () => ({ S: V(0, 0, 0), W: V(0, 0, 0), P: V(0, 0, 0), Q: new THREE.Quaternion() });
const A = { rest: tgt(), grab: tgt(), out: tgt() }, _F = V(0, 0, 0), _T = V(0, 0, 0);

export class Hatch {
  constructor(eva) {
    this.eva = eva;
    // a stand-in for the body's transform (first person has no visible body)
    this.ghost = new THREE.Group(); this.ghostBody = new THREE.Group(); this.ghost.add(this.ghostBody);
    this.torso = V(0, 0, 0); this.tilt = 0; this.legs = LEG.seat.slice();
    this.cam = { pivot: V(0, 0, 0), yaw: 0, pitch: 0, dist: 0 }; this.camFrom = { pivot: V(0, 0, 0), yaw: 0, pitch: 0, dist: 0 };
    this.from = { p: V(0, 0, 0), q: new THREE.Quaternion() };
  }

  get fp() { return this.eva.view === 0; }

  // ---- start ----------------------------------------------------------------------------------
  startExit(firstPerson) {
    const e = this.eva;
    this.dir = 'out'; this.t = 0; this.step = 0; this.fpv = firstPerson;
    e.view = firstPerson ? 0 : 1;
    this.speed = e.reduced ? 2.6 : 1;
    this.camFromNow(V(0, 0.9, 0.05));
    this.handedOff = !firstPerson;   // first person starts in the cockpit view and hands over to the world view later
  }

  startEntry() {
    const e = this.eva, p = e.pilot;
    this.dir = 'in'; this.t = 0; this.step = 0; this.fpv = e.view === 0;
    this.speed = e.reduced ? 2.6 : 1;
    this.from.p.copy(p.pos).sub(e.ship.pos).applyQuaternion(_q.copy(e.ship.quat).invert());   // ship space
    this.from.q.copy(_q).multiply(p.quat);
    // the approach takes longer from further out
    // (and never before the canopy is up: it opens as you come in)
    this.A = Math.max(1.75, 0.75 + Math.min(1.4, this.from.p.distanceTo(HOVER) * 0.36));
    e.cockpit.setCanopy(true);
    this.camFromNow(V(0, 0.85, 0.1));
    this.handedOff = false; this.unclip = 0;
  }

  // the current camera, as an orbit around a ship-space pivot
  camFromNow(pivot) {
    const e = this.eva, f = this.camFrom;
    f.pivot.copy(pivot);
    _v.copy(e.camera.position).sub(e.ship.pos).applyQuaternion(_q.copy(e.ship.quat).invert()).sub(pivot);
    f.dist = Math.max(0.5, _v.length()); f.pitch = Math.asin(THREE.MathUtils.clamp(_v.y / f.dist, -1, 1)); f.yaw = Math.atan2(_v.x, _v.z);
    this.fov0 = e.camera.fov;
  }

  // ---- per frame: returns true when finished ------------------------------------------------------
  update(dt) {
    this.t += dt * this.speed;
    return this.dir === 'out' ? this.exit(dt) : this.entry(dt);
  }

  exit(dt) {
    const e = this.eva, ck = e.cockpit, t = this.t, fp = this.fpv;
    // events
    if (this.step === 0 && t > 0.35) { ck.setCanopy(true); this.step = 1; }
    if (this.step === 1 && t > 0.5) { this.vent(1); if (!e.reduced) { if (fp) ck.headV.y += 0.12; else e.rig.kick(0.04); } this.step = 2; }
    // the canopy stays up while you're outside; it comes down once you're back in the seat
    if (fp && !this.handedOff && ck.open >= 0.999) { ck.target = 0; ck.blend = 0; this.handedOff = true; }

    // body: seat -> up off the seat -> push up on the glareshield -> float clear over the nose
    const k1 = smr(1.1, 2.2, t), k2 = smr(2.15, 3.3, t);
    if (k2 > 0) bez(PUSH, CLEAR, FLOAT, k2, this.torso); else bez(SEAT, LIFT, PUSH, k1, this.torso);
    this.tilt = -0.25 * sm(1.3, 2.1, t) + 0.35 * sm(2.2, 3.2, t);
    this.mixLegs(LEG.seat, LEG.stand, sm(1.35, 2.3, t), LEG.float, sm(2.35, 3.3, t));
    const grab = sm(0.65, 1.15, t) * (1 - sm(2.2, 2.75, t));
    const seatW = 1 - sm(1.6, 2.2, t), fpW = sm(2.55, 3.3, t);
    // look: forward, up at the canopy swinging away, down at your hands on the glareshield, then level
    const Pc = this.cockpitPitch();
    const pitch = Pc + (0.25 - Pc) * sm(0.4, 1.0, t) - 0.9 * sm(1.05, 1.9, t) + 0.65 * sm(2.3, 3.3, t);
    const yaw = -0.12 * (sm(0.4, 0.9, t) - sm(1.0, 1.6, t));
    this.place(dt, { grab, seatW, fpW, pitch, yaw, visor: sm(0, 0.5, t), quat: e.ship.quat });

    // third person: swing round to the side to watch, then settle over your shoulder
    if (!fp) {
      const c = this.cam, k = smr(0, 1.35, t), d = sm(1.35, 2.6, t), j = smr(2.5, 3.3, t);
      this.orbit(this.camFrom, { yaw: -1.75 - 0.2 * d, pitch: 0.28 + 0.03 * d, dist: (4.4 - 0.4 * d) * this.far() }, k, -1, c);
      c.pivot.copy(this.camFrom.pivot);
      this.shoulderShot(c, j);
    }
    if (t >= 3.3) return true;
    return false;
  }

  entry(dt) {
    const e = this.eva, ck = e.cockpit, t = this.t, fp = this.fpv, Ah = this.A;
    // approach: the suit lines you up over the seat, upright to the ship
    const ka = smr(0, Ah, t);
    _v.copy(this.from.p).lerp(HOVER, 0.5).addScaledVector(_up, 0.45);
    bez(this.from.p, _v, HOVER, ka, _v2);
    // lower: hover -> push height on the glareshield -> down into the seat, a little bounce as you land
    const kl1 = smr(Ah, Ah + 0.6, t), kl2 = smr(Ah + 0.5, Ah + 1.45, t);
    if (kl2 > 0) bez(PUSH, LIFT, SEAT, kl2, this.torso); else this.torso.copy(_v2).lerp(PUSH, kl1);
    this.torso.y -= 0.022 * Math.sin(Math.PI * clamp01((t - Ah - 1.4) / 0.45));
    this.tilt = 0.1 * (1 - sm(Ah - 0.4, Ah + 0.3, t)) - 0.1 * (sm(Ah + 0.3, Ah + 0.8, t) - sm(Ah + 1.0, Ah + 1.5, t));
    this.mixLegs(LEG.float, LEG.stand, sm(Ah - 0.5, Ah + 0.2, t), LEG.seat, sm(Ah + 0.55, Ah + 1.45, t));
    const grab = sm(Ah - 0.45, Ah + 0.05, t) * (1 - sm(Ah + 1.2, Ah + 1.65, t));
    const seatW = sm(Ah + 0.8, Ah + 1.3, t), fpW = 1 - sm(Ah - 0.5, Ah + 0.1, t);
    _q.slerpQuaternions(this.from.q, _q2.identity(), smr(0, Ah * 0.85, t));
    const bodyQ = _q2.copy(e.ship.quat).multiply(_q);
    // look: from where you were looking, down into the seat, then level with the panel
    const Pc = this.cockpitPitch();
    const pitch = -0.55 * sm(Ah * 0.4, Ah, t) + (Pc + 0.55) * sm(Ah + 0.6, Ah + 1.6, t);
    this.place(dt, { grab, seatW, fpW, pitch, yaw: 0, visor: 1 - sm(Ah + 1.2, Ah + 1.75, t), quat: bodyQ });

    // tether: unclip once seated and the reel takes it home
    if (t > Ah + 1.4) this.unclip = Math.min(1, this.unclip + dt * this.speed * 1.8);
    e.unclip = this.unclip;

    if (this.step === 0 && t > Ah + 1.5) { ck.setCanopy(false); this.step = 1; }
    if (fp && !this.handedOff && t > Ah + 0.75) {
      // once your eye drops below the sill the cockpit view (its own lights, live screens) draws the cabin; the
      // camera stays yours until you're settled, at exactly the cockpit eye, then it's the cockpit's
      ck.target = 1; ck.blend = 1; ck.fovSm = e.camera.fov; this.handedOff = true;
    }
    if (!fp) {
      const c = this.cam, k = smr(0, Ah + 0.3, t), d = sm(Ah, Ah + 3, t);
      this.orbit(this.camFrom, { yaw: 1.8 - 0.15 * d, pitch: 0.3, dist: (4.4 - 0.35 * d) * this.far() }, k, 0, c);
      c.pivot.copy(this.camFrom.pivot);
      this.orbitPose(c, 1);
    }
    if (this.step === 1 && ck.open <= 0) {
      this.vent(0.4);
      if (!e.reduced) { if (fp) ck.headV.y -= 0.18; else e.rig.kick(0.05); }
      return true;
    }
    return false;
  }

  // narrow (portrait) screens stand the side shots further back so the whole ship and pilot fit
  far() { const a = this.eva.camera.aspect; return a < 1 ? Math.min(1.9, 1.25 / Math.max(0.4, a)) : 1; }

  cockpitPitch() { return this.eva.camera.aspect < 0.8 ? PITCH * 0.3 : PITCH; }

  mixLegs(a, b, kb, c, kc) {
    for (let i = 0; i < 6; i++) this.legs[i] = a[i] + (b[i] - a[i]) * kb + (c[i] - b[i]) * kc;
  }

  // ---- pose the body, the arms and the first-person camera -----------------------------------------------
  place(dt, o) {
    const e = this.eva, ship = e.ship, cam = e.camera, fp = this.fpv;
    const g = this.ghost, gb = this.ghostBody;
    g.position.copy(this.torso).applyQuaternion(ship.quat).add(ship.pos); g.quaternion.copy(o.quat);
    gb.rotation.set(this.tilt, 0, 0); g.updateMatrixWorld(true);
    // the EVA state follows along (rope, markers)
    e.pilot.pos.copy(g.position); e.pilot.quat.copy(o.quat);

    const settled = this.dir === 'in' && this.t > this.A + 1.9;
    if (fp && !settled) {
      // eye: on the torso (ignoring the lean, as the EVA view does), looking where the head turns
      cam.position.copy(SUIT.eye).applyQuaternion(o.quat).add(g.position);
      _e.set(o.pitch, o.yaw, 0); cam.quaternion.copy(o.quat).multiply(_q.setFromEuler(_e));
      const f0 = this.dir === 'out' ? this.fov0 : 74, f1 = this.dir === 'out' ? 74 : (cam.aspect < 0.8 ? 80 : 72);
      cam.fov = f0 + (f1 - f0) * sm(this.dir === 'out' ? 1.5 : this.A, this.dir === 'out' ? 3.3 : this.A + 1.6, this.t);
      cam.up.set(0, 1, 0).applyQuaternion(cam.quaternion);
      cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      if (e.cockpit.mode === 1) { const c = e.cockpit.cam; c.position.copy(cam.position); c.quaternion.copy(cam.quaternion); c.fov = cam.fov; c.updateProjectionMatrix(); c.updateMatrixWorld(); }
    }
    if (fp) {
      e.body.visible = false;
      const on = this.dir === 'out' || this.t < this.A + 1.75;
      e.pass.enabled = on;
      if (on) {
        e.handView(cam);
        this.poseArms(e.armR, e.armL, o, true);
        e.gloveL.setCurl(0.3 + 0.35 * o.grab);
        e.visorU.uOn.value = o.visor;
        e.fitVisor(cam);
      }
    } else {
      const b = e.body; b.visible = true;
      b.position.copy(g.position); b.quaternion.copy(g.quaternion);
      const u = b.userData; u.body.rotation.set(this.tilt, 0, 0);
      const L = this.legs;
      u.legR.hip.rotation.set(L[0], 0, 0.06); u.legR.knee.rotation.x = L[1]; u.legR.ankle.rotation.x = L[2];
      u.legL.hip.rotation.set(L[3], 0, 0.08); u.legL.knee.rotation.x = L[4]; u.legL.ankle.rotation.x = L[5];
      b.updateMatrixWorld(true);
      this.fitLegs(u);
      this.poseArms(u.armR, u.armL, o, false);
      u.armL.glove.setCurl(0.35 + 0.35 * o.grab, 0.2); u.armR.glove.setCurl(0.92);
      e.pass.enabled = false;
    }
  }

  // The suit is bigger than the cockpit well is deep, so while the hips are down in the seat the legs are folded
  // away inside the fuselage. Each leg is nudged (hip pitch, knee) from the scripted pose until no part of it pokes
  // out through the hull's skin below the cockpit floor: a small pattern search from the scripted pose every
  // frame, so it is continuous and lets go as soon as the legs are up and clear.
  fitLegs(u) {
    const e = this.eva, ship = e.ship, core = e.suit.core;
    _qi.copy(ship.quat).invert();
    [[u.legR, 10], [u.legL, 16]].forEach(([leg, i0]) => {
      const S = core.slice(i0, i0 + 6), B = legProbes(leg);
      const cost = (hp, kn) => {
        leg.hip.rotation.x = hp; leg.knee.rotation.x = kn; leg.hip.updateMatrixWorld(true);
        let c = 0;
        for (const s of S) {
          _v.copy(s.l).applyMatrix4(s.o.matrixWorld).sub(ship.pos).applyQuaternion(_qi);
          if (_v.y - s.r > FLOOR_Y) continue;              // in the cockpit (or above it): fine
          c += exposed(_v, s.r);
        }
        // and the corners of the real thigh, shin and boot shells (the soles stick out past the spheres)
        for (const [o, pts] of B) for (const q of pts) {
          _v.copy(q).applyMatrix4(o.matrixWorld).sub(ship.pos).applyQuaternion(_qi);
          if (_v.y > FLOOR_Y) continue;
          const f = field(_v.x, _v.y, _v.z) + 0.04; if (f > 0) c += f * f;
        }
        return c;
      };
      const h0 = leg.hip.rotation.x, k0 = leg.knee.rotation.x;
      let h = h0, k = k0, best = cost(h, k);
      if (best > 0) {
        const J = (hh, kk) => cost(hh, kk) * 400 + (hh - h0) ** 2 + 0.6 * (kk - k0) ** 2;
        let f = J(h, k);
        for (let step = 0.4; step > 0.012; step *= 0.5) {
          for (let it = 0, moved = true; it < 6 && moved; it++) {
            moved = false;
            for (const [dh, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]]) {
              const hh = THREE.MathUtils.clamp(h + dh * step, -0.4, 2.3), kk = THREE.MathUtils.clamp(k + dk * step, -2.45, -0.05);
              const g = J(hh, kk); if (g < f) { f = g; h = hh; k = kk; moved = true; }
            }
          }
        }
      }
      leg.hip.rotation.x = h; leg.knee.rotation.x = k; leg.hip.updateMatrixWorld(true);
    });
  }

  // arms: a blend of a rest pose (body space), the hands on the glareshield (ship space) and the first-person
  // view-model pose (camera space), all brought into each arm's own space
  poseArms(armR, armL, o, fp) {
    const e = this.eva, ship = e.ship, gb = this.ghostBody;
    const fpT = fp ? fpTargets({ narrow: Math.min(1, e.camera.aspect * 1.3) }) : null;
    [[armR, 1, fpT && fpT.R], [armL, -1, fpT && fpT.L]].forEach(([arm, sx, F]) => {
      const root = arm.root; root.updateWorldMatrix(true, false); _mi.copy(root.matrixWorld).invert();
      const toArm = (p, out) => out.copy(p).applyMatrix4(_mi);
      const dirToArm = (d, out) => out.copy(d).transformDirection(_mi);
      const bodyPt = (p, out) => gb.localToWorld(out.set(p.x * sx, p.y, p.z));
      const bodyDir = (d, out) => out.set(d.x * sx, d.y, d.z).transformDirection(gb.matrixWorld);
      // rest: seated hands on the thighs, or floating free
      const R = A.rest, w = o.seatW;
      R.W.lerpVectors(REST.float.W, REST.seat.W, w); bodyPt(R.W, _v); toArm(_v, R.W);
      _F.lerpVectors(REST.float.F, REST.seat.F, w); bodyDir(_F, _v); dirToArm(_v, _F);
      _T.lerpVectors(REST.float.T, REST.seat.T, w); bodyDir(_T, _v); dirToArm(_v, _T);
      handBasis(_F, _T, R.Q);
      R.P.lerpVectors(REST.float.P, REST.seat.P, w);
      // (first person: the shoulders sit a little wider and lower, so the upper arms don't fill the bottom corners)
      toArm(bodyPt(fp ? _v2.copy(SUIT.shoulder).add(FP_SH) : SUIT.shoulder, _v), R.S);
      // grab: palm down on the hood, fingers curled over its front edge, elbows out
      const G = A.grab;
      toArm(_v.copy(HOLD[sx > 0 ? 0 : 1]).applyQuaternion(ship.quat).add(ship.pos), G.W);
      dirToArm(_v.set(sx * 0.15, -0.55, -1).applyQuaternion(ship.quat), _F);
      dirToArm(_v.set(-sx, 0.1, -0.25).applyQuaternion(ship.quat), _T);
      handBasis(_F, _T, G.Q); G.P.copy(GRAB_P);
      // first person: the view-model arms take over at the end of the way out / start of the way in
      const Out = A.out;
      Out.S.copy(R.S); Out.W.copy(R.W); Out.Q.copy(R.Q); Out.P.copy(R.P);
      if (F && o.fpW > 0) { Out.S.lerp(F.S, o.fpW); Out.W.lerp(F.W, o.fpW); Out.Q.slerp(F.Q, o.fpW); Out.P.lerp(F.P, o.fpW); }
      Out.W.lerp(G.W, o.grab); Out.Q.slerp(G.Q, o.grab); Out.P.lerp(G.P, o.grab).normalize();
      solveArm(arm, Out.S, Out.W, Out.P, Out.Q);
      // first person, the left glove takes the cutter's fore grip as the view-model pose takes over
      if (sx < 0) arm.glove.hold = fpT ? o.fpW * fpT.two * (1 - o.grab) : 0;
    });
  }

  // ---- third-person camera ---------------------------------------------------------------------------------
  // orbit between two (yaw, pitch, dist) around the pivot; `way` -1/+1 forces the direction, 0 takes the short one
  orbit(a, b, k, way, out) {
    let dy = b.yaw - a.yaw;
    if (way === 0) dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    else if (way < 0 && dy > 0) dy -= Math.PI * 2; else if (way > 0 && dy < 0) dy += Math.PI * 2;
    out.yaw = a.yaw + dy * k; out.pitch = a.pitch + (b.pitch - a.pitch) * k; out.dist = a.dist + (b.dist - a.dist) * k;
    return out;
  }

  orbitPose(c, apply) {
    const e = this.eva, ship = e.ship, cam = e.camera;
    _v.set(Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch)).multiplyScalar(c.dist).add(c.pivot);
    const pw = _v2.copy(c.pivot).applyQuaternion(ship.quat).add(ship.pos);
    cam.position.copy(_v).applyQuaternion(ship.quat).add(ship.pos);
    cam.up.set(0, 1, 0).applyQuaternion(ship.quat);
    _m.lookAt(cam.position, pw, cam.up); cam.quaternion.setFromRotationMatrix(_m);
    if (apply) this.camFov(66);
  }

  // the over-the-shoulder EVA camera (same offset as Eva.place), reached by orbiting round the pivot
  // (never a straight line through the pilot), then locked to the exact pose and heading
  shoulderShot(c, j) {
    const e = this.eva, cam = e.camera, p = e.pilot, ship = e.ship;
    if (j > 0) {
      _v.set(0.8, 0.55, 2.35).applyQuaternion(p.quat).add(p.pos).sub(ship.pos).applyQuaternion(_q.copy(ship.quat).invert()).sub(c.pivot);
      const d = _v.length(), S = { yaw: Math.atan2(_v.x, _v.z), pitch: Math.asin(THREE.MathUtils.clamp(_v.y / d, -1, 1)), dist: d };
      this.orbit({ yaw: c.yaw, pitch: c.pitch, dist: c.dist }, S, j, 0, c);
    }
    this.orbitPose(c, 0);
    if (j > 0) cam.quaternion.slerp(p.quat, j * j);
    cam.up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    this.camFov(66);
  }

  camFov(f) { const cam = this.eva.camera; cam.fov = this.fov0 + (f - this.fov0) * clamp01(this.t / 1.2); cam.updateProjectionMatrix(); cam.updateMatrixWorld(); }

  // a breath of cabin air out of the canopy seam (s: how much)
  vent(s) {
    const e = this.eva, ship = e.ship, fx = e.fx, n = Math.round((e.coarse ? 14 : 28) * s);
    for (let i = 0; i < n; i++) {
      const z = -1.3 + Math.random() * 1.8, [cw, , y0] = canopyAt(z), sx = Math.random() < 0.5 ? -1 : 1;
      _v.set(sx * cw, y0 + 0.02, z).applyQuaternion(ship.quat).add(ship.pos);
      _v2.set(sx * (0.5 + Math.random() * 0.9), 0.3 + Math.random() * 0.6, (Math.random() - 0.5) * 0.4).multiplyScalar(s > 0.5 ? 1 : 0.6).applyQuaternion(ship.quat).add(ship.vel);
      fx.emit(_v, _v2, e.fxT(), 0.6 + Math.random() * 0.7, 0.03, 0.28 + Math.random() * 0.2, K.RCS, 2.4, 0.0);
    }
  }
}
