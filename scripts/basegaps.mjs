// Finds Rell Yard exterior hull the jet can fly into (no box collider within jet reach) and writes box colliders for it to
// src/assets/baseGaps.json (base-local frame, used by src/base.js). Boxes are carved out of every room.
// node scripts/basegaps.mjs   (vite on :5173)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.addInitScript(() => { try { localStorage.setItem('rell.save', JSON.stringify({ credits: 250000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); } catch {} });
await p.goto('http://localhost:5173/?nogaps=1'); await p.waitForFunction(() => window.__game, null, { timeout: 180000 });
await p.waitForTimeout(2500);
const boxes = await p.evaluate(() => {
  const g = window.__game, T = g.THREE, w = g.world, site = w.sites.find((s) => s.kind === 'base'), Bk = g.base.B; g.look.render = () => {};
  site.group.updateMatrixWorld(true); const inv = site.group.matrixWorld.clone().invert();
  const meshes = []; site.group.traverse((o) => { let vis = true; for (let q = o; q && q !== site.group.parent; q = q.parent) if (q.visible === false) vis = false; if (vis && o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && o.geometry.attributes.position.count > 30 && !/lamp|light|beacon|glow|holo|float|canopy|plume|exhaust/i.test(o.name) && !(o.material && (o.material.transparent || o.material.blending === 2))) meshes.push(o); });
  const rc = new T.Raycaster(), a = new T.Vector3(), bb = new T.Vector3(), c = new T.Vector3(), n = new T.Vector3(), cen = new T.Vector3();
  const cells = new Map(), CELL = 3; let seed = 11; const R = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const cum = []; let tot = 0; for (const m of meshes) { tot += m.geometry.attributes.position.count; cum.push(tot); }
  for (let t = 0; t < 12000; t++) {
    const r = R() * tot, mi = cum.findIndex((x) => x >= r), m = meshes[mi], pa = m.geometry.attributes.position, ix = m.geometry.index, tc = ix ? ix.count / 3 : pa.count / 3, ti = Math.floor(R() * tc) * 3, v = (k) => (ix ? ix.getX(ti + k) : ti + k);
    a.fromBufferAttribute(pa, v(0)).applyMatrix4(m.matrixWorld); bb.fromBufferAttribute(pa, v(1)).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(pa, v(2)).applyMatrix4(m.matrixWorld);
    n.copy(bb).sub(a).cross(c.clone().sub(a)); if (n.length() / 2 < 0.02) continue; n.normalize(); cen.copy(a).add(bb).add(c).divideScalar(3);
    rc.set(cen.clone().addScaledVector(n, 0.02), n); rc.far = 6; if (rc.intersectObjects(meshes, false).length) continue;
    const p0 = cen.clone().addScaledVector(n, 0.5); w.refreshActive(p0, true); let hit = false; w.sphereContacts(p0, 1.5, () => { hit = true; });
    if (hit) continue;
    const l = cen.clone().applyMatrix4(inv), k = Math.floor(l.x / CELL) + ',' + Math.floor(l.y / CELL) + ',' + Math.floor(l.z / CELL); let e = cells.get(k);
    if (!e) cells.set(k, e = { lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9] });
    for (let i = 0; i < 3; i++) { const q = l.getComponent(i); e.lo[i] = Math.min(e.lo[i], q); e.hi[i] = Math.max(e.hi[i], q); }
  }
  let bx = [...cells.values()].map((e) => ({ lo: e.lo.map((l, i) => Math.min(l, (l + e.hi[i]) / 2 - 0.9)), hi: e.hi.map((h, i) => Math.max(h, (e.lo[i] + h) / 2 + 0.9)) }));
  for (const bxo of bx) for (const v of Bk.vols) {
    const lo = [v.min.x, v.min.y, v.min.z], hi = [v.max.x, v.max.y, v.max.z], pen = [0, 1, 2].map((q) => Math.min(bxo.hi[q], hi[q]) - Math.max(bxo.lo[q], lo[q]));
    if (pen.some((q) => q <= 0.02)) continue;
    let q = 0; if (pen[1] < pen[q]) q = 1; if (pen[2] < pen[q]) q = 2;
    if ((bxo.lo[q] + bxo.hi[q]) / 2 < (lo[q] + hi[q]) / 2) bxo.hi[q] = lo[q] - 0.02; else bxo.lo[q] = hi[q] + 0.02;
  }
  bx = bx.filter((q) => [0, 1, 2].every((i) => q.hi[i] - q.lo[i] > 0.3));
  return bx.map((q) => ({ c: q.lo.map((l, i) => +((l + q.hi[i]) / 2).toFixed(2)), h: q.lo.map((l, i) => +((q.hi[i] - l) / 2).toFixed(2)) }));
});
fs.writeFileSync('src/assets/baseGaps.json', JSON.stringify(boxes));
console.log('base gap boxes:', boxes.length);
await b.close();
