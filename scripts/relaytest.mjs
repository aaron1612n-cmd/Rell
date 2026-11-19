// Airlock + collision logic test, no rendering. Usage: node scripts/relaytest.mjs   (needs vite on :5173)
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
p.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
await p.addInitScript(() => { try { localStorage.setItem('rell.save', JSON.stringify({ tut: true })); } catch {} });
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 120000 });
await p.waitForTimeout(2000);
const res = await p.evaluate(() => {
  const g = __game, T = g.THREE, R = g.relay, S = g.world.site.relay, e = g.eva, out = [];
  g.look.render = () => {};   // no drawing
  const W = (x, y, z) => S.group.localToWorld(new T.Vector3(x, y, z));
  e.state = 'eva'; e.enterEva(); e.state = 'eva'; g.ship.pos.copy(W(0, 0, 30)); g.ship.vel.set(0, 0, 0);
  const put = (x, y, z) => { e.pilot.pos.copy(W(x, y, z)); e.pilot.vel.set(0, 0, 0); g.camera.position.copy(e.pilot.pos); };
  let t = 0; const step = (n, dt = 0.05) => { for (let i = 0; i < n; i++) { t += dt; g.world.refreshActive(g.ship.pos); R.update(dt, t, g.camera.position, e, g.ship); } };
  const st = () => ({ air: R.al.air, ph: R.al.phase, goal: R.al.goal, inO: +R.doors.alIn.open.toFixed(2), outO: +R.doors.alOut.open.toFixed(2), here: R.here, safe: R.air(e.pilot.pos) });
  put(0, 0, 24); step(40); out.push(['outside near', st()]);
  put(0, 0, 18.3); step(10); out.push(['in chamber shallow', st()]);
  put(0, 0, 17.6); step(80); out.push(['deep: closing/cycling', st()]);
  step(80); out.push(['cycled', st()]);
  put(0, 0, 15.2); step(30); out.push(['inner open?', st()]);
  put(0, 0, 10); step(30); out.push(['corridor', st()]);
  put(0, 0, 0); step(60); out.push(['hub', st()]);
  // colliders: walk into a wall
  const walls = g.world.obbs.length; out.push(['obbs', walls]);
  // exit
  put(0, 0, 12); step(80); out.push(['to inner door', st()]);
  put(0, 0, 16.3); step(10); put(0, 0, 16.6); step(100); out.push(['out cycle', st()]);
  put(0, 0, 19.0); step(40); out.push(['outer', st()]);
  put(0, 0, 26); step(120); out.push(['far outside', st()]);
  // collision with the hull from outside: pilot shot at the wall
  put(8, 0, 12); e.pilot.vel.set(-4, 0, 0).applyQuaternion(S.group.quaternion); for (let i = 0; i < 120; i++) { e.pilot.pos.addScaledVector(e.pilot.vel, 1 / 120); g.world.collideStatic(e.pilot, 0.2); }
  const L = S.group.worldToLocal(e.pilot.pos.clone()); out.push(['wall hit local', [L.x.toFixed(2), L.z.toFixed(2)]]);
  // fly through the open inner door region unobstructed? hub to cargo
  R.al.air = true; for (const k of ['hubS', 'cgIn']) R.doors[k].open = 1;
  g.world.dirty = true; g.world.refreshActive(g.ship.pos);
  put(0, 0, -3); e.pilot.vel.set(0, 0, -6).applyQuaternion(S.group.quaternion); let blocked = false;
  for (let i = 0; i < 400; i++) { e.pilot.pos.addScaledVector(e.pilot.vel, 1 / 120); g.world.collideStatic(e.pilot, 0.2); }
  const L2 = S.group.worldToLocal(e.pilot.pos.clone()); out.push(['through S corridor z=', L2.z.toFixed(2)]);
  out.push(['loot left', R.left]);
  put(-5.3, -1.1, -20.4); step(2); out.push(['loot taken', R.left, e.cargo]);
  return out;
});
for (const r of res) console.log(JSON.stringify(r));
await b.close();
