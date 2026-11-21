// Drops exact duplicate triangles (same three corners in the same winding, 1 mm) inside each primitive of src/assets/fleet.glb
// and re-packs it the way tools/fleetpack.mjs does. Idempotent. node tools/fleetdedup.mjs [ironwake ...]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read('src/assets/fleet.glb'); await doc.transform(dequantize());
const only = process.argv.slice(2); let dropped = 0;
const inShip = (node) => { for (let n = node; n; n = n.getParentNode()) if (!only.length || only.includes(n.getName())) return true; return false; };
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh(); if (!mesh || !inShip(node)) continue;
  for (const prim of mesh.listPrimitives()) {
    const P = prim.getAttribute('POSITION'), I = prim.getIndices(); if (!I || prim.getMode() !== 4) continue;
    const seen = new Set(), keep = [], e = [0, 0, 0];
    for (let i = 0; i + 2 < I.getCount(); i += 3) {
      const t = [0, 1, 2].map((k) => { const j = I.getScalar(i + k); P.getElement(j, e); return e.map((x) => Math.round(x * 1000)).join(','); });
      const m = t.indexOf([...t].sort()[0]), key = [t[m], t[(m + 1) % 3], t[(m + 2) % 3]].join('|');   // same winding only: opposite-facing pairs are deliberate double sides
      if (seen.has(key)) { dropped++; continue; } seen.add(key); keep.push(I.getScalar(i), I.getScalar(i + 1), I.getScalar(i + 2));
    }
    if (keep.length < I.getCount()) I.setArray(new Uint32Array(keep));
  }
}
console.log('dropped', dropped, 'duplicate triangles');
if (dropped) { await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeColor: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'high' })); await io.write('src/assets/fleet.glb', doc); }
