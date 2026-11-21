import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { K } from './gpufx.js';
import { Bake, T, floorTexture, screenTexture, ledTexture } from './bake.js';

// The Ironwake's walkable decks, built in code like Kestrel Relay (bake.js): a hangar bay open to space on the
// starboard flank, a cycling airlock, a corridor to a junction (crew mess one way, engineering the other), a
// 68 m lift shaft up through the dorsal tower, and the bridge with its helm. Ship space: nose -z, up +y.
// The numbers match ROOMS in tools/blender/fleet.py, which keeps the hull's colliders out of these rooms.
//
// Dark for decades: emergency red until the reactor is brought back from the helm, then the lights come up.

const C = { bone: 0xcfc8b8, slate: 0x4a525c, dark: 0x1c1e22, orange: 0xe8561a, teal: 0x2f6f73, rust: 0x7a4a30, steel: 0x8e949a, cream: 0xe2dccc, olive: 0x5d6150 };
const L = { cool: 0xd6ecff, warm: 0xffd9a8, amber: 0xffa040, red: 0xff4a2a, green: 0x4dff9a, cyan: 0x50e0ff };
const DW = 2.2, DH = 2.4;
const rect = (u, v, w = DW, h = DH) => [u - w / 2, u + w / 2, v - h / 2, v + h / 2];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
let sd = 41; const rnd = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
const rr = (a, b) => a + rnd() * (b - a);

export const HELM = { seat: new THREE.Vector3(0, 58.0, -467.6), eye: new THREE.Vector3(0, 59.15, -467.85), board: new THREE.Vector3(0, 58.6, -467.0) };
export const BAY_DOCK = new THREE.Vector3(46, -14.55, -440);

// per-room colour multipliers (own uniform array, so the relay's rooms and these never fight)
const roomU = { uIwC: { value: Array.from({ length: 16 }, () => new THREE.Vector3(1, 1, 1)) } };
function patch(m, grime = 0) {
  m.onBeforeCompile = (s) => {
    s.uniforms.uIwC = roomU.uIwC;
    s.vertexShader = 'attribute float aRoom;\nuniform vec3 uIwC[16];\nvarying vec3 vIwP;\n' + s.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_COLOR\nvColor.rgb *= uIwC[int(aRoom + 0.5)];\n#endif\nvIwP = position;');
    if (grime) {
      // break up the repeat: big soft stains, water streaks running down, and a per-plate tone shift, all from
      // the surface position so no two stretches of wall match
      s.fragmentShader = 'varying vec3 vIwP;\nfloat iwH(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }\nfloat iwN(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);\n return mix(mix(mix(iwH(i), iwH(i + vec3(1,0,0)), f.x), mix(iwH(i + vec3(0,1,0)), iwH(i + vec3(1,1,0)), f.x), f.y), mix(mix(iwH(i + vec3(0,0,1)), iwH(i + vec3(1,0,1)), f.x), mix(iwH(i + vec3(0,1,1)), iwH(i + vec3(1,1,1)), f.x), f.y), f.z); }\n' + s.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  { vec3 q = vIwP; float big = iwN(q * 0.09) * 0.6 + iwN(q * 0.27) * 0.4;
    float streak = iwN(vec3(q.x * 1.7 + q.z * 1.7, q.y * 0.08, 0.)) ; streak = smoothstep(0.62, 0.95, streak) * smoothstep(0.2, 0.7, iwN(q * 0.05 + 3.));
    float plate = iwH(floor(q / vec3(3.0, 1.5, 3.0)) + 7.) ;
    float k = mix(0.78, 1.08, big) * mix(0.93, 1.05, plate) * (1. - 0.28 * streak * ${grime.toFixed(2)});
    diffuseColor.rgb *= k; diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.08, 0.86, 0.7), 0.35 * streak * ${grime.toFixed(2)}); }`);
    }
  };
  m.customProgramCacheKey = () => 'ironwakeroom' + grime;
  return m;
}

// the carrier's own plating: big riveted plates of mixed sizes between heavy frames, stencils, wear. One
// texture covers a 6 m square of wall (the bake's UVs are 2 m per unit), so the seams don't march in a grid.
function hullPlateTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
  let r = 7; const R = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  x.fillStyle = '#c9c3b4'; x.fillRect(0, 0, 512, 512);
  // plates: split the square into rows of uneven plates
  const rows = [0, 118, 196, 330, 512];
  for (let i = 0; i < rows.length - 1; i++) {
    let px = 0; const y0 = rows[i], y1 = rows[i + 1];
    while (px < 512) {
      const w = Math.min(512 - px, 90 + R() * 180), t = 0.9 + R() * 0.16;
      x.fillStyle = `rgb(${201 * t | 0},${195 * t | 0},${180 * t | 0})`; x.fillRect(px, y0, w, y1 - y0);
      x.strokeStyle = 'rgba(28,26,22,.75)'; x.lineWidth = 2.5; x.strokeRect(px + 1, y0 + 1, w - 2, y1 - y0 - 2);
      x.strokeStyle = 'rgba(255,250,240,.18)'; x.lineWidth = 1; x.strokeRect(px + 3, y0 + 3, w - 6, y1 - y0 - 6);
      x.fillStyle = 'rgba(30,28,24,.5)';
      for (let rx = px + 8; rx < px + w - 4; rx += 22) for (const ry of [y0 + 7, y1 - 7]) { x.beginPath(); x.arc(rx, ry, 1.8, 0, 7); x.fill(); }
      px += w;
    }
  }
  // heavy frames: one vertical rib and a horizontal stringer
  x.fillStyle = '#6b6a66'; x.fillRect(250, 0, 22, 512); x.fillStyle = 'rgba(255,255,255,.15)'; x.fillRect(250, 0, 3, 512); x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(269, 0, 3, 512);
  x.fillStyle = '#74726c'; x.fillRect(0, 322, 512, 14); x.fillStyle = 'rgba(0,0,0,.3)'; x.fillRect(0, 333, 512, 3);
  // stencil: frame number and a hazard chevron strip low on the wall
  x.fillStyle = 'rgba(40,36,30,.55)'; x.font = 'bold 34px Arial Narrow, Arial, sans-serif'; x.fillText('FR 41', 290, 380); x.font = 'bold 14px Arial, sans-serif'; x.fillText('NO STEP · HULL 7', 290, 400);
  for (let i = 0; i < 26; i++) { x.fillStyle = i % 2 ? 'rgba(20,18,16,.75)' : 'rgba(214,98,32,.85)'; x.beginPath(); x.moveTo(i * 20, 512); x.lineTo(i * 20 + 20, 512); x.lineTo(i * 20 + 34, 486); x.lineTo(i * 20 + 14, 486); x.fill(); }
  // grime and scuffs
  for (let i = 0; i < 3000; i++) { x.fillStyle = `rgba(${R() < 0.6 ? '40,36,30' : '255,250,240'},${R() * 0.06})`; x.fillRect(R() * 512, R() * 512, 1 + R() * 4, 1 + R() * 3); }
  for (let i = 0; i < 24; i++) { const gx = R() * 512, gy = R() * 300, g = x.createLinearGradient(gx, gy, gx, gy + 200); g.addColorStop(0, 'rgba(90,60,36,.0)'); g.addColorStop(0.2, `rgba(90,60,36,${0.12 + R() * 0.2})`); g.addColorStop(1, 'rgba(90,60,36,0)'); x.fillStyle = g; x.fillRect(gx, gy, 2 + R() * 5, 200); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 3, 1 / 3); t.anisotropy = 4;
  return t;
}

export function buildIronwake(site, { Part }) {
  const B = new Bake();
  const R_ = (id, c, s, o) => B.room(id, c, s, o);
  const BAY = R_('bay', [52.5, 0, -440], [45, 32, 60], { amb: [0.06, 0.055, 0.05], tint: [0.74, 0.72, 0.68] });
  const AL = R_('al', [27.55, -13, -440], [4.2, 3.6, 3.6], { amb: [0.06, 0.06, 0.06], tint: [0.78, 0.78, 0.76] });
  const CA = R_('ca', [15.225, -13, -440], [19.75, 3, 3], { amb: [0.05, 0.05, 0.05], tint: [0.8, 0.79, 0.76] });
  const J = R_('j', [0, -13, -440], [10, 4, 10], { amb: [0.06, 0.06, 0.07], tint: [0.8, 0.82, 0.84] });
  const MS = R_('mess', [0, -12.5, -427.65], [14, 6, 14], { amb: [0.06, 0.06, 0.05], tint: [0.86, 0.8, 0.7] });
  const EN = R_('eng', [0, -12.5, -452.35], [16, 6, 14], { amb: [0.05, 0.06, 0.07], tint: [0.74, 0.8, 0.84] });
  const SH = R_('shaft', [0, 23.5, -440], [3.4, 68.3, 3.4], { amb: [0.05, 0.05, 0.05], tint: [0.78, 0.78, 0.78] });
  const LO = R_('lobby', [0, 60, -440], [8, 4, 8], { amb: [0.06, 0.06, 0.07], tint: [0.8, 0.82, 0.84] });
  const BC = R_('bc', [0, 60, -449.35], [3, 3, 10], { amb: [0.05, 0.05, 0.05], tint: [0.8, 0.8, 0.78] });
  const BR = R_('bridge', [0, 61, -464.7], [28, 8, 20], { amb: [0.06, 0.065, 0.075], tint: [0.78, 0.8, 0.82] });
  const ROOMS = [BAY, AL, CA, J, MS, EN, SH, LO, BC, BR];

  // ---- lights (baked; the room uniforms dim and colour them at run time) ----
  const lit = (R, pts, col, i, r, reach = []) => { for (const p of pts) B.light(R.idx, p, new THREE.Color(col).toArray(), i, r, reach); };
  for (const z of [-462, -440, -418]) for (const y of [14, -6]) lit(BAY, [[34, y, z]], L.amber, 1.6, 30, [1]);
  lit(BAY, [[60, 15, -455], [60, 15, -425]], L.cool, 1.0, 26);
  lit(AL, [[27.55, -11.4, -440]], L.cool, 1.4, 5, [2]);
  for (let x = 8; x < 25; x += 4) B.light(CA.idx, [x, -11.7, -440], new THREE.Color(L.warm).toArray(), 1.0, 5.5, [1, 3]);
  lit(J, [[0, -11.2, -440]], L.cool, 1.6, 9, [2, 4, 5, 6]);
  lit(MS, [[-3.5, -9.8, -431], [3.5, -9.8, -431], [-3.5, -9.8, -424], [3.5, -9.8, -424]], L.warm, 1.3, 9, [3]);
  lit(EN, [[-4, -9.8, -449], [4, -9.8, -449], [-4, -9.8, -456], [4, -9.8, -456]], L.cool, 1.2, 9, [3]);
  for (let y = -6; y < 56; y += 6) B.light(SH.idx, [0, y, -440], new THREE.Color(L.cool).toArray(), 0.9, 5, [3, 7]);
  lit(LO, [[0, 61.7, -440]], L.cool, 1.4, 7, [6, 8]);
  lit(BC, [[0, 61.3, -447], [0, 61.3, -452]], L.warm, 1.0, 5, [7, 9]);
  lit(BR, [[-7, 64.6, -460], [7, 64.6, -460], [-7, 64.6, -470], [7, 64.6, -470], [0, 64.6, -465]], L.cool, 1.25, 13);
  lit(BR, [[0, 58, -472]], L.cyan, 0.9, 6);

  // ---- shells ----
  const holes = new Map();
  const H = (R, key, r, extra = {}) => { const k = R.idx + key; if (!holes.has(k)) holes.set(k, []); holes.get(k).push(Object.assign([...r], extra)); };
  const plane = (R, key) => { const a = 'xyz'.indexOf(key[0]), s = key[1] === '+' ? 1 : -1; return R.c.getComponent(a) + s * (R.s.getComponent(a) / 2 + T / 2); };
  const tunnel = (R, key, r) => {
    const ax = key[0], at = plane(R, key), a = T / 2 + 0.03;
    if (ax === 'z') B.tunnel([r[0], r[2], at - a], [r[1], r[3], at + a], R.idx); else if (ax === 'x') B.tunnel([at - a, r[2], r[0]], [at + a, r[3], r[1]], R.idx); else B.tunnel([r[0], at - a, r[2]], [r[1], at + a, r[3]], R.idx);
  };
  const doors = {}, windows = [];
  const door = (id, R, key, u, v, other, kind = 'int') => { const r = rect(u, v); H(R, key, r); tunnel(R, key, r); doors[id] = { id, R, other, axis: key[0], at: plane(R, key), u, v, kind }; };
  const hole = (R, key, r) => { H(R, key, r); tunnel(R, key, r); };
  const win = (R, key, r, tint = 0x9cc8ff) => { H(R, key, r, { g: 1 }); tunnel(R, key, r); windows.push({ R, key, r, at: plane(R, key), tint }); };

  door('alOut', BAY, 'x-', -440, -13, AL, 'outer'); door('alIn', AL, 'x-', -440, -13, CA, 'inner');
  door('jCA', J, 'x+', -440, -13, CA); door('jMess', J, 'z+', 0, -13, MS); door('jEng', J, 'z-', 0, -13, EN);
  hole(J, 'y+', [-1.7, 1.7, -441.7, -438.3]); hole(LO, 'y-', [-1.7, 1.7, -441.7, -438.3]);
  door('loBC', LO, 'z-', 0, 60, BC); door('brBC', BR, 'z+', 0, 60, BC);
  // bridge glass: a wide band forward, a skylight strip, two side windows each flank
  for (let i = 0; i < 5; i++) { const u0 = -12.6 + i * 5.1; win(BR, 'z-', [u0, u0 + 4.8, 60.4, 64.0]); }
  for (const s of [-1, 1]) for (const z of [-471, -465]) win(BR, s > 0 ? 'x+' : 'x-', [z - 2.2, z + 2.2, 60.6, 63.6]);
  // engineering: a viewport down the spine is too far; a sealed inspection window into a machinery void instead
  const sh = (R, skip = [], tube = null) => {
    const [cx, cy, cz] = R.c.toArray(), [sx, sy, sz] = R.s.toArray(), hl = (k) => holes.get(R.idx + k) || [];
    const ex = tube === 'x' ? 0 : 2 * T, ez = tube === 'z' ? 0 : 2 * T, o = { room: R.idx, seg: R === BAY ? 2.6 : 0.75 };
    for (const s of [-1, 1]) {
      const sg = s > 0 ? '+' : '-';
      if (tube !== 'y' && !skip.includes('y' + sg)) B.wall('y', cy + s * (sy / 2 + T / 2), [cx - sx / 2 - (tube === 'x' ? 0 : T), cx + sx / 2 + (tube === 'x' ? 0 : T)], [cz - sz / 2 - ez / 2, cz + sz / 2 + ez / 2], hl('y' + sg), o);
      if (tube !== 'x' && !skip.includes('x' + sg)) B.wall('x', cx + s * (sx / 2 + T / 2), [cz - sz / 2 - ez / 2, cz + sz / 2 + ez / 2], [cy - sy / 2 - (tube === 'y' ? 0 : 0), cy + sy / 2], hl('x' + sg), o);
      if (tube !== 'z' && !skip.includes('z' + sg)) B.wall('z', cz + s * (sz / 2 + T / 2), [cx - sx / 2, cx + sx / 2], [cy - sy / 2, cy + sy / 2], hl('z' + sg), o);
    }
  };
  sh(BAY, ['x+']); sh(AL, ['x+']); sh(CA, [], 'x'); sh(J); sh(MS, ['z-']); sh(EN, ['z+']); sh(SH, [], 'y'); sh(LO); sh(BC, [], 'z'); sh(BR);
  // shaft walls run the full height between the junction ceiling and the lobby floor
  for (const w of windows) {
    const [u0, u1, v0, v1] = w.r, ax = w.key[0];
    if (ax === 'z') B.obb([(u0 + u1) / 2, (v0 + v1) / 2, w.at], [u1 - u0, v1 - v0, T]); else B.obb([w.at, (v0 + v1) / 2, (u0 + u1) / 2], [T, v1 - v0, u1 - u0]);
  }

  // ---- props ----
  const P = (c, s, col, R, extra) => B.box(c, s, { kind: 'prop', color: col, room: R.idx, collide: true, ...extra });
  const Pc = (c, r, len, ax, col, R, extra) => B.cyl(c, r, len, ax, { kind: 'prop', color: col, room: R.idx, collide: true, ...extra });
  const LAMP = (c, s, col, R, k = 2.2) => B.box(c, s, { kind: 'lamp', color: col, k, room: R.idx, seg: 9 });
  const deco = (c, s, col, R, extra) => B.box(c, s, { kind: 'prop', color: col, room: R.idx, ...extra });

  // hangar bay: ribbed walls, gantry along the ceiling, a landing cradle, crates and a dead loader
  for (let z = -466; z <= -414; z += 6.5) {
    for (const y of [-15.7, 15.7]) deco([52.5, y, z], [44, 0.5, 0.7], C.slate, BAY, { seg: 3 });
    deco([30.3, 0, z], [0.6, 31, 0.7], C.slate, BAY, { seg: 3 });
  }
  for (const z of [-469.6, -410.4]) for (let y = -12; y <= 12; y += 6) deco([52.5, y, z], [44, 0.6, 0.5], C.slate, BAY, { seg: 3 });
  deco([52.5, 14.6, -440], [3, 1.4, 58], C.dark, BAY, { seg: 3 }); deco([52.5, 13.6, -440], [1.2, 0.6, 58], C.orange, BAY, { seg: 3 });
  // cradle: a raised pad with clamp jaws and edge lights; the jet docks here (BAY_DOCK)
  P([46, -15.6, -440], [10, 0.8, 12], C.slate, BAY, { seg: 2 });
  for (const [x, z] of [[41.5, -434.5], [50.5, -434.5], [41.5, -445.5], [50.5, -445.5]]) P([x, -14.9, z], [1, 0.8, 1], C.orange, BAY, { seg: 2 });
  for (const s of [-1, 1]) { LAMP([46, -15.18, -440 + s * 5.9], [9, 0.06, 0.12], L.amber, BAY, 2.4); LAMP([46 + s * 4.9, -15.18, -440], [0.12, 0.06, 11], L.amber, BAY, 2.4); }
  for (const s of [-1, 1]) deco([46, -15.95, -440 + s * 7], [12, 0.05, 0.4], C.orange, BAY, { seg: 3 });
  // floor markings toward the airlock
  for (let x = 32; x < 40; x += 1.6) deco([x, -15.95, -440], [0.9, 0.05, 0.25], C.orange, BAY, { seg: 3 });
  const crate = (c, s, col) => { P(c, s, col, BAY, { seg: 1.5 }); deco([c[0], c[1] + s[1] / 2 - 0.15, c[2]], [s[0] + 0.06, 0.1, s[2] + 0.06], C.dark, BAY, { seg: 3 }); };
  crate([36, -14.5, -462], [4, 3, 6], C.rust); crate([36, -11.5, -462], [3, 3, 4], C.teal); crate([40, -14.5, -466], [3, 3, 3], C.olive);
  crate([36, -14.5, -418], [4, 3, 6], C.slate); crate([60, -14, -464], [6, 4, 6], C.rust); crate([66, -14.5, -416], [3, 3, 5], C.teal);
  // the loader: a parked cargo walker, its arm up
  P([60, -13.5, -420], [3.6, 2.4, 5], C.orange, BAY, { seg: 1.2 }); P([60, -11.6, -421.5], [2.6, 1.4, 2], C.dark, BAY, { seg: 1.2 });
  for (const [x, z] of [[58.6, -418], [61.4, -418], [58.6, -422], [61.4, -422]]) Pc([x, -15.2, z], 0.35, 1.6, 'y', C.slate, BAY, { sides: 8 });
  Pc([60, -10, -418.5], 0.3, 6, 'y', C.steel, BAY, { sides: 8, collide: false });
  // bay floods (lamps on the inner wall) and status board by the airlock
  for (const z of [-462, -440, -418]) for (const y of [14, -6]) LAMP([30.45, y, z], [0.1, 0.8, 2.4], L.amber, BAY, 2.6);
  P([30.5, -11, -436.2], [0.4, 2.4, 1.6], C.dark, BAY, { seg: 2 }); LAMP([30.75, -10.6, -436.2], [0.05, 1.2, 1.2], L.green, BAY, 1.6);
  for (const z of [-442.6, -437.4]) deco([30.2, -13, z], [0.3, 2.8, 0.25], C.orange, BAY, { seg: 3 });

  // airlock
  for (const sg of [-1, 1]) {
    Pc([27.55, -14.3, -440 + sg * 1.65], 0.035, 4.0, 'x', C.orange, AL, { sides: 6 });
    P([26.3, -12.8, -440 + sg * 1.6], [0.5, 1.6, 0.3], C.slate, AL, { seg: 6 }); P([28.8, -12.8, -440 + sg * 1.6], [0.5, 1.6, 0.3], C.slate, AL, { seg: 6 });
  }
  const alLamp = [[26.5, -11.26, -440], [28.6, -11.26, -440]];
  for (const c of alLamp) B.box(c, [0.36, 0.05, 1.8], { kind: 'lamp', color: L.cool, k: 2.2, room: AL.idx, seg: 5 });

  // corridors: rib frames, lamp strips, a cable tray and grab rails
  const tube = (R, ax) => {
    const len = R.s[ax], c0 = R.c[ax] - len / 2, n = Math.floor(len / 1.8);
    const at = (t, a, b) => (ax === 'z' ? [R.c.x + a, R.c.y + b, t] : ax === 'x' ? [t, R.c.y + b, R.c.z + a] : [R.c.x + a, t, R.c.z + b]);
    const hs = ax === 'y' ? R.s.x / 2 - 0.08 : 1.42;
    for (let i = 0; i < n; i++) {
      const t = c0 + 0.9 + i * (len - 1.8) / Math.max(1, n - 1);
      if (ax === 'y') {
        for (const s of [-1, 1]) { P(at(t, s * hs, 0), [0.16, 0.16, R.s.z], C.slate, R, { seg: 5 }); P(at(t, 0, s * hs), [R.s.x, 0.16, 0.16], C.slate, R, { seg: 5 }); }
        if (i % 2 === 0) LAMP(at(t + 0.5, hs - 0.02, 0), [0.04, 0.8, 0.5], L.cool, R, 2);
        // a ladder of grab rungs up one wall
        Pc(at(t, 0, -hs + 0.12), 0.03, 1.4, 'x', C.orange, R, { sides: 6, collide: false });
        continue;
      }
      const fr = (a, b, sa, sb) => P(at(t, a, b), ax === 'z' ? [sa, sb, 0.16] : [0.16, sb, sa], C.slate, R, { seg: 5 });
      fr(0, 1.42, 3.0, 0.16); fr(0, -1.42, 3.0, 0.16); fr(1.42, 0, 0.16, 3.0); fr(-1.42, 0, 0.16, 3.0);
      if (i % 2 === 0) LAMP(at(t + 0.9, 0, 1.46), ax === 'z' ? [1.0, 0.04, 0.34] : [0.34, 0.04, 1.0], L.warm, R, 2.0);
    }
    if (ax !== 'y') {
      for (const sg of [-1, 1]) Pc(at(R.c[ax], sg * 1.36, -0.2), 0.035, len, ax, C.orange, R, { sides: 6 });
      P(at(R.c[ax], 1.0, 1.38), ax === 'z' ? [0.34, 0.1, len] : [len, 0.1, 0.34], C.dark, R);
    }
  };
  tube(CA, 'x'); tube(BC, 'z'); tube(SH, 'y');
  // shaft: orange rails full height, deck numbers as lamp bands every 12 m
  for (const [x, z] of [[1.45, -441.45], [-1.45, -441.45], [1.45, -438.55], [-1.45, -438.55]]) Pc([x, 23.5, z], 0.05, 68, 'y', C.orange, SH, { sides: 6 });
  for (let y = -4; y < 56; y += 12) LAMP([0, y, -441.66], [2.4, 0.08, 0.04], L.amber, SH, 2.2);

  // junction: a hub with pipes, consoles and a sign board for each way
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { Pc([sx * 4.5, -13, -440 + sz * 4.5], 0.25, 4, 'y', C.steel, J); LAMP([sx * 3.4, -11.12, -440 + sz * 3.4], [1.0, 0.04, 1.0], L.cool, J, 2); }
  for (const [c, n] of [[[0, -11.2, -444.8], 'eng'], [[0, -11.2, -435.2], 'mess'], [[4.8, -11.2, -440], 'bay']]) LAMP(c, n === 'bay' ? [0.04, 0.3, 1.6] : [1.6, 0.3, 0.04], n === 'bay' ? L.amber : n === 'eng' ? L.cyan : L.warm, J, 2);
  LAMP([0, -10.95, -440], [2.6, 0.04, 2.6], L.green, J, 0.6);   // ring round the shaft mouth

  // crew mess: long tables with benches, a galley wall, lockers
  for (const x of [-3.5, 3.5]) {
    P([x, -14.2, -427.5], [2.2, 0.15, 9], C.cream, MS, { seg: 1 }); Pc([x, -14.9, -427.5], 0.2, 1.2, 'y', C.steel, MS);
    for (const s of [-1, 1]) P([x + s * 1.6, -14.8, -427.5], [0.6, 0.3, 9], C.teal, MS, { seg: 1 });
  }
  P([0, -12.5, -421.0], [13.6, 6, 0.8], C.slate, MS, { seg: 1 });
  for (let i = 0; i < 6; i++) { deco([-5.5 + i * 2.2, -12.2, -421.42], [1.8, 1.2, 0.05], i % 2 ? C.steel : C.cream, MS, { seg: 3 }); LAMP([-5.5 + i * 2.2, -11.4, -421.43], [1.6, 0.05, 0.03], L.warm, MS, 1.6); }
  for (let i = 0; i < 5; i++) { P([-6.6, -12.5, -432.5 + i * 2.2], [0.8, 5.6, 2], i % 2 ? C.olive : C.slate, MS, { seg: 1 }); LAMP([-6.18, -11, -432.5 + i * 2.2], [0.03, 0.06, 0.5], i % 3 ? L.green : L.amber, MS, 1.8); }
  LAMP([0, -9.62, -427.5], [10, 0.05, 0.6], L.warm, MS, 1.6);

  // engineering: a reactor status wall, a big pipe manifold, a control desk
  P([0, -12.5, -459.0], [15.6, 6, 0.6], C.dark, EN, { seg: 1 });
  for (let i = 0; i < 3; i++) { Pc([-5 + i * 5, -12.5, -457.8], 1.2, 5.6, 'y', C.steel, EN, { sides: 16 }); LAMP([-5 + i * 5, -12.5, -456.6], [1.0, 3.6, 0.04], i === 1 ? L.cyan : L.amber, EN, 1.4); }
  for (const y of [-10.2, -14.6]) Pc([0, y, -455.6], 0.35, 15, 'x', C.rust, EN);
  P([0, -14.6, -449.5], [8, 1.2, 1.6], C.slate, EN, { seg: 1 }); deco([0, -13.8, -449.9], [7.6, 0.5, 0.8], C.dark, EN, { seg: 3 });
  for (const sx of [-1, 1]) P([sx * 7.4, -12.5, -452.35], [0.8, 5.6, 12], C.slate, EN, { seg: 1 });

  // lobby and bridge
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) LAMP([sx * 2.6, 61.9, -440 + sz * 2.6], [0.9, 0.04, 0.9], L.cool, LO, 2);
  LAMP([0, 58.06, -440], [4.6, 0.04, 4.6], L.green, LO, 0.5);
  // bridge floor: a raised helm dais forward, side stations, the captain's chair, a holo table
  P([0, 57.25, -468.5], [10, 0.5, 6], C.slate, BR, { seg: 1 });
  deco([0, 57.52, -465.6], [10, 0.05, 0.12], C.orange, BR, { seg: 3 });
  const consoles = [];
  const desk = (c, w, face = [0, -1], col = C.slate) => {
    const [fx, fz] = face;
    P([c[0], c[1] - 0.45, c[2]], fz ? [w, 0.9, 0.9] : [0.9, 0.9, w], col, BR, { seg: 1 });
    deco([c[0] + fx * 0.18, c[1] + 0.12, c[2] + fz * 0.18], fz ? [w, 0.14, 0.4] : [0.4, 0.14, w], C.dark, BR, { seg: 5 });
    consoles.push({ c: [c[0] + fx * 0.28, c[1] + 0.5, c[2] + fz * 0.28], n: [-fx, 0, -fz], w: w * 0.86, h: 0.55, R: BR, tilt: 0.35 });
    LAMP([c[0] + fx * 0.38, c[1] + 0.08, c[2] + fz * 0.38], fz ? [w * 0.7, 0.03, 0.05] : [0.05, 0.03, w * 0.7], L.cyan, BR, 1.8);
  };
  desk([0, 58.4, -470.6], 6.4); desk([-5.6, 58.4, -470.0], 3.2); desk([5.6, 58.4, -470.0], 3.2);
  for (const sx of [-1, 1]) { desk([sx * 12.6, 58.0, -462], 5, [sx, 0]); desk([sx * 12.6, 58.0, -469], 4, [sx, 0]); }
  // the helm seat
  const seat = (c, col = C.dark) => {
    P([c[0], c[1] - 0.25, c[2]], [0.9, 0.18, 0.9], col, BR, { seg: 2 }); P([c[0], c[1] + 0.55, c[2] + 0.42], [0.9, 1.4, 0.18], col, BR, { seg: 2 });
    Pc([c[0], c[1] - 0.55, c[2]], 0.12, 0.5, 'y', C.steel, BR);
    for (const s of [-1, 1]) deco([c[0] + s * 0.5, c[1] + 0.05, c[2] - 0.05], [0.12, 0.12, 0.7], C.orange, BR, { seg: 3 });
  };
  seat([HELM.seat.x, HELM.seat.y, HELM.seat.z], C.dark); seat([0, 58.6, -461.0], C.rust);
  // holo table
  Pc([0, 57.5, -459.0], 1.3, 1.0, 'y', C.slate, BR, { sides: 20 }); B.cyl([0, 58.02, -459.0], 1.2, 0.04, 'y', { kind: 'lamp', color: L.cyan, k: 2.2, room: BR.idx, sides: 24 });
  // overhead: a frame of beams and light panels
  for (const z of [-457, -463, -469, -474]) deco([0, 64.75, z], [27.4, 0.4, 0.5], C.slate, BR, { seg: 2 });
  for (const sx of [-1, 1]) for (const z of [-460, -466, -472]) LAMP([sx * 7, 64.85, z], [4, 0.04, 1.4], L.cool, BR, 1.8);
  // window frames
  for (let i = 0; i <= 5; i++) deco([-12.6 + i * 5.1 - 0.15, 62.2, -474.62], [0.3, 3.9, 0.3], C.dark, BR, { seg: 3 });
  deco([0, 60.2, -474.62], [26, 0.3, 0.3], C.dark, BR, { seg: 3 }); deco([0, 64.2, -474.62], [26, 0.3, 0.3], C.dark, BR, { seg: 3 });

  // ---- screens ----
  const screenGeos = [];
  const plane1 = (c, n, w, h, R, tilt) => {
    const g = new THREE.PlaneGeometry(w, h); const nv = new THREE.Vector3(...n);
    _m.lookAt(_v.set(0, 0, 0), nv, _v2.set(0, 1, 0)); _q.setFromRotationMatrix(_m);
    _q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-tilt, 0, 0)));
    g.applyQuaternion(_q); g.translate(c[0], c[1], c[2]);
    const u = g.attributes.uv; const ou = rnd(), ov = rnd(); for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * 0.5 + ou, u.getY(i) * 0.4 + ov);
    const n3 = g.attributes.position.count;
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n3 * 3).fill(1), 3)); g.setAttribute('aRoom', new THREE.BufferAttribute(new Float32Array(n3).fill(R.idx), 1)); g.deleteAttribute('normal');
    screenGeos.push(g);
  };
  for (const s of consoles) plane1(s.c, s.n, s.w, s.h, s.R, s.tilt);
  plane1([0, -12.5, -458.68], [0, 0, 1], 12, 1.4, EN, 0); plane1([0, -13.3, -449.05], [0, 0, 1], 6.8, 0.5, EN, 0.6);
  plane1([30.72, -11.6, -443.7], [1, 0, 0], 1.6, 1.0, BAY, 0);

  // ---- finish ----
  const G = B.finish();
  const M = {
    wall: patch(new THREE.MeshBasicMaterial({ map: hullPlateTexture(), vertexColors: true }), 1),
    floor: patch(new THREE.MeshBasicMaterial({ map: floorTexture(), vertexColors: true }), 0.6),
    lamp: patch(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })),
    screen: patch(new THREE.MeshBasicMaterial({ map: screenTexture(), vertexColors: true, toneMapped: false })),
    glass: new THREE.MeshBasicMaterial({ color: 0x9cc8ff, transparent: true, opacity: 0.06, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
  };
  const inner = new THREE.Group(); inner.name = 'ironwake-inner'; site.group.add(inner);
  const mk = (g, m) => { const o = new THREE.Mesh(g, m); inner.add(o); return o; };
  mk(G.wall, M.wall); mk(G.floor, M.floor); mk(G.lamp, M.lamp);
  const screens = mk(mergeGeometries(screenGeos), M.screen);
  // doors: leaves that slide into the wall
  const leafGeo = (d) => {
    const save = B.sink; B.sink = B.fresh();
    const ax = d.axis, pos = (uu, vv, w) => (ax === 'z' ? [uu, vv, w] : [w, vv, uu]), sz = (a, b, c) => (ax === 'z' ? [a, b, c] : [c, b, a]);
    const w = DW / 2 + 0.03;
    B.box(pos(0, 0, 0), sz(w, DH, 0.2), { kind: 'prop', color: d.kind === 'int' ? C.slate : C.dark, room: d.R.idx, seg: 0.6 });
    for (const s of [-1, 1]) { B.box(pos(0, 0.2, s * 0.105), sz(w * 0.8, 0.1, 0.012), { kind: 'prop', color: C.orange, room: d.R.idx, seg: 9 }); B.box(pos(0, -0.55, s * 0.105), sz(w * 0.8, 0.5, 0.012), { kind: 'prop', color: C.dark, room: d.R.idx, seg: 9 }); }
    const g = B.finish(B.sink); B.sink = save; return g.wall;
  };
  for (const d of Object.values(doors)) {
    const g = leafGeo(d);
    d.leaves = [-1, 1].map((s) => { const m = new THREE.Mesh(g, M.wall); m.userData.side = s; inner.add(m); return m; });
    d.open = 0; d.target = 0;
    // frame
  }
  for (const w of windows) {
    const [u0, u1, v0, v1] = w.r, g = new THREE.PlaneGeometry(u1 - u0, v1 - v0), ax = w.key[0];
    if (ax === 'z') g.translate((u0 + u1) / 2, (v0 + v1) / 2, w.at); else { g.rotateY(Math.PI / 2); g.translate(w.at, (v0 + v1) / 2, (u0 + u1) / 2); }
    const m = new THREE.Mesh(g, M.glass); m.renderOrder = 3; inner.add(m);
  }
  // colliders: one part for every wall and prop
  site.group.updateMatrixWorld(true);
  const node = new THREE.Group(); node.name = 'ironwake-decks'; site.group.add(node);
  const part = new Part(site, 'decks', node, B.obbs); part.sync(0);
  site.parts.push(part); site.byName.decks = part;
  for (const d of Object.values(doors)) {
    d.lc = new THREE.Vector3(...(d.axis === 'z' ? [d.u, d.v, d.at] : [d.at, d.v, d.u]));
    d.h = d.axis === 'z' ? new THREE.Vector3(DW / 2, DH / 2, 0.15) : new THREE.Vector3(0.15, DH / 2, DW / 2);
    d.obb = { c: new THREE.Vector3(), q: new THREE.Quaternion(), qi: new THREE.Quaternion(), h: d.h, v: new THREE.Vector3(), br: d.h.length(), node, chunk: 'decks', part };
  }
  const base = site.collectObbs.bind(site);
  site.collectObbs = (out) => { base(out); for (const d of Object.values(doors)) if (d.open < 0.55) out.push(d.obb); };
  return new Decks({ site, B, doors, ROOMS, M, inner, screens, alLamp, AL, BAY, BR });
}

// ---- runtime ----------------------------------------------------------------------------------------------
const ROOM_NAME = ['Hangar bay', 'Airlock', 'Corridor', 'Junction', 'Crew mess', 'Engineering', 'Lift shaft', 'Bridge deck', 'Corridor', 'Bridge'];
class Decks {
  constructor(o) {
    Object.assign(this, o);
    this.al = { air: false, phase: 'idle', t: 0, dur: 3.2, target: false, goal: null, idle: 0, entry: null, p: 0 };
    this.pl = new THREE.Vector3(); this.inv = new THREE.Matrix4(); this.near = false; this.here = -1; this.time = 0;
    this.power = 0; this.powerT = 0;     // 0 dark, ramps to 1 when the reactor comes back
    try { this.power = localStorage.getItem('rell.ironwake.power') === '1' ? 1 : 0; } catch {}
  }
  setRoom(i, r, g, b) { roomU.uIwC.value[i].set(r, g, b); }
  local(wp, out = this.pl) { return out.copy(wp).applyMatrix4(this.inv.copy(this.site.group.matrixWorld).invert()); }
  roomAt(p, m = 0.2) { for (const v of this.B.vols) if (p.x > v.min.x - m && p.x < v.max.x + m && p.y > v.min.y - m && p.y < v.max.y + m && p.z > v.min.z - m && p.z < v.max.z + m) return v.room; return -1; }
  air(wp) { if (!this.near) return false; const r = this.roomAt(this.local(wp, _v2), 0.18); return r > 1 || (r === 1 && this.al.air); }
  clampCam(pilotWp, want) {
    if (!this.near) return;
    const a = this.local(pilotWp, _v).clone(), pr = this.roomAt(a, 0.1); if (pr < 0) return;
    const b = this.local(want, _v2).clone();
    for (let k = 0; k <= 10; k++) { const t = 1 - k / 10; const c = _v.lerpVectors(a, b, t); if (this.roomAt(c, -0.3) >= 0 || k === 10) { if (k) want.copy(c).applyMatrix4(this.site.group.matrixWorld); return; } }
  }
  restore() { if (this.power >= 1) return; this.powerT = 0.001; try { localStorage.setItem('rell.ironwake.power', '1'); } catch {} }

  update(dt, time, camPos, eva) {
    this.time = time; const S = this.site;
    const dist = camPos.distanceTo(_v.copy(BAY_DOCK).applyMatrix4(S.group.matrixWorld));
    const pilot = eva.state === 'eva' ? eva.pilot.pos : null;
    this.near = dist < 260 || (pilot && pilot.distanceTo(_v) < 260) || false;
    this.inner.visible = this.near || dist < 600;
    // door colliders follow the ship
    const M = S.group.matrixWorld; S.group.getWorldQuaternion(_q);
    for (const d of Object.values(this.doors)) { const prev = _v2.copy(d.obb.c); d.obb.c.copy(d.lc).applyMatrix4(M); d.obb.q.copy(_q); d.obb.qi.copy(_q).invert(); if (dt) d.obb.v.copy(d.obb.c).sub(prev).divideScalar(dt); }
    if (!this.near) return;
    const p = pilot ? this.local(pilot, this.pl) : null;
    this.here = p ? this.roomAt(p, 0.15) : -1;
    this.innerDoors(dt, p); this.airlock(dt, p, time);
    // power: red emergency light with a slow pulse; when restored, rooms come up one after another
    if (this.powerT > 0) { this.powerT += dt; this.power = Math.min(1, this.powerT / 6); }
    const pw = this.power;
    for (let i = 0; i < this.ROOMS.length; i++) {
      if (i === 1) continue;
      const k = THREE.MathUtils.clamp(pw * 1.6 - i * 0.06, 0, 1);
      const em = 0.45 + 0.15 * Math.sin(time * 1.4 + i);
      const fl = k > 0 && k < 1 && Math.sin(time * 37 + i * 3) > 0.2 ? 0.4 : 1;
      this.setRoom(i, (em * 0.9 * (1 - k) + k) * fl, (em * 0.22 * (1 - k) + k) * fl, (em * 0.16 * (1 - k) + k) * fl);
    }
    this.M.screen.map.offset.y = (time * 0.05) % 1;
    this.M.screen.color.setScalar(0.15 + 0.85 * pw);
  }

  airlock(dt, p, time) {
    const al = this.al, D = this.doors, inD = D.alIn, outD = D.alOut;
    let zone = null;
    if (p) {
      const ok = Math.abs(p.y + 13) < 2.2 && Math.abs(p.z + 440) < 2.2;
      if (ok && p.x > 25.25 && p.x < 29.85) zone = 'chamber';
      else if (p.x > 30 && p.x < 42 && Math.abs(p.y + 12) < 5 && Math.abs(p.z + 440) < 7) zone = 'out';
      else if (ok && p.x > 20 && p.x < 25.25) zone = 'in';
    }
    if (al.phase === 'cycle') {
      al.t += dt;
      if (al.t >= al.dur) { al.phase = 'idle'; al.air = al.target; this.sound?.tonePing(al.air ? 760 : 520, 0.35, 0.1, 'sine'); }
    } else {
      if (zone === 'chamber') {
        if (!al.entry) al.entry = outD.open > 0.05 ? 'out' : inD.open > 0.05 ? 'in' : null;
        const deep = al.entry === 'out' ? p.x < 28.9 : al.entry === 'in' ? p.x > 26.2 : false;
        if (deep) al.goal = al.entry === 'out' ? 'in' : 'out';
      } else if (zone === 'out') { al.entry = null; if (!al.goal || al.goal === 'out' || inD.open < 0.05) al.goal = 'out'; }
      else if (zone === 'in') { al.entry = null; if (!al.goal || al.goal === 'in' || outD.open < 0.05) al.goal = 'in'; }
      else { al.idle += dt; if (al.idle > 1.5) { al.goal = null; al.entry = null; } }
      if (zone) al.idle = 0;
      if (zone === 'chamber' && !al.goal && inD.open < 0.05 && outD.open < 0.05) { al.stuck = (al.stuck || 0) + dt; if (al.stuck > 1) al.goal = p.x > 27.55 ? 'out' : 'in'; } else al.stuck = 0;
      const goal = al.goal, want = goal ? D[goal === 'out' ? 'alOut' : 'alIn'] : null, other = want === outD ? inD : outD;
      inD.target = outD.target = 0;
      if (want) {
        const needAir = goal === 'in';
        if (other.open > 0.02) other.target = 0;
        else if (al.air !== needAir) { al.phase = 'cycle'; al.t = 0; al.target = needAir; this.sound?.noise(al.dur, 'highpass', 2800, 0.12); }
        else want.target = 1;
      }
    }
    for (const d of [inD, outD]) this.move(d, dt, 1.5);
    if (al.phase === 'cycle') { const s = (time * 5) % 1 < 0.5 ? 1.5 : 0.25; this.setRoom(1, 1.4 * s, 0.55 * s, 0.1 * s); }
    else if (al.air) this.setRoom(1, 1, 1, 1); else this.setRoom(1, 0.6, 0.22, 0.18);
    // gas venting into the chamber while it cycles
    if (al.phase === 'cycle' && this.fx) {
      this._acc = (this._acc || 0) + 50 * dt; const gw = this.site.group.matrixWorld;
      while (this._acc > 1) { this._acc--; const s = Math.random() < 0.5 ? -1 : 1; _v.set(25.6 + Math.random() * 3.8, -12.2, -440 + s * 1.74).applyMatrix4(gw); _v2.set((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, -s * (0.8 + Math.random())).transformDirection(gw).multiplyScalar(1.2 + Math.random()); this.fx.emit(_v, _v2, this.getFxT(), 0.5 + Math.random() * 0.4, 0.03, 0.16, K.RCS, 2.4, 0); }
    }
  }
  innerDoors(dt, p) {
    for (const d of Object.values(this.doors)) {
      if (d.kind !== 'int') { this.slide(d); continue; }
      d.target = p && p.distanceToSquared(d.lc) < 3.8 * 3.8 ? 1 : 0;
      this.move(d, dt, 2.6);
    }
  }
  move(d, dt, sp) {
    const prev = d.open;
    d.open += Math.sign(d.target - d.open) * Math.min(Math.abs(d.target - d.open), sp * dt);
    if (prev !== d.open && (prev < 0.55) !== (d.open < 0.55)) this.site.world.dirty = true;
    if (prev === 0 && d.open > 0) this.sound?.noise(0.45, 'lowpass', 550, 0.1);
    this.slide(d);
  }
  slide(d) {
    const off = d.open * (DW / 2 + 0.02);
    for (const m of d.leaves) {
      const s = m.userData.side, u = d.u + s * (DW / 4 + 0.0075) + s * off;
      if (d.axis === 'z') m.position.set(u, d.v, d.at); else m.position.set(d.at, d.v, u);
      m.visible = d.open < 0.995;
    }
  }

  status(eva, touch, helmNear) {
    if (!this.near || eva.state !== 'eva') return '';
    const al = this.al, h = this.here;
    if (helmNear) return `<b>Helm</b> ${touch ? 'Tap Hatch' : 'Press G'} to take the helm`;
    if (al.phase === 'cycle') return `<b>${al.target ? 'Pressurising' : 'Venting'}</b> ${Math.max(0, al.dur - al.t).toFixed(1)}s · wait in the airlock`;
    if (h === 1) return `<b>Airlock</b> ${al.goal === 'in' ? 'Inner door opening, float on in' : al.goal === 'out' ? 'Outer door open, float out' : 'Float all the way through'}`;
    if (h === 0) return '<b>Hangar bay</b> The airlock is on the inner wall, past the orange marks';
    if (h === 3) return '<b>Junction</b> The lift shaft goes up to the bridge · mess one way, engineering the other';
    if (h === 6) return '<b>Lift shaft</b> Keep going up · 68 m to the bridge deck';
    if (h === 9) return `<b>Bridge</b> ${this.power < 1 ? 'Dark. Float to the helm seat at the front' : 'Float to the helm seat at the front'}`;
    if (h >= 0) return `<b>${ROOM_NAME[h]}</b> ${h === 7 || h === 8 ? 'The bridge is forward' : ''}`;
    return '';
  }
}
