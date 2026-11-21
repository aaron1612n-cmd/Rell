// Quantize + meshopt-compress the exported .glb files in src/assets (run after the Blender scripts).
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { quantize, meshopt, dedup, prune } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { statSync } from 'node:fs';
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
for (const n of process.argv.slice(2).length ? process.argv.slice(2) : ['ship', 'station', 'debris', 'cockpit', 'depot', 'freighter', 'salvage', 'astronaut']) {
  const f = `src/assets/${n}.glb`, before = statSync(f).size;
  const doc = await io.read(f);
  await doc.transform(dedup(), prune(), quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeColor: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await io.write(f, doc);
  console.log(n, (before / 1e6).toFixed(2), 'MB ->', (statSync(f).size / 1e6).toFixed(2), 'MB');
}
