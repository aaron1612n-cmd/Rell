// Bakes a signed distance field of the ship hull (ship space) for the EVA suit's collisions:
// node scripts/shipsdf.mjs  ->  src/assets/shipsdf.json. Rerun after any ship.glb re-export.
// The canopy is left out (it hinges; eva handles it analytically). Unsigned distance per triangle in a narrow
// band, then inside/outside by flooding the outside from the grid border through cells clear of the surface.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { writeFileSync } from 'node:fs';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read('src/assets/ship.glb');
const CELL = 0.06, BAND = 0.45, SKIP = /canopy/;

const tris = [];
const mul = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
for (const n of doc.getRoot().listNodes()) {
  const mesh = n.getMesh(); if (!mesh) continue;
  let skip = false; for (let a = n; a; a = a.getParentNode()) if (SKIP.test(a.getName())) skip = true;
  if (skip) continue;
  const m = n.getWorldMatrix();
  for (const pr of mesh.listPrimitives()) {
    const P = pr.getAttribute('POSITION'), I = pr.getIndices(), cnt = I ? I.getCount() : P.getCount();
    const v = (i) => { const e = P.getElement(i, []); return mul(m, e[0], e[1], e[2]); };
    for (let i = 0; i < cnt; i += 3) tris.push([v(I ? I.getScalar(i) : i), v(I ? I.getScalar(i + 1) : i + 1), v(I ? I.getScalar(i + 2) : i + 2)]);
  }
}
const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
for (const t of tris) for (const p of t) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
const org = lo.map((v) => v - BAND - CELL), dim = hi.map((v, k) => Math.ceil((v + BAND + CELL - org[k]) / CELL) + 1);
const [NX, NY, NZ] = dim, N = NX * NY * NZ;
console.log('tris', tris.length, 'dims', dim, 'cells', N);
const udf = new Float32Array(N).fill(BAND);

// closest point on a triangle (Ericson), returns squared distance
function d2tri(p, a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const dot = (u, w) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  const d1 = dot(ab, ap), d2 = dot(ac, ap); let q;
  if (d1 <= 0 && d2 <= 0) q = a;
  else {
    const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]], d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) q = b;
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); q = [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]; }
      else {
        const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], d5 = dot(ab, cp), d6 = dot(ac, cp);
        if (d6 >= 0 && d5 <= d6) q = c;
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); q = [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); q = [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]; }
            else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]; }
          }
        }
      }
    }
  }
  const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2]; return dx * dx + dy * dy + dz * dz;
}
const t0 = Date.now(), p = [0, 0, 0];
for (const [a, b, c] of tris) {
  const i0 = [], i1 = [];
  for (let k = 0; k < 3; k++) { i0[k] = Math.max(0, Math.floor((Math.min(a[k], b[k], c[k]) - BAND - org[k]) / CELL)); i1[k] = Math.min(dim[k] - 1, Math.ceil((Math.max(a[k], b[k], c[k]) + BAND - org[k]) / CELL)); }
  for (let z = i0[2]; z <= i1[2]; z++) for (let y = i0[1]; y <= i1[1]; y++) for (let x = i0[0]; x <= i1[0]; x++) {
    const id = x + NX * (y + NY * z);
    p[0] = org[0] + x * CELL; p[1] = org[1] + y * CELL; p[2] = org[2] + z * CELL;
    const cur = udf[id]; const d = d2tri(p, a, b, c); if (d < cur * cur) udf[id] = Math.sqrt(d);
  }
}
console.log('udf', ((Date.now() - t0) / 1000).toFixed(1) + 's');
// flood the outside through cells clear of the surface
const THR = CELL * 0.75, out = new Uint8Array(N), st = [];
for (let z = 0; z < NZ; z++) for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) if (x === 0 || y === 0 || z === 0 || x === NX - 1 || y === NY - 1 || z === NZ - 1) { const id = x + NX * (y + NY * z); out[id] = 1; st.push(id); }
while (st.length) {
  const id = st.pop(), x = id % NX, y = ((id / NX) | 0) % NY, z = (id / (NX * NY)) | 0;
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const X = x + dx, Y = y + dy, Z = z + dz; if (X < 0 || Y < 0 || Z < 0 || X >= NX || Y >= NY || Z >= NZ) continue;
    const j = X + NX * (Y + NY * Z); if (out[j] || udf[j] <= THR) continue; out[j] = 1; st.push(j);
  }
}
// inside = not reached and clear of the surface; surface cells stay positive (small), a thin skin closes thin parts
const q = new Int8Array(N); let inside = 0;
for (let i = 0; i < N; i++) { let d = udf[i]; if (!out[i] && d > THR) { d = -d; inside++; } q[i] = Math.max(-127, Math.min(127, Math.round(d / BAND * 127))); }
console.log('inside cells', inside);
// run-length: [value, count] byte pairs (count 1..255)
const rle = [];
for (let i = 0; i < N;) { let n = 1; while (i + n < N && n < 255 && q[i + n] === q[i]) n++; rle.push(q[i] & 255, n); i += n; }
writeFileSync('src/assets/shipsdf.json', JSON.stringify({ cell: CELL, band: BAND, org: org.map((v) => +v.toFixed(4)), dim, rle: Buffer.from(rle).toString('base64') }));
console.log('rle bytes', rle.length);
