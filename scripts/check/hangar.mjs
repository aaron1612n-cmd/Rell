// Hangar solidity: the main hangar (bay, shop, shaft, bunk) and every berth must be solid to a jet-sized body.
//  1) surface coverage: random points on every visible hull of the base site (incl. berths with doors shut) must touch a collider
//  2) leak test: from random directions, a jet-sized sphere marched toward the middle of each room/berth must hit something first
//     (doors shut, nobody nearby). A miss is a hole you can fly or float through.
// node scripts/check/hangar.mjs   env: BERTHS=wren,mule,atlas  SAMPLES=500  RAYS=160  URL=
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const SAMPLES = +(process.env.SAMPLES || 500), RAYS = +(process.env.RAYS || 160), BERTHS = (process.env.BERTHS || 'wren,mule').split(',').filter(Boolean);
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('rell.save', JSON.stringify({ credits: 900000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); } catch {} });
await p.goto(process.env.URL || 'http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 180000 });
await p.waitForTimeout(2500);
const res = await p.evaluate(([N, RAYS, BERTHS]) => {
  const g = window.__game, T = g.THREE, w = g.world, B = g.base; g.look.render = () => {}; g.rig.introDur = 0; if (g.tutorial.on) g.tutorial.finish();
  // berths, fully out
  for (const id of BERTHS) {
    const S = g.fleet.byId[id], r = { id, ...B.slotFor(S.spec) }; g.yard.recs.push(r);
    const need = r.z0 + B.berthDims(S.spec).W; if (need > B.keel[r.side]) { B.keel[r.side] = need; B.buildKeel(r.side, need, false); }
    const bb = B.makeBerth({ ...r, spec: S.spec }); B.poseBerth(bb, 1); bb.state = 'ready'; B.berthCollide(bb, true);
  }
  g.ship.pos.copy(B.world(new T.Vector3(0, 0, 400), new T.Vector3())); B.update(0.016, 1, g.camera.position, g.eva, g.ship);
  for (const bb of B.berths) { bb.door.open = 0; bb.door.hold = 0; bb.doorForce = false; }
  B.doorOpen = 0; B.doorTarget = 0; B.site.group.updateMatrixWorld(true);
  let seed = 11; const R = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const wp = (v) => B.world(v, new T.Vector3());
  const hit = (p0, rad) => { w.refreshActive(p0, true); let h = false; w.sphereContacts(p0, rad, () => { h = true; }); return h; };
  // 1) surface coverage
  const s = B.site; s.group.updateMatrixWorld(true);
  const meshes = []; s.group.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && o.visible && o.geometry.attributes.position.count > 30 && !/lamp|light|beacon|glow|holo|tug|plume/i.test(o.name) && !(o.material && (o.material.transparent || o.material.blending === 2 || o.material.isMeshBasicMaterial && o.material.map == null && o.material.vertexColors && o.material.toneMapped === false))) { let vis = true; for (let a = o; a; a = a.parent) if (!a.visible) vis = false; if (vis) meshes.push(o); } });
  const cum = []; let tot = 0; for (const m of meshes) { tot += m.geometry.attributes.position.count; cum.push(tot); }
  const a = new T.Vector3(), b2 = new T.Vector3(), c = new T.Vector3(), n = new T.Vector3(), cen = new T.Vector3(), miss = {}; let tested = 0, missed = 0;
  const nameOf = (o) => { for (let q = o; q; q = q.parent) if (q.name && !/^(Scene|Group|Object3D)$/.test(q.name)) return q.name; return '?'; };
  for (let t = 0; t < N; t++) {
    const r = R() * tot, mi = cum.findIndex((x) => x >= r), m = meshes[mi], pa = m.geometry.attributes.position, ix = m.geometry.index;
    const tc = ix ? ix.count / 3 : pa.count / 3, ti = Math.floor(R() * tc) * 3, v = (k) => (ix ? ix.getX(ti + k) : ti + k);
    a.fromBufferAttribute(pa, v(0)).applyMatrix4(m.matrixWorld); b2.fromBufferAttribute(pa, v(1)).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(pa, v(2)).applyMatrix4(m.matrixWorld);
    n.copy(b2).sub(a).cross(c.clone().sub(a)); if (n.length() / 2 < 0.02) continue; n.normalize(); cen.copy(a).add(b2).add(c).divideScalar(3);
    if (new T.Raycaster(cen.clone().addScaledVector(n, 0.02), n, 0, 6).intersectObjects(meshes, false).length) continue;
    tested++; if (!hit(cen.clone().addScaledVector(n, 0.5), 1.5)) { missed++; const nm = nameOf(m) + '@' + cen.toArray().map((x) => Math.round(B.local(cen, new T.Vector3()).x)).slice(0, 1); miss[nameOf(m)] = (miss[nameOf(m)] || 0) + 1; }
  }
  // 2) leaks: march a jet-sized sphere in from far away toward the middle of each room / berth
  const targets = [['bay', new T.Vector3(0, 1, 0)], ['shop', new T.Vector3(0, -3, -24.4)], ['shaft', new T.Vector3(9, 2.4, -25.5)], ['bunk', new T.Vector3(6, 7.7, -24.65)]];
  for (const bb of B.berths) targets.push(['berth-' + bb.id, new T.Vector3(...bb.grp.localToWorld(new T.Vector3(bb.len / 2, 0, 0)).toArray()).applyMatrix4(new T.Matrix4().copy(s.group.matrixWorld).invert())]);
  const leaks = {};
  for (const [nm, P] of targets) {
    leaks[nm] = { rays: 0, leaks: 0, ex: [] };
    for (let i = 0; i < RAYS; i++) {
      const d = new T.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize(), dist = nm.startsWith('berth') ? 220 : 120, from = P.clone().addScaledVector(d, dist);
      let leaked = true; const pt = new T.Vector3();
      for (let s2 = dist; s2 > 0; s2 -= 0.6) { pt.copy(P).addScaledVector(d, s2); if (hit(wp(pt.clone()), 1.2)) { leaked = false; break; } }
      // a hit only counts if it is outside the room; if the march started inside a hit, it still is a hit. We want the first contact before reaching P.
      leaks[nm].rays++; if (leaked) { leaks[nm].leaks++; if (leaks[nm].ex.length < 2) leaks[nm].ex.push(d.toArray().map((x) => +x.toFixed(2))); }
    }
  }
  return { tested, missed, miss, leaks };
}, [SAMPLES, RAYS, BERTHS]);
console.log(`surface: tested ${res.tested}, not solid ${res.missed} (${(100 * res.missed / Math.max(1, res.tested)).toFixed(1)}%)`, JSON.stringify(res.miss));
let bad = res.missed / Math.max(1, res.tested) > 0.01 ? 1 : 0;
for (const [k, v] of Object.entries(res.leaks)) { console.log(`${v.leaks ? 'LEAK' : 'ok  '} ${k.padEnd(14)} ${v.leaks}/${v.rays} rays reached the middle ${v.ex.length ? 'e.g. dir ' + JSON.stringify(v.ex) : ''}`); if (v.leaks) bad++; }
console.log(bad ? 'hangar has holes or non-solid surfaces' : 'hangar is sealed and solid');
await b.close(); process.exit(bad ? 1 : 0);
