import * as THREE from 'three';
import { mats } from './assets.js';
import { K } from './gpufx.js';
import { containerParts } from './base.js';

// The yard's machinery: every ship you own gets a berth on the base. Buying one has it shipped in a container by a
// yard tug while the hangar grows outward to take it; claiming a derelict has the tug fetch it in; selling has it
// towed away and the berth folds back up. Each is a job on the base's queue, filmed by a cinematic camera
// (skippable). Berths and keel lengths are saved in 'rell.base'.

const SAVE = 'rell.base';
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const bez = (a, b, c, d, t, out) => { const u = 1 - t; return out.set(0, 0, 0).addScaledVector(a, u * u * u).addScaledVector(b, 3 * u * u * t).addScaledVector(c, 3 * u * t * t).addScaledVector(d, t * t * t); };
const bezD = (a, b, c, d, t, out) => { const u = 1 - t; return out.set(0, 0, 0).addScaledVector(_v3.copy(b).sub(a), 3 * u * u).addScaledVector(_v3.copy(c).sub(b), 6 * u * t).addScaledVector(_v3.copy(d).sub(c), 3 * t * t); };
// a quaternion whose -x (the tug's nose) points along dir, up as near world up as it can
function noseAlong(dir, up, out) {
  const x = _v.copy(dir).normalize().negate(), z = _v2.crossVectors(x, up).normalize(); if (z.lengthSq() < 1e-6) z.set(0, 0, 1);
  const y = _v3.crossVectors(z, x).normalize();
  return out.setFromRotationMatrix(_m.makeBasis(x, y, z));
}

export class Yard {
  constructor({ base, fleet, econ, sound, toast, nav, fx, getFxT, rig, camera, reduced }) {
    Object.assign(this, { base, fleet, econ, sound, toast, nav, fx, getFxT, rig, cam: camera, reduced });
    fleet.berthed = (S) => !!this.rec(S.spec.id)?.parked;
    base.fleet = fleet;
    let s = {}; try { s = JSON.parse(localStorage.getItem(SAVE) || '{}') || {}; } catch {}
    this.recs = Array.isArray(s.berths) ? s.berths : [];
    // berths already deployed
    for (const r of this.recs) {
      const S = fleet.byId[r.id]; if (!S || S.sold || !S.owned) continue;
      const b = base.makeBerth({ ...r, spec: S.spec }); base.poseBerth(b, 1); b.state = 'ready'; base.berthCollide(b, true);
      if (r.parked) { base.berthPose(b, S.spec, S.V.pos, S.V.quat); S.V.vel.set(0, 0, 0); S.V.w.set(0, 0, 0); fleet.place(S, 0); }
    }
    this.recs = this.recs.filter((r) => base.berths.some((b) => b.id === r.id));
    this.hideCatalog();
    this.buildDom();
    this.cineCam = { p: new THREE.Vector3(), l: new THREE.Vector3(), init: true };
    this.save();
  }

  save() {
    const o = { keel: this.base.keel, berths: this.recs.map(({ id, side, z0, parked }) => ({ id, side, z0, parked: !!parked })) };
    try { localStorage.setItem(SAVE, JSON.stringify(o)); } catch {}
  }
  rec(id) { return this.recs.find((r) => r.id === id); }
  berth(id) { return this.base.berths.find((b) => b.id === id); }

  // yard ships you don't own are in the catalogue, not floating about: keep them out of the world
  hideCatalog() {
    for (const S of this.fleet.ships) {
      if (S.spec.cat !== 'yard' || S.owned || S.sold) continue;
      S.V.pos.set(0, -4000, 0); S.V.vel.set(0, 0, 0); this.fleet.place(S, 0); this.fleet.show(S, false);
    }
  }

  // ---- what the counter can do --------------------------------------------------------------------------------
  canBuy(id) { const S = this.fleet.byId[id]; return S && S.spec.cat === 'yard' && !S.owned && !S.sold && !this.base.busy(); }
  order(id) {
    const S = this.fleet.byId[id]; if (!this.canBuy(id)) return false;
    if (this.econ.credits < S.spec.price) { this.toast('warn', 'Not enough credits'); return false; }
    this.econ.credits -= S.spec.price; this.econ.save(); S.owned = true; this.fleet.saveAll();
    const slot = this.base.slotFor(S.spec); const r = { id, ...slot, parked: false }; this.recs.push(r); this.save();
    this.base.queue(this.deliveryJob(S, r));
    return true;
  }
  // a derelict you've flown home (or found near enough): the tug fetches it into a berth
  canClaim(id) { const S = this.fleet.byId[id]; return S && S.spec.cat === 'derelict' && S.found && !S.owned && !S.sold && this.fleet.state(S).home && !this.fleet.helm && !this.base.busy(); }
  claim(id) {
    const S = this.fleet.byId[id]; if (!this.canClaim(id)) return false;
    if (S.spec.walk) { (this.fleetClaim || this.fleet.claim.bind(this.fleet))(id); this.toast('info', `${S.spec.name} registered · moored where she is`); return true; }
    S.owned = true; this.fleet.saveAll();
    const slot = this.base.slotFor(S.spec); const r = { id, ...slot, parked: false }; this.recs.push(r); this.save();
    this.base.queue(this.fetchJob(S, r, true));
    return true;
  }
  // bring an owned ship that's out and about back into its berth
  canRecall(id) { const S = this.fleet.byId[id], r = this.rec(id); return S && r && S.owned && !r.parked && this.fleet.helm !== S && this.fleet.dock?.S !== S && this.fleet.state(S).home && !this.base.busy(); }
  recall(id) { const S = this.fleet.byId[id]; if (!this.canRecall(id)) return false; this.base.queue(this.fetchJob(S, this.rec(id), false)); return true; }
  canSell(id) {
    const S = this.fleet.byId[id]; if (!S || S.sold || this.fleet.helm === S || this.fleet.dock?.S === S || this.base.busy()) return false;
    if (S.spec.cat === 'yard') return S.owned;
    return S.found && this.fleet.state(S).home;
  }
  sellValue(S) { return S.spec.cat === 'yard' ? Math.round(S.spec.price * 0.6) : Math.round(S.spec.salvage * (0.5 + 0.5 * S.V.hull)); }
  sell(id) {
    const S = this.fleet.byId[id]; if (!this.canSell(id)) return false;
    const r = this.rec(id);
    if (r && r.parked) { this.base.queue(this.sellJob(S, r)); return true; }
    // not in a berth: sold where it floats, the buyer collects
    this.payOut(S); return true;
  }
  payOut(S) {
    const v = this.sellValue(S); this.econ.bonus(v); this.nav.pop(v);
    if (S.spec.cat === 'yard') { S.owned = false; S.V.pos.set(0, -4000, 0); S.V.vel.set(0, 0, 0); S.V.fuel = 1; S.V.hull = 1; this.fleet.place(S, 0); this.fleet.show(S, false); }
    else { S.sold = true; S.owned = false; this.fleet.remove(S); }
    const i = this.recs.findIndex((r) => r.id === S.spec.id); if (i >= 0) this.recs.splice(i, 1);
    this.econ.save(); this.fleet.saveAll(); this.save(); this.sound?.chime?.(false); this.toast('info', `${S.spec.name} sold · ${v.toLocaleString('en-US')}`);
  }

  // ---- shared steps ----
  // grow the keel if the berth runs past it; returns seconds the keel takes
  keelFor(r, spec) {
    const need = r.z0 + this.base.berthDims(spec).W;
    if (need <= this.base.keel[r.side]) return 0;
    const before = this.base.keelSegs[r.side].length;
    this.base.keel[r.side] = need; this.base.buildKeel(r.side, need, true);
    const added = this.base.keelSegs[r.side].length - before;
    // stagger: each new truss slides out after the last
    this.base.keelSegs[r.side].slice(before).forEach((g, i) => { g.userData.t = -i * 0.9 / 1.6; });
    this.save();
    return added ? 0.9 * (added - 1) + 1.7 : 0;
  }
  deployBerth(J, t0) {
    // unfold + telescope; returns end time
    const b = J.b, dur = 3 + 0.8 * b.n;
    const k = clamp01((J.t - t0) / dur);
    if (k > 0 && !J.unfoldSnd) { J.unfoldSnd = true; if (!J.quiet) { this.sound?.noise?.(3, 'lowpass', 140, 0.35); this.sound?.warn?.(); } }
    const prev = b.k; this.base.poseBerth(b, k);
    // a clunk as each section locks out
    const n = b.segs.length, tk = (k - 0.3) / 0.7;
    for (let i = 0; i < n; i++) { const j = n - 1 - i, at = (j / n) * 0.6 + 0.4; const was = (prev - 0.3) / 0.7; if (was < at && tk >= at && !J.quiet) this.base.clunk(b.segs[i].getWorldPosition(_v).addScaledVector(this.base.site.group.position, 0)); }
    if (prev < 0.3 && k >= 0.3 && !J.quiet) this.base.clunk(b.grp.getWorldPosition(_v));
    if (k >= 1 && b.state !== 'ready') { b.state = 'ready'; this.base.berthCollide(b, true); }
    return t0 + dur;
  }
  // the tug's pose for pushing something whose outer end is at `endW`, facing inward along `inW`
  tugAt(endW, inW, up, quatOut, posOut) { noseAlong(inW, up, quatOut); posOut.copy(endW).addScaledVector(inW, -5.6); }
  tugShow(on, pw) { const T = this.base.tug; T.visible = on; T.userData.glow.opacity = on ? pw : 0; for (const c of T.children) if (c.geometry?.type === 'ConeGeometry') c.scale.set(1, 0.6 + pw, 1); }
  setTug(p, q) { const T = this.base.tug; T.position.copy(p).applyMatrix4(_m.copy(this.base.site.group.matrixWorld).invert()); T.quaternion.copy(this.base.site.group.quaternion).invert().multiply(q); }
  thrusterFx(pw) {
    if (!this.fx || pw < 0.05) return;
    const T = this.base.tug, t = this.getFxT();
    for (const s of [-1, 1]) { _v.set(7.4, 0, s * 1.4).applyMatrix4(T.matrixWorld); _v2.set(1, 0, 0).transformDirection(T.matrixWorld).multiplyScalar(14 * pw); this.fx.emit(_v, _v2, t, 0.25, 0.4, 1.6 * pw, K.PLASMA, 2, 0.01); }
  }

  // ---- delivery: berth out, container in, sleeve off, tug away ----
  deliveryJob(S, r) {
    const base = this.base, spec = S.spec;
    const J = { kind: 'deliver', S, r, quiet: false };
    J.start = () => {
      J.b = base.makeBerth({ ...r, spec }); base.poseBerth(J.b, 0);
      J.tKeel = this.keelFor(r, spec);
      J.tDeploy = J.tKeel + 3 + 0.8 * J.b.n;
      // container sized to the hull, built now
      const len = spec.len + 4, wid = spec.beam + 3, hgt = spec.height + 3;
      J.box = this.buildContainer(len, wid, hgt); J.hl = len / 2;
      J.arrive = 10; J.slide = 6; J.shut = 2.4; J.sleeve = 7; J.leave = 7;
      J.t1 = J.tDeploy + 0.6; J.t2 = J.t1 + J.arrive; J.t3 = J.t2 + J.slide; J.t4 = J.t3 + J.shut; J.t5 = J.t4 + J.sleeve; J.t6 = J.t5 + J.leave;
      S.site.group.visible = true;
      this.cine(J);
      if (!J.quiet) { this.sound?.warn?.(); this.toast('info', `${spec.name} ordered · watch the yard`); }
    };
    J.step = (J, dt) => {
      const b = J.b, t = J.t;
      this.deployBerth(J, J.tKeel);
      // the frames: berth axis (outward), the berth's ship pose, the container's end points
      b.grp.updateMatrixWorld(true); const bq = b.grp.getWorldQuaternion(new THREE.Quaternion());
      const out = new THREE.Vector3(1, 0, 0).applyQuaternion(bq), up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.base.site.group.quaternion);
      const cIn = new THREE.Vector3(0.9 + b.len / 2, 0, 0).applyMatrix4(b.grp.matrixWorld);          // container centre, docked
      const cEntry = cIn.clone().addScaledVector(out, b.len / 2 + J.hl + 12);                          // just outside
      const cFar = cEntry.clone().addScaledVector(out, 900).addScaledVector(up, 260).addScaledVector(_v2.set(0, 0, 1).applyQuaternion(this.base.site.group.quaternion), 400);
      const cq = new THREE.Quaternion(), cp = new THREE.Vector3();
      let pw = 0;
      if (t < J.t1) { this.tugShow(false, 0); J.box.visible = false; S.site.group.visible = false; }
      else if (t < J.t2) {
        const k = ease((t - J.t1) / J.arrive);
        const a = cFar, c1 = cFar.clone().lerp(cEntry, 0.35).addScaledVector(up, 80), c2 = cEntry.clone().addScaledVector(out, 260);
        bez(a, c1, c2, cEntry, k, cp); bezD(a, c1, c2, cEntry, Math.max(0.001, k), _v); noseAlong(_v, up, cq); cq.slerp(bq, ease((k - 0.7) / 0.3)); pw = 1 - k * 0.6;
      } else if (t < J.t3) { const k = ease((t - J.t2) / J.slide); cp.lerpVectors(cEntry, cIn, k); cq.copy(bq); pw = 0.25; }
      else if (t < J.t4) { cp.copy(cIn); cq.copy(bq); }
      else if (t < J.t5) { const k = ease((t - J.t4) / J.sleeve); cp.lerpVectors(cIn, cEntry, k); cq.copy(bq); pw = 0.35; }
      else { const k = ease((t - J.t5) / J.leave); const far = cEntry.clone().addScaledVector(out, 700).addScaledVector(up, 300); cp.lerpVectors(cEntry, far, k * k); _v.copy(far).sub(cEntry); noseAlong(_v.negate(), up, cq); cq.slerp(bq, 1 - ease(k * 3)); pw = 0.4 + k * 0.6; }
      if (t >= J.t1) {
        // container group sits at its centre; the tug pushes on its outer end
        J.box.visible = t < J.t6; this.placeLocal(J.box, cp, cq);
        _v.set(1, 0, 0).applyQuaternion(cq); const endW = cp.clone().addScaledVector(_v, J.hl + 0.4);
        const tq = new THREE.Quaternion(), tp = new THREE.Vector3(); this.tugAt(endW, _v.clone().negate(), up, tq, tp);
        this.setTug(tp, tq); this.tugShow(t < J.t6, pw); this.thrusterFx(pw);
        // the ship rides inside until the sleeve comes off, then stays on its berth
        if (t < J.t4) { this.shipIn(S, cp, cq); } else { base.berthPose(b, spec, S.V.pos, S.V.quat); this.fleet.place(S, 0); }
        S.site.group.visible = true;
        // the shutter at the inner end rolls up
        J.box.userData.shutter.scale.y = Math.max(0.02, 1 - clamp01((t - J.t3) / J.shut));
        if (t >= J.t3 && !J.unlatch) { J.unlatch = true; if (!J.quiet) { this.sound?.noise?.(1.2, 'highpass', 2400, 0.2); this.base.clunk(cIn.clone().addScaledVector(out, -J.hl)); } }
        if (t >= J.t2 && !J.seat) { J.seat = true; if (!J.quiet) { this.sound?.hit?.(6); this.rig?.kick(0.06); } }
      }
      if (t >= J.t6) J.done = true;
    };
    J.finish = () => {
      if (J.box) { J.box.removeFromParent(); }
      this.tugShow(false, 0);
      base.berthPose(J.b, spec, S.V.pos, S.V.quat); S.V.vel.set(0, 0, 0); S.V.w.set(0, 0, 0); this.fleet.place(S, 0); this.fleet.show(S, true);
      r.parked = true; this.save(); this.fleet.saveAll();
      this.toast('info', `${spec.name} berthed`); this.sound?.chime?.(true);
    };
    return J;
  }

  // ---- fetch: berth out if needed, tug flies out, latches on the nose, tows it in tail first ----
  fetchJob(S, r, claim) {
    const base = this.base, spec = S.spec;
    const J = { kind: claim ? 'claim' : 'recall', S, r };
    J.start = () => {
      J.b = this.berth(S.spec.id) || base.makeBerth({ ...r, spec });
      J.tKeel = J.b.state === 'ready' ? 0 : this.keelFor(r, spec);
      J.tDeploy = J.b.state === 'ready' ? 0 : J.tKeel + 3 + 0.8 * J.b.n;
      J.p0 = S.V.pos.clone(); J.q0 = S.V.quat.clone();
      J.go = 6; J.tow = 12; J.slide = 6; J.leave = 6;
      J.t1 = J.tDeploy + 0.5; J.t2 = J.t1 + J.go; J.t3 = J.t2 + 1.2; J.t4 = J.t3 + J.tow; J.t5 = J.t4 + J.slide; J.t6 = J.t5 + J.leave;
      this.cine(J);
      this.toast('info', claim ? `${spec.name}: claim filed · tug on the way` : `${spec.name}: tug on the way`);
    };
    J.step = (J) => {
      const b = J.b, t = J.t;
      if (J.tDeploy) this.deployBerth(J, J.tKeel);
      b.grp.updateMatrixWorld(true); const bq = b.grp.getWorldQuaternion(new THREE.Quaternion());
      const out = new THREE.Vector3(1, 0, 0).applyQuaternion(bq), up = new THREE.Vector3(0, 1, 0).applyQuaternion(base.site.group.quaternion);
      const pIn = new THREE.Vector3(), qIn = new THREE.Quaternion(); base.berthPose(b, spec, pIn, qIn);
      const pEntry = pIn.clone().addScaledVector(out, spec.len + 16);
      // the ship's nose, where the tug latches: ship space -z
      const noseOf = (p, q, o) => o.copy(p).addScaledVector(_v.set(0, 0, -1).applyQuaternion(q), spec.len * 0.55 + 1);
      const home = base.world(_v2.set(0, 2, 40), new THREE.Vector3());
      let pw = 0; const tp = new THREE.Vector3(), tq = new THREE.Quaternion();
      if (t < J.t1) { this.tugShow(false, 0); }
      else if (t < J.t2) {   // out to the ship
        const k = ease((t - J.t1) / J.go), nose = noseOf(J.p0, J.q0, new THREE.Vector3()), dirN = _v3.set(0, 0, -1).applyQuaternion(J.q0).clone();
        const at = nose.clone().addScaledVector(dirN, 5.6);
        bez(home, home.clone().addScaledVector(up, 60), at.clone().addScaledVector(dirN, 80), at, k, tp); bezD(home, home.clone().addScaledVector(up, 60), at.clone().addScaledVector(dirN, 80), at, Math.max(0.001, k), _v);
        noseAlong(_v, up, tq); const latchQ = noseAlong(dirN.clone().negate(), up, new THREE.Quaternion()); tq.slerp(latchQ, ease((k - 0.75) / 0.25)); pw = 1 - k * 0.7;
        this.setTug(tp, tq);
      } else if (t < J.t3) {   // latch
        if (!J.latched) { J.latched = true; const nose = noseOf(J.p0, J.q0, new THREE.Vector3()); base.clunk(nose); }
        pw = 0.1;
      } else if (t < J.t5) {   // tow to the berth mouth, then slide in tail first
        const p = new THREE.Vector3(), q = new THREE.Quaternion();
        if (t < J.t4) { const k = ease((t - J.t3) / J.tow); const c1 = J.p0.clone().addScaledVector(up, 40), c2 = pEntry.clone().addScaledVector(out, 200); bez(J.p0, c1, c2, pEntry, k, p); q.slerpQuaternions(J.q0, qIn, ease(k * 1.2)); pw = 0.9; }
        else { const k = ease((t - J.t4) / J.slide); p.lerpVectors(pEntry, pIn, k); q.copy(qIn); pw = 0.3; }
        S.V.pos.copy(p); S.V.quat.copy(q); S.V.vel.set(0, 0, 0); S.V.w.set(0, 0, 0); this.fleet.place(S, 0);
        const nose = noseOf(p, q, new THREE.Vector3()), dirN = _v3.set(0, 0, -1).applyQuaternion(q).clone();
        noseAlong(dirN.clone().negate(), up, tq); tp.copy(nose).addScaledVector(dirN, 5.6); this.setTug(tp, tq);
      } else {   // let go, back off, away
        if (!J.parked) { J.parked = true; base.berthPose(b, spec, S.V.pos, S.V.quat); this.fleet.place(S, 0); }
        const k = ease((t - J.t5) / J.leave), nose = noseOf(pIn, qIn, new THREE.Vector3()), dirN = _v3.set(0, 0, -1).applyQuaternion(qIn).clone();
        const a = nose.clone().addScaledVector(dirN, 5.6), far = a.clone().addScaledVector(out, 600).addScaledVector(up, 260);
        tp.lerpVectors(a, far, k * k); noseAlong(dirN.clone().negate(), up, tq); pw = 0.3 + 0.7 * k; this.setTug(tp, tq);
      }
      if (t >= J.t1) { this.tugShow(t < J.t6, pw); this.thrusterFx(pw); }
      if (t >= J.t6) J.done = true;
    };
    J.finish = () => {
      this.tugShow(false, 0);
      base.berthPose(J.b, spec, S.V.pos, S.V.quat); S.V.vel.set(0, 0, 0); S.V.w.set(0, 0, 0); this.fleet.place(S, 0);
      r.parked = true; this.save();
      if (claim) { this.fleet.claim(spec.id) || (S.owned = true); }
      this.fleet.saveAll();
      this.toast('info', `${spec.name} berthed`); this.sound?.chime?.(true);
    };
    return J;
  }

  // ---- sale: tug pulls it out by the nose and takes it away, then the berth folds back ----
  sellJob(S, r) {
    const base = this.base, spec = S.spec;
    const J = { kind: 'sell', S, r };
    J.start = () => { J.b = this.berth(spec.id); J.come = 6; J.pull = 6; J.away = 8; J.fold = 3 + 0.6 * J.b.n; J.t1 = 0.3 + J.come; J.t2 = J.t1 + 1.2; J.t3 = J.t2 + J.pull; J.t4 = J.t3 + J.away; J.t5 = J.t4 + J.fold; this.cine(J); r.parked = false; this.save(); };
    J.step = (J) => {
      const b = J.b, t = J.t;
      b.grp.updateMatrixWorld(true); const bq = b.grp.getWorldQuaternion(new THREE.Quaternion());
      const out = new THREE.Vector3(1, 0, 0).applyQuaternion(bq), up = new THREE.Vector3(0, 1, 0).applyQuaternion(base.site.group.quaternion);
      const pIn = new THREE.Vector3(), qIn = new THREE.Quaternion(); base.berthPose(b, spec, pIn, qIn);
      const nose0 = pIn.clone().addScaledVector(out, spec.len * 0.55 + 1), at = nose0.clone().addScaledVector(out, 5.6);
      const tq = noseAlong(out.clone().negate(), up, new THREE.Quaternion()), tp = new THREE.Vector3(); let pw = 0;
      if (t < J.t1) { const k = ease((t - 0.3) / J.come); const far = at.clone().addScaledVector(out, 500).addScaledVector(up, 200); tp.lerpVectors(far, at, k); pw = 1 - k * 0.8; }
      else if (t < J.t2) { tp.copy(at); if (!J.latched) { J.latched = true; base.clunk(nose0); } }
      else if (t < J.t4) {
        const k = t < J.t3 ? ease((t - J.t2) / J.pull) : 1, k2 = t < J.t3 ? 0 : ease((t - J.t3) / J.away);
        const p = pIn.clone().addScaledVector(out, (spec.len + 18) * k + 700 * k2 * k2).addScaledVector(up, 260 * k2 * k2);
        S.V.pos.copy(p); S.V.quat.copy(qIn); this.fleet.place(S, 0); S.site.group.visible = k2 < 0.98;
        tp.copy(p).addScaledVector(out, spec.len * 0.55 + 6.6); pw = 0.4 + 0.6 * k2;
      } else {
        if (!J.paid) { J.paid = true; this.payOut(S); b.state = 'folding'; base.berthCollide(b, false); }
        base.poseBerth(b, 1 - clamp01((t - J.t4) / J.fold));
      }
      this.setTug(tp, tq); this.tugShow(t > 0.3 && t < J.t4, pw); this.thrusterFx(pw);
      if (t >= J.t5) J.done = true;
    };
    J.finish = () => {
      this.tugShow(false, 0);
      if (!J.paid) { J.paid = true; this.payOut(S); base.berthCollide(J.b, false); }
      const b = J.b; b.grp.removeFromParent(); base.berths.splice(base.berths.indexOf(b), 1); base.resetMesh(); this.save();
    };
    return J;
  }

  // ---- bits ----
  placeLocal(obj, wp, wq) { obj.position.copy(wp).applyMatrix4(_m.copy(this.base.site.group.matrixWorld).invert()); obj.quaternion.copy(this.base.site.group.quaternion).invert().multiply(wq); }
  shipIn(S, cp, cq) {
    const d = S.d, c = _v.set((d.min[0] + d.max[0]) / 2, (d.min[1] + d.max[1]) / 2, (d.min[2] + d.max[2]) / 2);
    const q = _q.copy(cq).multiply(_q2.setFromAxisAngle(_v2.set(0, 1, 0), Math.PI / 2));
    S.V.quat.copy(q); S.V.pos.copy(cp).sub(c.applyQuaternion(q)); S.V.vel.set(0, 0, 0); S.V.w.set(0, 0, 0); this.fleet.place(S, 0);
  }
  buildContainer(len, wid, hgt) {
    const P = containerParts(len, wid, hgt), g = new THREE.Group(); g.name = 'container';
    const mk = (geo, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mats.hull); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    mk(P.side, 0, 0, P.hw); mk(P.side, 0, 0, -P.hw, Math.PI); mk(P.top, 0, P.hh, 0, -Math.PI / 2); mk(P.top, 0, -P.hh, 0, Math.PI / 2); mk(P.frame, 0, 0, 0);
    // the shutter at the inner (-x) end: slats on a roller drum at the top
    const sh = new THREE.Group(); sh.position.set(-P.hl - 0.15, P.hh - 0.3, 0); g.add(sh);
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.22, hgt - 0.6, wid - 0.6).translate(0, -(hgt - 0.6) / 2, 0), new THREE.MeshStandardMaterial({ color: 0x8c8678, roughness: 0.6, metalness: 0.4 }));
    sh.add(slat);
    for (let y = 0.8; y < hgt - 0.6; y += 0.8) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, wid - 0.7), new THREE.MeshStandardMaterial({ color: 0x5a5d62, roughness: 0.5, metalness: 0.6 })); s.position.y = -y; slat.add(s); }
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, wid - 0.4, 16).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3d4249, roughness: 0.5, metalness: 0.6 })); drum.position.set(-0.2, 0.2, 0); sh.add(drum);
    g.userData.shutter = sh;
    // marker lights on the corners
    const lm = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.0, 0.3), toneMapped: false });
    for (const x of [-P.hl, P.hl]) for (const y of [-P.hh, P.hh]) for (const z of [-P.hw, P.hw]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), lm); b.position.set(x * 1.0, y + Math.sign(y) * 0.5, z + Math.sign(z) * 0.5); g.add(b); }
    g.visible = false; this.base.site.group.add(g);
    return g;
  }

  // ---- the movie ----
  buildDom() {
    const css = document.createElement('style'); css.textContent = `
#cine{position:fixed;inset:0;pointer-events:none;z-index:8;display:none}
body.cine #cine{display:block}
#cine i{position:absolute;left:0;right:0;height:9vh;background:#050608;transition:transform .5s cubic-bezier(.2,.8,.2,1)}
#cine i.t{top:0;transform:translateY(-100%)}#cine i.b{bottom:0;transform:translateY(100%)}
body.cine.cin #cine i{transform:none}
#cine button{position:absolute;right:max(16px,env(safe-area-inset-right));bottom:calc(9vh + 12px);pointer-events:auto;font:600 11px ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:#e8e0cc;background:rgba(5,6,8,.6);border:1.5px solid rgba(232,224,204,.4);padding:9px 14px;cursor:pointer;border-radius:2px}
#cine p{position:absolute;left:max(16px,env(safe-area-inset-left));bottom:calc(9vh + 14px);margin:0;font:600 12px ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#e8e0cc;text-shadow:0 1px 3px #000}
#cine p b{color:#e8561a;font-weight:700}
body.cine #hud,body.cine #btns,body.cine #evabtns,body.cine #stn,body.cine #exitbtn,body.cine #viewbtn,body.cine #toast,body.cine #board,body.cine #tut,body.cine #objective{opacity:0!important;pointer-events:none!important}
`; document.head.appendChild(css);
    const el = this.el = document.createElement('div'); el.id = 'cine';
    el.innerHTML = '<i class="t"></i><i class="b"></i><p></p><button>Skip</button>';
    document.body.appendChild(el); this.cap = el.querySelector('p');
    el.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); this.skip(); });
    addEventListener('keydown', (e) => { if (this.base.cine && (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') && !e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); this.skip(); } }, true);
  }
  cine(J) {
    this.base.cine = { J }; this.cineCam.init = true;
    document.body.classList.add('cine'); requestAnimationFrame(() => document.body.classList.add('cin'));
    const n = J.S.spec.name, w = { deliver: 'Delivery', claim: 'Claim', recall: 'Recall', sell: 'Sale' }[J.kind];
    this.cap.innerHTML = `<b>${w}</b> · ${n}`;
    if (document.pointerLockElement) { if (this.menu) { this.menu.quiet = true; setTimeout(() => { this.menu.quiet = false; }, 300); } document.exitPointerLock(); }
    this.base.onCine = (on) => { if (!on) { document.body.classList.remove('cine', 'cin'); this.rig?.blendFrom?.(this.cam, 0.8); } };
  }
  skip() {
    const J = this.base.jobs[0]; if (!J) return;
    J.quiet = true; J.speed = 400;    // run the timeline out in a frame or two, quietly
  }
  // drive the camera while a job runs (after every other camera this frame)
  camera(dt) {
    const c = this.base.cine; if (!c) return false;
    const J = c.J, b = J.b, cam = this.cam, base = this.base; if (!b) return true;
    b.grp.updateMatrixWorld(true);
    const s = b.side ? 1 : -1, bw = b.grp.matrixWorld, up = _v3.set(0, 1, 0).applyQuaternion(base.site.group.quaternion).clone();
    const L = b.len, W = b.W, H = b.H, T = base.tug;
    const want = new THREE.Vector3(), look = new THREE.Vector3();
    const t = J.t;
    const wideP = () => want.set(L * 0.35, H * 0.5 + 18 + L * 0.18, s * (W / 2 + 26 + L * 0.55)).applyMatrix4(bw);
    if ((J.kind === 'deliver' || J.kind === 'claim') && t < (J.t1 ?? 0)) {
      // the hangar growing: wide from the mouth side, drifting
      wideP(); want.addScaledVector(up, Math.sin(t * 0.3) * 2);
      look.set(L * 0.45, -H * 0.1, 0).applyMatrix4(bw);
    } else if (T.visible && (J.kind === 'deliver' ? t < J.t3 : J.kind === 'sell' ? t < J.t2 || t > J.t3 : t < J.t5)) {
      // follow the tug in: low off the berth mouth, looking out at it
      want.set(L + 18, -H * 0.25, s * (W / 2 + 18 + L * 0.2)).applyMatrix4(bw);
      T.getWorldPosition(look);
      // the long haul in: ride alongside the tug and container, then hand over to the berth-mouth shot
      if (J.kind === 'deliver' && t < J.t1 + J.arrive * 0.62) { const back = _v2.copy(look).sub(want).normalize(); want.copy(look).addScaledVector(back, 26 + J.hl * 0.6).addScaledVector(up, 10 + J.hl * 0.4).add(_v.set(s * (J.hl + 14), 0, 0).applyQuaternion(T.quaternion)); }
      if (J.kind === 'claim' || J.kind === 'recall') { if (t < J.t3) { want.copy(look).add(_v.set(0, 25, 0).applyQuaternion(base.site.group.quaternion)).addScaledVector(_v2.copy(look).sub(base.site.pos).normalize(), 60); } }
    } else if (J.kind === 'sell' && t >= J.t4) { wideP(); look.set(L * 0.45, 0, 0).applyMatrix4(bw); }
    else {
      // unloading: side-on, close, the ship in frame
      // (from just off the open mouth: the berth's own side panels would hide it from abeam)
      want.set(L + 10 + L * 0.3, H * 0.4, s * (W * 0.5 + 8)).applyMatrix4(bw);
      look.set(L * 0.55, -H * 0.05, 0).applyMatrix4(bw);
    }
    // portrait phones see a narrow slice: pull back so the subject still fits
    const asp = cam.aspect || 1.6; if (asp < 1.3) want.sub(look).multiplyScalar(Math.min(2.4, 1.45 / asp)).add(look);
    const cc = this.cineCam;
    if (cc.init) { cc.p.copy(want); cc.l.copy(look); cc.init = false; }
    const k = this.reduced ? 1 : 1 - Math.exp(-1.6 * dt);
    cc.p.lerp(want, k); cc.l.lerp(look, 1 - Math.exp(-3 * dt));
    cam.position.copy(cc.p); cam.up.copy(up); cam.lookAt(cc.l);
    cam.near = 0.5; cam.fov = THREE.MathUtils.damp(cam.fov, 58, 3, dt); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    return true;
  }

  // ships berthed but out flying: once nobody's aboard and it's drifted back close, the berth reels it in
  update(dt) {
    for (const r of this.recs) {
      const S = this.fleet.byId[r.id], b = this.berth(r.id); if (!S || !b || b.state !== 'ready') continue;
      if (this.fleet.helm === S || this.fleet.dock?.S === S) { r.parked = false; continue; }
      if (r.parked || this.base.busy()) continue;
      const p = _v.set(0, 0, 0), q = _q; this.base.berthPose(b, S.spec, p, q);
      const d = S.V.pos.distanceTo(p);
      if (d < 30 + S.spec.len * 0.4 && S.V.vel.length() < 3) {
        S.V.pos.lerp(p, Math.min(1, dt * 0.8)); S.V.quat.slerp(q, Math.min(1, dt * 0.8)); S.V.vel.set(0, 0, 0); S.V.w.set(0, 0, 0); this.fleet.place(S, 0);
        if (d < 0.2) { r.parked = true; this.save(); this.toast('info', `${S.spec.name} berthed`); }
      }
    }
  }
}
