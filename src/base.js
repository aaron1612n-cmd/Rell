import baseGaps from './assets/baseGaps.json';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mats } from './assets.js';
import { K } from './gpufx.js';
import { Bake, T, wallTexture, floorTexture, screenTexture, ledTexture } from './bake.js';

// Rell Yard: home base. A pressurised hangar you fly into (the cradle clamps the jet, the big doors roll shut and
// the bay fills with air once you climb out), a concourse behind it where Ilse Marrow runs the counter, and a
// sleeping module up the shaft. Everything is built in code like Kestrel Relay (bake.js).
//
// Zero-g logic everywhere: nothing rests on a floor. Bags are strapped to walls, cups are sealed pouches on velcro,
// the galley water is a closed loop, people hook their feet into loops and hold rails.
//
// Ships you buy or claim get a berth: the hangar grows outward. A keel rail runs back along each flank; a berth
// unfolds from it (floor, roof and walls swing out on hinges) and then telescopes out to the ship's length.
// Local frame: +z is the hangar mouth, y up, the bay's centre at the origin.

const C = { bone: 0xcfc8b8, slate: 0x4a525c, dark: 0x1c1e22, orange: 0xe8561a, teal: 0x2f6f73, rust: 0x7a4a30, steel: 0x8e949a, cream: 0xe2dccc, olive: 0x5d6150, plum: 0x5a3f5e, fabric: 0x3f5560 };
const L = { cool: 0xd6ecff, warm: 0xffd9a8, amber: 0xffa040, red: 0xff4a2a, green: 0x4dff9a, cyan: 0x50e0ff, grow: 0xff5ce0 };
const DW = 2.2, DH = 2.4;
const rect = (u, v, w = DW, h = DH) => [u - w / 2, u + w / 2, v - h / 2, v + h / 2];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _e = new THREE.Euler();
let sd = 77; const rnd = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };

export const CRADLE = new THREE.Vector3(0, -4.2, 2);          // where the jet sits, nose out of the mouth
export const MOUTH = new THREE.Vector3(0, 0, 18);
export const COUNTER = new THREE.Vector3(0, -4.0, -24.6);      // float here to talk to Ilse
export const ILSE = new THREE.Vector3(0, -4.62, -28.6);        // where she stands (torso centre), feet in the loops
export const HOLO = new THREE.Vector3(-2.6, -3.7, -27.0);
export const BED = new THREE.Vector3(0.9, 7.6, -24.6);
const KEEL_X = 17.2, KEEL_Z0 = 18, BAY_LEN = 36;               // keel rails along each flank, from the mouth back
const SAVE = 'rell.base';

// per-room colour multipliers (own uniform array so the relay's and the Ironwake's rooms never fight these)
const roomU = { uBaseC: { value: Array.from({ length: 8 }, () => new THREE.Vector3(1, 1, 1)) } };
function patch(m) {
  m.onBeforeCompile = (s) => {
    s.uniforms.uBaseC = roomU.uBaseC;
    s.vertexShader = 'attribute float aRoom;\nuniform vec3 uBaseC[8];\n' + s.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_COLOR\nvColor.rgb *= uBaseC[int(aRoom + 0.5)];\n#endif');
  };
  m.customProgramCacheKey = () => 'baseroom';
  return m;
}

// a box turned to lie along a direction (for braces and struts), as raw geometry for Bake.geo
function strut(a, b, w, h = w) {
  const d = _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = d.length();
  const g = new THREE.BoxGeometry(w, h, len);
  _m.lookAt(_v2.set(0, 0, 0), d, Math.abs(d.y) / len > 0.95 ? _v3.set(1, 0, 0) : _v3.set(0, 1, 0)); g.applyMatrix4(_m);
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
}

export function buildBase(site, { Part }) {
  const B = new Bake();
  const BAY = B.room('bay', [0, 1, 0], [30, 14, 36], { amb: [0.07, 0.07, 0.07], tint: [0.8, 0.79, 0.76] });
  const Q = B.room('shop', [0, -3, -24.35], [22, 6, 12], { amb: [0.08, 0.07, 0.06], tint: [0.86, 0.82, 0.74] });
  const SH = B.room('shaft', [9, 2.35, -25.5], [3, 4, 3], { amb: [0.06, 0.06, 0.07], tint: [0.8, 0.8, 0.8] });
  const BR = B.room('bunk', [6, 7.7, -24.65], [12, 6, 11], { amb: [0.07, 0.06, 0.06], tint: [0.84, 0.8, 0.74] });
  const ROOMS = [BAY, Q, SH, BR];

  // ---- baked lights ----
  const lit = (R, pts, col, i, r, reach = []) => { for (const p of pts) B.light(R.idx, p, new THREE.Color(col).toArray(), i, r, reach); };
  for (const z of [-11, 0, 11]) for (const x of [-8, 8]) lit(BAY, [[x, 7.2, z]], L.cool, 1.35, 20);
  lit(BAY, [[0, -5, 2]], L.amber, 0.9, 9);                         // cradle glow
  lit(BAY, [[-13.5, -2, -16], [13.5, -2, -16]], L.warm, 0.8, 10, [1]);
  lit(Q, [[-6, -0.6, -21], [6, -0.6, -21], [-6, -0.6, -28], [6, -0.6, -28]], L.warm, 1.25, 10, [0]);
  lit(Q, [[0, -2.2, -29.6]], L.amber, 1.1, 6);                      // counter backlight
  lit(Q, [[-9.6, -2, -24]], L.cyan, 0.7, 5);                        // galley
  lit(SH, [[9, 2.4, -25.5]], L.cool, 1.0, 5, [1, 3]);
  lit(BR, [[3, 10.2, -22], [9, 10.2, -27]], L.warm, 1.0, 9, [2]);
  lit(BR, [[0.8, 9.6, -24.6]], 0xffe6c0, 0.9, 4.5);                 // reading lamp over the bunk
  lit(BR, [[11, 6.2, -28.8]], L.grow, 0.8, 5);                      // grow lamp

  // ---- shells ----
  const holes = new Map();
  const H = (R, key, r, extra = {}) => { const k = R.idx + key; if (!holes.has(k)) holes.set(k, []); holes.get(k).push(Object.assign([...r], extra)); };
  const plane = (R, key) => { const a = 'xyz'.indexOf(key[0]), s = key[1] === '+' ? 1 : -1; return R.c.getComponent(a) + s * (R.s.getComponent(a) / 2 + T / 2); };
  const tunnel = (R, key, r) => {
    const ax = key[0], at = plane(R, key), a = T / 2 + 0.03;
    if (ax === 'z') B.tunnel([r[0], r[2], at - a], [r[1], r[3], at + a], R.idx); else if (ax === 'x') B.tunnel([at - a, r[2], r[0]], [at + a, r[3], r[1]], R.idx); else B.tunnel([r[0], at - a, r[2]], [r[1], at + a, r[3]], R.idx);
  };
  const doors = {}, windows = [];
  const door = (id, R, key, u, v, kind = 'int') => { const r = rect(u, v); H(R, key, r); tunnel(R, key, r); doors[id] = { id, R, axis: key[0], at: plane(R, key), u, v, kind }; };
  const hole = (R, key, r) => { H(R, key, r); tunnel(R, key, r); };
  const win = (R, key, r, extra = {}) => { H(R, key, r, { g: 1 }); tunnel(R, key, r); windows.push({ R, key, r, at: plane(R, key), ...extra }); };

  hole(BAY, 'z+', [-11, 11, -5, 6]);                                 // the mouth (the big doors close it)
  door('bayShop', BAY, 'z-', 0, -4.75);
  win(BAY, 'z-', [-9.2, -3, -3.4, -0.7]); win(BAY, 'z-', [3, 9.2, -3.4, -0.7]);
  hole(Q, 'y+', [7.5, 10.5, -27, -24]); hole(BR, 'y-', [7.5, 10.5, -27, -24]);
  win(BR, 'z+', [1.6, 10.4, 6.1, 9.7]);                             // panorama over the hangar roof
  win(BR, 'y+', [3.4, 8.6, -27.6, -22.4]);                          // skylight
  win(BR, 'z-', [1.2, 4.0, 6.4, 9.2]);                              // porthole by the bunk

  const sh = (R, skip = [], tube = null) => {
    const [cx, cy, cz] = R.c.toArray(), [sx, sy, sz] = R.s.toArray(), hl = (k) => holes.get(R.idx + k) || [];
    const ez = tube === 'z' ? 0 : 2 * T, o = { room: R.idx, seg: R === BAY ? 2.4 : 0.75 };
    for (const s of [-1, 1]) {
      const sg = s > 0 ? '+' : '-';
      if (tube !== 'y' && !skip.includes('y' + sg)) B.wall('y', cy + s * (sy / 2 + T / 2), [cx - sx / 2 - (tube === 'x' ? 0 : T), cx + sx / 2 + (tube === 'x' ? 0 : T)], [cz - sz / 2 - ez / 2, cz + sz / 2 + ez / 2], hl('y' + sg), o);
      if (tube !== 'x' && !skip.includes('x' + sg)) B.wall('x', cx + s * (sx / 2 + T / 2), [cz - sz / 2 - ez / 2, cz + sz / 2 + ez / 2], [cy - sy / 2, cy + sy / 2], hl('x' + sg), o);
      if (tube !== 'z' && !skip.includes('z' + sg)) B.wall('z', cz + s * (sz / 2 + T / 2), [cx - sx / 2, cx + sx / 2], [cy - sy / 2, cy + sy / 2], hl('z' + sg), o);
    }
  };
  sh(BAY); sh(Q, ['z+']); sh(SH, [], 'y'); sh(BR);
  for (const w of windows) {      // glass is solid for every body
    const [u0, u1, v0, v1] = w.r, ax = w.key[0];
    if (ax === 'z') B.obb([(u0 + u1) / 2, (v0 + v1) / 2, w.at], [u1 - u0, v1 - v0, T]); else if (ax === 'x') B.obb([w.at, (v0 + v1) / 2, (u0 + u1) / 2], [T, v1 - v0, u1 - u0]); else B.obb([(u0 + u1) / 2, w.at, (v0 + v1) / 2], [u1 - u0, T, v1 - v0]);
  }

  // ---- props ----
  const P = (c, s, col, R, extra) => B.box(c, s, { kind: 'prop', color: col, room: R.idx, collide: true, ...extra });
  const Pc = (c, r, len, ax, col, R, extra) => B.cyl(c, r, len, ax, { kind: 'prop', color: col, room: R.idx, collide: true, ...extra });
  const deco = (c, s, col, R, extra) => B.box(c, s, { kind: 'prop', color: col, room: R.idx, ...extra });
  const decoC = (c, r, len, ax, col, R, extra) => B.cyl(c, r, len, ax, { kind: 'prop', color: col, room: R.idx, ...extra });
  const LAMP = (c, s, col, R, k = 2.2) => B.box(c, s, { kind: 'lamp', color: col, k, room: R.idx, seg: 9 });
  const rail = (a, b, R, col = C.orange) => {   // a grab rail on two stand-offs, the zero-g staple
    const ax = a[0] !== b[0] ? 'x' : a[1] !== b[1] ? 'y' : 'z', i = 'xyz'.indexOf(ax), len = Math.abs(b[i] - a[i]), c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    decoC(c, 0.035, len, ax, col, R, { sides: 6 });
    return { c, len, ax };
  };
  const standoffs = (r, n, off) => { const i = 'xyz'.indexOf(r.ax); for (let k = 0; k < n; k++) { const c = [...r.c]; c[i] += (k / (n - 1) - 0.5) * r.len * 0.9; c[0] += off[0] / 2; c[1] += off[1] / 2; c[2] += off[2] / 2; deco(c, [Math.abs(off[0]) + 0.06, Math.abs(off[1]) + 0.06, Math.abs(off[2]) + 0.06], C.slate, R_of(r), { seg: 9 }); } };
  let curR = BAY; const R_of = () => curR;
  const handrail = (a, b, R, off, col) => { curR = R; const r = rail(a, b, R, col); standoffs(r, Math.max(2, Math.round(r.len / 1.6) + 1), off); };
  const velcro = (c, s, R) => deco(c, s, 0x262626, R, { seg: 9 });

  // ===== hangar bay =====
  // floor: deck plates with tie-down rings, painted lanes to the cradle, wall ribs, a crane on a ceiling rail
  for (let z = -16; z <= 16; z += 8) {
    for (const x of [-14.8, 14.8]) deco([x, 1, z], [0.4, 14, 0.7], C.slate, BAY, { seg: 3 });
    deco([0, 7.8, z], [30, 0.4, 0.7], C.slate, BAY, { seg: 3 });
  }
  for (const x of [-14.6, 14.6]) for (const y of [-3, 3]) deco([x, y, 0], [0.15, 0.3, 35], C.dark, BAY, { seg: 3 });  // cable trays
  // cradle: a raised pad with clamp sockets, lit edges and an umbilical post
  P([0, -5.55, 2], [8.6, 0.9, 10.5], C.slate, BAY, { seg: 1.5 });
  deco([0, -5.08, 2], [7.4, 0.06, 9.3], C.dark, BAY, { seg: 3 });
  for (const s of [-1, 1]) { LAMP([0, -5.06, 2 + s * 5.1], [8.2, 0.05, 0.14], L.amber, BAY, 2.4); LAMP([s * 4.15, -5.06, 2], [0.14, 0.05, 10], L.amber, BAY, 2.4); }
  for (const [x, z] of [[-3, -1.5], [3, -1.5], [-3, 5.5], [3, 5.5]]) P([x, -4.95, z], [0.9, 0.3, 0.9], C.orange, BAY, { seg: 2 });
  P([5.6, -3.6, -2.2], [0.7, 4.0, 0.7], C.steel, BAY, { seg: 1 });   // umbilical post
  deco([5.6, -1.4, -2.2], [0.9, 0.4, 0.9], C.orange, BAY, { seg: 2 });
  // painted guidance: chevrons pointing in from the mouth, and a lane edge
  for (let z = 7.5; z < 17; z += 1.8) for (const s of [-1, 1]) deco([s * 1.4, -5.97, z], [1.6, 0.04, 0.3], C.orange, BAY, { seg: 3 });
  for (const s of [-1, 1]) deco([s * 5.5, -5.97, 0], [0.18, 0.04, 34], C.cream, BAY, { seg: 3 });
  // tie-down rings across the floor
  for (let x = -12; x <= 12; x += 4) for (let z = -14; z <= 14; z += 4) if (Math.abs(x) > 5 || Math.abs(z - 2) > 6) deco([x, -5.96, z], [0.3, 0.05, 0.3], C.steel, BAY, { seg: 9 });
  // tool racks on the walls: bungee-held tool boards (velcro panels with tools stuck on)
  for (const z of [-12, -5]) {
    P([-14.55, -2.6, z], [0.4, 2.4, 3.6], C.dark, BAY, { seg: 1 });
    for (let k = 0; k < 4; k++) deco([-14.3, -3.4 + k * 0.55, z - 1.2 + (k % 2) * 1.1], [0.1, 0.12, 0.9], [C.orange, C.steel, C.teal, C.cream][k], BAY, { seg: 9 });
    for (const y of [-3.6, -2.6, -1.6]) deco([-14.28, y, z], [0.04, 0.04, 3.5], 0x111111, BAY, { seg: 9 });   // bungees
  }
  // parts crates strapped to the floor with webbing (zero g: nothing stays put on its own)
  const crate = (c, s, col) => { P(c, s, col, BAY, { seg: 1 }); for (const k of [-0.3, 0.3]) deco([c[0], c[1] + 0.01, c[2] + k * s[2]], [s[0] + 0.06, s[1] + 0.06, 0.08], C.orange, BAY, { seg: 9 }); };
  crate([11.5, -5.0, -13.5], [3, 2, 2.4], C.rust); crate([11.5, -3.0, -13.5], [2.4, 2, 2], C.teal); crate([8.0, -5.2, -14.5], [2, 1.6, 2], C.olive);
  crate([-11.6, -5.1, 13.5], [2.6, 1.8, 3], C.slate); crate([11.8, -5.25, 12.8], [2.2, 1.5, 2.2], C.rust);
  // control booth window frames on the back wall
  for (const x0 of [-9.2, 3]) { deco([x0 + 3.1, -3.55, -17.85], [6.6, 0.3, 0.3], C.dark, BAY, { seg: 3 }); deco([x0 + 3.1, -0.55, -17.85], [6.6, 0.3, 0.3], C.dark, BAY, { seg: 3 }); }
  for (const x of [-9.35, -2.85, 2.85, 9.35]) deco([x, -2.05, -17.85], [0.3, 3.3, 0.3], C.dark, BAY, { seg: 3 });
  // status board over the shop door, and the door's hazard frame
  P([0, -2.6, -17.75], [3.0, 0.6, 0.4], C.dark, BAY, { seg: 2 });
  for (const s of [-1, 1]) deco([s * 1.25, -4.75, -17.9], [0.25, 2.6, 0.2], C.orange, BAY, { seg: 3 });
  // handrails along the back wall so you can pull yourself to the door
  curR = BAY; handrail([-12, -4.2, -17.7], [-2, -4.2, -17.7], BAY, [0, 0, -0.2]); handrail([2, -4.2, -17.7], [12, -4.2, -17.7], BAY, [0, 0, -0.2]);
  handrail([-14.5, -4.5, -15], [-14.5, -4.5, 15], BAY, [-0.2, 0, 0]); handrail([14.5, -4.5, -15], [14.5, -4.5, 15], BAY, [0.2, 0, 0]);
  // ceiling crane rail
  deco([0, 7.55, 0], [1.2, 0.5, 34], C.dark, BAY, { seg: 3 }); deco([0, 7.2, 0], [0.4, 0.3, 34], C.orange, BAY, { seg: 3 });
  // floodlight housings
  for (const z of [-11, 0, 11]) for (const x of [-8, 8]) { deco([x, 7.65, z], [2.2, 0.4, 1.2], C.slate, BAY, { seg: 2 }); LAMP([x, 7.43, z], [1.8, 0.04, 0.9], L.cool, BAY, 2.6); }
  // mouth inside frame: hazard band and status lamps that the pressure cycle recolours
  for (const s of [-1, 1]) deco([s * 11.2, 0.5, 17.8], [0.4, 11, 0.4], C.orange, BAY, { seg: 3 });
  deco([0, 6.2, 17.8], [22.8, 0.4, 0.4], C.orange, BAY, { seg: 3 }); deco([0, -5.2, 17.8], [22.8, 0.4, 0.4], C.orange, BAY, { seg: 3 });

  // ===== the shop: concourse and counter =====
  // counter: a long console the trader works behind, foot loops for her and for you, ship catalog screens
  P([0, -5.45, -27.0], [8.4, 1.0, 1.2], C.slate, Q, { seg: 1 });
  deco([0, -4.9, -27.0], [8.6, 0.12, 1.4], C.cream, Q, { seg: 2 });
  deco([0, -5.45, -26.38], [8.0, 0.75, 0.04], C.rust, Q, { seg: 9 });
  LAMP([0, -5.0, -26.32], [8.0, 0.04, 0.04], L.amber, Q, 2.2);
  decoC([-2.6, -4.78, -27.0], 0.45, 0.14, 'y', C.dark, Q, { sides: 16 }); B.cyl([-2.6, -4.7, -27.0], 0.38, 0.03, 'y', { kind: 'lamp', color: L.cyan, k: 2.4, room: Q.idx, sides: 20 });   // holo projector
  for (let i = -3; i <= 3; i++) deco([i * 1.15, -5.88, -25.6], [0.7, 0.12, 0.18], C.orange, Q, { seg: 9 });   // your foot loops
  for (let i = -2; i <= 2; i++) deco([i * 1.2, -5.88, -28.9], [0.7, 0.12, 0.18], C.orange, Q, { seg: 9 });    // hers
  curR = Q; handrail([-4.2, -5.2, -26.2], [4.2, -5.2, -26.2], Q, [0, 0, -0.16]);
  // back wall: catalog screens on a slate board, shelves with netting, the yard's sign
  P([0, -2.4, -30.15], [10, 3.6, 0.4], C.dark, Q, { seg: 1 });
  for (const x of [-3.2, 0, 3.2]) deco([x, -2.2, -29.92], [2.8, 1.8, 0.06], C.slate, Q, { seg: 9 });
  LAMP([0, -0.45, -29.9], [9.6, 0.1, 0.04], L.amber, Q, 2.4);
  for (const s of [-1, 1]) {
    P([s * 7.4, -3, -29.8], [3.2, 5.6, 1.0], C.slate, Q, { seg: 1 });
    for (const y of [-5, -3.4, -1.8]) { deco([s * 7.4, y, -29.25], [3.0, 0.08, 0.12], C.steel, Q, { seg: 9 }); deco([s * 7.4, y + 0.6, -29.27], [2.9, 1.0, 0.03], 0x2a2a2a, Q, { seg: 9 }); }  // cargo netting
    for (let k = 0; k < 3; k++) deco([s * 7.4 + (k - 1) * 0.9, -4.5 + k * 1.6, -29.4], [0.6, 0.5, 0.5], [C.rust, C.teal, C.cream][k], Q, { seg: 9 });
  }
  // galley (west): a sealed drink dispenser with pouch racks, a food warmer, a table you clip food to
  P([-10.5, -3.0, -24.3], [0.9, 5.4, 4.6], C.slate, Q, { seg: 1 });
  deco([-10.02, -2.6, -25.6], [0.1, 1.4, 1.2], C.steel, Q, { seg: 9 }); LAMP([-9.96, -2.0, -25.6], [0.04, 0.12, 0.8], L.cyan, Q, 2);   // dispenser
  decoC([-9.85, -3.2, -25.6], 0.05, 0.5, 'y', C.steel, Q, { sides: 8 });                                                           // its nozzle (a sealed valve)
  for (let k = 0; k < 6; k++) deco([-9.95, -1.2 + (k % 2) * 0.5, -23.6 + Math.floor(k / 2) * 0.55], [0.06, 0.4, 0.3], [C.cream, C.orange, C.teal][k % 3], Q, { seg: 9 });   // pouches on velcro
  velcro([-10.0, -0.95, -23.05], [0.04, 1.2, 1.7], Q);
  deco([-10.0, -4.2, -23.0], [0.12, 1.1, 1.3], C.dark, Q, { seg: 9 }); LAMP([-9.93, -3.7, -23.0], [0.03, 0.08, 0.9], L.amber, Q, 2);   // food warmer
  // the table: a waist-high slab with bungee cords and a ring of foot loops; you float around it
  P([-6.2, -4.6, -22.2], [2.6, 0.18, 1.6], C.cream, Q, { seg: 1 }); Pc([-6.2, -5.3, -22.2], 0.12, 1.2, 'y', C.steel, Q);
  for (const z of [-22.6, -21.8]) deco([-6.2, -4.48, z], [2.5, 0.04, 0.04], 0x111111, Q, { seg: 9 });
  for (const [x, z] of [[-7.8, -22.2], [-4.6, -22.2], [-6.2, -23.5], [-6.2, -20.9]]) deco([x, -5.88, z], [0.6, 0.12, 0.18], C.orange, Q, { seg: 9 });
  for (const [x, z] of [[-6.8, -22.0], [-5.6, -22.5]]) deco([x, -4.42, z], [0.22, 0.12, 0.3], C.orange, Q, { seg: 9 });   // pouches clipped down
  // lounge (east): restraint seats on the wall (lap belts, no "sitting"), a big window into the bay is opposite
  for (const z of [-21.4, -23.4]) {
    P([10.55, -3.5, z], [0.6, 2.6, 1.5], C.fabric, Q, { seg: 1 });
    deco([10.2, -3.9, z], [0.12, 0.16, 1.55], C.orange, Q, { seg: 9 }); deco([10.2, -2.9, z], [0.12, 0.16, 1.55], C.orange, Q, { seg: 9 });   // belts
    deco([10.2, -2.3, z], [0.1, 0.3, 0.6], C.cream, Q, { seg: 9 });   // headrest strap
  }
  curR = Q; handrail([10.5, -1.2, -25.5], [10.5, -1.2, -19.5], Q, [0.2, 0, 0]); handrail([-10.5, -1.2, -21], [-10.5, -1.2, -19], Q, [-0.2, 0, 0]);
  // ceiling: air vents with fans (moving air matters in zero g), light panels, the shaft collar
  for (const x of [-6, 0, 6]) { deco([x, -0.15, -24.3], [1.2, 0.2, 1.2], C.dark, Q, { seg: 2 }); decoC([x, -0.28, -24.3], 0.45, 0.05, 'y', C.steel, Q, { sides: 12 }); }
  for (const [x, z] of [[-6, -21], [6, -21], [-6, -28], [6, -28]]) LAMP([x, -0.12, z], [2.0, 0.04, 0.8], L.warm, Q, 2);
  for (const s of [-1, 1]) deco([9 + s * 1.65, -0.2, -25.5], [0.2, 0.3, 3.3], C.orange, Q, { seg: 3 });
  for (const s of [-1, 1]) deco([9, -0.2, -25.5 + s * 1.65], [3.3, 0.3, 0.2], C.orange, Q, { seg: 3 });
  // floor: foot-loop rail runs, lockers along the west wall
  for (let i = 0; i < 4; i++) { P([-4 + i * 1.4, -3.0, -18.85 - 0.0], [1.2, 5.4, 0.6], i % 2 ? C.olive : C.slate, Q, { seg: 1 }); LAMP([-4 + i * 1.4, -1.0, -19.17], [0.5, 0.04, 0.03], i % 3 ? L.green : L.amber, Q, 1.8); }

  // ===== the shaft up to the bunk room =====
  curR = SH;
  for (const [x, z] of [[7.75, -26.75], [10.25, -26.75], [7.75, -24.25], [10.25, -24.25]]) decoC([x, 2.35, z], 0.05, 4, 'y', C.orange, SH, { sides: 6 });
  for (let y = 0.9; y < 4; y += 0.7) decoC([9, y, -26.82], 0.03, 1.6, 'x', C.orange, SH, { sides: 6 });   // rungs
  LAMP([10.42, 2.35, -25.5], [0.04, 2.6, 0.4], L.cool, SH, 2);

  // ===== bunk room =====
  // the bunk: a sleeping bag zipped to the west wall, three restraint straps over it, a head strap and pillow,
  // the reading lamp and a fan blowing across the face (no convection up here: you'd wake in your own CO2)
  P([0.3, 7.7, -24.6], [0.25, 4.6, 2.6], C.dark, BR, { seg: 1 });                     // padded backing board
  B.geo(new THREE.CapsuleGeometry(0.42, 3.0, 6, 14).scale(1, 1, 1.9).translate(0.72, 7.5, -24.6), { kind: 'prop', color: C.fabric, room: BR.idx });   // the bag
  B.obb([0.72, 7.5, -24.6], [0.84, 3.84, 1.6]);
  B.geo(new THREE.SphereGeometry(0.34, 14, 10).scale(0.6, 0.8, 1.2).translate(0.62, 9.45, -24.6), { kind: 'prop', color: C.cream, room: BR.idx });     // pillow, strapped
  for (const y of [6.4, 7.6, 8.8]) {
    deco([1.12, y, -24.6], [0.08, 0.16, 1.8], C.orange, BR, { seg: 9 });               // strap across the bag
    for (const s of [-1, 1]) deco([0.55, y, -24.6 + s * 0.98], [0.66, 0.16, 0.08], C.orange, BR, { seg: 9 });   // down to the board
    deco([1.17, y, -24.6], [0.04, 0.24, 0.24], C.steel, BR, { seg: 9 });               // buckle
  }
  deco([0.95, 9.45, -24.6], [0.06, 0.12, 1.3], C.orange, BR, { seg: 9 });               // head strap
  decoC([0.55, 10.0, -23.5], 0.03, 0.8, 'x', C.steel, BR, { sides: 6 }); deco([0.95, 9.95, -23.5], [0.2, 0.14, 0.24], C.dark, BR, { seg: 9 }); LAMP([0.95, 9.87, -23.5], [0.16, 0.02, 0.18], 0xffe6c0, BR, 2.6);
  deco([0.4, 10.35, -25.6], [0.5, 0.5, 0.5], C.slate, BR, { seg: 9 }); decoC([0.67, 10.35, -25.6], 0.2, 0.04, 'x', C.dark, BR, { sides: 12 });   // the fan
  curR = BR; handrail([0.4, 5.3, -26.2], [0.4, 5.3, -23.0], BR, [-0.15, 0, 0]); handrail([0.4, 10.1, -27.1], [0.4, 10.1, -26.2], BR, [-0.15, 0, 0]);
  for (const s of [-1, 1]) handrail([0.4, 6.5, -24.6 + s * 1.7], [0.4, 8.9, -24.6 + s * 1.7], BR, [-0.15, 0, 0]);
  // personal stuff on velcro beside the bunk: a tablet, a pen, a photo, a drink pouch
  velcro([0.22, 8.2, -27.0], [0.06, 1.4, 1.2], BR);
  deco([0.28, 8.4, -27.1], [0.04, 0.5, 0.36], C.dark, BR, { seg: 9 }); LAMP([0.31, 8.4, -27.1], [0.01, 0.42, 0.3], L.cyan, BR, 1.2);
  deco([0.28, 7.8, -26.75], [0.04, 0.24, 0.18], C.cream, BR, { seg: 9 }); deco([0.28, 7.9, -27.4], [0.05, 0.3, 0.2], C.orange, BR, { seg: 9 });
  // hygiene: a sealed wash capsule (water stays in the cylinder, a fan pulls it down to the drain) and a towel net
  Pc([10.6, 7.7, -21.0], 1.0, 5.6, 'y', C.bone, BR, { sides: 18 });
  decoC([10.6, 7.7, -21.0], 1.03, 0.14, 'y', C.slate, BR, { sides: 18 }); decoC([10.6, 5.2, -21.0], 1.04, 0.2, 'y', C.slate, BR, { sides: 18 }); decoC([10.6, 10.2, -21.0], 1.04, 0.2, 'y', C.slate, BR, { sides: 18 });
  deco([9.62, 7.7, -21.0], [0.06, 3.6, 1.0], C.steel, BR, { seg: 9 }); deco([9.58, 7.7, -21.4], [0.06, 0.8, 0.08], C.dark, BR, { seg: 9 });   // door and handle
  Pc([11.6, 8.5, -23.0], 0.28, 1.4, 'y', C.cream, BR, { sides: 12 }); decoC([11.25, 8.0, -22.6], 0.03, 1.0, 'z', C.steel, BR, { sides: 6 });   // water bladder and hose
  deco([11.8, 6.4, -23.4], [0.06, 1.2, 1.4], 0x2a2a2a, BR, { seg: 9 }); deco([11.7, 6.6, -23.4], [0.12, 0.7, 0.8], C.teal, BR, { seg: 9 });     // towel in a net
  // exercise: a treadmill on the floor with a harness on bungees (bones and muscle waste without load)
  P([5.2, 4.95, -28.4], [2.6, 0.3, 1.2], C.dark, BR, { seg: 1 }); deco([5.2, 5.12, -28.4], [2.3, 0.04, 0.9], 0x2b2b2b, BR, { seg: 9 });
  for (const s of [-1, 1]) { Pc([5.2 + s * 1.2, 5.9, -29.0], 0.05, 1.6, 'y', C.steel, BR); decoC([5.2 + s * 0.5, 6.4, -28.4], 0.02, 2.6, 'y', 0x111111, BR, { sides: 5 }); }
  deco([5.2, 7.7, -28.4], [1.2, 0.2, 0.5], C.orange, BR, { seg: 9 });               // the harness yoke
  decoC([5.2, 6.9, -28.4], 0.02, 1.4, 'y', 0x111111, BR, { sides: 5 });
  // a grow cabinet: lettuce under magenta LEDs, a crew favourite
  P([11.3, 6.6, -28.8], [1.2, 3.4, 2.0], C.slate, BR, { seg: 1 });
  deco([10.68, 6.6, -28.8], [0.04, 3.0, 1.7], 0x241a2a, BR, { seg: 9 });
  for (const y of [5.6, 6.6, 7.6]) { LAMP([10.66, y + 0.38, -28.8], [0.03, 0.04, 1.6], L.grow, BR, 2.4); for (let k = 0; k < 4; k++) B.geo(new THREE.SphereGeometry(0.16, 8, 6).scale(1, 0.7, 1).translate(10.7, y, -29.45 + k * 0.42), { kind: 'prop', color: 0x6fae4a, room: BR.idx }); }
  // a mesh net of belongings on the east wall and a locker bank
  deco([11.8, 9.2, -25.2], [0.06, 1.6, 2.6], 0x2a2a2a, BR, { seg: 9 });
  for (const [y, z, c] of [[9.4, -25.8, C.rust], [9.0, -24.8, C.cream], [9.5, -24.4, C.teal]]) deco([11.7, y, z], [0.2, 0.4, 0.5], c, BR, { seg: 9 });
  for (let i = 0; i < 3; i++) { P([3.2 + i * 1.5, 10.2, -29.85], [1.3, 1.0, 0.6], i % 2 ? C.olive : C.slate, BR, { seg: 1 }); deco([3.2 + i * 1.5, 10.2, -29.52], [1.0, 0.04, 0.03], 0x111111, BR, { seg: 9 }); }
  // window frames
  for (const y of [6.05, 9.75]) deco([6, y, -19.4], [9.0, 0.2, 0.2], C.dark, BR, { seg: 3 }); for (const x of [1.55, 6, 10.45]) deco([x, 7.9, -19.4], [0.2, 3.8, 0.2], C.dark, BR, { seg: 3 });
  for (const s of [-1, 1]) deco([6, 10.55, -25 + s * 2.65], [5.4, 0.2, 0.2], C.dark, BR, { seg: 3 });
  LAMP([6, 10.6, -22.2], [5.0, 0.04, 0.12], L.warm, BR, 1.6); LAMP([6, 10.6, -27.8], [5.0, 0.04, 0.12], L.warm, BR, 1.6);
  curR = BR; handrail([1.8, 5.3, -19.6], [10.2, 5.3, -19.6], BR, [0, 0, 0.15]);
  // the shaft collar in the floor
  for (const s of [-1, 1]) { deco([9 + s * 1.65, 4.8, -25.5], [0.2, 0.2, 3.3], C.orange, BR, { seg: 3 }); deco([9, 4.8, -25.5 + s * 1.65], [3.3, 0.2, 0.2], C.orange, BR, { seg: 3 }); }

  // ---- screens ----
  const screenGeos = [];
  const plane1 = (c, n, w, h, R, tilt = 0) => {
    const g = new THREE.PlaneGeometry(w, h); const nv = new THREE.Vector3(...n);
    _m.lookAt(_v.set(0, 0, 0), nv, _v2.set(0, 1, 0)); _q.setFromRotationMatrix(_m);
    _q.multiply(_q2.setFromEuler(_e.set(-tilt, 0, 0))); g.applyQuaternion(_q); g.translate(c[0], c[1], c[2]);
    const u = g.attributes.uv; const ou = rnd(), ov = rnd(); for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * 0.5 + ou, u.getY(i) * 0.4 + ov);
    const n3 = g.attributes.position.count;
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n3 * 3).fill(1), 3)); g.setAttribute('aRoom', new THREE.BufferAttribute(new Float32Array(n3).fill(R.idx), 1)); g.deleteAttribute('normal');
    screenGeos.push(g);
  };
  for (const x of [-3.2, 0, 3.2]) plane1([x, -2.2, -29.88], [0, 0, -1], 2.6, 1.6, Q);
  plane1([0, -2.6, -17.53], [0, 0, -1], 2.8, 0.45, BAY);
  plane1([-14.33, -2.6, 8], [-1, 0, 0], 3.2, 1.6, BAY);
  plane1([2.6, -4.83, -27.3], [0, 0, 1], 1.4, 0.5, Q, 1.2); plane1([1.0, -4.83, -27.3], [0, 0, 1], 1.0, 0.4, Q, 1.2);

  // ===== exterior =====
  const X = (c, s, col = undefined, extra = {}) => { B.box(c, s, { kind: 'hull', color: col, seg: 3, ...extra }); if (!extra.noObb) B.obb(c, s); };
  const XC = (c, r, len, ax, col, extra = {}) => B.cyl(c, r, len, ax, { kind: 'hull', color: col, sides: extra.sides ?? 16, seg: 4, ...extra });
  const XG = (g, col) => B.geo(g, { kind: 'hull', color: col });
  const BEAM = 0x3d4249, BAND = 0x6b6e70, PANEL = 0xa9a69b;
  // the hangar's ribs: heavy frames round the bay every 8 m, so it reads as a pressure hull, not a box
  const hx = 15 + T, hy0 = -6 - T, hy1 = 8 + T;
  for (const z of [-16, -8, 0, 8, 16]) {
    const d = 0.9, w = 1.1;
    for (const s of [-1, 1]) X([s * (hx + d / 2), 1, z], [d, 14 + 2 * T + 2 * d, w], BEAM, { noObb: true });
    X([0, hy1 + d / 2, z], [2 * hx + 2 * d, d, w], BEAM, { noObb: true }); X([0, hy0 - d / 2, z], [2 * hx + 2 * d, d, w], BEAM, { noObb: true });
  }
  for (const s of [-1, 1]) for (const y of [hy0 - 0.45, hy1 + 0.45]) X([s * (hx + 0.45), y, 0], [0.9, 0.9, 36.7], BEAM, { noObb: true });
  // plating between ribs: raised panels with seams on the flanks and roof
  for (let i = 0; i < 4; i++) {
    const z = -12 + i * 8;
    for (const s of [-1, 1]) {
      X([s * (hx + 0.08), 1, z], [0.16, 12.6, 6.6], i % 2 ? PANEL : 0x9c998e, { noObb: true });
      for (const y of [-3, 1, 5]) X([s * (hx + 0.17), y, z], [0.04, 0.12, 6.2], 0x2d3035, { noObb: true });
    }
    X([0, hy1 + 0.08, z], [28.6, 0.16, 6.6], i % 2 ? 0x9c998e : PANEL, { noObb: true });
  }
  // roof: radiator wings on hinges, a comms mast and dish, tanks
  for (const s of [-1, 1]) {
    X([s * 9, hy1 + 1.4, -4], [0.6, 2.2, 0.6], BEAM, { noObb: true });
    X([s * 9, hy1 + 2.5, -4], [10, 0.2, 20], 0xd8d4c8, { noObb: true });
    for (let k = 0; k < 9; k++) X([s * 9, hy1 + 2.62, -13 + k * 2.25], [9.6, 0.05, 0.12], 0x7e7b73, { noObb: true });
    B.obb([s * 9, hy1 + 2.5, -4], [10, 0.4, 20]);
  }
  XC([0, hy1 + 4, 10], 0.25, 8, 'y', BAND); X([0, hy1 + 8.2, 10], [0.5, 0.5, 0.5], 0xe8561a, { noObb: true });
  XG(new THREE.SphereGeometry(2.2, 22, 8, 0, Math.PI * 2, 0, 0.9).rotateX(-0.9).translate(0, hy1 + 6.6, 10.4), 0xd0ccc0);
  for (const s of [-1, 1]) { XG(new THREE.CapsuleGeometry(1.4, 9, 6, 18).rotateX(Math.PI / 2).translate(s * 4, hy0 - 1.8, -6), 0xb9b3a6); B.obb([s * 4, hy0 - 1.8, -6], [2.8, 2.8, 11.8]); for (const z of [-9.5, -2.5]) X([s * 4, hy0 - 0.75, z], [3.2, 1.3, 0.5], BEAM, { noObb: true }); }
  // the mouth: a thick portal with hazard chevrons, door rails top and bottom that run past the flanks into pockets
  const MZ = 18 + T;
  X([0, 6.6, MZ + 0.6], [2 * hx + 2.4, 1.2, 1.2], 0x5a5d62); X([0, -5.6, MZ + 0.6], [2 * hx + 2.4, 1.2, 1.2], 0x5a5d62);
  for (const s of [-1, 1]) {
    X([s * (hx + 0.9), 0.5, MZ + 0.6], [1.8, 13.4, 1.2], 0x5a5d62);
    X([s * (hx + 6.5), 6.6, MZ + 1.6], [13, 0.7, 1.1], BEAM); X([s * (hx + 6.5), -5.6, MZ + 1.6], [13, 0.7, 1.1], BEAM);   // rails out to the pockets (solid: you can hit them)
    X([s * (hx + 12.6), 0.5, MZ + 1.6], [0.8, 13, 1.1], BEAM);
    for (let k = 0; k < 6; k++) X([s * (11.6 + 0.0), -4.6 + k * 2, MZ + 1.25], [0.6, 0.9, 0.08], k % 2 ? 0x1c1e22 : 0xe8561a, { noObb: true });   // chevrons
  }
  // name on the portal: big painted blocks reading as a yard number
  for (let k = 0; k < 9; k++) X([-8 + k * 2, 6.6, MZ + 1.22], [1.4, 0.7, 0.04], k % 2 ? 0x1c1e22 : 0xe8561a, { noObb: true });
  // approach lane: two rails of light posts reaching out from the mouth (they chase inward)
  const lanePosts = [];
  for (let i = 0; i < 8; i++) for (const s of [-1, 1]) {
    const z = MZ + 5 + i * 6, x = s * 12.5;
    X([x, -6.5, z], [0.4, 0.4, 0.4], BEAM, { noObb: true }); lanePosts.push([x, -6.1, z, i]);
  }
  for (const s of [-1, 1]) X([s * 12.5, -6.95, MZ + 26], [0.5, 0.3, 44], BEAM);   // the lane rails themselves
  // the shop and bunk modules: frames and bands
  const frame = (R) => {
    const hx2 = R.s.x / 2 + T, hy2 = R.s.y / 2 + T, hz2 = R.s.z / 2 + T, [cx, cy, cz] = R.c.toArray(), w = 0.36;
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) X([cx, cy + sy * hy2, cz + sz * hz2], [2 * hx2 + w, w, w], BEAM, { noObb: true });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) X([cx + sx * hx2, cy, cz + sz * hz2], [w, 2 * hy2 + w, w], BEAM, { noObb: true });
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) X([cx + sx * hx2, cy + sy * hy2, cz], [w, w, 2 * hz2 + w], BEAM, { noObb: true });
  };
  frame(Q); frame(BR);
  for (const x of [-7, 0, 7]) X([x, 0.35 + 0.1, -24.35], [0.3, 0.2, 12.7], BAND, { noObb: true });
  XC([9, 2.35, -25.5], 2.15, 4, 'y', 0x9a978e, { open: true, sides: 20 });
  for (const s of [-1, 1]) X([s * 11.6, -3, -24.35], [0.16, 5.2, 11], PANEL, { noObb: true });
  // orange identity stripe along each flank of the bay
  for (const s of [-1, 1]) X([s * (hx + 0.2), -5.2, 0], [0.04, 0.4, 36], 0xe8561a, { noObb: true });
  // keel rails along both flanks: the berths hang off these
  for (const s of [-1, 1]) {
    const x = s * KEEL_X;
    X([x, 7.4, -0.0], [1.6, 1.6, BAY_LEN + 0.5], BEAM); X([x, -5.4, 0], [1.6, 1.6, BAY_LEN + 0.5], BEAM);
    for (let z = -16; z <= 16; z += 8) X([x, 1, z], [1.0, 12, 1.0], BAND, { noObb: true });
    for (let z = -16; z < 16; z += 8) XG(strut([x, -4.6, z], [x, 6.6, z + 8], 0.5), BAND);
    for (const z of [-16, -8, 0, 8, 16]) X([s * (hx + 0.95), 1, z], [KEEL_X - hx - 0.95, 0.8, 0.8], BEAM, { noObb: true });   // stand-offs to the ribs
  }

  // ---- finish ----
  const G = B.finish();
  const M = {
    wall: patch(new THREE.MeshBasicMaterial({ map: wallTexture(), vertexColors: true })),
    floor: patch(new THREE.MeshBasicMaterial({ map: floorTexture(), vertexColors: true })),
    lamp: patch(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })),
    screen: patch(new THREE.MeshBasicMaterial({ map: screenTexture(), vertexColors: true, toneMapped: false })),
    glass: new THREE.MeshBasicMaterial({ color: 0x9cc8ff, transparent: true, opacity: 0.07, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
  };
  const inner = new THREE.Group(); inner.name = 'base-inner'; const outer = new THREE.Group(); outer.name = 'base-outer';
  site.group.add(outer, inner);
  const mk = (g, m, parent = inner) => { const o = new THREE.Mesh(g, m); parent.add(o); return o; };
  const hullMesh = mk(G.hull, mats.hull, outer); hullMesh.castShadow = hullMesh.receiveShadow = true;
  mk(G.wall, M.wall); mk(G.floor, M.floor); mk(G.lamp, M.lamp);
  mk(mergeGeometries(screenGeos), M.screen);
  for (const w of windows) {
    const [u0, u1, v0, v1] = w.r, g = new THREE.PlaneGeometry(u1 - u0, v1 - v0), ax = w.key[0];
    if (ax === 'z') g.translate((u0 + u1) / 2, (v0 + v1) / 2, w.at); else if (ax === 'x') { g.rotateY(Math.PI / 2); g.translate(w.at, (v0 + v1) / 2, (u0 + u1) / 2); } else { g.rotateX(Math.PI / 2); g.translate((u0 + u1) / 2, w.at, (v0 + v1) / 2); }
    const m = new THREE.Mesh(g, M.glass); m.renderOrder = 3; inner.add(m);
  }

  // ---- moving parts: the hangar doors, the cradle clamps, the shop door, approach lights, crane ----
  const metal = new THREE.MeshStandardMaterial({ color: 0x8b8e92, roughness: 0.45, metalness: 0.7 });
  const haz = new THREE.MeshStandardMaterial({ color: 0xe8561a, roughness: 0.6, metalness: 0.15 });
  const darkM = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.6, metalness: 0.4 });
  const bigDoor = (s) => {
    const g = new THREE.Group();
    const pan = new THREE.Mesh(new THREE.BoxGeometry(11.3, 11.6, 0.5), mats.hull); pan.castShadow = pan.receiveShadow = true; g.add(pan);
    // stiffening ribs outside, a hazard edge where the leaves meet, a window strip
    for (let k = -2; k <= 2; k++) { const r = new THREE.Mesh(new THREE.BoxGeometry(11.0, 0.35, 0.3), metal); r.position.set(0, k * 2.3, 0.38); r.castShadow = true; g.add(r); }
    for (const x of [-3.6, 0.2, 4.0]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.3, 11.2, 0.22), metal); r.position.set(x, 0, 0.34); g.add(r); }
    for (let k = 0; k < 7; k++) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.2, 0.06), k % 2 ? darkM : haz); c.position.set(-s * 5.4, -4.6 + k * 1.55, 0.29); g.add(c); }
    const strip = new THREE.Mesh(new THREE.BoxGeometry(8, 0.5, 0.06), new THREE.MeshBasicMaterial({ color: 0x0b1018 })); strip.position.set(s * 0.6, 3.5, 0.28); g.add(strip);
    // rollers that ride the rails
    for (const y of [5.95, -5.0]) for (const x of [-4, 4]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.6, 12).rotateX(Math.PI / 2), darkM); r.position.set(x, y, 0.55); g.add(r); }
    // inside face: a lit ring of amber lamps for the pressure cycle
    const lampM = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    for (let k = -2; k <= 2; k++) { const lm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.06), lampM); lm.position.set(k * 2.1, 5.2, -0.28); g.add(lm); }
    g.userData.lamp = lampM;
    g.position.set(s * 5.65, 0.5, MZ + 0.55); outer.add(g); return g;
  };
  const leaves = [bigDoor(-1), bigDoor(1)];
  // cradle clamps: four arms that swing up and close on the jet
  const clamps = [];
  for (const [x, z] of [[-3, -1.5], [3, -1.5], [-3, 5.5], [3, 5.5]]) {
    const piv = new THREE.Group(); piv.position.set(x, -4.8, z); inner.add(piv);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1.5, 0.4), metal); arm.position.y = 0.7; arm.castShadow = true;
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.5), haz); pad.position.set(0, 1.45, 0);
    piv.add(arm, pad); piv.userData.s = Math.sign(x); clamps.push(piv);
  }
  // fuel umbilical: an arm from the post that swings over to the jet's spine when it's clamped
  const umb = new THREE.Group(); umb.position.set(5.6, -1.4, -2.2); inner.add(umb);
  { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.6, 10).rotateZ(Math.PI / 2), metal); a.position.x = -1.8; umb.add(a);
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.5, 10), haz); h.position.set(-3.6, -0.2, 0); umb.add(h); }
  // shop door
  const leafGeo = (d) => {
    const save = B.sink; B.sink = B.fresh();
    const ax = d.axis, pos = (uu, vv, w) => (ax === 'z' ? [uu, vv, w] : [w, vv, uu]), sz = (a, b, c) => (ax === 'z' ? [a, b, c] : [c, b, a]);
    const w = DW / 2 + 0.03;
    B.box(pos(0, 0, 0), sz(w, DH, 0.2), { kind: 'prop', color: C.slate, room: d.R.idx, seg: 0.6 });
    for (const s of [-1, 1]) { B.box(pos(0, 0.2, s * 0.105), sz(w * 0.8, 0.1, 0.012), { kind: 'prop', color: C.orange, room: d.R.idx, seg: 9 }); B.box(pos(0, -0.55, s * 0.105), sz(w * 0.8, 0.5, 0.012), { kind: 'prop', color: C.dark, room: d.R.idx, seg: 9 }); }
    const g = B.finish(B.sink); B.sink = save; return g.wall;
  };
  for (const d of Object.values(doors)) {
    const g = leafGeo(d);
    d.leaves = [-1, 1].map((s) => { const m = new THREE.Mesh(g, M.wall); m.userData.side = s; inner.add(m); return m; });
    d.open = 0; d.target = 0;
  }
  // approach lights
  const laneM = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const laneG = []; for (const [x, y, z, i] of lanePosts) { const g = new THREE.BoxGeometry(0.3, 0.3, 0.3).translate(x, y, z); const c = new Float32Array(g.attributes.position.count * 3).fill(0); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.userData = { i }; laneG.push(g); }
  const laneMesh = new THREE.Mesh(mergeGeometries(laneG), laneM); outer.add(laneMesh);
  const laneIdx = new Float32Array(laneMesh.geometry.attributes.position.count); { let o = 0; for (const g of laneG) { for (let k = 0; k < g.attributes.position.count; k++) laneIdx[o + k] = g.userData.i; o += g.attributes.position.count; } }
  // ceiling crane trolley
  const crane = new THREE.Group(); crane.position.set(0, 6.9, -8); inner.add(crane);
  { const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 1.6), haz); crane.add(b);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), metal); c.position.y = -1.4; crane.add(c);
    const hk = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.7), darkM); hk.position.y = -2.7; crane.add(hk); }
  // beacons on the portal and keel ends
  const beaconM = new THREE.MeshBasicMaterial({ color: 0xff7a30, toneMapped: false });
  for (const p of [[-hx - 1.8, 7.6, MZ + 0.6], [hx + 1.8, 7.6, MZ + 0.6], [-KEEL_X, 8.6, 17.8], [KEEL_X, 8.6, 17.8]]) { const b = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), beaconM); b.position.set(...p); outer.add(b); }

  // ---- colliders ----
  site.group.updateMatrixWorld(true);
  const node = new THREE.Group(); node.name = 'base-col'; site.group.add(node);
  for (const o of baseGaps) B.obbs.push({ c: o.c, q: [0, 0, 0, 1], h: o.h });   // gap fillers traced from the hull (scripts/basegaps.mjs)
  const part = new Part(site, 'base', node, B.obbs); part.sync(0);
  site.parts.push(part); site.byName.base = part;
  for (const d of Object.values(doors)) {
    d.lc = new THREE.Vector3(...(d.axis === 'z' ? [d.u, d.v, d.at] : [d.at, d.v, d.u]));
    d.h = d.axis === 'z' ? new THREE.Vector3(DW / 2, DH / 2, 0.15) : new THREE.Vector3(0.15, DH / 2, DW / 2);
    const c = d.lc.clone().applyMatrix4(site.group.matrixWorld), q = site.group.quaternion.clone();
    d.obb = { c, q, qi: q.clone().invert(), h: d.h, v: new THREE.Vector3(), br: d.h.length(), node, chunk: 'base', part };
  }
  // the big door's collider: one slab across the mouth while it's more than half shut
  const mq = site.group.quaternion.clone(), mh = new THREE.Vector3(11, 5.6, 0.4);
  const mouthObb = { c: new THREE.Vector3(0, 0.5, MZ + 0.55).applyMatrix4(site.group.matrixWorld), q: mq, qi: mq.clone().invert(), h: mh, v: new THREE.Vector3(), br: mh.length(), node, chunk: 'base', part };
  return new Base({ site, B, doors, ROOMS, M, inner, outer, leaves, clamps, umb, laneMesh, laneIdx, crane, beaconM, mouthObb, Part, BAY, Q, SH, BR });
}

// ================================================================================================================
// Berths: an extension of the hangar for one ship. Built in its own frame: +x out from the keel, y up, z across.
// The root section unfolds on hinges at the keel; the rest telescope out of it, each a little smaller.
function berthGeometry(W, H, Ls, k, outer) {
  const B = new Bake();
  const X = (c, s, col, extra) => B.box(c, s, { kind: 'hull', color: col, seg: 4, ...extra });
  const XG = (g, col) => B.geo(g, { kind: 'hull', color: col });
  const t = 0.5, hw = W / 2, hh = H / 2;
  // floor deck, roof, two walls: plates with ribs outside and a seam grid, an orange edge band inside
  const deck = (y, s) => {
    X([Ls / 2, y, 0], [Ls, t, W], s > 0 ? 0x9c998e : 0x8e8b82);
    for (let z = -hw + 2; z < hw - 1; z += 4) X([Ls / 2, y + s * (t / 2 + 0.2), z], [Ls - 0.4, 0.4, 0.5], 0x3d4249);
    for (let x = 2; x < Ls - 1; x += 4) X([x, y + s * (t / 2 + 0.12), 0], [0.3, 0.24, W - 0.6], 0x4a4f55);
    X([Ls / 2, y - s * (t / 2 + 0.02), hw - 1.0], [Ls, 0.04, 0.5], 0xe8561a); X([Ls / 2, y - s * (t / 2 + 0.02), -hw + 1.0], [Ls, 0.04, 0.5], 0xe8561a);
  };
  const wall = (z, s) => {
    X([Ls / 2, 0, z], [Ls, H, t], 0xa9a69b);
    for (let y = -hh + 2; y < hh - 1; y += 3.5) X([Ls / 2, y, z + s * (t / 2 + 0.15)], [Ls - 0.4, 0.3, 0.3], 0x3d4249);
    for (let x = 0.2; x < Ls; x += Math.max(2.5, Ls / 4)) X([x + 0.2, 0, z + s * (t / 2 + 0.2)], [0.4, H - 0.6, 0.4], 0x4a4f55);
  };
  deck(-hh, -1); deck(hh, 1); wall(-hw, -1); wall(hw, 1);
  // portal frame at the outer end: heavy, with hazard chevrons and a lamp strip, and the corner posts
  const P = 1.0;
  X([Ls - P / 2, -hh - 0.2, 0], [P, 1.2, W + 1.4], 0x5a5d62); X([Ls - P / 2, hh + 0.2, 0], [P, 1.2, W + 1.4], 0x5a5d62);
  for (const s of [-1, 1]) X([Ls - P / 2, 0, s * (hw + 0.2)], [P, H + 1.4, 1.2], 0x5a5d62);
  const nChev = Math.max(2, Math.floor(W / 3));
  for (let i = 0; i < nChev; i++) X([Ls + 0.02, -hh - 0.2, -hw + (i + 0.5) * W / nChev], [0.06, 0.9, W / nChev * 0.5], i % 2 ? 0x1c1e22 : 0xe8561a);
  // cross bracing on the walls (inside the plating's ribs): one X per wall
  for (const s of [-1, 1]) { const z = s * (hw + t / 2 + 0.35); XG(strut([0.6, -hh + 0.6, z], [Ls - 0.6, hh - 0.6, z], 0.3), 0x5a5d62); XG(strut([0.6, hh - 0.6, z], [Ls - 0.6, -hh + 0.6, z], 0.3), 0x5a5d62); }
  // lamps: a strip along the inside top corners and floods on the portal
  for (const s of [-1, 1]) B.box([Ls / 2, hh - t / 2 - 0.06, s * (hw - 0.9)], [Ls - 1, 0.08, 0.25], { kind: 'lamp', color: 0xd6ecff, k: 2.2 });
  for (const s of [-1, 1]) B.box([Ls - 1.06, hh - 0.6, s * (hw - 0.5)], [0.1, 0.6, 1.2], { kind: 'lamp', color: 0xffd9a8, k: 2.6 });
  B.box([Ls - P - 0.06, -hh + 0.4, 0], [0.06, 0.12, W - 2], { kind: 'lamp', color: 0xffa040, k: 2.4 });
  if (!outer) { X([0.4, 0, 0], [0.8, H + 0.6, W + 0.6], 0x5a5d62); X([0.82, 0, 0], [0.06, H - 1, W - 1], 0x23262b); }   // the root's back plate against the keel
  const G = B.finish();
  // colliders (berth frame)
  const obbs = [
    { c: [Ls / 2, -hh, 0], h: [Ls / 2, t / 2 + 0.4, hw + 0.4] }, { c: [Ls / 2, hh, 0], h: [Ls / 2, t / 2 + 0.4, hw + 0.4] },
    { c: [Ls / 2, 0, -hw], h: [Ls / 2, hh, t / 2 + 0.4] }, { c: [Ls / 2, 0, hw], h: [Ls / 2, hh, t / 2 + 0.4] },
  ];
  if (!outer) obbs.push({ c: [0.4, 0, 0], h: [0.45, hh, hw] });
  return { G, obbs };
}

// the root section, split into its hinged panels so it can unfold from the keel
function rootPanels(W, H, Ls) {
  const t = 0.5, hw = W / 2, hh = H / 2;
  const mk = (fn) => { const B = new Bake(); fn(B); return B.finish().hull; };
  const X = (B, c, s, col) => B.box(c, s, { kind: 'hull', color: col, seg: 4 });
  // each panel's geometry is built in its final pose, then shifted so its hinge sits at the group origin
  const floor = mk((B) => { X(B, [Ls / 2, 0, 0], [Ls, t, W], 0x8e8b82); for (let z = -hw + 2; z < hw - 1; z += 4) X(B, [Ls / 2, -t / 2 - 0.2, z], [Ls - 0.4, 0.4, 0.5], 0x3d4249); X(B, [Ls / 2, t / 2 + 0.02, hw - 1], [Ls, 0.04, 0.5], 0xe8561a); X(B, [Ls / 2, t / 2 + 0.02, -hw + 1], [Ls, 0.04, 0.5], 0xe8561a); });
  const roof = mk((B) => { X(B, [Ls / 2, 0, 0], [Ls, t, W], 0x9c998e); for (let z = -hw + 2; z < hw - 1; z += 4) X(B, [Ls / 2, t / 2 + 0.2, z], [Ls - 0.4, 0.4, 0.5], 0x3d4249); });
  const side = (s) => mk((B) => { X(B, [Ls / 2, 0, 0], [Ls, H, t], 0xa9a69b); for (let y = -hh + 2; y < hh - 1; y += 3.5) X(B, [Ls / 2, y, s * (t / 2 + 0.15)], [Ls - 0.4, 0.3, 0.3], 0x3d4249); });
  return { floor, roof, sideA: side(-1), sideB: side(1), hw, hh };
}

// ---- the container a bought ship arrives in, and the tug that pushes it ---------------------------------------
function containerParts(len, wid, hgt) {
  const mk = (fn) => { const B = new Bake(); fn(B); return B.finish().hull; };
  const X = (B, c, s, col) => B.box(c, s, { kind: 'hull', color: col, seg: 3 });
  const hl = len / 2, hw = wid / 2, hh = hgt / 2, t = 0.35;
  // corrugated panel: ribs every 1.2 m and a stencilled band
  const panel = (w, h, col) => mk((B) => {
    X(B, [0, 0, 0], [len, h, t], col);
    for (let x = -hl + 0.6; x < hl; x += 1.2) X(B, [x, 0, t / 2 + 0.08], [0.3, h - 0.2, 0.16], col === 0xc4672e ? 0xa8551f : 0x4b5a63);
    X(B, [0, h / 2 - 0.4, t / 2 + 0.18], [len - 0.4, 0.3, 0.04], 0xe2dccc);
    X(B, [-hl + 2, 0, t / 2 + 0.18], [1.6, h * 0.6, 0.04], 0x1c1e22);
  });
  const side = panel(len, hgt, 0xc4672e), top = panel(len, wid, 0x5f7380);
  // end frames: heavy corner castings and a door frame
  const frame = mk((B) => {
    for (const x of [-hl, hl]) {
      for (const [y, z] of [[-hh, -hw], [-hh, hw], [hh, -hw], [hh, hw]]) X(B, [x, y, z], [0.9, 0.9, 0.9], 0x2b2d31);
      for (const y of [-hh, hh]) X(B, [x, y, 0], [0.6, 0.6, wid], 0x3d4249);
      for (const z of [-hw, hw]) X(B, [x, 0, z], [0.6, hgt, 0.6], 0x3d4249);
    }
    for (const [y, z] of [[-hh, -hw], [-hh, hw], [hh, -hw], [hh, hw]]) X(B, [0, y, z], [len, 0.5, 0.5], 0x3d4249);
    X(B, [hl + 0.25, 0, 0], [0.3, hgt - 0.8, wid - 0.8], 0xb5b0a4);   // the closed outer end (the tug pushes here)
  });
  return { side, top, frame, hl, hw, hh };
}
function tugGeometry() {
  const B = new Bake();
  const X = (c, s, col) => B.box(c, s, { kind: 'hull', color: col, seg: 2 });
  const XC = (c, r, len, ax, col, o = {}) => B.cyl(c, r, len, ax, { kind: 'hull', color: col, sides: o.sides ?? 14, r2: o.r2, seg: 3 });
  // a stubby yard tug: cab forward (-x is its nose), a push plate, engine block aft, RCS quads and floodlights
  X([0, 0, 0], [7, 3.2, 4.2], 0xd2c9b6); X([-3.9, 0.5, 0], [1.2, 2.2, 3.4], 0xd2c9b6); X([-4.55, 0.7, 0], [0.12, 1.2, 2.8], 0x1a2430);   // body, cab and glass
  X([-5.2, -0.2, 0], [0.5, 4.6, 6.4], 0x3d4249); for (let k = -2; k <= 2; k++) X([-5.5, -0.2, k * 1.2], [0.2, 4.2, 0.5], 0xe8561a);   // push plate
  for (const s of [-1, 1]) { XC([2.6, 0, s * 1.4], 1.0, 3.6, 'x', 0x5a5d62); XC([4.8, 0, s * 1.4], 0.75, 1.0, 'x', 0x2b2d31, { r2: 1.0 }); }   // engines and bells
  for (const [y, z] of [[1.8, 2.3], [1.8, -2.3], [-1.8, 2.3], [-1.8, -2.3]]) { X([-1.5, y, z], [0.8, 0.5, 0.5], 0x3d4249); X([-1.5, y + Math.sign(y) * 0.3, z + Math.sign(z) * 0.3], [0.3, 0.3, 0.3], 0x2b2d31); }
  X([0.5, 1.9, 0], [3, 0.6, 2.4], 0x4a4f55); XC([1.5, 2.6, 0], 0.08, 1.6, 'y', 0x8e949a);   // spine and antenna
  for (const s of [-1, 1]) X([-1, -1.7, s * 2.2], [4, 0.4, 0.3], 0xe8561a);
  B.box([-4.62, -1.5, 1.6], [0.1, 0.4, 0.6], { kind: 'lamp', color: 0xffe6c0, k: 3 }); B.box([-4.62, -1.5, -1.6], [0.1, 0.4, 0.6], { kind: 'lamp', color: 0xffe6c0, k: 3 });
  B.box([-1, 1.65, 2.12], [0.4, 0.2, 0.06], { kind: 'lamp', color: 0x4dff9a, k: 3 }); B.box([-1, 1.65, -2.12], [0.4, 0.2, 0.06], { kind: 'lamp', color: 0xff4a2a, k: 3 });
  return B.finish();
}

// ================================================================================================================
const ROOM_NAME = ['Hangar', 'Yard counter', 'Shaft', 'Bunk room'];
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const easeIO = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

class Base {
  constructor(o) {
    Object.assign(this, o);
    this.pl = new THREE.Vector3(); this.inv = new THREE.Matrix4(); this.near = false; this.here = -1; this.time = 0;
    this.doorOpen = 1; this.doorTarget = 1; this.pres = 0; this.cycle = null;   // big door 0 shut .. 1 open; air 0 vacuum .. 1
    this.captured = false; this.capT = 0; this.capFrom = null; this.relT = 0;
    this.berths = []; this.jobs = []; this.cine = null;
    this.keel = [BAY_LEN, BAY_LEN];   // built keel length per side (-x, +x), metres from the mouth back
    this.save0 = {}; try { this.save0 = JSON.parse(localStorage.getItem(SAVE) || '{}') || {}; } catch {}
    if (this.save0.keel) this.keel = this.save0.keel.slice();
    this.keelSegs = [[], []];
    this.contMat = mats.hull;
    const { site } = this;
    // the two big door leaves stay solid wherever they are on their rails (open, they sit out past the mouth)
    this.leafObbs = this.leaves.map(() => { const mo = this.mouthObb, h = new THREE.Vector3(5.65, 5.95, 0.5); return { c: new THREE.Vector3(), q: mo.q.clone(), qi: mo.qi.clone(), h, v: new THREE.Vector3(), br: h.length(), node: mo.node, chunk: 'base', part: mo.part }; });
    this.syncLeaves();
    this.site.collectObbs = ((base) => (out) => { base(out); for (const d of Object.values(this.doors)) if (d.open < 0.55) out.push(d.obb); if (this.doorOpen < 0.5) out.push(this.mouthObb); else out.push(...this.leafObbs); })(site.collectObbs.bind(site));
    this.tug = this.buildTug();
    for (let s = 0; s < 2; s++) this.buildKeel(s, this.keel[s], false);
  }

  setRoom(i, r, g, b) { roomU.uBaseC.value[i].set(r, g, b); }
  local(wp, out = this.pl) { return out.copy(wp).applyMatrix4(this.inv.copy(this.site.group.matrixWorld).invert()); }
  world(lp, out) { return out.copy(lp).applyMatrix4(this.site.group.matrixWorld); }
  roomAt(p, m = 0.2) { for (const v of this.B.vols) if (p.x > v.min.x - m && p.x < v.max.x + m && p.y > v.min.y - m && p.y < v.max.y + m && p.z > v.min.z - m && p.z < v.max.z + m) return v.room; return -1; }
  // breathable: the shop, shaft and bunk room always; the bay once it's pressurised
  air(wp) { if (!this.near) return false; const r = this.roomAt(this.local(wp, _v2), 0.18); return r > 0 || (r === 0 && this.pres > 0.98); }
  clampCam(pilotWp, want) {
    if (!this.near) return;
    const a = this.local(pilotWp, _v).clone(), pr = this.roomAt(a, 0.1); if (pr < 0) return;
    if (pr === 0 && this.doorOpen > 0.3) return;   // bay open to space: the camera may look in from outside
    const b = this.local(want, _v2).clone();
    for (let k = 0; k <= 10; k++) { const t = 1 - k / 10; const c = _v.lerpVectors(a, b, t); if (this.roomAt(c, -0.3) >= 0 || k === 10) { if (k) want.copy(c).applyMatrix4(this.site.group.matrixWorld); return; } }
  }

  // jet pose on the cradle, in world space (nose out of the mouth)
  cradlePose(outP, outQ) {
    this.world(CRADLE, outP);
    outQ.copy(this.site.group.quaternion).multiply(_q2.setFromAxisAngle(_v3.set(0, 1, 0), Math.PI));
  }
  get forward() { return _v3.set(0, 0, 1).applyQuaternion(this.site.group.quaternion); }

  // autopilot target: line up on the lane in front of the mouth, then in to the cradle
  approach(shipPos, out) {
    const l = this.local(shipPos, _v);
    const inLane = l.z > 12 && Math.abs(l.x) < 9 && Math.abs(l.y - 0) < 6;
    if (this.roomAt(l, 0) === 0 || (inLane && l.z < 70)) return this.world(CRADLE, out);
    return this.world(_v2.set(0, -1, 60), out);
  }

  // ---- the jet on the cradle --------------------------------------------------------------------------------
  // runs after the jet's physics step. Captures a slow jet over the pad, holds it there, lets go on thrust.
  hold(dt, ship, cmd, evaActive) {
    const l = this.local(ship.pos, _v);
    if (!this.captured) {
      this.relT += dt;
      const d = l.distanceTo(CRADLE);
      if (d < 5.2 && ship.vel.length() < 4.5 && this.relT > 2.5) { this.captured = true; this.capT = 0; this.capFrom = { p: ship.pos.clone(), q: ship.quat.clone() }; this.sound?.hook?.(); this.rig?.kick(0.1); this.onCapture?.(true); }
      return;
    }
    this.cradlePose(_v2, _q);
    this.capT = Math.min(1, this.capT + dt / 1.4); const e = ease(this.capT);
    ship.pos.lerpVectors(this.capFrom.p, _v2, e); ship.quat.slerpQuaternions(this.capFrom.q, _q, e);
    ship.vel.set(0, 0, 0); ship.angVel.set(0, 0, 0);
    const go = !evaActive && this.capT >= 1 && !this.cine && (Math.abs(cmd.fwd) > 0.5 || Math.abs(cmd.vert) > 0.5 || Math.abs(cmd.strafe) > 0.5);
    if (go && this.doorOpen > 0.98) { this.release(ship); }
    else if (go) this.wantOut = true;
  }
  release(ship) {
    this.captured = false; this.relT = 0; this.wantOut = false;
    ship.vel.copy(this.forward).multiplyScalar(2.5); this.sound?.snap?.(); this.onCapture?.(false);
  }
  // put the jet straight on the cradle (respawn, load)
  snap(ship) { this.cradlePose(ship.pos, ship.quat); ship.vel.set(0, 0, 0); ship.angVel.set(0, 0, 0); this.captured = true; this.capT = 1; this.capFrom = { p: ship.pos.clone(), q: ship.quat.clone() }; this.relT = 0; }

  // ---- per frame ----------------------------------------------------------------------------------------------
  update(dt, time, camPos, eva, ship) {
    this.time = time; const S = this.site;
    const dist = camPos.distanceTo(S.pos), pilot = eva.state === 'eva' ? eva.pilot.pos : null;
    this.near = dist < 260 || (pilot && pilot.distanceTo(S.pos) < 260) || false;
    this.inner.visible = this.near || dist < 700;
    const p = pilot ? this.local(pilot, this.pl) : null;
    this.here = p ? this.roomAt(p, 0.15) : -1;
    // stepping out of the jet on the cradle: the hatch leaves you on the spine behind the canopy with the tail fin
    // and engines between you and the shop door. Lift clear of the hull and drift toward the door instead.
    const isEva = eva.state === 'eva';
    if (isEva && !this.wasEva && this.captured && p && this.roomAt(p, 0.6) === 0) {
      const lp = this.local(eva.pilot.pos, _v).clone(); lp.y = Math.max(lp.y, -0.2); lp.x *= 0.3;
      this.world(lp, eva.pilot.pos);
      eva.pilot.vel.copy(ship.vel).add(_v2.set(0, 0, -0.5).applyQuaternion(this.site.group.quaternion));
    }
    this.wasEva = isEva;
    this.pressure(dt, eva, p);
    this.innerDoors(dt, p);
    // the cradle: clamps up and the umbilical over while the jet sits there
    const cl = this.captured ? ease(Math.min(1, this.capT * 1.4 - 0.3)) : 0;
    this.clampK = THREE.MathUtils.damp(this.clampK || 0, cl, 6, dt);
    for (const c of this.clamps) c.rotation.z = -c.userData.s * (1 - this.clampK) * 1.3 + c.userData.s * 0.1 * this.clampK;
    this.umb.rotation.y = THREE.MathUtils.damp(this.umb.rotation.y, this.captured ? -0.42 : 0.9, 3, dt);
    // approach lane: lights chase in toward the mouth (amber while the doors are shut, green when you're cleared)
    const ok = this.doorOpen > 0.98, cA = this.laneMesh.geometry.attributes.color, n = this.laneIdx.length;
    if (dist < 1500) {
      for (let i = 0; i < n; i++) { const k = this.laneIdx[i], ph = ((time * 1.4 - (7 - k) * 0.14) % 1 + 1) % 1, v = 0.15 + 2.6 * Math.max(0, 1 - ph * 5); cA.setXYZ(i, ok ? 0.25 * v : 1.6 * v, ok ? 1.5 * v : 0.6 * v, ok ? 0.6 * v : 0.12 * v); }
      cA.needsUpdate = true;
    }
    this.beaconM.color.setScalar((time % 1.6) < 0.1 ? 3 : 0.08);
    this.crane.position.z = -8 + Math.sin(time * 0.17) * 6; this.crane.position.x = Math.sin(time * 0.11) * 3;
    this.M.screen.map.offset.y = (time * 0.05) % 1;
    // rooms: the bay light follows the air (amber strobe while cycling); the rest are steady
    const cyc = this.cycle, strobe = cyc ? ((time * 3) % 1 < 0.5 ? 1.25 : 0.55) : 1;
    if (cyc) this.setRoom(0, 1.3 * strobe, 0.75 * strobe, 0.35 * strobe);
    else if (this.pres > 0.98) this.setRoom(0, 1, 1, 1);
    else this.setRoom(0, 0.82, 0.8, 0.86);
    this.setRoom(1, 1, 1, 1); this.setRoom(2, 1, 1, 1); this.setRoom(3, 1, 0.98, 0.95);
    for (const lf of this.leaves) lf.userData.lamp.color.setRGB(cyc ? 2.4 * strobe : this.pres > 0.98 ? 0.3 : 2.2, cyc ? 1.1 * strobe : this.pres > 0.98 ? 1.8 : 0.9, cyc ? 0.2 : 0.4);
    this.berthsUpdate(dt, time);
    this.jobsUpdate(dt, time);
  }

  // The big door and the bay's air. Shut and fill when you climb out on the cradle; vent and open when you're back
  // in the seat (or anyone outside wants in). The shop door only opens on air.
  pressure(dt, eva, p) {
    const inBay = p && this.roomAt(p, 0.6) === 0;
    const wantClosed = this.captured && eva.active && (eva.state !== 'eva' || inBay || this.here > 0) && !this.cine?.keepOpen;
    const prev = this.doorOpen;
    if (wantClosed) {
      if (this.pres < 1 && this.doorOpen <= 0) { if (!this.cycle) { this.cycle = { fill: true, t: 0 }; this.sound?.noise?.(3.2, 'highpass', 2600, 0.12); } }
      else if (this.pres <= 0) this.doorTarget = 0;
    } else {
      if (this.pres > 0 && this.doorOpen <= 0) { if (!this.cycle) { this.cycle = { fill: false, t: 0 }; this.sound?.noise?.(2.2, 'highpass', 1800, 0.14); } }
      else if (this.pres <= 0) this.doorTarget = 1;
    }
    if (this.cycle) {
      const c = this.cycle; c.t += dt; this.doorTarget = 0;
      this.pres = THREE.MathUtils.clamp(c.fill ? c.t / 3.2 : 1 - c.t / 2.2, 0, 1);
      if ((c.fill && this.pres >= 1) || (!c.fill && this.pres <= 0)) { this.cycle = null; this.sound?.tonePing?.(c.fill ? 760 : 520, 0.35, 0.1, 'sine'); }
      // gas jets from the wall vents
      if (this.fx && (this._acc = (this._acc || 0) + dt * 70) > 1) {
        const gw = this.site.group.matrixWorld;
        while (this._acc > 1) { this._acc--; const s = Math.random() < 0.5 ? -1 : 1; _v.set(s * 14.5, 6 + Math.random(), -14 + Math.random() * 28).applyMatrix4(gw); _v2.set(-s * (1 + Math.random()), -0.5 - Math.random(), (Math.random() - 0.5)).transformDirection(gw).multiplyScalar(c.fill ? 2.2 : 3.4); this.fx.emit(_v, _v2, this.getFxT(), 0.8 + Math.random() * 0.6, 0.08, 0.6, K.RCS, 1.2, 0); }
      }
    }
    const sp = 0.32;
    this.doorOpen += Math.sign(this.doorTarget - this.doorOpen) * Math.min(Math.abs(this.doorTarget - this.doorOpen), sp * dt);
    if ((prev < 0.5) !== (this.doorOpen < 0.5)) this.site.world.dirty = true;
    if (prev !== this.doorOpen && (prev === 0 || prev === 1)) { this.sound?.noise?.(3.0, 'lowpass', 160, 0.3); this.rig?.kick(0.05); }
    if (prev !== this.doorOpen && (this.doorOpen === 0 || this.doorOpen === 1)) { this.sound?.hit?.(4); this.rig?.kick(0.12); }
    const e = easeIO(this.doorOpen);
    this.leaves[0].position.x = -5.65 - e * 11.6; this.leaves[1].position.x = 5.65 + e * 11.6; this.syncLeaves();
    if (this.wantOut && this.doorOpen > 0.98 && this.shipRef) this.release(this.shipRef);
  }
  syncLeaves() {
    this.site.group.updateMatrixWorld();
    this.leaves.forEach((lf, i) => { const o = this.leafObbs[i]; o.c.copy(lf.position).setZ(lf.position.z + 0.25).applyMatrix4(this.site.group.matrixWorld); });
  }
  innerDoors(dt, p) {
    for (const d of Object.values(this.doors)) {
      d.target = p && this.pres > 0.98 && p.distanceToSquared(d.lc) < 3.8 * 3.8 ? 1 : 0;
      const prev = d.open;
      d.open += Math.sign(d.target - d.open) * Math.min(Math.abs(d.target - d.open), 2.6 * dt);
      if (prev !== d.open && (prev < 0.55) !== (d.open < 0.55)) this.site.world.dirty = true;
      if (prev === 0 && d.open > 0) this.sound?.noise?.(0.45, 'lowpass', 550, 0.1);
      const off = d.open * (DW / 2 + 0.02);
      for (const m of d.leaves) { const s = m.userData.side, u = d.u + s * (DW / 4 + 0.0075) + s * off; if (d.axis === 'z') m.position.set(u, d.v, d.at); else m.position.set(d.at, d.v, u); m.visible = d.open < 0.995; }
    }
  }

  status(eva, touch) {
    const k = (a, b) => (touch ? b : a);
    if (this.cine) return '';
    if (eva.state !== 'eva') {
      if (this.captured && !eva.active) return this.doorOpen < 0.98 ? `<b>Hangar</b> Doors opening` : `<b>Docked</b> ${k('Press G', 'Tap Hatch')} to get out and see Ilse at the counter · thrust to launch`;
      return '';
    }
    const h = this.here;
    if (h < 0) return '';
    if (this.cycle && h === 0) return `<b>${this.cycle.fill ? 'Pressurising' : 'Venting'}</b> hangar · hold on`;
    if (h === 0) return this.pres > 0.98 ? '<b>Hangar</b> Air in · the yard counter is through the back door' : '<b>Hangar</b> Doors closing, then air';
    if (this.nearCounter) return `<b>Ilse Marrow</b> ${k('Press G', 'Tap Hatch')} to talk`;
    if (this.nearBed) return `<b>Bunk</b> ${k('Press G', 'Tap Hatch')} to strap in and sleep`;
    if (h === 1) return '<b>Yard counter</b> Ilse is behind the counter · the bunk room is up the shaft';
    if (h === 2) return '<b>Shaft</b> Pull yourself up the rungs';
    if (h === 3) return '<b>Bunk room</b> Your bunk is on the far wall';
    return '';
  }

  // ---- keel and berths ------------------------------------------------------------------------------------------
  // side index 0 = -x, 1 = +x
  sideSign(si) { return si ? 1 : -1; }
  buildKeel(si, len, animate) {
    // extra keel past the bay: 12 m truss segments
    const segs = this.keelSegs[si], s = this.sideSign(si), need = Math.max(0, Math.ceil((len - BAY_LEN) / 12));
    while (segs.length < need) {
      const i = segs.length, B = new Bake(), X = (c, sz, col) => B.box(c, sz, { kind: 'hull', color: col, seg: 3 });
      X([0, 7.4, -6], [1.6, 1.6, 12.2], 0x3d4249); X([0, -5.4, -6], [1.6, 1.6, 12.2], 0x3d4249); X([0, 1, -12], [1.0, 12, 1.0], 0x6b6e70);
      B.geo(strut([0, -4.6, 0], [0, 6.6, -12], 0.5), { kind: 'hull', color: 0x6b6e70 });
      B.box([0, 8.3, -11.5], [0.3, 0.2, 0.3], { kind: 'lamp', color: 0xffa040, k: 3 });
      const g = B.finish(), grp = new THREE.Group(); const m = new THREE.Mesh(g.hull, mats.hull); m.castShadow = m.receiveShadow = true; grp.add(m, new THREE.Mesh(g.lamp, this.M.lamp));
      const z1 = KEEL_Z0 - BAY_LEN - i * 12;
      grp.position.set(s * KEEL_X, 0, z1); grp.userData = { z1, from: z1 + 12 }; this.outer.add(grp);
      const col = new THREE.Group(); col.position.copy(grp.position); this.site.group.add(col); col.updateMatrixWorld(true);
      const part = new this.Part(this.site, `keel${si}_${i}`, col, [{ c: [0, 7.4, -6], q: [0, 0, 0, 1], h: [0.8, 0.8, 6.1] }, { c: [0, -5.4, -6], q: [0, 0, 0, 1], h: [0.8, 0.8, 6.1] }, { c: [0, 1, -12], q: [0, 0, 0, 1], h: [0.5, 6, 0.5] }]);
      part.sync(0); grp.userData.part = part;
      if (animate) { grp.position.z = grp.userData.from; grp.visible = true; grp.userData.t = 0; } else { this.site.parts.push(part); }
      segs.push(grp);
    }
    this.site.world.dirty = true; this.resetMesh();
  }
  resetMesh() { this.eva?.meshHit?.cache?.delete(this.site); }

  // where a ship of this size goes: the side with less keel used, first gap that fits
  slotFor(spec) {
    const W = Math.max(14, spec.beam + 12);
    const used = [0, 1].map((si) => this.berths.filter((b) => b.side === si).reduce((m, b) => Math.max(m, b.z0 + b.W), 0));
    const si = used[0] <= used[1] ? 0 : 1;
    return { side: si, z0: used[si], W };
  }
  berthDims(spec) {
    const len = spec.len + 14, W = Math.max(14, spec.beam + 12), H = Math.max(13, spec.height + 10);
    const n = Math.max(2, Math.min(12, Math.ceil(len / 16)));
    return { len, W, H, n, Ls: len / n };
  }

  // build a berth's meshes (hidden until it deploys)
  makeBerth(rec) {
    const spec = rec.spec, d = this.berthDims(spec), s = this.sideSign(rec.side);
    const zc = KEEL_Z0 - rec.z0 - d.W / 2;
    const grp = new THREE.Group(); grp.position.set(s * (KEEL_X + 0.8), 1, zc); if (s < 0) grp.rotation.y = Math.PI; this.outer.add(grp);
    const b = { ...rec, ...d, grp, zc, segs: [], root: null, k: 0, state: 'hidden' };
    // root: hinged panels
    const rp = rootPanels(d.W + (d.n - 1) * 0.9, d.H + (d.n - 1) * 0.9, d.Ls);
    const W0 = d.W + (d.n - 1) * 0.9, H0 = d.H + (d.n - 1) * 0.9;
    const hinge = (geo, pos) => { const piv = new THREE.Group(); piv.position.set(...pos); grp.add(piv); const m = new THREE.Mesh(geo, mats.hull); m.castShadow = m.receiveShadow = true; piv.add(m); return { piv, m }; };
    const fl = hinge(rp.floor, [0, -H0 / 2, 0]), rf = hinge(rp.roof, [0, H0 / 2, 0]), sa = hinge(rp.sideA, [0, 0, -W0 / 2]), sb = hinge(rp.sideB, [0, 0, W0 / 2]);
    b.root = { fl, rf, sa, sb };
    // back plate on the keel (always there once the berth exists)
    { const Bk = new Bake(); Bk.box([0.4, 0, 0], [0.8, H0 + 0.6, W0 + 0.6], { kind: 'hull', color: 0x5a5d62, seg: 4 }); Bk.box([0.82, 0, 0], [0.06, H0 - 1, W0 - 1], { kind: 'hull', color: 0x23262b, seg: 4 });
      for (let k = -2; k <= 2; k++) Bk.box([0.9, H0 / 2 - 1, k * W0 / 6], [0.08, 0.3, 1.2], { kind: 'lamp', color: 0xffa040, k: 2.6 });
      const g = Bk.finish(); const m = new THREE.Mesh(g.hull, mats.hull); m.castShadow = true; grp.add(m); grp.add(new THREE.Mesh(g.lamp, this.M.lamp)); b.plate = m; }
    // telescoping sections, nested: section i is (n-1-i)*0.9 m smaller than the root
    for (let i = 1; i < d.n; i++) {
      const shrink = (d.n - 1 - i) * 0.9, { G } = berthGeometry(d.W + shrink, d.H + shrink, d.Ls, i, i === d.n - 1);
      const sg = new THREE.Group(); const m = new THREE.Mesh(G.hull, mats.hull); m.castShadow = m.receiveShadow = true; sg.add(m);
      const lm = new THREE.Mesh(G.lamp, this.M.lamp.clone()); lm.material.color.setScalar(0); sg.add(lm); sg.userData.lamp = lm.material;
      grp.add(sg); b.segs.push(sg);
    }
    this.berths.push(b);
    return b;
  }
  // pose a berth at deploy progress k (0 folded on the keel .. 1 fully out). Unfold takes the first 30%.
  poseBerth(b, k) {
    b.k = k; const u = ease(THREE.MathUtils.clamp(k / 0.3, 0, 1)), R = b.root;
    const fold = (1 - u) * Math.PI / 2;
    R.fl.piv.rotation.z = fold; R.rf.piv.rotation.z = -fold; R.sa.piv.rotation.y = -fold; R.sb.piv.rotation.y = fold;
    // panels sit flat against the keel while folded
    const vis = k > 0; b.grp.visible = vis;
    const tk = THREE.MathUtils.clamp((k - 0.3) / 0.7, 0, 1), n = b.segs.length;
    b.segs.forEach((sg, i) => {
      // each section starts nested in the root; the outermost slides first and farthest (staged)
      const j = n - 1 - i, t0 = j / n, local = ease(THREE.MathUtils.clamp((tk - t0 * 0.6) / 0.4 + 0, 0, 1));
      const final = (i + 1) * b.Ls, start = 0.02 * (i + 1);
      sg.position.x = start + (final - start) * Math.max(local, tk >= 1 ? 1 : 0) * (i === n - 1 ? 1 : 1);
      sg.visible = vis && u > 0.95;
      sg.userData.lamp.color.setScalar(THREE.MathUtils.clamp((k - 0.92) / 0.08, 0, 1) * (0.7 + 0.3 * Math.sin(this.time * 2 + i)));
    });
  }
  // colliders for a deployed berth, in the base frame
  berthCollide(b, on) {
    if (b.part) { const i = this.site.parts.indexOf(b.part); if (i >= 0) this.site.parts.splice(i, 1); b.part = null; }
    if (on) {
      const node = new THREE.Group(); node.position.copy(b.grp.position); node.quaternion.copy(b.grp.quaternion); this.site.group.add(node); node.updateMatrixWorld(true);
      const obbs = [];
      const W0 = b.W + (b.n - 1) * 0.9, H0 = b.H + (b.n - 1) * 0.9;
      obbs.push({ c: [0.4, 0, 0], q: [0, 0, 0, 1], h: [0.45, H0 / 2, W0 / 2] });
      obbs.push({ c: [b.Ls / 2, -H0 / 2, 0], q: [0, 0, 0, 1], h: [b.Ls / 2, 0.6, W0 / 2] }, { c: [b.Ls / 2, H0 / 2, 0], q: [0, 0, 0, 1], h: [b.Ls / 2, 0.6, W0 / 2] }, { c: [b.Ls / 2, 0, -W0 / 2], q: [0, 0, 0, 1], h: [b.Ls / 2, H0 / 2, 0.6] }, { c: [b.Ls / 2, 0, W0 / 2], q: [0, 0, 0, 1], h: [b.Ls / 2, H0 / 2, 0.6] });
      b.segs.forEach((sg, i) => {
        const shrink = (b.n - 2 - i) * 0.9, W = b.W + shrink, H = b.H + shrink, x = sg.position.x;
        obbs.push({ c: [x + b.Ls / 2, -H / 2, 0], q: [0, 0, 0, 1], h: [b.Ls / 2, 0.65, W / 2 + 0.4] }, { c: [x + b.Ls / 2, H / 2, 0], q: [0, 0, 0, 1], h: [b.Ls / 2, 0.65, W / 2 + 0.4] });
        obbs.push({ c: [x + b.Ls / 2, 0, -W / 2], q: [0, 0, 0, 1], h: [b.Ls / 2, H / 2, 0.65] }, { c: [x + b.Ls / 2, 0, W / 2], q: [0, 0, 0, 1], h: [b.Ls / 2, H / 2, 0.65] });
      });
      b.part = new this.Part(this.site, 'berth-' + b.id, node, obbs); b.part.sync(0); this.site.parts.push(b.part); b.colNode = node;
    }
    this.site.world.dirty = true; this.resetMesh();
  }
  // where the ship sits in its berth (world pose). Nose out of the open end.
  berthPose(b, spec, outP, outQ) {
    const d = this.fleet?.byId?.[spec.id]?.d;
    const cx = d ? (d.min[0] + d.max[0]) / 2 : 0, cy = d ? (d.min[1] + d.max[1]) / 2 : 0, cz = d ? (d.min[2] + d.max[2]) / 2 : 0;
    // ship space: nose -z. Berth: +x outward. So ship -z -> berth +x: rotate the ship +90 deg about y.
    _q.setFromAxisAngle(_v3.set(0, 1, 0), Math.PI / 2);
    const off = _v.set(cx, cy, cz).applyQuaternion(_q);
    const mid = _v2.set(0.9 + b.len / 2, 0, 0).sub(off);
    b.grp.updateMatrixWorld(true);
    outP.copy(mid).applyMatrix4(b.grp.matrixWorld);
    b.grp.getWorldQuaternion(outQ).multiply(_q);
  }
  berthsUpdate(dt, time) {
    for (const b of this.berths) if (b.state === 'ready') b.segs.forEach((sg, i) => sg.userData.lamp.color.setScalar(0.75 + 0.25 * Math.sin(time * 1.3 + i * 0.7)));
    for (let si = 0; si < 2; si++) for (const g of this.keelSegs[si]) if (g.userData.t !== undefined) {
      g.userData.t = Math.min(1, g.userData.t + dt / 1.6); const e = easeIO(g.userData.t);
      g.position.z = g.userData.from + (g.userData.z1 - g.userData.from) * e;
      if (g.userData.t >= 1) { delete g.userData.t; this.site.parts.push(g.userData.part); this.site.world.dirty = true; this.clunk(g.getWorldPosition(_v)); }
    }
  }
  clunk(p) {
    this.sound?.hit?.(9); this.rig?.kick(0.08);
    if (this.fx) { const t = this.getFxT(); for (let i = 0; i < 26; i++) this.fx.emit(p, _v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14), t, 0.3 + Math.random() * 0.5, 0.03, 0.02, K.SPARK, 0.6, 0.04); for (let i = 0; i < 12; i++) this.fx.emit(p, _v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(3), t, 0.9 + Math.random() * 0.6, 0.15, 1.1, K.RCS, 1.0, 0); }
  }

  // ---- tug ----
  buildTug() {
    const g = tugGeometry(), grp = new THREE.Group(); grp.name = 'tug';
    const m = new THREE.Mesh(g.hull, mats.hull); m.castShadow = m.receiveShadow = true; grp.add(m); grp.add(new THREE.Mesh(g.lamp, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })));
    const glowM = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.8, 0.35), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    for (const s of [-1, 1]) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4.5, 14, 1, true).rotateZ(Math.PI / 2).translate(7.6, 0, s * 1.4), glowM); grp.add(c); }
    grp.userData.glow = glowM; grp.visible = false; this.site.group.add(grp);
    return grp;
  }

  // ---- jobs: deliveries, claims, sales. One at a time, each a timeline the cinematic camera follows. ----------
  busy() { return this.jobs.length > 0; }
  queue(job) { this.jobs.push(job); }
  jobsUpdate(dt, time) {
    const J = this.jobs[0]; if (!J) return;
    J.t = (J.t || 0) + dt * (J.speed || 1);
    if (!J.started) { J.started = true; J.start?.(J); }
    J.step(J, dt, time);
    if (J.done) { this.jobs.shift(); J.finish?.(J); this.cine = null; this.onCine?.(false); }
  }
}

export { Base, berthGeometry, containerParts, ROOM_NAME };
