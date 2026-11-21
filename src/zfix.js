// Z-fight separator: finds pairs of triangles that sit in the same plane, face the same way, overlap and look different
// (colour or material), and lists the smaller of each pair so the caller can lift it a hair along its normal.
// Pure numbers, no three.js, so the asset tool (tools/zfix.mjs) and the runtime mesh builders share it.
// tris: [{ a:[x,y,z], b, c, col:[r,g,b], mat: any }]  ->  Map(index -> [nx,ny,nz]) of triangles to lift
export function coplanarLifts(tris, { eps = 0.004, minArea = 1e-3, cell = 1.5 } = {}) {
  const N = tris.length, nrm = new Array(N), cen = new Array(N), area = new Array(N), keep = new Uint8Array(N);
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]], dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const grid = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
  for (let i = 0; i < N; i++) {
    const t = tris[i], c = cross(sub(t.b, t.a), sub(t.c, t.a)), L = Math.hypot(c[0], c[1], c[2]); area[i] = L / 2; if (area[i] < 2e-4) continue;
    nrm[i] = [c[0] / L, c[1] / L, c[2] / L]; cen[i] = [(t.a[0] + t.b[0] + t.c[0]) / 3, (t.a[1] + t.b[1] + t.c[1]) / 3, (t.a[2] + t.b[2] + t.c[2]) / 3]; keep[i] = 1;
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(t.a[k], t.b[k], t.c[k]) / cell)), hi = [0, 1, 2].map((k) => Math.floor(Math.max(t.a[k], t.b[k], t.c[k]) / cell));
    if ((hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1) > 64) { const k = key(...cen[i].map((v) => Math.floor(v / cell))); (grid.get(k) || grid.set(k, []).get(k)).push(i); continue; }
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const k = key(x, y, z); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
  }
  const proj = (p, e1, e2) => [dot(p, e1), dot(p, e2)];
  const clipArea = (A, B) => {
    const ccw = (P) => ((P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[1][1] - P[0][1]) * (P[2][0] - P[0][0]) < 0 ? [P[0], P[2], P[1]] : P);
    A = ccw(A); B = ccw(B); let out = A;
    for (let i = 0; i < 3 && out.length; i++) {
      const p1 = B[i], p2 = B[(i + 1) % 3], inside = (q) => (p2[0] - p1[0]) * (q[1] - p1[1]) - (p2[1] - p1[1]) * (q[0] - p1[0]) >= -1e-9, inp = out; out = [];
      for (let j = 0; j < inp.length; j++) {
        const c = inp[j], d = inp[(j + 1) % inp.length], ci = inside(c), di = inside(d);
        const X = () => { const a1 = d[0] - c[0], b1 = d[1] - c[1], a2 = p2[0] - p1[0], b2 = p2[1] - p1[1], den = a1 * b2 - b1 * a2, tt = ((p1[0] - c[0]) * b2 - (p1[1] - c[1]) * a2) / den; return [c[0] + a1 * tt, c[1] + b1 * tt]; };
        if (ci) { out.push(c); if (!di) out.push(X()); } else if (di) out.push(X());
      }
    }
    let s = 0; for (let i = 0; i < out.length; i++) { const q = out[i], r = out[(i + 1) % out.length]; s += q[0] * r[1] - r[0] * q[1]; } return Math.abs(s) / 2;
  };
  const lifts = new Map(), seen = new Set();
  for (const list of grid.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const ia = list[i], ib = list[j], A = tris[ia], B = tris[ib]; if (!keep[ia] || !keep[ib]) continue;
    if (dot(nrm[ia], nrm[ib]) < 0.9995) continue;
    const d0 = dot(nrm[ia], A.a);
    if (Math.abs(dot(nrm[ia], B.a) - d0) > eps || Math.abs(dot(nrm[ia], B.b) - d0) > eps || Math.abs(dot(nrm[ia], B.c) - d0) > eps) continue;
    const dc = Math.abs(A.col[0] - B.col[0]) + Math.abs(A.col[1] - B.col[1]) + Math.abs(A.col[2] - B.col[2]); if (dc < 0.04 && A.mat === B.mat) continue;
    const k = ia < ib ? ia * 1e7 + ib : ib * 1e7 + ia; if (seen.has(k)) continue; seen.add(k);
    const n = nrm[ia], e1 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], pr = dot(e1, n), f1 = [e1[0] - n[0] * pr, e1[1] - n[1] * pr, e1[2] - n[2] * pr], fl = Math.hypot(...f1), u = f1.map((v) => v / fl), v2 = cross(n, u);
    if (clipArea([A.a, A.b, A.c].map((p) => proj(p, u, v2)), [B.a, B.b, B.c].map((p) => proj(p, u, v2))) < minArea) continue;
    const lo = area[ia] < area[ib] || (area[ia] === area[ib] && ia > ib) ? ia : ib;     // lift the smaller one (decal/plate on the bigger surface)
    if (!lifts.has(lo)) lifts.set(lo, nrm[lo]);
  }
  return lifts;
}
