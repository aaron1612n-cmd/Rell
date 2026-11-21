// Collision coverage probe: for every site (stations, wrecks, depot, all 13 ships) samples random points on the
// visible mesh surface and asks the game's own collision query whether a suit-sized sphere (r 0.3, hovering 0.1 m
// off the surface) and a jet-sized sphere (r 1.5, hovering 0.5 m off: 1 m deep into the visible hull; this one fails the check) touch anything. A miss means that bit of hull is
// not solid: things fly through it. Fast and deterministic, complements the flight tests (clipcheck/suitclip).
// node scripts/check/coverage.mjs [samples=400]   env: MAXMISS (fraction allowed, default 0.02)
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const N = +(process.argv[2] || 400), MAX = +(process.env.MAXMISS || 0.02);
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.addInitScript(() => { try { localStorage.setItem('rell.save', JSON.stringify({ credits: 250000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); } catch {} });
await p.goto(process.env.URL || 'http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 180000 });
await p.waitForTimeout(2500);
const res = await p.evaluate(([N, process_only]) => {
  const g = window.__game, T = g.THREE, w = g.world; g.look.render = () => {};
  g.rig.introDur = 0; if (g.tutorial.on) g.tutorial.finish();
  for (const S of Object.values(g.fleet.byId)) { S.site.group.visible = true; if (!w.sites.includes(S.site)) w.sites.push(S.site); }
  let seed = 5; const R = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const nameOf = (o) => { for (let a = o; a; a = a.parent) if (a.name && !/^(Scene|Group|Object3D)$/.test(a.name)) return a.name; return '?'; };
  const out = {};
  for (const s of w.sites) {
    if (s.kind === 'field' || !s.group) continue; if (process_only && !process_only.includes(s.id || s.kind)) continue;
    s.group.updateMatrixWorld(true);
    const meshes = []; s.group.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && o.visible && o.geometry.attributes.position.count > 30 && !/lamp|light|beacon|glow|holo|float|canopy|plume|exhaust/i.test(o.name) && !(o.material && (o.material.transparent || o.material.blending === 2))) meshes.push(o); });
    if (!meshes.length) continue;
    const cum = []; let tot = 0; for (const m of meshes) { tot += m.geometry.attributes.position.count; cum.push(tot); }
    const id = s.id || s.kind; let tested = 0; const miss = { suit: 0, jet: 0, deep: 0 }, where = {};
    const a = new T.Vector3(), b2 = new T.Vector3(), c = new T.Vector3(), n = new T.Vector3(), cen = new T.Vector3();
    for (let t = 0; t < N; t++) {
      const r = R() * tot; let mi = cum.findIndex((x) => x >= r); const m = meshes[mi], pa = m.geometry.attributes.position, ix = m.geometry.index;
      const tc = ix ? ix.count / 3 : pa.count / 3, ti = Math.floor(R() * tc) * 3, v = (k) => (ix ? ix.getX(ti + k) : ti + k);
      a.fromBufferAttribute(pa, v(0)).applyMatrix4(m.matrixWorld); b2.fromBufferAttribute(pa, v(1)).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(pa, v(2)).applyMatrix4(m.matrixWorld);
      n.copy(b2).sub(a).cross(c.clone().sub(a)); const area = n.length() / 2; if (area < 0.02) continue; n.normalize();
      cen.copy(a).add(b2).add(c).divideScalar(3);
      // skip faces that look inward (a ray along the normal hits the same mesh set again soon = interior/back face)
      const rc = new T.Raycaster(cen.clone().addScaledVector(n, 0.02), n, 0, 6); if (rc.intersectObjects(meshes, false).length) continue;
      tested++;
      for (const [who, rad, off] of [['suit', 0.3, 0.1], ['jet', 1.5, 0.5]]) {
        const p0 = cen.clone().addScaledVector(n, off); w.refreshActive(p0, true);
        let hit = false; w.sphereContacts(p0, rad, () => { hit = true; });
        if (!hit) { miss[who]++; const nm = nameOf(m); where[nm] = (where[nm] || 0) + 1; }
      }
    }
    out[id] = { tested, miss, where };
  }
  return out;
}, [N, (process.env.ONLY || '').split(',').filter(Boolean)]);
let bad = 0;
for (const [id, r] of Object.entries(res)) {
  const sf = r.miss.suit / Math.max(1, r.tested), jf = r.miss.jet / Math.max(1, r.tested), fail = jf > MAX; if (fail) bad++;  // suit contacts also use the mesh BVH + hull SDF in eva, so a world-only suit miss is informational
  const top = Object.entries(r.where).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, v]) => k + ':' + v).join(' ');
  console.log(`${fail ? 'FAIL' : 'ok  '} ${id.padEnd(12)} tested ${String(r.tested).padStart(3)}  suit-miss(info) ${(sf * 100).toFixed(1)}%  jet-miss ${(jf * 100).toFixed(1)}%  ${top}`);
}
console.log(bad ? `${bad} model(s) with non-solid surface` : 'all surfaces solid');
await b.close(); process.exit(bad ? 1 : 0);
