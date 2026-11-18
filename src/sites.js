import * as THREE from 'three';
import { mats } from './assets.js';
import { addHullDetail } from './hullDetail.js';
import stationData from './assets/station.json';
import depotData from './assets/depot.json';
import freighterData from './assets/freighter.json';

// The yard: one working depot and several wrecks spread over a few kilometres of low orbit.
// Every site is a group of named chunks with oriented-box colliders. Chunks can be welded salvage
// (torn off with the tow line), and a wreck whose reactor core is pulled shakes itself apart.
//
// Positions in metres. The planet's top is ~300 m below y=0, so everything stays above y=-150.
export const LAYOUT = {
  spawn: { pos: [30, 14, 142], euler: [-0.06, 0.28, 0] },
  depot: { pos: [250, 40, 820], yaw: Math.PI },
  meridian: { pos: [0, 0, 0], yaw: 0 },                       // the hero derelict (first wreck)
  halves: { pos: [-1250, 140, -620], yaw: 0.9, roll: 0.35 },   // station broken in two
  freighter: { pos: [1450, -40, -980], yaw: -0.7, roll: -0.25 },
  field: { pos: [-260, 60, -1650], r: 260 },                    // debris graveyard
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _v = new THREE.Vector3(), _c = new THREE.Vector3();

let dark = null, deadLamp = null;
function darkMats() {
  if (!dark) {
    dark = addHullDetail(new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x8e8478, roughness: 0.82, metalness: 0.28 }), { scale: 0.22, grime: 1.2, bump: 1.5 });
    deadLamp = mats.lamp.clone(); deadLamp.color.setScalar(0.18);
  }
  return { dark, deadLamp };
}

// A chunk of a site. obbsL are colliders in the node's local frame; obbs are the live world copies.
class Part {
  constructor(site, name, node, obbsL) {
    this.site = site; this.name = name; this.node = node;
    this.obbsL = obbsL.map((o) => ({ c: new THREE.Vector3(...o.c), q: new THREE.Quaternion(...o.q), h: new THREE.Vector3(...o.h) }));
    this.obbs = this.obbsL.map((o) => ({ c: new THREE.Vector3(), q: new THREE.Quaternion(), qi: new THREE.Quaternion(), h: o.h.clone(), v: new THREE.Vector3(), br: o.h.length(), node, chunk: name, part: this }));
    this.moving = false; this.pivot = null; this.vel = new THREE.Vector3(); this.angVel = new THREE.Vector3();
    this.welded = true; this.salvage = null;
    // centre (node-local) = mean of collider centres
    this.centerL = new THREE.Vector3(); for (const o of this.obbsL) this.centerL.add(o.c); if (this.obbsL.length) this.centerL.divideScalar(this.obbsL.length);
  }

  sync(dt) {
    this.node.updateWorldMatrix(true, false);
    const M = this.node.matrixWorld; M.decompose(_c, _q, _s);
    for (let i = 0; i < this.obbs.length; i++) {
      const L = this.obbsL[i], W = this.obbs[i];
      _v.copy(L.c).applyMatrix4(M);
      if (dt) W.v.copy(_v).sub(W.c).divideScalar(dt); else W.v.set(0, 0, 0);
      W.c.copy(_v); W.q.copy(_q).multiply(L.q); W.qi.copy(W.q).invert();
    }
  }

  // detach into a free-drifting pivot at the chunk's centre (world transform preserved)
  free(scene) {
    if (this.pivot) return this.pivot;
    this.node.updateWorldMatrix(true, false);
    const p = new THREE.Object3D(); p.position.copy(this.centerL).applyMatrix4(this.node.matrixWorld);
    this.node.matrixWorld.decompose(_c, p.quaternion, _s);
    scene.add(p); p.updateMatrixWorld(true); p.attach(this.node);
    this.pivot = p; this.moving = true; this.welded = false;
    return p;
  }

  step(dt) {
    if (!this.pivot || this.salvage) return;
    const p = this.pivot; p.position.addScaledVector(this.vel, dt);
    const w = this.angVel.length();
    if (w > 1e-6) { _q.setFromAxisAngle(_v.copy(this.angVel).divideScalar(w), w * dt); p.quaternion.premultiply(_q); }
    p.updateMatrixWorld(true);
  }
}

export class Site {
  constructor(world, { id, kind, pos, yaw = 0, roll = 0, pitch = 0, radius }) {
    this.world = world; this.id = id; this.kind = kind; this.radius = radius;
    this.group = new THREE.Group(); this.group.position.set(...pos);
    this.group.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
    world.scene.add(this.group); this.group.updateMatrixWorld(true);
    this.pos = this.group.position;
    this.parts = []; this.byName = {};
    this.spheres = [];          // ring colliders {lp (node-local), rad, pos, w, node}
    this.debris = []; this.inst = [];
    this.lampMats = []; this.active = false;
    this.state = 'ok';          // ok | unstable | collapsed
    this.timer = 0; this.spin = 0; this.ringNode = null;
    this.core = null;           // salvage item whose removal destabilises the site
  }

  addModel(model, data, { darkened = false } = {}) {
    if (darkened) {
      const { dark, deadLamp } = darkMats();
      model.traverse((o) => { if (o.isMesh) { if (o.material === mats.hull) o.material = dark; else if (o.material === mats.lamp) o.material = deadLamp; } });
    }
    this.group.add(model); this.group.updateMatrixWorld(true);
    const nodes = {}; model.traverse((o) => { if (o.name && !nodes[o.name]) nodes[o.name] = o; });
    this.nodes = nodes;
    for (const [name, c] of Object.entries(data.chunks)) {
      if (!nodes[name]) continue;
      const p = new Part(this, name, nodes[name], c.obbs); p.sync(0);
      this.parts.push(p); this.byName[name] = p;
    }
    return nodes;
  }

  // drop a chunk from the model (used to make variants of the same station)
  remove(name) {
    const n = this.nodes[name]; if (n) n.parent.remove(n);
    const p = this.byName[name]; if (p) { this.parts.splice(this.parts.indexOf(p), 1); delete this.byName[name]; }
  }

  ring(node, spin) {
    this.ringNode = node; this.spin = spin;
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + 0.3;
      for (let i = 0; i < 14; i++) this.spheres.push({ lp: new THREE.Vector3(Math.cos(a) * (12 + i * 3), Math.sin(a) * (12 + i * 3), 0), rad: 2.3, pos: new THREE.Vector3(), w: new THREE.Vector3(), node });
    }
    for (let i = 0; i < 52; i++) { const a = i / 52 * Math.PI * 2; this.spheres.push({ lp: new THREE.Vector3(Math.cos(a) * 50, Math.sin(a) * 50, 0), rad: 4.2, pos: new THREE.Vector3(), w: new THREE.Vector3(), node }); }
    this.syncSpheres(0);
  }

  syncSpheres(dt) {
    if (!this.spheres.length) return;
    this.ringNode.updateWorldMatrix(true, false);
    const M = this.ringNode.matrixWorld;
    for (const s of this.spheres) {
      _v.copy(s.lp).applyMatrix4(M);
      if (dt) s.w.copy(_v).sub(s.pos).divideScalar(dt); else s.w.set(0, 0, 0);
      s.pos.copy(_v);
    }
  }

  get moving() { return this.spin !== 0 || this.parts.some((p) => p.moving) || this.state === 'unstable'; }

  // pulled the core: the wreck shudders for a while, then comes apart
  destabilise(time = 22) {
    if (this.state !== 'ok') return;
    this.state = 'unstable'; this.timer = time; this.world.onSiteEvent?.('unstable', this);
  }

  collapse() {
    this.state = 'collapsed'; this.timer = 0;
    const scene = this.world.scene;
    this.group.updateMatrixWorld(true);
    const centre = this.group.position;
    for (const p of this.parts) {
      if (p.salvage && p.salvage.state !== 'welded') continue;
      p.free(scene);
      const out = _v.copy(p.pivot.position).sub(centre); const d = out.length() || 1;
      p.vel.copy(out).divideScalar(d).multiplyScalar(1.5 + Math.random() * 4 + Math.min(4, 120 / d));
      p.vel.add(_c.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2));
      p.angVel.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.12 + 2.5 / Math.max(6, p.obbs.reduce((m, o) => Math.max(m, o.br), 0)));
      if (p.salvage) p.salvage.unweld(p.vel, p.angVel);
    }
    if (this.ringNode && this.byName.ring === undefined) {
      // ring has no box colliders; drift it as a whole with the hub
      const rp = new Part(this, 'ring', this.ringNode, []); rp.free(scene);
      rp.vel.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2); rp.angVel.set(0.02, 0.05, this.spin * 1.5);
      this.parts.push(rp); this.spin = 0; this.ringPart = rp;
    }
    for (const d of this.debris) d.vel.add(_v.copy(d.pos).sub(centre).normalize().multiplyScalar(4 + Math.random() * 8));
    this.world.onSiteEvent?.('collapse', this);
    this.world.dirty = true;
  }

  // physics substep for an active site
  step(dt) {
    if (this.state === 'unstable') { this.timer -= dt; if (this.timer <= 0) this.collapse(); }
    if (this.spin && this.ringNode) { this.ringNode.rotation.z += this.spin * dt; }
    for (const p of this.parts) if (p.moving) { p.step(dt); p.sync(dt); }
    if (this.spheres.length && (this.spin || this.ringPart)) this.syncSpheres(dt);
  }

  // all live colliders of the site
  collectObbs(out) { for (const p of this.parts) if (!p.salvage || p.salvage.state === 'welded') for (const o of p.obbs) out.push(o); }
}

// ---- builders ----------------------------------------------------------------------------
export function buildSites(world, models) {
  const S = [];

  // 1. Depot: the only lit, living structure. Delivery cradle ("catch") + service dock in front of it.
  {
    const L = LAYOUT.depot;
    const s = new Site(world, { id: 'depot', kind: 'depot', pos: L.pos, yaw: L.yaw, radius: 140 });
    const nodes = s.addModel(models.depot, depotData);
    s.beacon = mats.lamp.clone(); s.catchMat = mats.lamp.clone();
    nodes.beacon && (nodes.beacon.material = s.beacon); nodes.catch_lights && (nodes.catch_lights.material = s.catchMat);
    const c = depotData.catch;
    s.catchL = { c: new THREE.Vector3(...c.c), h: new THREE.Vector3(...c.h), mouth: new THREE.Vector3(...c.mouth) };
    s.mouth = s.catchL.mouth.clone().applyMatrix4(s.group.matrixWorld);
    s.dockPt = new THREE.Vector3(...depotData.dock.c).applyMatrix4(s.group.matrixWorld); s.dockR = depotData.dock.r;
    s.axis = new THREE.Vector3(0, 0, 1).applyQuaternion(s.group.quaternion);  // out of the mouth
    s.inv = s.group.matrixWorld.clone().invert();
    S.push(s);
  }

  // 2. Meridian: the hero derelict at the origin, ring still turning, cargo pods welded on.
  {
    const L = LAYOUT.meridian;
    const s = new Site(world, { id: 'meridian', kind: 'wreck', pos: L.pos, yaw: L.yaw, radius: 150 });
    const nodes = s.addModel(models.station, stationData);
    s.lampMats = ['lamps_a', 'lamps_b', 'lamps_c'].map((n) => { const m = mats.lamp.clone(); if (nodes[n]) nodes[n].material = m; return m; });
    s.ring(nodes.ring, 0.045);
    s.salvageSpec = [
      ...[0, 1, 2, 3].map((i) => ({ type: 'chunk', part: `pod_${i}`, value: 450, mass: 30 })),
      { type: 'core', at: [0, 10.6, -86] },
      { type: 'canister', at: [22, 12, 64] }, { type: 'canister', at: [-24, -10, 10] }, { type: 'canister', at: [30, -16, -60] },
      { type: 'crate', at: [-20, 22, 70] },
    ];
    s.debrisSpec = { n: 60, rMin: 70, rMax: 290, avoid: (p) => (p.x > 60 && p.z > 120) };   // keep the tutorial lane clear
    S.push(s);
  }

  // 3. Halves: a sister station snapped in two, charred, dead lights. Fore half tumbles slowly.
  {
    const L = LAYOUT.halves;
    const s = new Site(world, { id: 'halves', kind: 'wreck', pos: L.pos, yaw: L.yaw, roll: L.roll, radius: 170 });
    const nodes = s.addModel(models.stationB, stationData, { darkened: true });
    for (const n of ['lamps_a', 'lamps_c', 'solar_r', 'mast_aft']) s.remove(n);
    s.ring(nodes.ring, 0);
    nodes.ring.rotation.set(0.25, -0.18, 0.6);         // ring knocked off its bearing
    s.syncSpheres(0);
    s.salvageSpec = [
      { type: 'chunk', part: 'pod_1', value: 450, mass: 30 }, { type: 'chunk', part: 'pod_2', value: 450, mass: 30 },
      { type: 'core', at: [0, 6, 4] },
      { type: 'canister', at: [18, 6, -2] }, { type: 'canister', at: [-12, 14, 20] }, { type: 'crate', at: [6, -16, 30] }, { type: 'crate', at: [-26, 4, -30] },
    ];
    // the fore half floats free of the rest, drifting apart with a slow tumble
    s.afterBuild = () => {
      for (const n of ['spine_fore', 'nose', 'collar', 'pod_0', 'module_up', 'mast_fore']) {
        const p = s.byName[n]; if (!p) continue;
        p.node.position.set(4, 18, 38); p.node.rotation.set(0.32, 0.12, 0.2); p.node.updateMatrixWorld(true); p.sync(0);
      }
      for (const n of ['pod_1']) { const p = s.byName[n]; if (p) { p.node.position.set(4, 18, 38); p.node.rotation.set(0.32, 0.12, 0.2); p.node.updateMatrixWorld(true); p.sync(0); } }
    };
    s.debrisSpec = { n: 46, rMin: 40, rMax: 240 };
    S.push(s);
  }

  // 4. Freighter: bent keel and racks of containers, each one a tow job. Reactor sits on the engines.
  {
    const L = LAYOUT.freighter;
    const s = new Site(world, { id: 'freighter', kind: 'wreck', pos: L.pos, yaw: L.yaw, roll: L.roll, radius: 160 });
    const nodes = s.addModel(models.freighter, freighterData);
    s.lampMats = [mats.lamp.clone()]; if (nodes.lamps) nodes.lamps.material = s.lampMats[0];
    s.salvageSpec = [
      ...freighterData.boxes.map((b) => ({ type: 'chunk', part: b, value: 300, mass: 22 })),
      { type: 'core', at: freighterData.core },
      { type: 'canister', at: [14, 8, 30] }, { type: 'canister', at: [-12, -8, -50] },
    ];
    s.debrisSpec = { n: 40, rMin: 30, rMax: 220 };
    S.push(s);
  }

  // 5. Field: no structure, just a dense graveyard of drifting parts with loose cargo among it.
  {
    const L = LAYOUT.field;
    const s = new Site(world, { id: 'field', kind: 'field', pos: L.pos, radius: L.r });
    const R = () => (Math.random() * 2 - 1);
    s.salvageSpec = [];
    for (let i = 0; i < 9; i++) s.salvageSpec.push({ type: i % 3 === 0 ? 'crate' : 'canister', at: [R() * 200, R() * 70, R() * 200] });
    s.debrisSpec = { n: 110, rMin: 0, rMax: L.r, flat: 0.4 };
    S.push(s);
  }
  for (const s of S) s.afterBuild?.();
  return S;
}
