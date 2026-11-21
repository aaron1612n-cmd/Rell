// Adds box colliders (to src/assets/colliders.json, per chunk) for hull of a wreck that the jet can fly into although the
// generator thought it covered it (misses measured in-game, in each chunk's own authoring frame).
// node scripts/chunkgaps.mjs freighter   (vite on :5173)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const id = process.argv[2] || 'freighter';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
await p.addInitScript(() => { try { localStorage.setItem('rell.save', JSON.stringify({ credits: 250000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); } catch {} });
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 180000 }); await p.waitForTimeout(2500);
const res = await p.evaluate((id) => {
  const g = window.__game, T = g.THREE, w = g.world, s = w.sites.find((x) => x.id === id); g.look.render = () => {};
  s.group.updateMatrixWorld(true);
  const meshes = []; s.group.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && o.visible && o.geometry.attributes.position.count > 30 && !/lamp|light|beacon|glow|holo|float|canopy|plume|exhaust/i.test(o.name) && !(o.material && (o.material.transparent || o.material.blending === 2))) meshes.push(o); });
  const owner = (o) => { for (let a = o; a; a = a.parent) if (s.byName[a.name]) return s.byName[a.name]; return null; };
  const rc = new T.Raycaster(), a = new T.Vector3(), bb = new T.Vector3(), c = new T.Vector3(), n = new T.Vector3(), cen = new T.Vector3();
  const cells = {}, CELL = 3; let seed = 11; const R = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const cum = []; let tot = 0; for (const m of meshes) { tot += m.geometry.attributes.position.count; cum.push(tot); }
  for (let t = 0; t < 12000; t++) {
    const r = R() * tot, mi = cum.findIndex((x) => x >= r), m = meshes[mi], pa = m.geometry.attributes.position, ix = m.geometry.index, tc = ix ? ix.count / 3 : pa.count / 3, ti = Math.floor(R() * tc) * 3, v = (k) => (ix ? ix.getX(ti + k) : ti + k);
    a.fromBufferAttribute(pa, v(0)).applyMatrix4(m.matrixWorld); bb.fromBufferAttribute(pa, v(1)).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(pa, v(2)).applyMatrix4(m.matrixWorld);
    n.copy(bb).sub(a).cross(c.clone().sub(a)); if (n.length() / 2 < 0.02) continue; n.normalize(); cen.copy(a).add(bb).add(c).divideScalar(3);
    rc.set(cen.clone().addScaledVector(n, 0.02), n); rc.far = 6; if (rc.intersectObjects(meshes, false).length) continue;
    const p0 = cen.clone().addScaledVector(n, 0.5); w.refreshActive(p0, true); let hit = false; w.sphereContacts(p0, 1.5, () => { hit = true; });
    if (hit) continue;
    const part = owner(m); if (!part) continue;
    const l = cen.clone().applyMatrix4(part.frame().clone().invert()), k = Math.floor(l.x / CELL) + ',' + Math.floor(l.y / CELL) + ',' + Math.floor(l.z / CELL);
    const e = ((cells[part.name] ??= {})[k] ??= { lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9] });
    for (let i = 0; i < 3; i++) { const q = l.getComponent(i); e.lo[i] = Math.min(e.lo[i], q); e.hi[i] = Math.max(e.hi[i], q); }
  }
  const out = {};
  for (const [nm, cs] of Object.entries(cells)) out[nm] = Object.values(cs).map((e) => { const lo = e.lo.map((l, i) => Math.min(l, (l + e.hi[i]) / 2 - 0.9)), hi = e.hi.map((h, i) => Math.max(h, (e.lo[i] + h) / 2 + 0.9)); return { c: lo.map((l, i) => +((l + hi[i]) / 2).toFixed(2)), h: lo.map((l, i) => +((hi[i] - l) / 2).toFixed(2)), q: [0, 0, 0, 1] }; });
  return out;
}, id);
const J = JSON.parse(fs.readFileSync('src/assets/colliders.json'));
for (const [nm, bx] of Object.entries(res)) { J[id].chunks[nm] = (J[id].chunks[nm] || []).concat(bx); console.log(id, nm, '+', bx.length); }
fs.writeFileSync('src/assets/colliders.json', JSON.stringify(J));
await b.close();
