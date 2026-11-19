import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mats } from './assets.js';
import { K } from './gpufx.js';
import { Bake, T, wallTexture, floorTexture, screenTexture, ledTexture, panelsTexture, roomUniform, patchRoom } from './bake.js';

// Kestrel Relay: a working comms relay you can fly into on foot. A hub with four arms: the airlock (EVA only,
// cycles pressure with the outer door shut), a cargo hold, crew quarters and a lab, all with sliding doors,
// lit rooms, a suit recharge bay and loot to find. Built entirely in code (bake.js): no models, no real lights.
//
// Local frame: +z is the airlock mouth, y up. The hub sits at the origin.

const C = { bone: 0xcfc8b8, slate: 0x4a525c, dark: 0x1c1e22, orange: 0xe8561a, teal: 0x2f6f73, rust: 0x7a4a30, steel: 0x8e949a, cream: 0xe2dccc };
const L = { cool: 0xbfe6ff, warm: 0xffd7a0, amber: 0xff9a40, red: 0xff3a20, green: 0x4dff9a, cyan: 0x50e0ff };
const DW = 2.2, DH = 2.4;                                   // door opening
const rect = (u, v) => [u - DW / 2, u + DW / 2, v - DH / 2, v + DH / 2];
const LOOT = { cell: { value: 120, col: 0x4dff9a }, core: { value: 240, col: 0xffb347 }, drive: { value: 400, col: 0x50e0ff }, box: { value: 650, col: 0xff4a2a } };

let sd = 11; const rnd = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
const rr = (a, b) => a + rnd() * (b - a);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1);

export function buildRelay(site, { Part, scene, fx, sound, getFxT }) {
  const B = new Bake();
  // ---- rooms ---------------------------------------------------------------------------------
  const HUB = B.room('hub', [0, 0, 0], [10, 6, 10], { amb: [0.07, 0.08, 0.1], tint: [0.82, 0.86, 0.9] });
  const CN = B.room('cn', [0, 0, 9.925], [3, 3, 9.15], { amb: [0.05, 0.05, 0.05], tint: [0.8, 0.8, 0.78] });
  const AL = B.room('al', [0, 0, 16.95], [3.6, 3.6, 4.2], { amb: [0.06, 0.06, 0.06], tint: [0.78, 0.78, 0.76] });
  const CS = B.room('cs', [0, 0, -9.925], [3, 3, 9.15], { amb: [0.05, 0.05, 0.05], tint: [0.8, 0.8, 0.78] });
  const CG = B.room('cg', [0, 0, -20.85], [12, 7, 12], { amb: [0.06, 0.05, 0.04], tint: [0.9, 0.82, 0.68] });
  const CE = B.room('ce', [9.35, 0, 0], [8, 3, 3], { amb: [0.05, 0.05, 0.05], tint: [0.8, 0.8, 0.78] });
  const QU = B.room('qu', [18.2, 0, 0], [9, 5, 8], { amb: [0.06, 0.07, 0.07], tint: [0.8, 0.9, 0.88] });
  const CW = B.room('cw', [-9.35, 0, 0], [8, 3, 3], { amb: [0.05, 0.03, 0.03], tint: [0.85, 0.75, 0.72] });
  const LB = B.room('lb', [-19.2, 0, 0], [11, 5, 9], { amb: [0.05, 0.07, 0.09], tint: [0.78, 0.86, 0.94] });
  const ROOMS = [HUB, CN, AL, CS, CG, CE, QU, CW, LB];

  // ---- lights (baked) --------------------------------------------------------------------------
  const lit = (room, pts, col, i, r, reach) => { for (const p of pts) B.light(room.idx, p, new THREE.Color(col).toArray(), i, r, reach); };
  lit(HUB, [[3.5, 2.7, 3.5], [-3.5, 2.7, 3.5], [3.5, 2.7, -3.5], [-3.5, 2.7, -3.5]], L.cool, 1.5, 12, [1, 3, 5, 7]);
  lit(HUB, [[3.5, -2.7, 0], [-3.5, -2.7, 0]], L.cool, 0.7, 9, []);
  for (let z = 7; z < 14.5; z += 2.6) B.light(CN.idx, [0, 1.3, z], new THREE.Color(L.warm).toArray(), 1.1, 5.5, [0, 2]);
  lit(AL, [[0, 1.7, 15.9], [0, 1.7, 18.0]], L.cool, 1.5, 6, [1]);
  for (let z = -7; z > -14.5; z -= 2.6) B.light(CS.idx, [0, 1.3, z], new THREE.Color(L.warm).toArray(), 1.0, 5.5, [0, 4]);
  lit(CG, [[-3, 3.1, -17], [3, 3.1, -17], [-3, 3.1, -24.5], [3, 3.1, -24.5], [0, 3.1, -20.8]], L.amber, 1.7, 13, [3]);
  lit(CE, [[7.6, 1.3, 0], [11.2, 1.3, 0]], L.warm, 1.0, 6, [0, 6]);
  lit(QU, [[15.5, 2.2, 0], [20.9, 2.2, 0]], 0xcdf2ec, 1.4, 9, [5]);
  lit(CW, [[-7.6, 1.3, 0], [-11.2, 1.3, 0]], L.red, 1.3, 6, [0, 8]);
  lit(LB, [[-16.5, 2.2, 2.5], [-16.5, 2.2, -2.5], [-21.9, 2.2, 2.5], [-21.9, 2.2, -2.5]], 0xa8d8ff, 1.3, 10, [7]);
  lit(LB, [[-19.2, -0.2, 0]], L.cyan, 1.5, 6, []);

  // ---- shells (slabs with holes) ----------------------------------------------------------------
  const holes = new Map();
  const H = (R, key, r, extra = {}) => { const k = R.idx + key; if (!holes.has(k)) holes.set(k, []); holes.get(k).push(Object.assign([...r], extra)); };
  const plane = (R, key) => { const a = 'xyz'.indexOf(key[0]), s = key[1] === '+' ? 1 : -1; return R.c.getComponent(a) + s * (R.s.getComponent(a) / 2 + T / 2); };
  const tunnel = (R, key, r) => {            // the opening is interior too, so its faces get the room's paint
    const ax = key[0], at = plane(R, key), a = T / 2 + 0.03;
    if (ax === 'z') B.tunnel([r[0], r[2], at - a], [r[1], r[3], at + a], R.idx); else if (ax === 'x') B.tunnel([at - a, r[2], r[0]], [at + a, r[3], r[1]], R.idx); else B.tunnel([r[0], at - a, r[2]], [r[1], at + a, r[3]], R.idx);
  };
  const doors = {}, windows = [];
  const door = (id, R, key, u, v, other, kind = 'int') => { const r = rect(u, v); H(R, key, r); tunnel(R, key, r); const at = plane(R, key); doors[id] = { id, R, other, axis: key[0], at, u, v, kind }; };
  const win = (R, key, r, tint = 0x7fb4ff) => { H(R, key, r, { g: 1 }); tunnel(R, key, r); windows.push({ R, key, r, at: plane(R, key), tint }); };

  door('hubN', HUB, 'z+', 0, 0, CN); door('hubS', HUB, 'z-', 0, 0, CS); door('hubE', HUB, 'x+', 0, 0, CE); door('hubW', HUB, 'x-', 0, 0, CW);
  win(HUB, 'y+', [-1.8, 1.8, -1.8, 1.8]); win(HUB, 'y-', [-1.8, 1.8, -1.8, 1.8]);
  door('alIn', AL, 'z-', 0, 0, CN, 'inner'); door('alOut', AL, 'z+', 0, 0, null, 'outer');
  door('cgIn', CG, 'z+', 0, 0, CS); door('quW', QU, 'x-', 0, 0, CE); door('lbE', LB, 'x+', 0, 0, CW);
  // windows: quarters portholes, lab bay windows, cargo skylight
  for (const z of [-3, 0, 3]) { win(QU, 'z+', [18.2 - 0.9 + z * 1.2, 18.2 + 0.9 + z * 1.2, 0.1, 0.85], 0xa8e0d0); win(QU, 'z-', [18.2 - 0.9 + z * 1.2, 18.2 + 0.9 + z * 1.2, 0.1, 0.85], 0xa8e0d0); }
  win(LB, 'z+', [-23.2, -20.6, -0.8, 1.6]); win(LB, 'z+', [-18.4, -15.8, -0.8, 1.6]);

  const HULLC = { 0: 0xb8b4aa, 1: 0x9a978e, 2: 0xa7a398, 3: 0x9a978e, 4: 0xb5a58a, 5: 0x9a978e, 6: 0xc2bfb4, 7: 0x9a978e, 8: 0xa9b0b4 };
  const shell = (R, tube = null) => {
    const [cx, cy, cz] = R.c.toArray(), [sx, sy, sz] = R.s.toArray();
    const ex = tube === 'x' ? 0 : 2 * T, ez = tube === 'z' ? 0 : 2 * T, hl = (k) => holes.get(R.idx + k) || [];
    for (const s of [-1, 1]) {
      const sg = s > 0 ? '+' : '-';
      B.wall('y', cy + s * (sy / 2 + T / 2), [cx - sx / 2 - (tube === 'x' ? 0 : T), cx + sx / 2 + (tube === 'x' ? 0 : T)], [cz - sz / 2 - ez / 2, cz + sz / 2 + ez / 2], hl('y' + sg), { room: R.idx, hullColor: HULLC[R.idx] });
      if (tube !== 'x') B.wall('x', cx + s * (sx / 2 + T / 2), [cz - sz / 2 - ez / 2, cz + sz / 2 + ez / 2], [cy - sy / 2, cy + sy / 2], hl('x' + sg), { room: R.idx, hullColor: HULLC[R.idx] });
      if (tube !== 'z') B.wall('z', cz + s * (sz / 2 + T / 2), [cx - sx / 2, cx + sx / 2], [cy - sy / 2, cy + sy / 2], hl('z' + sg), { room: R.idx, hullColor: HULLC[R.idx] });
    }
  };
  shell(HUB); shell(CN, 'z'); shell(AL); shell(CS, 'z'); shell(CG); shell(CE, 'x'); shell(QU); shell(CW, 'x'); shell(LB);
  // the windows are solid for the body: the glass is only drawn
  for (const w of windows) {
    const [u0, u1, v0, v1] = w.r, ax = w.key[0];
    if (ax === 'z') B.obb([(u0 + u1) / 2, (v0 + v1) / 2, w.at], [u1 - u0, v1 - v0, T]); else if (ax === 'x') B.obb([w.at, (v0 + v1) / 2, (u0 + u1) / 2], [T, v1 - v0, u1 - u0]); else B.obb([(u0 + u1) / 2, w.at, (v0 + v1) / 2], [u1 - u0, T, v1 - v0]);
  }

  // ---- details ----------------------------------------------------------------------------------
  const P = (c, s, col, R, extra) => B.box(c, s, { kind: 'prop', color: col, room: R.idx, ...extra });
  const Pc = (c, r, len, ax, col, R, extra) => B.cyl(c, r, len, ax, { kind: 'prop', color: col, room: R.idx, ...extra });
  const LAMP = (c, s, col, R, k = 2.2) => B.box(c, s, { kind: 'lamp', color: col, k, room: R.idx, seg: 5 });
  const solid = (c, s) => B.obb(c, s);

  // rib frames around a tube, light panels between them, grab rails, a cable tray
  const tube = (R, ax) => {
    const len = R.s[ax], c0 = R.c[ax] - len / 2;
    const n = Math.floor(len / 1.5);
    for (let i = 0; i < n; i++) {
      const t = c0 + 0.75 + i * (len - 1.5) / Math.max(1, n - 1), cc = ax === 'z' ? [0, 0, t] : [t, 0, 0];
      const frame = (dx, dy, sx, sy) => P(ax === 'z' ? [dx, dy, t] : [t, dy, dx], ax === 'z' ? [sx, sy, 0.16] : [0.16, sy, sx], C.slate, R, { seg: 5 });
      frame(0, 1.42, 3.0, 0.16); frame(0, -1.42, 3.0, 0.16); frame(1.42, 0, 0.16, 3.0); frame(-1.42, 0, 0.16, 3.0);
      if (i % 2 === 0) LAMP(ax === 'z' ? [0, 1.46, t + 0.75] : [t + 0.75, 1.46, 0], ax === 'z' ? [1.0, 0.04, 0.34] : [0.34, 0.04, 1.0], R === CW ? L.red : R === CG ? L.amber : L.warm, R, R === CW ? 1.6 : 2.0);
    }
    for (const sg of [-1, 1]) Pc(ax === 'z' ? [sg * 1.36, -0.2, R.c.z] : [R.c.x, -0.2, sg * 1.36], 0.035, len, ax, C.orange, R, { sides: 6 });
    P(ax === 'z' ? [1.0, 1.38, R.c.z] : [R.c.x, 1.38, 1.0], ax === 'z' ? [0.34, 0.1, len] : [len, 0.1, 0.34], C.dark, R);
    Pc(ax === 'z' ? [-0.95, 1.36, R.c.z] : [R.c.x, 1.36, -0.95], 0.07, len, ax, C.steel, R);
  };
  tube(CN, 'z'); tube(CS, 'z'); tube(CE, 'x'); tube(CW, 'x');

  // door frames (both faces), with status lamps; leaves are separate meshes that slide
  const doorMeshes = [];
  const statusM = {};
  const stat = (id) => (statusM[id] = patchRoom(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })));
  for (const d of Object.values(doors)) {
    const { R, axis, at, u, v } = d, ax = axis;
    const pos = (uu, vv, w) => (ax === 'z' ? [u + uu, v + vv, at + w] : [at + w, v + vv, u + uu]);
    const sz = (a, b, c) => (ax === 'z' ? [a, b, c] : [c, b, a]);
    P(pos(-DW / 2 - 0.06, 0, 0), sz(0.12, DH + 0.12, T + 0.14), C.orange, R, { seg: 9 }); P(pos(DW / 2 + 0.06, 0, 0), sz(0.12, DH + 0.12, T + 0.14), C.orange, R, { seg: 9 });
    P(pos(0, DH / 2 + 0.06, 0), sz(DW, 0.12, T + 0.14), C.slate, R, { seg: 9 });
    // leaves
    const leaf = (side) => {
      const save = B.sink; B.sink = B.fresh();
      const w = DW / 2 + 0.03, cu = side * (w / 2 - 0.015);
      B.box(pos(cu, 0, 0), sz(w, DH, 0.2), { kind: 'prop', color: C.slate, room: R.idx, seg: 0.6 });
      B.box(pos(cu, 0.2, 0.105), sz(w * 0.8, 0.1, 0.012), { kind: 'prop', color: C.orange, room: R.idx, seg: 9 }); B.box(pos(cu, 0.2, -0.105), sz(w * 0.8, 0.1, 0.012), { kind: 'prop', color: C.orange, room: R.idx, seg: 9 });
      B.box(pos(cu, -0.55, 0.105), sz(w * 0.8, 0.5, 0.012), { kind: 'prop', color: C.dark, room: R.idx, seg: 9 }); B.box(pos(cu, -0.55, -0.105), sz(w * 0.8, 0.5, 0.012), { kind: 'prop', color: C.dark, room: R.idx, seg: 9 });
      const g = B.finish(B.sink); B.sink = save; return g.wall;
    };
    const gl = leaf(-1), gr = leaf(1);
    const mL = new THREE.Mesh(gl, null), mR = new THREE.Mesh(gr, null); doorMeshes.push(mL, mR);
    d.leaves = [mL, mR]; d.open = 0; d.target = 0; d.axisU = ax === 'z' ? 'x' : 'z';
    // status lamps above the frame, one per side; airlock doors get their own colour
    for (const s of [-1, 1]) {
      const lc = pos(0, DH / 2 + 0.3, s * (T / 2 + 0.02)), ls = sz(0.34, 0.1, 0.03);
      if (d.kind === 'int') LAMP(lc, ls, L.green, R, 1.3);
      else { (d.lampGeo = d.lampGeo || []).push([lc, ls, s]); }
    }
  }

  // ---- hub ---------------------------------------------------------------------------------------
  // grab-bar cross in the middle, ring lights, pipes, consoles, the suit recharge bay
  Pc([0, 0, 0], 0.05, 4.6, 'x', C.orange, HUB, { sides: 6 }); Pc([0, 0, 0], 0.05, 4.6, 'z', C.orange, HUB, { sides: 6 }); P([0, 0, 0], [0.3, 0.3, 0.3], C.slate, HUB, { seg: 5 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    Pc([sx * 4.55, 2.6, sz * 2.2], 0.14, 5, 'z', C.steel, HUB); Pc([sx * 2.2, -2.6, sz * 4.55], 0.14, 5, 'x', C.steel, HUB);
    P([sx * 3.5, 2.88, sz * 3.5], [1.2, 0.2, 1.2], C.slate, HUB, { seg: 5 }); LAMP([sx * 3.5, 2.77, sz * 3.5], [0.9, 0.04, 0.9], L.cool, HUB, 2.4);
  }
  for (const sx of [-1, 1]) { P([sx * 3.5, -2.88, 0], [1.2, 0.2, 1.2], C.slate, HUB, { seg: 5 }); LAMP([sx * 3.5, -2.77, 0], [0.9, 0.04, 0.9], L.cool, HUB, 1.6); }
  // window surrounds
  for (const s of [-1, 1]) { P([0, s * 2.93, 2.0], [4.4, 0.14, 0.4], C.slate, HUB, { seg: 5 }); P([0, s * 2.93, -2.0], [4.4, 0.14, 0.4], C.slate, HUB, { seg: 5 }); P([2.0, s * 2.93, 0], [0.4, 0.14, 4.4], C.slate, HUB, { seg: 5 }); P([-2.0, s * 2.93, 0], [0.4, 0.14, 4.4], C.slate, HUB, { seg: 5 }); }
  // consoles in the +z corners and -z corners
  const consoles = [];
  const console_ = (c, R, face, w = 2.0, col = C.slate, st = 0.9) => {
    // desk + sloped screen rack; face = direction (unit x/z) the operator looks toward
    const [fx_, fz_] = face;
    const rot = Math.atan2(fx_, fz_);
    B.box([c[0], c[1] - 0.45, c[2]], [fz_ ? w : 0.9, 0.9, fz_ ? 0.9 : w], { kind: 'prop', color: col, room: R.idx });
    solid([c[0], c[1] - 0.45, c[2]], [fz_ ? w : 0.9, 0.9, fz_ ? 0.9 : w]);
    B.box([c[0] + fx_ * 0.18, c[1] + 0.12, c[2] + fz_ * 0.18], [fz_ ? w : 0.4, 0.14, fz_ ? 0.4 : w], { kind: 'prop', color: C.dark, room: R.idx, seg: 5 });
    consoles.push({ c: [c[0] + fx_ * 0.28, c[1] + 0.5, c[2] + fz_ * 0.28], n: [fx_, 0, fz_], w: w * 0.86, h: 0.55, R, tilt: 0.35 });
    LAMP([c[0] + fx_ * 0.38, c[1] + 0.08, c[2] + fz_ * 0.38], [fz_ ? w * 0.7 : 0.05, 0.03, fz_ ? 0.05 : w * 0.7], st > 0.5 ? L.cyan : L.amber, R, 1.8);
  };
  console_([-3.4, -2.2, 4.4], HUB, [0, -1]); console_([3.4, -2.2, 4.4], HUB, [0, -1]);
  console_([-3.4, -2.2, -4.4], HUB, [0, 1]); console_([3.4, -2.2, -4.4], HUB, [0, 1]);
  // recharge bay on the +x wall, towards +z: a suit cradle with two tanks. Wordless: green rings = air and fuel
  const BAY = { c: [4.55, 0.1, -3.4], r: 1.9 };
  P([4.6, 0, -3.4], [0.8, 2.6, 1.6], C.slate, HUB); solid([4.6, 0, -3.4], [0.8, 2.6, 1.6]);
  P([4.17, 0.1, -3.4], [0.06, 1.5, 0.9], C.dark, HUB, { seg: 5 });
  Pc([4.05, 0.9, -3.0], 0.2, 1.1, 'y', C.steel, HUB); Pc([4.05, 0.9, -3.8], 0.2, 1.1, 'y', C.steel, HUB);
  for (const y of [-0.6, 0.0, 0.6]) LAMP([4.12, y, -3.4], [0.04, 0.08, 1.3], L.green, HUB, 2.4);
  const bayLamp = B.sink.lamp.pos.length;       // (marker only)
  // vents and conduit
  for (let i = -1; i <= 1; i += 2) P([i * 2.6, 2.92, -1.6], [0.7, 0.1, 0.4], C.dark, HUB, { seg: 5 });

  // ---- airlock ----------------------------------------------------------------------------------
  for (const sg of [-1, 1]) {
    Pc([sg * 1.65, -0.3, 16.95], 0.035, 4.0, 'z', C.orange, AL, { sides: 6 });
    P([sg * 1.55, 0.2, 16.0], [0.3, 1.6, 0.5], C.slate, AL, { seg: 6 }); P([sg * 1.55, 0.2, 17.9], [0.3, 1.6, 0.5], C.slate, AL, { seg: 6 });
    LAMP([sg * 1.4, 0.2, 16.0], [0.04, 1.3, 0.12], L.cool, AL, 1.2); LAMP([sg * 1.4, 0.2, 17.9], [0.04, 1.3, 0.12], L.cool, AL, 1.2);
    for (const y of [-1.5, 1.5]) P([sg * 0.7, y, 16.95], [0.14, 0.14, 4.0], C.slate, AL, { seg: 5 });
  }
  // strobing ceiling strips (their own material so the cycle can colour them)
  const alLamp = [[0, 1.74, 15.95], [0, 1.74, 17.95]];
  for (const z of [15.4, 18.5]) P([0, -1.72, z], [2.8, 0.06, 0.5], C.orange, AL, { seg: 9 });   // hazard stripes at the thresholds
  for (const c of alLamp) B.box(c, [1.8, 0.05, 0.36], { kind: 'lamp', color: L.cool, k: 2.2, room: AL.idx, seg: 5 });
  for (const sg of [-1, 1]) for (const z of [15.6, 18.3]) P([sg * 1.76, 0.9, z], [0.06, 0.3, 0.3], C.dark, AL, { seg: 5 });   // vents

  // ---- cargo hold -------------------------------------------------------------------------------
  const crate = (c, s, col = C.rust) => {
    P(c, s, col, CG, { seg: 0.9 }); solid(c, s);
    P([c[0], c[1], c[2]], [s[0] + 0.05, 0.08, s[2] + 0.05], C.dark, CG, { seg: 9 });
    P([c[0], c[1] + s[1] / 2 - 0.1, c[2]], [s[0] + 0.05, 0.06, s[2] + 0.05], C.orange, CG, { seg: 9 });
    P([c[0], c[1], c[2]], [s[0] * 0.5, s[1] * 0.35, s[2] + 0.04], C.cream, CG, { seg: 9 });
  };
  // racks along the walls: posts and shelves with crates
  for (const sg of [-1, 1]) {
    const x = sg * 5.25;
    for (const z of [-16.2, -20.85, -25.5]) for (const y of [-3.4, 3.4]) Pc([x, 0, z], 0.06, 7, 'y', C.slate, CG, { sides: 6 });
    for (const y of [-2.2, -0.2, 1.8]) { P([x, y, -20.85], [1.1, 0.08, 10], C.slate, CG, { seg: 1.4 }); }
    solid([x, 0, -20.85], [1.2, 7, 10]);
    for (const y of [-1.75, 0.25, 2.25]) for (const z of [-17.5, -20.85, -24.1]) if (rnd() < 0.85) { const s = [rr(0.7, 1.0), rr(0.55, 0.9), rr(1.5, 2.4)]; P([x, y + s[1] / 2 - 0.1 + 0.0, z + rr(-0.4, 0.4)], s, rnd() < 0.5 ? C.rust : C.teal, CG, { seg: 0.9 }); }
  }
  // freight in the middle: a big container and a stack, floor markings, an overhead crane rail
  crate([-1.6, -2.1, -19.2], [2.2, 1.6, 3.2], C.slate); crate([-1.6, -0.5, -19.2], [1.8, 1.5, 2.6], C.rust); crate([2.0, -2.6, -23.0], [1.4, 0.8, 1.4], C.teal);
  crate([2.6, -2.6, -17.4], [1.0, 0.8, 1.2], C.rust);
  for (const [x, z, w, d] of [[0, -20.85, 8.4, 0.08], [0, -20.85, 0.08, 9.2]]) P([x, -3.46, z], [w, 0.02, d], C.orange, CG, { seg: 9 });
  P([0, 3.3, -20.85], [0.5, 0.35, 11.4], C.slate, CG, { seg: 1.5 }); Pc([0, 3.1, -20.85], 0.12, 11.4, 'z', C.steel, CG);
  // the far wall's big freight door
  P([0, 0, -26.78], [7, 6, 0.14], C.slate, CG, { seg: 1 }); for (const sg of [-1, 1]) P([sg * 3.3, 0, -26.68], [0.4, 6, 0.1], C.orange, CG, { seg: 9 });
  LAMP([0, 3.0, -26.7], [6, 0.08, 0.06], L.amber, CG, 2); LAMP([0, -3.0, -26.7], [6, 0.08, 0.06], L.amber, CG, 1.4);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { P([sx * 3, 3.38, -20.85 + sz * 4], [1.6, 0.14, 1.0], C.slate, CG, { seg: 5 }); LAMP([sx * 3, 3.28, -20.85 + sz * 4], [1.2, 0.04, 0.6], L.amber, CG, 2.2); }
  solid([0, -0.5, -26.78], [7, 6, 0.4]);

  // ---- crew quarters ---------------------------------------------------------------------------
  for (const sg of [-1, 1]) for (let i = 0; i < 3; i++) for (const y of [-1.4, 0.1]) {
    const x = 15.4 + i * 2.8, z = sg * 3.15;
    P([x, y, z], [2.3, 1.2, 1.4], C.slate, QU, { seg: 1 }); solid([x, y, z], [2.3, 1.2, 1.4]);
    P([x, y, z - sg * 0.72], [1.9, 0.9, 0.06], i % 2 ? C.teal : C.rust, QU, { seg: 9 });
    LAMP([x, y + 0.48, z - sg * 0.74], [1.7, 0.04, 0.04], i % 2 ? L.cyan : L.warm, QU, 1.5);
  }
  for (let i = 0; i < 4; i++) { P([22.35, -0.4, -2.6 + i * 1.7], [0.6, 3.6, 1.4], C.bone, QU, { seg: 1 }); P([22.04, 1.2, -2.6 + i * 1.7], [0.04, 0.5, 0.9], C.dark, QU, { seg: 9 }); LAMP([22.03, -0.3, -2.6 + i * 1.7], [0.03, 0.06, 0.4], i % 2 ? L.green : L.amber, QU, 1.8); }
  solid([22.35, -0.4, 0], [0.6, 3.6, 6.8]);
  Pc([18.2, -1.25, 0], 0.18, 2.2, 'y', C.steel, QU); Pc([18.2, -0.15, 0], 1.0, 0.1, 'y', C.cream, QU, { sides: 16 }); solid([18.2, -0.6, 0], [2.0, 2.3, 2.0]);
  LAMP([18.2, 2.45, 0], [2.4, 0.05, 2.4], 0xcdf2ec, QU, 1.15);

  // ---- lab ---------------------------------------------------------------------------------------
  Pc([-19.2, -2.1, 0], 0.9, 0.7, 'y', C.slate, LB, { sides: 16 }); Pc([-19.2, -1.7, 0], 1.2, 0.12, 'y', C.dark, LB, { sides: 20 }); solid([-19.2, -1.6, 0], [2.4, 1.6, 2.4]);
  const holoRing = B.sink.lamp.pos.length;
  B.cyl([-19.2, -1.62, 0], 1.12, 0.04, 'y', { kind: 'lamp', color: L.cyan, k: 2.4, room: LB.idx, sides: 24 });
  for (const z of [-3.6, -2.2, 2.2, 3.6]) console_([-14.6, -2.2, z], LB, [-1, 0], 1.3, C.slate, 0.6);
  for (let i = 0; i < 5; i++) { P([-24.45, -0.4, -3.4 + i * 1.5], [0.5, 4.2, 1.2], C.dark, LB, { seg: 1 }); }
  solid([-24.45, -0.4, 0], [0.5, 4.2, 7.4]);
  const racks = [];
  for (let i = 0; i < 5; i++) racks.push({ c: [-24.18, -0.4, -3.4 + i * 1.5] });
  P([-19.2, 2.4, 0], [2.6, 0.2, 2.6], C.slate, LB, { seg: 5 }); LAMP([-19.2, 2.28, 0], [2.0, 0.04, 2.0], 0xa8d8ff, LB, 1.8);
  // black box: a bright-orange recorder on the desk
  for (const sg of [-1, 1]) for (const z of [-3.8]) { P([-16, -2.1, sg * 4.2], [0.9, 0.5, 0.9], C.rust, LB); solid([-16, -2.1, sg * 4.2], [0.9, 0.5, 0.9]); }

  // consoles → screens (merged, scrolling)
  const screenGeos = [];
  const plane1 = (c, n, w, h, R, tilt) => {
    const g = new THREE.PlaneGeometry(w, h); const nv = new THREE.Vector3(...n);
    _m.lookAt(_v.set(0, 0, 0), nv, _v2.set(0, 1, 0)); _q.setFromRotationMatrix(_m);
    const e = new THREE.Euler(-tilt, 0, 0, 'XYZ'); const qt = new THREE.Quaternion().setFromEuler(e); _q.multiply(qt);
    g.applyQuaternion(_q); g.translate(c[0], c[1], c[2]);
    const u = g.attributes.uv; const ou = rnd(), ov = rnd(); for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * 0.5 + ou, u.getY(i) * 0.4 + ov);
    const n3 = g.attributes.position.count, col = new Float32Array(n3 * 3).fill(1), rm = new Float32Array(n3).fill(R.idx);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aRoom', new THREE.BufferAttribute(rm, 1)); g.deleteAttribute('normal');
    screenGeos.push(g);
  };
  for (const s of consoles) plane1(s.c, s.n, s.w, s.h, s.R, s.tilt);
  plane1([-24.17, 1.1, 0], [1, 0, 0], 6.8, 0.8, LB, 0);   // status strip over the racks
  const nb = screenGeos.length; for (const r of racks) plane1([-24.19, -0.7, r.c[2]], [1, 0, 0], 1.0, 3.0, LB, 0);
  const ledGeos = screenGeos.splice(nb); for (const g of ledGeos) { const u = g.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * 2, u.getY(i) * 7); }
  // wall-mounted display in the cargo hold and in the quarters
  plane1([5.9 - 0.0, 1.0, -20.85], [-1, 0, 0], 3.4, 1.4, CG, 0); plane1([22.0, 1.0, 0.0], [-1, 0, 0], 0.01, 0.01, QU, 0);

  // ---- exterior --------------------------------------------------------------------------------
  const X = (c, s, col = undefined, extra = {}) => { B.box(c, s, { kind: 'hull', color: col, ...extra }); if (!extra.noObb) B.obb(c, s); };
  // docking collar out of the airlock mouth with a ring and clamp mounts
  const colz = [19.4, 22.4];
  for (const sg of [-1, 1]) {
    X([sg * (1.8 + T / 2), 0, (colz[0] + colz[1]) / 2], [T, 3.6 + 2 * T, colz[1] - colz[0]], 0x5a5d62, { seg: 1.2 });
    X([0, sg * (1.8 + T / 2), (colz[0] + colz[1]) / 2], [3.6, T, colz[1] - colz[0]], 0x5a5d62, { seg: 1.2 });
  }
  // ring and chevrons
  const ringC = 0xc8c0b0; X([0, 2.35, 22.35], [4.9, 0.5, 0.5], ringC); X([0, -2.35, 22.35], [4.9, 0.5, 0.5], ringC); X([2.35, 0, 22.35], [0.5, 4.2, 0.5], ringC); X([-2.35, 0, 22.35], [0.5, 4.2, 0.5], ringC);
  for (const sg of [-1, 1]) X([sg * 1.25, 2.62, 22.2], [0.9, 0.06, 0.3], 0xe8561a, { noObb: true });
  // orange band round the airlock
  X([0, 2.13 + T, 19.9], [4.4, 0.05, 1.2], 0xe8561a, { noObb: true });
  // exterior structure: corner beams, ring bands, raised panels and vents on the big faces (restrained, one accent)
  const BEAM = 0x3d4249, BAND = 0x6b6e70;
  const frame = (R) => {
    const hx = R.s.x / 2 + T, hy = R.s.y / 2 + T, hz = R.s.z / 2 + T, [cx, cy, cz] = R.c.toArray(), w = 0.34;
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) X([cx, cy + sy * hy, cz + sz * hz], [2 * hx + w, w, w], BEAM, { noObb: true });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) X([cx + sx * hx, cy, cz + sz * hz], [w, 2 * hy + w, w], BEAM, { noObb: true });
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) X([cx + sx * hx, cy + sy * hy, cz], [w, w, 2 * hz + w], BEAM, { noObb: true });
  };
  const ring = (R, axis, t) => {
    const hx = R.s.x / 2 + T, hy = R.s.y / 2 + T, hz = R.s.z / 2 + T, [cx, cy, cz] = R.c.toArray(), d = 0.14, wd = 0.3;
    if (axis === 'z') { for (const s of [-1, 1]) { X([cx, cy + s * (hy + d / 2), t], [2 * hx, d, wd], BAND, { noObb: true }); X([cx + s * (hx + d / 2), cy, t], [d, 2 * hy, wd], BAND, { noObb: true }); } }
    else { for (const s of [-1, 1]) { X([t, cy + s * (hy + d / 2), cz], [wd, d, 2 * hz], BAND, { noObb: true }); X([t, cy, cz + s * (hz + d / 2)], [wd, 2 * hy, d], BAND, { noObb: true }); } }
  };
  frame(HUB); frame(CG); frame(QU); frame(LB); frame(AL);
  for (const z of [-3.9, 3.9]) ring(HUB, 'z', z);
  for (const z of [-17.6, -24.1]) ring(CG, 'z', z);
  for (const x of [16.4, 20.0]) ring(QU, 'x', x);
  for (const x of [-19.5, -14.9]) ring(LB, 'x', x);
  // raised panels and vents on the big faces, on a grid so they read as plating
  const panels = (R, key, hole = 0) => {
    const ax = 'xyz'.indexOf(key[0]), sg = key[1] === '+' ? 1 : -1, at = plane(R, key) + sg * T / 2;
    const [a1, a2] = [0, 1, 2].filter((i) => i !== ax), W = R.s.getComponent(a1) - 1.2, Hh = R.s.getComponent(a2) - 1.2;
    const nu = Math.max(1, Math.round(W / 2.6)), nv = Math.max(1, Math.round(Hh / 2.6));
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const u = -W / 2 + (i + 0.5) * W / nu, v = -Hh / 2 + (j + 0.5) * Hh / nv;
      if (Math.abs(u) < hole && Math.abs(v) < hole) continue;
      const r = rnd(); if (r < 0.45) continue;
      const su = W / nu - 0.25, sv = Hh / nv - 0.25, d = r < 0.8 ? 0.06 : 0.1;
      const c = [0, 0, 0]; c[ax] = at + sg * d / 2; c[a1] = R.c.getComponent(a1) + u; c[a2] = R.c.getComponent(a2) + v;
      const s = [0, 0, 0]; s[ax] = d; s[a1] = su; s[a2] = sv;
      B.box(c, s, { kind: 'hull', color: r < 0.8 ? 0xa3a096 : 0x4a4f55, seg: 9 });
      if (r > 0.8) for (let k = -2; k <= 2; k++) { const c2 = [...c], s2 = [0, 0, 0]; c2[ax] = at + sg * (d + 0.01); c2[a2] += k * sv / 6; s2[ax] = 0.02; s2[a1] = su * 0.8; s2[a2] = 0.05; B.box(c2, s2, { kind: 'hull', color: 0x14161a, seg: 9 }); }
    }
  };
  for (const k of ['y+', 'x+', 'x-', 'z+', 'z-', 'y-']) panels(HUB, k, 2.2);
  for (const k of ['y+', 'y-', 'x+', 'x-', 'z-']) panels(CG, k, 0);
  for (const k of ['y+', 'y-', 'x+']) panels(QU, k, 0);
  for (const k of ['y+', 'y-', 'z-', 'x-']) panels(LB, k, 0);
  // one orange identity stripe along the outside of each wing, and chevrons at the airlock
  for (const [R, ax] of [[CG, 'x'], [QU, 'z'], [LB, 'z'], [HUB, 'x']]) { const hx = R.s.x / 2 + T + 0.08; if (ax === 'x') { for (const sz of [-1, 1]) X([R.c.x, R.c.y - R.s.y / 2 + 0.7, R.c.z + sz * (R.s.z / 2 + T + 0.08)], [R.s.x - 1.4, 0.22, 0.04], 0xe8561a, { noObb: true }); } else { for (const sx of [-1, 1]) X([R.c.x + sx * (R.s.x / 2 + T + 0.08), R.c.y - R.s.y / 2 + 0.7, R.c.z], [0.04, 0.22, R.s.z - 1.4], 0xe8561a, { noObb: true }); } }
  // tanks on the cargo hold roof, pipework down the sides
  for (const x of [-3.6, 0, 3.6]) {
    B.geo(new THREE.CapsuleGeometry(1.3, 7.4, 6, 20).rotateX(Math.PI / 2).translate(x, 3.5 + T + 1.3, -20.85), { kind: 'hull', color: 0xb9b3a6 }); B.obb([x, 3.5 + T + 1.3, -20.85], [2.6, 2.6, 9.4]);
    for (const z of [-24.4, -17.3]) X([x, 3.5 + T + 0.5, z], [2.8, 1.0, 0.3], 0x4a525c, { noObb: true });
  }
  // round sleeves over the square corridors and the airlock: from outside they read as pressure tubes
  const sleeve = (c, r, len, ax, col = 0x9a978e) => { const g = new THREE.CylinderGeometry(r, r, len, 28, 1, true); if (ax === 'x') g.rotateZ(Math.PI / 2); else if (ax === 'z') g.rotateX(Math.PI / 2); g.translate(c[0], c[1], c[2]); B.geo(g, { kind: 'hull', color: col }); };
  sleeve([0, 0, 9.925], 2.75, 9.15, 'z'); sleeve([0, 0, -9.925], 2.75, 9.15, 'z'); sleeve([9.35, 0, 0], 2.75, 8, 'x'); sleeve([-9.35, 0, 0], 2.75, 8, 'x');
  for (const [c, ax] of [[[0, 0, 5.6], 'z'], [[0, 0, 14.25], 'z'], [[0, 0, -5.6], 'z'], [[0, 0, -14.25], 'z'], [[5.6, 0, 0], 'x'], [[13.1, 0, 0], 'x'], [[-5.6, 0, 0], 'x'], [[-13.1, 0, 0], 'x']]) { const g = new THREE.CylinderGeometry(2.9, 2.9, 0.5, 28, 1, true); if (ax === 'x') g.rotateZ(Math.PI / 2); else g.rotateX(Math.PI / 2); g.translate(...c); B.geo(g, { kind: 'hull', color: 0x4a525c }); }
  for (const c of [[0, 0, 9.925], [0, 0, -9.925]]) { const g = new THREE.CylinderGeometry(2.9, 2.9, 0.25, 28, 1, true).rotateX(Math.PI / 2).translate(...c); B.geo(g, { kind: 'hull', color: 0xe8561a }); }
  // a radiator ring halo over the hub, on four posts
  B.geo(new THREE.TorusGeometry(5.2, 0.2, 8, 56).rotateX(Math.PI / 2).translate(0, 4.7, 0), { kind: 'hull', color: 0x6b6e70 });
  for (const [x, z] of [[5.2, 0], [-5.2, 0], [0, 5.2], [0, -5.2]]) X([x, 4.0, z], [0.22, 1.5, 0.22], 0x4a525c, { noObb: true });
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + 0.39; X([Math.cos(a) * 5.2, 4.7, Math.sin(a) * 5.2], [0.5, 0.5, 0.5], 0xb8b4aa, { noObb: true }); }
  for (const z of [-26, -15.8]) X([0, 5.5, z], [11, 0.2, 0.3], 0x4a525c, { noObb: true });
  // hub spine truss and light poles
  for (const sg of [-1, 1]) { X([sg * 5.45, 3.9, 0], [0.12, 1.4, 0.12], 0x7d7a72, { noObb: true }); X([sg * 5.45, 4.6, 0], [0.4, 0.12, 0.4], 0x7d7a72, { noObb: true }); }
  // arm mast + dish on the lab roof; the dish turns (animated)
  X([-19.2, 3.6, 2.4], [0.4, 1.5, 0.4], 0x8e949a);
  // solar boom off the quarters
  X([24.6, 0, 0], [3.0, 0.4, 0.4], 0x6c6f73);
  X([-26.1, 0, -2.6], [2.0, 0.3, 0.3], 0x6c6f73, { noObb: true });

  // ---- finish: build meshes ----------------------------------------------------------------------
  const G = B.finish();
  const M = {
    wall: patchRoom(new THREE.MeshBasicMaterial({ map: wallTexture(), vertexColors: true })),
    floor: patchRoom(new THREE.MeshBasicMaterial({ map: floorTexture(), vertexColors: true })),
    lamp: patchRoom(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })),
    screen: patchRoom(new THREE.MeshBasicMaterial({ map: screenTexture(), vertexColors: true, toneMapped: false })),
    led: patchRoom(new THREE.MeshBasicMaterial({ map: ledTexture(), vertexColors: true, toneMapped: false })),
    glass: new THREE.MeshBasicMaterial({ color: 0x9cc8ff, transparent: true, opacity: 0.07, depthWrite: false, toneMapped: false }),
  };
  M.floor.map.repeat.set(1, 1);
  const inner = new THREE.Group(); inner.name = 'relay-inner'; const outer = new THREE.Group();
  site.group.add(outer, inner);
  const mk = (g, m, parent = inner) => { const o = new THREE.Mesh(g, m); o.frustumCulled = true; parent.add(o); return o; };
  const hullMesh = mk(G.hull, mats.hull, outer); hullMesh.castShadow = hullMesh.receiveShadow = true;
  mk(G.wall, M.wall); mk(G.floor, M.floor); mk(G.lamp, M.lamp);
  const screens = new THREE.Mesh(mergeGeometries(screenGeos), M.screen); inner.add(screens);
  const leds = new THREE.Mesh(mergeGeometries(ledGeos), M.led); inner.add(leds);
  for (const m of doorMeshes) { m.material = M.wall; }
  // door leaves: sit in the wall slab; "open" slides them into the wall beside the opening
  for (const d of Object.values(doors)) {
    for (const m of d.leaves) inner.add(m);
    d.base = d.leaves.map((m) => m.position.clone());
  }
  // airlock status lamps: own materials so they can go red / green
  for (const id of ['alIn', 'alOut']) {
    const d = doors[id], sink = B.fresh(); const save = B.sink; B.sink = sink;
    const sides = { '-1': [], 1: [] };
    for (const [lc, ls, s] of d.lampGeo) B.box(lc, ls, { kind: 'lamp', color: 0xffffff, k: 1, room: d.R.idx, seg: 5 });
    const g = B.finish(sink); B.sink = save;
    d.lampMesh = mk(g.lamp, stat(id));
  }
  // glass in the windows
  for (const w of windows) {
    const [u0, u1, v0, v1] = w.r, g = new THREE.PlaneGeometry(u1 - u0, v1 - v0); const ax = w.key[0];
    if (ax === 'z') g.translate((u0 + u1) / 2, (v0 + v1) / 2, w.at); else if (ax === 'x') { g.rotateY(Math.PI / 2); g.translate(w.at, (v0 + v1) / 2, (u0 + u1) / 2); } else { g.rotateX(Math.PI / 2); g.translate((u0 + u1) / 2, w.at, (v0 + v1) / 2); }
    const m = new THREE.Mesh(g, M.glass); m.renderOrder = 3; inner.add(m);
  }

  // ---- moving exterior parts ------------------------------------------------------------------
  const sol = new THREE.MeshStandardMaterial({ map: panelsTexture(), roughness: 0.35, metalness: 0.6, side: THREE.DoubleSide, envMapIntensity: 1.4 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xbdb8ac, roughness: 0.4, metalness: 0.65, side: THREE.DoubleSide });
  const wings = new THREE.Group(); wings.position.set(26.1, 0, 0); outer.add(wings);
  for (const sg of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(12, 0.07, 3.6), sol); p.position.set(6.2, 0, sg * 2.1); p.castShadow = true; p.userData.rep = 1; wings.add(p);
    p.geometry.attributes.uv.array.forEach((_, i, a) => { if (i % 2 === 0) a[i] *= 1; });
  }
  wings.add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 12.5, 6).rotateZ(Math.PI / 2), metal)).position.set(6.2, 0, 0);
  const dish = new THREE.Group(); dish.position.set(-19.2, 4.55, 2.4); outer.add(dish);
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(1.7, 28, 8, 0, Math.PI * 2, 0, 0.8), metal); bowl.rotation.x = Math.PI / 2 - 0.5; bowl.position.y = 0.2; bowl.castShadow = true;
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 6), metal); feed.rotation.x = Math.PI / 2 - 0.5; feed.position.set(0, 0.2 + 0.7, 0.75).add(new THREE.Vector3(0, 0, 0));
  dish.add(bowl, feed);
  // clamps: four arms hinged at the collar ring
  const clamps = [];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2, piv = new THREE.Group(); piv.position.set(Math.cos(a) * 2.35, Math.sin(a) * 2.35, 22.5); piv.rotation.z = a - Math.PI / 2; outer.add(piv);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 1.7), new THREE.MeshStandardMaterial({ color: 0x5a5d62, roughness: 0.5, metalness: 0.7 })); arm.position.z = 0.85; arm.castShadow = true;
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: 0xe8561a, roughness: 0.6, metalness: 0.2 })); pad.position.set(0, -0.14, 1.65);
    const hinge = new THREE.Group(); hinge.add(arm, pad); piv.add(hinge); clamps.push({ hinge, a });
  }
  // nav lights: red at the lab end, green at the quarters, white strobe on the roof
  const navLamp = (c, col) => { const m = new THREE.MeshBasicMaterial({ color: col, toneMapped: false }); const o = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), m); o.position.set(...c); outer.add(o); return m; };
  const nav = { red: navLamp([-25.3, 2.9, -4.7], 0xff2a1a), green: navLamp([23.3, 2.7, 4.2], 0x30ff60), white: navLamp([0, 5.9, -20.85], 0xffffff), amber: navLamp([0, 3.3, 22.5], 0xff9a30) };

  // ---- hologram, floaters, loot -----------------------------------------------------------------
  const holo = new THREE.Group(); holo.position.set(-19.2, -0.35, 0); inner.add(holo);
  const hm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.1, 1.5), wireframe: true, transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending });
  const globe = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 2), hm); holo.add(globe);
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.008, 4, 64), hm), ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.008, 4, 48), hm); ring1.rotation.x = 1.2; ring2.rotation.y = 1.2; holo.add(ring1, ring2);
  const sat = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.14), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.2, 0.6), toneMapped: false })); holo.add(sat);
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 1.4, 20, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.5, 0.7), transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide })); cone.position.y = -0.2; holo.add(cone);

  // crane trolley in the cargo hold
  const crane = new THREE.Group(); crane.position.set(0, 3.0, -20.85); inner.add(crane);
  { const s = B.fresh(); const save = B.sink; B.sink = s;
    B.box([0, 0.12, 0], [1.1, 0.3, 1.4], { kind: 'prop', color: C.orange, room: CG.idx, seg: 1 });
    B.cyl([0, -0.5, 0], 0.04, 1.1, 'y', { kind: 'prop', color: C.steel, room: CG.idx, sides: 5 });
    B.box([0, -1.12, 0], [0.5, 0.18, 0.5], { kind: 'prop', color: C.slate, room: CG.idx, seg: 1 });
    B.box([0, -1.12, 0.31], [0.4, 0.06, 0.1], { kind: 'lamp', color: L.amber, k: 2.4, room: CG.idx, seg: 9 });
    const g = B.finish(s); B.sink = save; mk(g.wall, M.wall, crane); mk(g.lamp, M.lamp, crane); }

  // floating clutter: little boxes and cylinders adrift in the rooms people live in
  const floatN = 36, floatMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), floatN);
  floatMesh.frustumCulled = false; inner.add(floatMesh);
  const floaters = [];
  const fcols = [0xc9c1ae, 0xe8561a, 0x58b8c0, 0xa89a82, 0x3a3f46];
  for (let i = 0; i < floatN; i++) {
    const R = [QU, QU, LB, LB, HUB, CG][i % 6];
    const m = 0.5; const mn = [R.min.x + m, R.min.y + m, R.min.z + m], mx = [R.max.x - m, R.max.y - m, R.max.z - m];
    floaters.push({ p: new THREE.Vector3(rr(mn[0], mx[0]), rr(mn[1] + 0.5, mx[1]), rr(mn[2], mx[2])), v: new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).multiplyScalar(0.12), w: new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).multiplyScalar(0.8), e: new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6), s: new THREE.Vector3(rr(0.06, 0.22), rr(0.03, 0.12), rr(0.06, 0.2)), mn, mx });
    floatMesh.setColorAt(i, new THREE.Color(fcols[i % fcols.length]).multiplyScalar(0.7));
  }

  // loot: glowing cases in the rooms. Fly into one to take it.
  const lootSpecs = [
    ['cell', [-5.3, -1.1, -20.4]], ['core', [5.4, 1.2, -24.9]], ['drive', [1.4, -3.05, -25.9]], ['cell', [4.2, -2.9, -18.9]],
    ['cell', [15.4, 0.15, 3.1]], ['drive', [21.4, 1.9, -3.2]], ['core', [18.2, -2.1, 3.3]],
    ['core', [-22.4, -1.1, 4.1]], ['box', [-16, -1.7, -4.2]], ['drive', [-23.7, 1.6, -3.5]], ['cell', [0.4, 0.8, 2.6]], ['cell', [-4.4, 1.4, -4.4]],
  ];
  let taken = {}; try { const s = JSON.parse(localStorage.getItem('rell.relay') || 'null'); if (s && Date.now() - s.t < 25 * 60 * 1000) taken = s.ids; } catch {}
  const loot = lootSpecs.map(([kind, p], i) => {
    const s = B.fresh(), save = B.sink; B.sink = s, B.rooms.length;
    const lc = new THREE.Color(LOOT[kind].col);
    B.box([0, 0, 0], [0.5, 0.3, 0.36], { kind: 'prop', color: C.dark, room: 0, seg: 1 });
    B.box([0, 0.17, 0], [0.34, 0.04, 0.1], { kind: 'prop', color: C.orange, room: 0, seg: 9 });
    B.box([0, 0, 0.19], [0.36, 0.06, 0.02], { kind: 'lamp', color: LOOT[kind].col, k: 2.6, room: 0, seg: 9 }); B.box([0, 0, -0.19], [0.36, 0.06, 0.02], { kind: 'lamp', color: LOOT[kind].col, k: 2.6, room: 0, seg: 9 });
    const g = B.finish(s); B.sink = save;
    const grp = new THREE.Group(); grp.position.set(...p); inner.add(grp);
    // loot uses the always-bright version of the wall material so it reads in every room
    grp.add(new THREE.Mesh(g.wall, M.wall), new THREE.Mesh(g.lamp, M.lamp));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ color: lc.clone().multiplyScalar(1.6), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, map: glowTex() })); halo.scale.setScalar(1.4); grp.add(halo);
    const it = { id: i, kind, value: LOOT[kind].value, grp, home: new THREE.Vector3(...p), ph: i * 1.7, got: !!taken[i], halo };
    grp.visible = !it.got; return it;
  });

  // ---- colliders & site integration --------------------------------------------------------------
  site.group.updateMatrixWorld(true);
  const node = new THREE.Group(); node.name = 'relay'; site.group.add(node);
  const part = new Part(site, 'relay', node, B.obbs); part.sync(0);
  site.parts.push(part); site.byName.relay = part; site.nodes = { relay: node };
  const gq = site.group.quaternion;
  for (const d of Object.values(doors)) {
    const c = new THREE.Vector3(...(d.axis === 'z' ? [d.u, d.v, d.at] : [d.at, d.v, d.u])).applyMatrix4(site.group.matrixWorld);
    const h = d.axis === 'z' ? new THREE.Vector3(DW / 2, DH / 2, 0.15) : new THREE.Vector3(0.15, DH / 2, DW / 2);
    d.obb = { c, q: gq.clone(), qi: gq.clone().invert(), h, v: new THREE.Vector3(), br: h.length(), node, chunk: 'relay', part };
    // place leaves
    const ax = d.axis;
    d.leaves.forEach((m, i) => { m.position.set(0, 0, 0); });
  }
  const base = site.collectObbs.bind(site);
  site.collectObbs = (out) => { base(out); for (const d of Object.values(doors)) if (d.open < 0.55) out.push(d.obb); };

  return new Relay({ site, B, doors, ROOMS, M, inner, outer, floaters, floatMesh, loot, holo, globe, ring1, ring2, sat, crane, wings, dish, clamps, nav, screens, bay: BAY, fx, sound, getFxT, statusM, alLamp, racks, AL, CG });
}

let dotT = null;
function glowTex() {
  if (dotT) return dotT;
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(0.25, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return (dotT = new THREE.CanvasTexture(c));
}

// ---- runtime -------------------------------------------------------------------------------------
class Relay {
  constructor(o) {
    Object.assign(this, o);
    this.site = o.site; this.inv = new THREE.Matrix4(); this.time = 0;
    this.al = { air: false, phase: 'idle', t: 0, dur: 3.2, target: false, goal: null, idle: 0, entry: null, p: 0 };
    this.pl = new THREE.Vector3(); this.pw = new THREE.Vector3(); this.near = false; this.here = -1; this.bayOn = 0; this.screenT = 0;
    this.sunL = new THREE.Vector3(); this.cb = Math.random();
    this.setRoom(2, 0.2, 0.2, 0.2);
    this.led = o.M.led;
  }

  setRoom(i, r, g, b) { roomUniform.uRoomC.value[i].set(r, g, b); }

  local(wp, out = this.pl) { return out.copy(wp).applyMatrix4(this.inv.copy(this.site.group.matrixWorld).invert()); }

  // which room the point is in (0 = outside), with a margin so doorways count
  roomAt(p, m = 0.2) {
    for (const v of this.B.vols) if (p.x > v.min.x - m && p.x < v.max.x + m && p.y > v.min.y - m && p.y < v.max.y + m && p.z > v.min.z - m && p.z < v.max.z + m) return v.room;
    return -1;
  }
  // breathable air here? (everything but the vacuum airlock, which the cycle controls)
  air(wp) {
    if (!this.near) return false;
    const r = this.roomAt(this.local(wp, _v2), 0.18);
    return r >= 0 && (r !== 2 || this.al.air);
  }

  // third-person camera must stay inside the building while you are: pull the wanted point back along the line
  clampCam(pilotWp, want) {
    if (!this.near) return;
    const a = this.local(pilotWp, _v), pr = this.roomAt(a, 0.1); if (pr < 0) return;
    const b = this.local(want, this.pw);
    for (let k = 0; k <= 10; k++) {
      const t = 1 - k / 10; _v2.lerpVectors(a, b, t);
      if (this.roomAt(_v2, -0.3) >= 0 || k === 10) { if (k) want.copy(_v2).applyMatrix4(this.site.group.matrixWorld); return; }
    }
  }

  // suit recharge: stand near the green bay
  charge(wp, dt, eva) {
    const p = this.local(wp, _v2), bc = this.bay.c;
    const d = Math.hypot(p.x - bc[0], p.y - bc[1], p.z - bc[2]);
    this.bayOn = THREE.MathUtils.damp(this.bayOn, d < this.bay.r ? 1 : 0, 6, dt);
    if (d < this.bay.r && this.air(wp)) { eva.fuel = Math.min(1, eva.fuel + dt * 0.35); eva.o2 = Math.min(1, eva.o2 + dt * 0.5); }
  }

  update(dt, time, camPos, eva, ship) {
    this.time = time; const S = this.site;
    const dist = camPos.distanceTo(S.pos);
    const near = dist < 150 || (eva.state === 'eva' && eva.pilot.pos.distanceTo(S.pos) < 150);
    this.near = near;
    this.inner.visible = dist < 170 || near;
    // exterior life: tracking panels, turning dish, nav blinks (cheap, always while near the site)
    if (dist > 700) return;
    const gq = S.group.quaternion;
    this.sunL.copy(this.sunDir || _v.set(0.62, 0.5, 0.6).normalize()).applyQuaternion(_q.copy(gq).invert());
    this.wings.rotation.x = THREE.MathUtils.damp(this.wings.rotation.x, Math.atan2(this.sunL.z, this.sunL.y), 1.2, dt);
    this.dish.rotation.y += dt * 0.12;
    this.nav.red.color.setScalar((time % 1.8) < 0.14 ? 3 : 0.12); this.nav.green.color.setScalar(((time + 0.9) % 1.8) < 0.14 ? 3 : 0.12);
    this.nav.white.color.setScalar((time % 2.6) < 0.06 || ((time + 0.18) % 2.6) < 0.06 ? 4 : 0.05); this.nav.amber.color.setScalar(this.al.phase === 'cycle' ? ((time * 4) % 1 < 0.5 ? 3 : 0.2) : 0.4);
    if (!near) return;

    const pilot = eva.state === 'eva' ? eva.pilot.pos : null;
    const p = pilot ? this.local(pilot, this.pl) : null;
    this.here = p ? this.roomAt(p, 0.15) : -1;
    this.airlock(dt, p, time);
    this.interior(dt, p, pilot);
    // animated bits
    const ct = time * 0.55; this.crane.position.z = -20.85 + Math.sin(ct) * 4.2; this.crane.position.x = Math.sin(ct * 0.7) * 1.6;
    this.holo.rotation.y += dt * 0.35; this.globe.rotation.x += dt * 0.12; this.ring1.rotation.z += dt * 0.5; this.ring2.rotation.x += dt * 0.7; this.sat.position.set(Math.cos(time * 0.9) * 0.95, Math.sin(time * 0.9) * 0.3, Math.sin(time * 0.9) * 0.95); this.holo.position.y = -0.35 + Math.sin(time * 1.2) * 0.04;
    this.M.screen.map.offset.y = (time * 0.05) % 1; this.M.led.color.setScalar(0.6 + 0.4 * Math.sin(time * 9) * Math.sin(time * 3.7));
    // room moods: the cargo hold hums, the quarters flicker, the west arm is on emergency power
    const flick = (f, ph) => { const a = Math.sin(time * f + ph) * Math.sin(time * f * 2.7 + ph * 3); return a > 0.55 ? 0.35 : 1; };
    this.setRoom(0, 1, 1, 1.05);
    this.setRoom(1, 1, 1, 1); this.setRoom(3, 1, 1, 1); this.setRoom(5, 1, 1, 1);
    this.setRoom(4, 1, 1, 1); const q = flick(7, 1.3); this.setRoom(6, q, q, q);
    const em = 0.65 + 0.35 * Math.sin(time * 3.2) ** 2; this.setRoom(7, em, em * 0.9, em * 0.9);
    const lf = flick(5, 4); this.setRoom(8, 1, 1, 1.05 * (lf < 1 ? 0.8 : 1));
  }

  // ---- the airlock: both doors never open at once; pressure cycles with the doors shut ----------
  airlock(dt, p, time) {
    const al = this.al, D = this.doors, inD = D.alIn, outD = D.alOut;
    let zone = null;
    if (p) {
      if (p.z > 14.85 - 0.2 && p.z < 19.05 + 0.2 && Math.abs(p.x) < 2 && Math.abs(p.y) < 2) zone = 'chamber';
      else if (p.z > 19.4 && p.z < 29 && Math.abs(p.x) < 4.5 && Math.abs(p.y) < 4.5) zone = 'out';
      else if (p.z > 10.8 && p.z < 14.5 && Math.abs(p.x) < 1.6 && Math.abs(p.y) < 1.6) zone = 'in';
    }
    if (al.phase === 'cycle') {
      al.t += dt; al.p = al.target ? al.t / al.dur : 1 - al.t / al.dur;
      this.cycleFx(dt, time);
      if (al.t >= al.dur) { al.phase = 'idle'; al.air = al.target; al.p = al.air ? 1 : 0; this.sound?.tonePing(al.air ? 760 : 520, 0.35, 0.1, 'sine'); }
    } else {
      // who wants what
      if (zone === 'chamber') {
        if (!al.entry) al.entry = outD.open > 0.05 ? 'out' : inD.open > 0.05 ? 'in' : null;
        const deep = al.entry === 'out' ? p.z < 18.1 : al.entry === 'in' ? p.z > 15.8 : false;
        if (deep) al.goal = al.entry === 'out' ? 'in' : 'out';
      } else if (zone === 'out') { al.entry = null; if (!al.goal || al.goal === 'out' || inD.open < 0.05) al.goal = 'out'; }
      else if (zone === 'in') { al.entry = null; if (!al.goal || al.goal === 'in' || outD.open < 0.05) al.goal = 'in'; }
      else if (!zone) { al.idle += dt; if (al.idle > 1.5) { al.goal = null; al.entry = null; } }
      if (zone) al.idle = 0;
      if (zone === 'chamber' && !al.goal && inD.open < 0.05 && outD.open < 0.05) { al.stuck = (al.stuck || 0) + dt; if (al.stuck > 1) al.goal = p.z > 16.95 ? 'out' : 'in'; } else al.stuck = 0;
      const goal = al.goal, want = goal ? D[goal === 'out' ? 'alOut' : 'alIn'] : null, other = want === outD ? inD : outD;
      inD.target = outD.target = 0;
      if (want) {
        const needAir = goal === 'in';
        if (other.open > 0.02) other.target = 0;
        else if (al.air !== needAir) { al.phase = 'cycle'; al.t = 0; al.target = needAir; this.sound?.noise(al.dur, 'highpass', 2800, 0.12); }
        else want.target = 1;
      }
    }
    for (const d of [inD, outD]) {
      const prev = d.open, sp = 1.5;
      d.open += Math.sign(d.target - d.open) * Math.min(Math.abs(d.target - d.open), sp * dt);
      if (prev !== d.open && (prev < 0.55) !== (d.open < 0.55)) this.site.world.dirty = true;
      if (prev === 0 && d.open > 0) this.sound?.noise(0.5, 'lowpass', 500, 0.12);
    }
    // chamber light: white (air) / dim red (vacuum) / amber strobe (cycling)
    const AL = 2;
    if (al.phase === 'cycle') { const s = (time * 5) % 1 < 0.5 ? 1.5 : 0.25; this.setRoom(AL, 1.4 * s, 0.55 * s, 0.1 * s); }
    else if (al.air) this.setRoom(AL, 1, 1, 1); else this.setRoom(AL, 0.55, 0.2, 0.18);
    // status lamps: red while its door is shut or the other side differs, green when open
    for (const id of ['alIn', 'alOut']) {
      const d = D[id], m = this.statusM[id]; const g = d.open > 0.5;
      const k = 0.4 + 0.6 * (al.phase === 'cycle' ? ((time * 5) % 1 < 0.5 ? 1 : 0.15) : 1);
      if (g) m.color.setRGB(0.3, 2.2, 0.8); else m.color.setRGB(2.3 * k, 0.25 * k, 0.1 * k);
    }
    // doors slide
    for (const d of Object.values(D)) this.slide(d);
    // collar clamps close when the doors are shut, open to take a visitor
    const open = Math.max(outD.open, al.phase === 'cycle' ? 0 : 0);
    for (const c of this.clamps) c.hinge.rotation.x = THREE.MathUtils.damp(c.hinge.rotation.x, 0.45 - open * 1.3, 3, dt);
  }

  slide(d) {
    const off = d.open * (DW / 2 + 0.02);
    const [a, b] = d.leaves;
    if (d.axis === 'z') { a.position.x = -off; b.position.x = off; } else { a.position.z = -off; b.position.z = off; }
    a.visible = b.visible = d.open < 0.995;
  }

  cycleFx(dt, time) {
    if (!this.fx) return;
    const al = this.al, rate = 55 * dt; this._acc = (this._acc || 0) + rate;
    const gw = this.site.group.matrixWorld;
    while (this._acc > 1) {
      this._acc--;
      const side = Math.random() < 0.5 ? -1 : 1, z = 15.6 + Math.random() * 2.7;
      _v.set(side * 1.74, 0.9, z).applyMatrix4(gw);
      _v2.set(-side * (0.8 + Math.random() * 1.2), (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.6).transformDirection(gw).multiplyScalar(1.2 + Math.random());
      this.fx.emit(_v, _v2, this.getFxT(), 0.5 + Math.random() * 0.4, 0.03, 0.16, K.RCS, 2.4, 0);
    }
  }

  // ---- living parts: floaters, loot, the suit bay ----------------------------------------------
  interior(dt, p, pilot) {
    // floaters drift, bounce off their room's walls, and get shoved by you
    const fm = this.floatMesh, pl = this.floaters;
    for (let i = 0; i < pl.length; i++) {
      const f = pl[i];
      if (p) { _v.copy(f.p).sub(p); const d2 = _v.lengthSq(); if (d2 < 0.5) { const d = Math.sqrt(d2) || 1; f.v.addScaledVector(_v, 1.6 / d / d * dt * 5); f.w.x += (Math.random() - 0.5) * dt * 4; } }
      f.v.clampLength(0, 1.6); f.p.addScaledVector(f.v, dt);
      for (let k = 0; k < 3; k++) { const mn = f.mn[k], mx = f.mx[k]; if (f.p.getComponent(k) < mn) { f.p.setComponent(k, mn); f.v.setComponent(k, Math.abs(f.v.getComponent(k))); } else if (f.p.getComponent(k) > mx) { f.p.setComponent(k, mx); f.v.setComponent(k, -Math.abs(f.v.getComponent(k))); } }
      f.e.x += f.w.x * dt; f.e.y += f.w.y * dt; f.e.z += f.w.z * dt;
      _q.setFromEuler(f.e); _m.compose(f.p, _q, f.s); fm.setMatrixAt(i, _m);
    }
    fm.instanceMatrix.needsUpdate = true;
    // loot
    for (const it of this.loot) {
      if (it.got) continue;
      it.grp.position.copy(it.home); it.grp.position.y += Math.sin(this.time * 1.4 + it.ph) * 0.05; it.grp.rotation.y = this.time * 0.6 + it.ph;
      it.halo.material.opacity = 0.35 + 0.2 * Math.sin(this.time * 3 + it.ph);
      if (p && p.distanceToSquared(it.home) < 1.1) this.take(it);
    }
    if (pilot) this.charge(pilot, dt, this.evaRef);
    // suit bay lamps pulse while charging: the bay's three lamp strips are part of the shared lamp mesh, so
    // pulse the whole hub's brightness a hair instead
    if (this.bayOn > 0.05) this.setRoom(0, 1, 1 + 0.2 * this.bayOn, 1.05);
  }

  take(it) {
    it.got = true; it.grp.visible = false;
    const taken = {}; for (const l of this.loot) if (l.got) taken[l.id] = 1; try { localStorage.setItem('rell.relay', JSON.stringify({ t: Date.now(), ids: taken })); } catch {}
    this.evaRef?.stowed({ kind: it.kind, value: it.value });
    this.sound?.chime?.(false);
    if (this.fx) { const w = it.grp.getWorldPosition(new THREE.Vector3()); const t = this.getFxT(); this.fx.emit(w, new THREE.Vector3(), t, 0.25, 0.1, 0.9, K.FLASH); for (let i = 0; i < 18; i++) this.fx.emit(w, new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3), t, 0.4 + Math.random() * 0.5, 0.02, 0.01, K.SPARK, 0.5, 0.03); }
  }

  // for tests: how many cases are left
  get left() { return this.loot.filter((l) => !l.got).length; }
}
