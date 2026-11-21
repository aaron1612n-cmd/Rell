// Fills the gaps between the Blender-authored box colliders and the real meshes.
// For each site model it samples every chunk's triangles in the chunk's authoring frame, finds the surface
// the hand-made boxes miss (masts, engine bells, booms, cranes) and covers it with extra boxes; the spinning
// station ring keeps its own sphere chain (Site.ring). Output: src/assets/colliders.json.
// Run: node scripts/colliders.mjs   (after the Blender exports / optimize)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import fs from 'node:fs';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const CELL = 3, PAD = 0.35, MINH = 0.7, COVER = +(process.env.COVER || 1.0);
const SKIP = /^lamps|^catch_lights|^beacon/;
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const out = ONLY.length ? JSON.parse(fs.readFileSync('src/assets/colliders.json')) : {};   // ONLY=freighter regenerates just that model

function samples(prim, M, push) {
  const pa = prim.getAttribute('POSITION'), idx = prim.getIndices();
  const n = idx ? idx.getCount() : pa.getCount(), e = [0, 0, 0];
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], t = new THREE.Vector3();
  for (let i = 0; i + 2 < n; i += 3) {
    for (let k = 0; k < 3; k++) { pa.getElement(idx ? idx.getScalar(i + k) : i + k, e); v[k].fromArray(e).applyMatrix4(M); }
    const L = Math.max(v[0].distanceTo(v[1]), v[1].distanceTo(v[2]), v[2].distanceTo(v[0]));
    const s = Math.min(24, Math.ceil(L / 1.2));
    for (let a = 0; a <= s; a++) for (let b = 0; b <= s - a; b++) {
      const c = s - a - b; t.set(0, 0, 0).addScaledVector(v[0], a / s).addScaledVector(v[1], b / s).addScaledVector(v[2], c / s); push(t.x, t.y, t.z);
    }
  }
}

function outside(o, x, y, z) {
  const l = new THREE.Vector3(x, y, z).sub(o.c).applyQuaternion(o.qi);
  return Math.hypot(Math.max(0, Math.abs(l.x) - o.h.x), Math.max(0, Math.abs(l.y) - o.h.y), Math.max(0, Math.abs(l.z) - o.h.z));
}

// greedy-merge occupied voxels into boxes, each box tight around the points it holds
function boxes(pts) {
  const cells = new Map(), key = (i, j, k) => `${i},${j},${k}`;
  for (const p of pts) { const i = Math.floor(p[0] / CELL), j = Math.floor(p[1] / CELL), k = Math.floor(p[2] / CELL); const K = key(i, j, k); let c = cells.get(K); if (!c) cells.set(K, c = { i, j, k, lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9] }); for (let a = 0; a < 3; a++) { c.lo[a] = Math.min(c.lo[a], p[a]); c.hi[a] = Math.max(c.hi[a], p[a]); } }
  const used = new Set(), res = [];
  const has = (i, j, k) => cells.has(key(i, j, k)) && !used.has(key(i, j, k));
  for (const c of [...cells.values()].sort((a, b) => a.k - b.k || a.j - b.j || a.i - b.i)) {
    if (used.has(key(c.i, c.j, c.k))) continue;
    let i1 = c.i; while (has(i1 + 1, c.j, c.k)) i1++;
    let j1 = c.j; grow: while (true) { for (let i = c.i; i <= i1; i++) if (!has(i, j1 + 1, c.k)) break grow; j1++; }
    let k1 = c.k; growk: while (true) { for (let i = c.i; i <= i1; i++) for (let j = c.j; j <= j1; j++) if (!has(i, j, k1 + 1)) break growk; k1++; }
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let i = c.i; i <= i1; i++) for (let j = c.j; j <= j1; j++) for (let k = c.k; k <= k1; k++) { const K = key(i, j, k), q = cells.get(K); used.add(K); for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], q.lo[a]); hi[a] = Math.max(hi[a], q.hi[a]); } }
    const cc = lo.map((v, a) => +((v + hi[a]) / 2).toFixed(2)), h = lo.map((v, a) => +Math.max(MINH, (hi[a] - v) / 2 + PAD).toFixed(2));
    res.push({ c: cc, h, q: [0, 0, 0, 1] });
  }
  return res;
}

for (const f of ['station', 'depot', 'freighter']) {
  if (ONLY.length && !ONLY.includes(f)) continue;
  const doc = await io.read(`src/assets/${f}.glb`);
  const data = JSON.parse(fs.readFileSync(`src/assets/${f}.json`));
  const nodes = doc.getRoot().listNodes();
  const W = (n) => new THREE.Matrix4().fromArray(n.getWorldMatrix());
  const frameOf = (n) => { const p = n.getParentNode(); return p ? W(p) : new THREE.Matrix4(); };
  const res = out[f] = { chunks: {} };
  const miss = {};
  const firstChunk = Object.keys(data.chunks).find((k) => nodes.some((n) => n.getName() === k));
  for (const n of nodes) {
    const m = n.getMesh(); if (!m || SKIP.test(n.getName())) continue;
    let a = n, chunk = null; while (a) { if (data.chunks[a.getName()]) { chunk = a; break; } a = a.getParentNode(); }
    if (!chunk && n.getName() === 'ring') continue;   // the spinning ring has its own sphere chain (Site.ring)
    // loose static meshes (the depot crane) ride on the site's first chunk
    const owner = chunk ? chunk.getName() : firstChunk;
    const ownerNode = chunk || nodes.find((x) => x.getName() === firstChunk);
    const M = frameOf(ownerNode).invert().multiply(W(n));
    const obbs = (data.chunks[owner]?.obbs || []).map((o) => ({ c: new THREE.Vector3(...o.c), qi: new THREE.Quaternion(...o.q).invert(), h: new THREE.Vector3(...o.h) }));
    for (const p of m.listPrimitives()) samples(p, M, (x, y, z) => {
      let best = 1e9; for (const o of obbs) { best = Math.min(best, outside(o, x, y, z)); if (best < COVER) return; }
      (miss[owner] ??= []).push([x, y, z]);
    });
  }
  for (const [k, pts] of Object.entries(miss)) { res.chunks[k] = boxes(pts); }
  console.log(f, Object.fromEntries(Object.entries(res.chunks).map(([k, v]) => [k, v.length])));
}
fs.writeFileSync('src/assets/colliders.json', JSON.stringify(out));
