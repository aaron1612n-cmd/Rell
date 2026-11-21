// Finds exterior relay hull that the jet can fly into (no box collider within 0.5 m) and writes box colliders for it to
// src/assets/relayGaps.json (relay-local frame, used by src/relay.js). Run again after changing the relay's geometry.
// node scripts/relaygaps.mjs   (vite on :5173)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto('http://localhost:5173/?nogaps=1'); await p.waitForFunction(() => window.__game, null, { timeout: 180000 });
await p.waitForTimeout(2500);
const boxes = await p.evaluate(() => {
  const g = window.__game, T = g.THREE, R = g.relay, site = R.site; g.look.render = () => {};
  site.group.updateMatrixWorld(true);
  const inv = site.group.matrixWorld.clone().invert();
  const meshes = []; site.group.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && o.visible && o.geometry.attributes.position.count > 30 && !(o.material && (o.material.transparent || o.material.blending === 2)) && !/lamp|light|beacon|glow|holo|float/i.test(o.name)) meshes.push(o); });
  const obbs = R.B.obbs.map((o) => ({ c: new T.Vector3(...o.c), h: new T.Vector3(...o.h) }));   // axis aligned (q identity)
  const dist = (x, y, z) => { let best = 1e9; for (const o of obbs) { const d = Math.hypot(Math.max(0, Math.abs(x - o.c.x) - o.h.x), Math.max(0, Math.abs(y - o.c.y) - o.h.y), Math.max(0, Math.abs(z - o.c.z) - o.h.z)); if (d < best) best = d; if (best < 0.5) return best; } return best; };
  const rc = new T.Raycaster(), a = new T.Vector3(), bb = new T.Vector3(), c = new T.Vector3(), n = new T.Vector3(), cen = new T.Vector3();
  const cells = new Map(), CELL = 3;
  for (const m of meshes) {
    const pa = m.geometry.attributes.position, ix = m.geometry.index, tc = ix ? ix.count / 3 : pa.count / 3;
    for (let t = 0; t < tc; t += 3) {   // every 3rd triangle is plenty at this scale
      const v = (k) => (ix ? ix.getX(t * 3 + k) : t * 3 + k);
      a.fromBufferAttribute(pa, v(0)).applyMatrix4(m.matrixWorld); bb.fromBufferAttribute(pa, v(1)).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(pa, v(2)).applyMatrix4(m.matrixWorld);
      n.copy(bb).sub(a).cross(c.clone().sub(a)); if (n.length() / 2 < 0.02) continue; n.normalize(); cen.copy(a).add(bb).add(c).divideScalar(3).applyMatrix4(inv);
      if (dist(cen.x, cen.y, cen.z) < 0.5) continue;
      { const nl = n.clone().transformDirection(inv), q = cen.clone().addScaledVector(nl, 0.25); if (R.B.inside(q) >= 0 || R.B.inside(cen.clone().addScaledVector(nl, 0.6)) >= 0) continue; }   // faces that look into a room or corridor are interior, never exterior
      // exterior only: nothing in the way along the outward normal
      const wc = cen.clone().applyMatrix4(site.group.matrixWorld); rc.set(wc.clone().addScaledVector(n, 0.02), n); rc.far = 6; if (rc.intersectObjects(meshes, false).length) continue;
      const k = Math.floor(cen.x / CELL) + ',' + Math.floor(cen.y / CELL) + ',' + Math.floor(cen.z / CELL); let e = cells.get(k);
      if (!e) cells.set(k, e = { lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9] });
      for (let i2 = 0; i2 < 3; i2++) { const q = cen.getComponent(i2); e.lo[i2] = Math.min(e.lo[i2], q); e.hi[i2] = Math.max(e.hi[i2], q); }
    }
  }
  // boxes as lo/hi corners, then carve every room, corridor and tunnel volume out of them (they must never poke into the inside)
  let bx = [...cells.values()].map((e) => ({ lo: e.lo.map((l, i) => Math.min(l, (l + e.hi[i]) / 2 - 0.7) - 0.0), hi: e.hi.map((h, i) => Math.max(h, (e.lo[i] + h) / 2 + 0.7)) }));
  for (const bxo of bx) for (const v of R.B.vols) {
    const lo = [v.min.x, v.min.y, v.min.z], hi = [v.max.x, v.max.y, v.max.z];
    const pen = [0, 1, 2].map((a) => Math.min(bxo.hi[a], hi[a]) - Math.max(bxo.lo[a], lo[a]));
    if (pen.some((q) => q <= 0.02)) continue;                       // not overlapping the volume
    let a = 0; if (pen[1] < pen[a]) a = 1; if (pen[2] < pen[a]) a = 2;
    const mid = (bxo.lo[a] + bxo.hi[a]) / 2, vm = (lo[a] + hi[a]) / 2;
    if (mid < vm) bxo.hi[a] = lo[a] - 0.02; else bxo.lo[a] = hi[a] + 0.02;
  }
  // keep every doorway (airlock mouths especially) clear for the suit: drop boxes within 2.5 m of a door opening
  for (const d of Object.values(R.doors)) {
    const ctr = d.axis === 'z' ? [d.u, d.v, d.at] : [d.at, d.v, d.u], half = d.axis === 'z' ? [1.5, 1.6, 1.0] : [1.0, 1.6, 1.5];
    bx = bx.filter((q) => ![0, 1, 2].every((a) => q.hi[a] > ctr[a] - half[a] && q.lo[a] < ctr[a] + half[a]));
  }
  bx = bx.filter((q) => [0, 1, 2].every((a) => q.hi[a] - q.lo[a] > 0.3));
  return bx.map((q) => ({ c: q.lo.map((l, i) => +((l + q.hi[i]) / 2).toFixed(2)), h: q.lo.map((l, i) => +((q.hi[i] - l) / 2).toFixed(2)) }));
});
fs.writeFileSync('src/assets/relayGaps.json', JSON.stringify(boxes));
console.log('relay gap boxes:', boxes.length);
await b.close();
