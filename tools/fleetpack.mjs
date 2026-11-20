// Merge the per-ship .glb files from tools/blender/.parts into src/assets/fleet.glb, quantized and meshopt-compressed.
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { quantize, meshopt, dedup, prune, mergeDocuments, unpartition } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { readdirSync, statSync } from 'node:fs';
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const dir = 'tools/blender/.parts', files = readdirSync(dir).filter((f) => f.endsWith('.glb')).sort();
const doc = await io.read(`${dir}/${files[0]}`);
for (const f of files.slice(1)) {
  const d = await io.read(`${dir}/${f}`);
  mergeDocuments(doc, d);
}
// one scene holding every ship
const root = doc.getRoot(), scenes = root.listScenes(), main = scenes[0];
for (const s of scenes.slice(1)) { for (const n of s.listChildren()) main.addChild(n); s.dispose(); }
await doc.transform(unpartition(), dedup(), prune(), quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeColor: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
await io.write('src/assets/fleet.glb', doc);
console.log(files.length, 'ships ->', (statSync('src/assets/fleet.glb').size / 1e6).toFixed(2), 'MB');
