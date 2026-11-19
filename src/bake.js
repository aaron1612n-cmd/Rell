import * as THREE from 'three';

// Procedural interiors without a single dynamic light. Every surface is built from subdivided boxes and
// cylinders, and its lighting is baked into vertex colours at build time: each room has a few fixtures,
// every vertex adds up their contribution (with a wrap term, so faces turned away still pick up some) and
// a cheap corner-darkening ambient occlusion. One shared material per kind then draws a whole station in a
// handful of calls, and per-room colour uniforms let a room brown out, flicker or strobe at run time.
//
// Which side of a slab is "inside" is decided per triangle: a point a hair off the face is tested against
// the room volumes, so a wall slab shows its panelled interior on one side and the hull skin on the other.

export const T = 0.35;                                  // wall thickness
const _p = new THREE.Vector3(), _n = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();
const _col = new THREE.Color();
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

class Sink {
  constructor(normals) { this.pos = []; this.nor = normals ? [] : null; this.col = []; this.uv = []; this.room = []; }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    if (this.nor) g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aRoom', new THREE.Float32BufferAttribute(this.room, 1));
    g.computeBoundingSphere(); g.computeBoundingBox(); return g;
  }
}

export class Bake {
  constructor() {
    this.rooms = []; this.vols = []; this.lights = []; this.obbs = [];
    this.sink = this.fresh();
  }
  fresh() { return { wall: new Sink(), floor: new Sink(), hull: new Sink(true), lamp: new Sink() }; }

  // a room: its inner box, ambient light, base paint
  room(id, c, s, { amb = [0.05, 0.05, 0.06], tint = [0.8, 0.8, 0.8] } = {}) {
    const min = new THREE.Vector3(c[0] - s[0] / 2, c[1] - s[1] / 2, c[2] - s[2] / 2), max = new THREE.Vector3(c[0] + s[0] / 2, c[1] + s[1] / 2, c[2] + s[2] / 2);
    const R = { id, idx: this.rooms.length, min, max, amb, tint: new THREE.Color(...tint), c: new THREE.Vector3(...c), s: new THREE.Vector3(...s) };
    this.rooms.push(R); this.vols.push({ min, max, room: R.idx }); return R;
  }
  tunnel(min, max, room) { this.vols.push({ min: new THREE.Vector3(...min), max: new THREE.Vector3(...max), room }); }
  light(room, p, c, i, r, reach = []) { this.lights.push({ room, p: new THREE.Vector3(...p), c: new THREE.Color(...c), i, r, reach }); }
  inside(p) { for (const v of this.vols) if (p.x > v.min.x && p.x < v.max.x && p.y > v.min.y && p.y < v.max.y && p.z > v.min.z && p.z < v.max.z) return v.room; return -1; }
  obb(c, s) { this.obbs.push({ c: [...c], q: [0, 0, 0, 1], h: [s[0] / 2, s[1] / 2, s[2] / 2] }); }

  // ---- shading ----------------------------------------------------------------------------
  shade(p, n, room, out) {
    const R = this.rooms[room];
    out.setRGB(R.amb[0], R.amb[1], R.amb[2]);
    for (const L of this.lights) {
      const k = L.room === room ? 1 : L.reach.includes(room) ? 0.45 : 0; if (!k) continue;
      _d.copy(L.p).sub(p); const d = _d.length(); if (d > L.r) continue;
      _d.divideScalar(d || 1);
      const ndl = Math.max(0, n.dot(_d)), f = 1 - d / L.r;
      const w = L.i * f * f * (0.2 + 0.8 * ndl) * k;
      out.r += L.c.r * w; out.g += L.c.g * w; out.b += L.c.b * w;
    }
    // corner darkening: distance to the nearest room edge along this face
    const ax = Math.abs(n.x) > Math.abs(n.y) ? (Math.abs(n.x) > Math.abs(n.z) ? 0 : 2) : (Math.abs(n.y) > Math.abs(n.z) ? 1 : 2);
    let dm = 9;
    for (let k = 0; k < 3; k++) { if (k === ax) continue; const a = p.getComponent(k) - R.min.getComponent(k), b = R.max.getComponent(k) - p.getComponent(k); dm = Math.min(dm, Math.max(0, a), Math.max(0, b)); }
    const ao = 0.5 + 0.5 * sstep(0, 1.1, dm);
    out.multiplyScalar(ao);
    return out;
  }

  // ---- geometry ----------------------------------------------------------------------------
  // o: { room, kind: 'auto' | 'prop' | 'lamp' | 'hull', color, k (lamp strength), seg }
  emit(g, o) {
    g = g.index ? g.toNonIndexed() : g;
    const P = g.attributes.position, N = g.attributes.normal;
    const base = o.color !== undefined ? _col.set(o.color).clone() : null;
    for (let i = 0; i < P.count; i += 3) {
      _p.fromBufferAttribute(P, i); _e1.fromBufferAttribute(P, i + 1).sub(_p); _e2.fromBufferAttribute(P, i + 2).sub(_p);
      _n.crossVectors(_e1, _e2);
      if (_n.lengthSq() < 1e-14) continue;
      _n.normalize(); _c.fromBufferAttribute(P, i).add(_e1.add(_p)).add(_e2.add(_p)).divideScalar(3);
      let kind = o.kind || 'prop', room = o.room ?? 0;
      if (kind === 'auto') {
        const r = this.inside(_p.copy(_c).addScaledVector(_n, 0.07));
        if (r >= 0) { room = r; kind = Math.abs(_n.y) > 0.9 ? 'floor' : 'wall'; } else kind = 'hull';
      } else if (kind === 'prop') kind = 'wall';
      const sk = this.sink[kind];
      for (let v = 0; v < 3; v++) {
        _p.fromBufferAttribute(P, i + v);
        if (N) _d.fromBufferAttribute(N, i + v).normalize(); else _d.copy(_n);
        if (kind === 'hull') {
          const h = 0.88 + 0.12 * Math.sin(_c.x * 12.9 + _c.y * 78.2 + _c.z * 37.7);
          const hc = o.hullColor !== undefined ? _col.set(o.hullColor) : (base || _col.setRGB(0.64, 0.61, 0.56));
          sk.col.push(hc.r * h, hc.g * h, hc.b * h); sk.nor.push(_d.x, _d.y, _d.z);
        } else if (kind === 'lamp') {
          const k = o.k ?? 1; sk.col.push(base.r * k, base.g * k, base.b * k);
        } else {
          const R = this.rooms[room], paint = base || R.tint;
          this.shade(_p, _d, room, _col);
          sk.col.push(_col.r * paint.r, _col.g * paint.g, _col.b * paint.b);
        }
        sk.pos.push(_p.x, _p.y, _p.z);
        // world-scaled UVs from the dominant axis of the face (a 2 m tile)
        const ax = Math.abs(_n.x) > Math.abs(_n.y) ? (Math.abs(_n.x) > Math.abs(_n.z) ? 0 : 2) : (Math.abs(_n.y) > Math.abs(_n.z) ? 1 : 2);
        if (ax === 0) sk.uv.push(_p.z / 2, _p.y / 2); else if (ax === 1) sk.uv.push(_p.x / 2, _p.z / 2); else sk.uv.push(_p.x / 2, _p.y / 2);
        sk.room.push(room);
      }
    }
  }

  box(c, s, o = {}) {
    const seg = o.seg ?? 0.75;
    // grid lines: even steps, plus every room-volume plane that crosses the slab, so no triangle straddles an
    // inside/outside boundary (it would be painted as one or the other, and show as a stray shard)
    const br = [0, 1, 2].map((k) => {
      const lo = c[k] - s[k] / 2, hi = c[k] + s[k] / 2, set = [lo, hi], n = Math.max(1, Math.ceil((hi - lo) / seg));
      for (let i = 1; i < n; i++) set.push(lo + (hi - lo) * i / n);
      if (o.kind === 'auto') for (const v of this.vols) for (const x of [v.min.getComponent(k), v.max.getComponent(k)]) if (x > lo + 1e-3 && x < hi - 1e-3) set.push(x);
      set.sort((a, b) => a - b);
      return set.filter((x, i) => i === 0 || x - set[i - 1] > 1e-3);
    });
    this.emit(gridBox(c, s, br), o);
  }
  cyl(c, r, len, axis, o = {}) {
    const g = new THREE.CylinderGeometry(r, o.r2 ?? r, len, o.sides ?? 10, Math.max(1, Math.ceil(len / (o.seg ?? 0.8))), !!o.open);
    if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(c[0], c[1], c[2]); this.emit(g, o);
  }
  // an arbitrary prebuilt geometry, already in place
  geo(g, o) { this.emit(g, o); }

  // a wall slab with rectangular holes. axis = normal axis, at plane coordinate `at`, thickness t.
  // u/v run along the other two axes (x,y for z; z,y for x; x,z for y). Pieces are boxes (and colliders).
  wall(axis, at, [u0, u1], [v0, v1], holes, o = {}) {
    const t = o.t ?? T;
    const cuts = (lo, hi, key0, key1) => {
      const s = new Set([lo, hi]);
      for (const h of holes) { for (const x of [h[key0], h[key1]]) if (x > lo && x < hi) s.add(x); }
      return [...s].sort((a, b) => a - b);
    };
    const us = cuts(u0, u1, 0, 1), vs = cuts(v0, v1, 2, 3);
    const free = (ua, ub, va, vb) => { const mu = (ua + ub) / 2, mv = (va + vb) / 2; return !holes.some((h) => mu > h[0] && mu < h[1] && mv > h[2] && mv < h[3]); };
    for (let j = 0; j < vs.length - 1; j++) {
      let start = null;
      for (let i = 0; i <= us.length - 1; i++) {
        const ok = i < us.length - 1 && free(us[i], us[i + 1], vs[j], vs[j + 1]);
        if (ok && start === null) start = us[i];
        if (!ok && start !== null) { this.piece(axis, at, t, start, us[i], vs[j], vs[j + 1], o); start = null; }
      }
    }
  }
  piece(axis, at, t, ua, ub, va, vb, o) {
    const cu = (ua + ub) / 2, cv = (va + vb) / 2, su = ub - ua, sv = vb - va;
    let c, s;
    if (axis === 'z') { c = [cu, cv, at]; s = [su, sv, t]; } else if (axis === 'x') { c = [at, cv, cu]; s = [t, sv, su]; } else { c = [cu, at, cv]; s = [su, t, sv]; }
    this.box(c, s, { kind: 'auto', ...o }); if (!o.noObb) this.obb(c, s);
  }

  // ---- output ------------------------------------------------------------------------------
  finish(sink = this.sink) { return { wall: sink.wall.geo(), floor: sink.floor.geo(), hull: sink.hull.geo(), lamp: sink.lamp.geo() }; }
}

// a box built from explicit grid lines per axis, non-indexed, with its face normals
function gridBox(c, s, br) {
  const pos = [], nor = [], lo = [c[0] - s[0] / 2, c[1] - s[1] / 2, c[2] - s[2] / 2], hi = [c[0] + s[0] / 2, c[1] + s[1] / 2, c[2] + s[2] / 2];
  for (let a = 0; a < 3; a++) for (const sg of [-1, 1]) {
    const b = (a + 1) % 3, d = (a + 2) % 3, A = sg > 0 ? hi[a] : lo[a];
    for (let i = 0; i < br[b].length - 1; i++) for (let j = 0; j < br[d].length - 1; j++) {
      const q = [[br[b][i], br[d][j]], [br[b][i + 1], br[d][j]], [br[b][i + 1], br[d][j + 1]], [br[b][i], br[d][j + 1]]];
      const P = q.map(([u, v]) => { const p = [0, 0, 0]; p[a] = A; p[b] = u; p[d] = v; return p; });
      const tri = sg > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      for (const t of tri) { pos.push(...P[t]); const n = [0, 0, 0]; n[a] = sg; nor.push(...n); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

// ---- textures (canvas, small, shared) ----------------------------------------------------------
let seed = 5;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
const tex = (c, repeat = true) => { const t = new THREE.CanvasTexture(c); if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };

export function wallTexture() {
  const [c, x] = mk(256, 256);
  x.fillStyle = '#d6d2c8'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2200; i++) { x.fillStyle = `rgba(${rnd() < 0.5 ? '40,38,34' : '255,252,244'},${rnd() * 0.07})`; x.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 3, 1 + rnd() * 2); }
  // panel seams: a 2 m tile cut in four, plus a recessed inspection plate and rivets
  x.strokeStyle = 'rgba(30,28,24,.7)'; x.lineWidth = 3; x.strokeRect(1.5, 1.5, 253, 253);
  x.lineWidth = 2; x.beginPath(); x.moveTo(128, 0); x.lineTo(128, 256); x.moveTo(0, 96); x.lineTo(256, 96); x.stroke();
  x.fillStyle = 'rgba(30,28,24,.55)';
  for (const px of [10, 118, 138, 246]) for (const py of [10, 86, 106, 246]) { x.beginPath(); x.arc(px, py, 2.4, 0, 7); x.fill(); }
  x.fillStyle = 'rgba(0,0,0,.14)'; x.fillRect(150, 124, 80, 56); x.strokeStyle = 'rgba(255,255,255,.18)'; x.lineWidth = 1.5; x.strokeRect(150, 124, 80, 56);
  for (let i = 0; i < 14; i++) { const gx = rnd() * 256, gr = x.createLinearGradient(gx, 90, gx, 256); gr.addColorStop(0, 'rgba(50,44,36,0)'); gr.addColorStop(1, `rgba(50,44,36,${rnd() * 0.22})`); x.fillStyle = gr; x.fillRect(gx, 90, 2 + rnd() * 6, 166); }
  return tex(c);
}

export function floorTexture() {
  const [c, x] = mk(128, 128);
  x.fillStyle = '#6d6a64'; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    x.fillStyle = '#25262a'; x.fillRect(i * 16 + 2, j * 16 + 3, 12, 6);
    x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(i * 16 + 2, j * 16 + 2, 12, 1);
  }
  x.strokeStyle = 'rgba(0,0,0,.6)'; x.lineWidth = 2; x.strokeRect(1, 1, 126, 126);
  for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(0,0,0,${rnd() * 0.15})`; x.fillRect(rnd() * 128, rnd() * 128, 2, 1 + rnd() * 3); }
  return tex(c);
}

// screens: bars, a scope trace, a map of dots: scrolled by the controller so they always look alive
export function screenTexture() {
  const [c, x] = mk(256, 256);
  x.fillStyle = '#04090c'; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = 'rgba(80,220,255,.9)'; x.lineWidth = 2;
  for (let r = 0; r < 4; r++) {
    const y0 = 8 + r * 62;
    x.strokeRect(6, y0, 244, 52);
    if (r % 2 === 0) { x.beginPath(); for (let i = 0; i <= 60; i++) { const px = 10 + i * 3.9, py = y0 + 26 + Math.sin(i * 0.5 + r) * 14 * Math.sin(i * 0.11 + r * 2); i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke(); }
    else { for (let i = 0; i < 16; i++) { const h = 6 + rnd() * 40; x.fillStyle = i % 5 === 0 ? 'rgba(255,150,70,.95)' : 'rgba(80,220,255,.85)'; x.fillRect(12 + i * 15, y0 + 50 - h, 10, h); } }
  }
  for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(255,255,255,${rnd() * 0.2})`; x.fillRect(0, rnd() * 256, 256, 1); }
  return tex(c);
}

export function ledTexture() {
  const [c, x] = mk(64, 64);
  x.fillStyle = '#050607'; x.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if (rnd() < 0.6) { x.fillStyle = rnd() < 0.15 ? '#ff7a30' : rnd() < 0.5 ? '#46ffb0' : '#58b8ff'; x.fillRect(i * 8 + 2, j * 8 + 2, 4, 4); }
  const t = tex(c); t.magFilter = THREE.NearestFilter; return t;
}

export function panelsTexture() {
  const [c, x] = mk(256, 128);
  x.fillStyle = '#0b1830'; x.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) {
    const g = x.createLinearGradient(i * 32, j * 32, i * 32 + 32, j * 32 + 32); g.addColorStop(0, '#1d3d7a'); g.addColorStop(1, '#0d1f45');
    x.fillStyle = g; x.fillRect(i * 32 + 1.5, j * 32 + 1.5, 29, 29);
    x.strokeStyle = 'rgba(150,190,255,.35)'; x.lineWidth = 1; x.beginPath(); for (let k = 1; k < 4; k++) { x.moveTo(i * 32 + 1.5 + k * 7.25, j * 32 + 1.5); x.lineTo(i * 32 + 1.5 + k * 7.25, j * 32 + 30.5); } x.stroke();
  }
  return tex(c);
}

// per-room colour multipliers, patched into the shared interior materials (one uniform array, many rooms)
export const roomUniform = { uRoomC: { value: Array.from({ length: 12 }, () => new THREE.Vector3(1, 1, 1)) } };
export function patchRoom(m) {
  m.onBeforeCompile = (s) => {
    s.uniforms.uRoomC = roomUniform.uRoomC;
    s.vertexShader = 'attribute float aRoom;\nuniform vec3 uRoomC[12];\n' + s.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_COLOR\nvColor.rgb *= uRoomC[int(aRoom + 0.5)];\n#endif');
  };
  m.customProgramCacheKey = () => 'relayroom';
  return m;
}
