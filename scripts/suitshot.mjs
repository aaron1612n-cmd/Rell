// Put the EVA suit somewhere, fly it into whatever is ahead for a moment, and screenshot it.
// node scripts/suitshot.mjs <out.png> '<json>' [w] [h]
//   json: { start:[x,y,z] world | rel:'relay'|'ship', at:[x,y,z] (local to rel), dir:[x,y,z], speed, frames,
//           view:0|1, yaw, pitch, roll (body, rad, relative to dir), cam:[x,y,z] (offset from pilot, world, optional; TP),
//           fire, setup (js run first) }
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [out, spec, w = 1280, h = 720] = process.argv.slice(2);
const S = JSON.parse(spec);
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const mobile = +w < 600;
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
p.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[s]')) console.log(m.text()); });
await p.goto(process.env.URL || 'http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 120000 });
await p.waitForTimeout(2000);
await p.evaluate(() => { const g = window.__game; g.rig.introDur = 0; g.ship.vel.set(0, 0, 0); if (g.tutorial.on) g.tutorial.finish(); g.tutorial.hideIntro?.(); g.eva.request(); });
await p.waitForFunction(() => window.__game.eva.state === 'eva', null, { timeout: 300000 });
await p.evaluate((S) => {
  const g = window.__game, T = g.THREE, e = g.eva, ship = g.ship, V = (a) => new T.Vector3(...a);
  if (S.setup) new Function('g', 'T', S.setup)(g, T);
  let start, dir = V(S.dir || [0, 0, -1]).normalize(), rq = new T.Quaternion();
  if (S.rel === 'relay') { const M = g.world.sites.find((s) => s.byName && s.byName.relay).group.matrixWorld; start = V(S.at).applyMatrix4(M); dir.transformDirection(M); M.decompose(V([0,0,0]), rq, V([0,0,0])); ship.pos.copy(V([0, 60, 0]).applyMatrix4(M)); g.world.refreshActive(ship.pos, true); for (const d of Object.values(g.relay.doors)) if (S.doors !== false) d.open = d.kind === 'outer' ? 0 : 1; }
  else if (S.rel === 'ship') { ship.pos.set(3000, 2600, 3000); ship.quat.identity(); start = V(S.at).add(ship.pos); g.world.refreshActive(ship.pos, true); }
  else start = V(S.start);
  ship.vel.set(0, 0, 0); g.shipMesh.position.copy(ship.pos); g.shipMesh.quaternion.copy(ship.quat); g.shipMesh.updateMatrixWorld(true);
  e.view = S.view ?? 1; e.pilot.pos.copy(start); e.pilot.vel.copy(dir).multiplyScalar(S.speed ?? 2);
  const q = new T.Quaternion().setFromUnitVectors(V([0, 0, -1]), dir).multiply(new T.Quaternion().setFromEuler(new T.Euler(S.pitch || 0, S.yaw || 0, S.roll || 0)));
  e.pilot.quat.copy(q); e.ropeReset = true; e.tpInit = false; e.anim.reset();
  const th = dir.clone().applyQuaternion(q.clone().invert());
  const cmd = { fwd: -th.z, strafe: th.x, vert: th.y, dx: 0, dy: 0, roll: 0, brake: false, boost: false, yawKey: 0, pitchKey: 0, reel: false, fire: !!S.fire };
  const n = S.frames ?? 90;
  for (let i = 0; i < n; i++) { g.relay.update(1 / 60, i / 60, g.camera.position, e, ship); e.update(1 / 60, i < n - 20 ? cmd : { ...cmd, fwd: 0, strafe: 0, vert: 0 }); }
  window.__hold = { pos: e.pilot.pos.clone(), quat: e.pilot.quat.clone() };
  g.input.mouseFire = !!S.fire;
  // freeze the pilot where it ended up (the live loop keeps posing the body)
  const fly = e.flyPilot.bind(e); e.flyPilot = (dt, c) => { e.pilot.vel.copy(ship.vel); e.pilot.pos.copy(window.__hold.pos); e.pilot.quat.copy(window.__hold.quat); };
  if (S.cam) { const off = V(S.cam).applyQuaternion(rq); const cam = g.camera; const pl = e.place.bind(e); e.place = (dt, c) => { pl(dt, c); cam.position.copy(e.pilot.pos).add(off); cam.lookAt(e.pilot.pos.clone().add(V(S.look || [0, 0, 0]).applyQuaternion(rq))); cam.updateMatrixWorld(); }; }
  console.log('[s] pilot', e.pilot.pos.toArray().map((v) => v.toFixed(2)).join(','), 'touching', e.suit ? e.suit.touching : '-', 'tuck', e.tuck ? e.tuck.R.toFixed(2) + ' ' + e.tuck.L.toFixed(2) : '-');
}, S);
await p.waitForTimeout(+(process.env.WAIT || 2500));
await p.screenshot({ path: out });
await b.close();
