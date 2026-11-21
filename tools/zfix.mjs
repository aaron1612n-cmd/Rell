// Separates coplanar, differently-coloured overlapping triangles in the exported .glb files by lifting the smaller one
// 1.2 cm along its normal (they used to z-fight: flicker on plates, spines, cargo boxes, noses). Idempotent.
// node tools/zfix.mjs [station depot freighter ...]   -> then re-run tools/optimize.mjs on the same names.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import * as THREE from 'three';
import { coplanarLifts } from '../src/zfix.js';
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const LIFT = +(process.env.LIFT || 0.012);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['station', 'depot', 'freighter']) {
  const f = `src/assets/${name}.glb`, doc = await io.read(f); await doc.transform(dequantize());
  const items = [], tris = [];       // items: {prim, tri index within prim, M, Minv}
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const M = new THREE.Matrix4().fromArray(node.getWorldMatrix()), Mi = M.clone().invert();
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION'), C = prim.getAttribute('COLOR_0'), I = prim.getIndices(), cnt = I ? I.getCount() : P.getCount(), base = prim.getMaterial()?.getBaseColorFactor() || [1, 1, 1, 1];
      if (prim.getMode() !== 4) continue;
      const mat = prim.getMaterial();
      for (let i = 0; i + 2 < cnt; i += 3) {
        const ix = [0, 1, 2].map((k) => (I ? I.getScalar(i + k) : i + k)), v = ix.map((j) => new THREE.Vector3().fromArray(P.getElement(j, [])).applyMatrix4(M).toArray());
        const col = [base[0], base[1], base[2]]; if (C) { const e = [0, 0, 0].map((_, k) => ix.reduce((s, j) => s + C.getElement(j, [])[k], 0) / 3); col[0] *= e[0]; col[1] *= e[1]; col[2] *= e[2]; }
        tris.push({ a: v[0], b: v[1], c: v[2], col, mat }); items.push({ prim, i, M, Mi });
      }
    }
  }
  const lifts = coplanarLifts(tris), byPrim = new Map();
  for (const [ti, n] of lifts) { const it = items[ti]; (byPrim.get(it.prim) || byPrim.set(it.prim, []).get(it.prim)).push([it, n]); }
  for (const [prim, list] of byPrim) {
    // un-share the lifted triangles' vertices (append copies) so neighbours stay put
    const I = prim.getIndices(), attrs = prim.listSemantics().map((s) => [s, prim.getAttribute(s)]), P = prim.getAttribute('POSITION');
    const idx = I ? Array.from(I.getArray()) : Array.from({ length: P.getCount() }, (_, k) => k);
    const add = new Map(attrs.map(([s, a]) => [s, Array.from(a.getArray())])); let nv = P.getCount();
    for (const [it, n] of list) {
      const dl = new THREE.Vector3(...n).transformDirection(it.Mi).multiplyScalar(LIFT);
      for (let k = 0; k < 3; k++) {
        const j = idx[it.i + k];
        for (const [s, a] of attrs) { const w = a.getElementSize(), arr = add.get(s); for (let q = 0; q < w; q++) arr.push(arr[j * w + q]); }
        const pa = add.get('POSITION'); pa[nv * 3] += dl.x; pa[nv * 3 + 1] += dl.y; pa[nv * 3 + 2] += dl.z;
        idx[it.i + k] = nv++;
      }
    }
    for (const [s, a] of attrs) { const A = doc.createAccessor().setType(a.getType()).setArray(new (a.getArray().constructor)(add.get(s))).setNormalized(a.getNormalized()); prim.setAttribute(s, A); }
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx)));
  }
  await io.write(f, doc);
  console.log(name, 'tris', tris.length, 'lifted', lifts.size);
}
