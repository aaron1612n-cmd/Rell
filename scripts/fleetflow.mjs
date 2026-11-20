// Ironwake boarding flow without teleports where it matters: fly into the bay, clamp, get out, cycle the airlock.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 800, height: 450 } });
let errs = 0;
p.on('console', (m) => { if (m.type() === 'error') { errs++; console.log('console:', m.text()); } });
p.on('pageerror', (e) => { errs++; console.log('pageerror:', e.message); });
await p.addInitScript(() => { try { localStorage.setItem('rell.save', JSON.stringify({ credits: 1000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); localStorage.removeItem('rell.fleet'); localStorage.removeItem('rell.ironwake.power'); } catch {} });
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 180000 });
await p.waitForTimeout(2000);
const ev = (f, a) => p.evaluate(f, a);
await ev(() => { const g = __game, T = g.THREE, F = g.fleet, S = F.byId.ironwake; g.tutorial.on && g.tutorial.finish();
  const w = S.site.group.localToWorld(new T.Vector3(46 + 16, -12, -440)); g.ship.pos.copy(w);
  const tgt = S.site.group.localToWorld(new T.Vector3(46, -14.55, -440)); g.ship.vel.copy(tgt).sub(w).setLength(2.5); g.ship.angVel.set(0, 0, 0); g.ship.setMode('drift');
  g.ship.quat.setFromRotationMatrix(new T.Matrix4().lookAt(w, tgt, new T.Vector3(0, 1, 0).applyQuaternion(S.site.group.quaternion))); });
for (let i = 0; i < 70; i++) { await p.waitForTimeout(500); const d = await ev(() => { const F = __game.fleet; return F.dock ? 'dock ' + F.dock.t.toFixed(2) : 'free ' + __game.ship.pos.distanceTo(F.byId.ironwake.site.group.localToWorld(new __game.THREE.Vector3(46, -14.55, -440))).toFixed(1); });  console.log('approach', d); if (d.startsWith('dock 1')) break; }
console.log('status:', await ev(() => __game.fleet.status(false)));
await p.keyboard.press('KeyG');
for (let i = 0; i < 40; i++) { await p.waitForTimeout(500); if (await ev(() => __game.eva.state) === 'eva') break; }
console.log('eva state', await ev(() => __game.eva.state), 'room', await ev(() => __game.fleet.byId.ironwake.decks.here));
// walk the pilot through the airlock in small steps (as if floating), letting doors and cycle run
const path = (process.env.PATH_ON ? [[33, -13, -440], [28.2, -13, -440], [26.0, -13, -440], [22, -13, -440]] : []);
for (const q of path) {
  await ev((q) => { const g = __game, S = g.fleet.byId.ironwake; g.eva.pilot.pos.copy(S.site.group.localToWorld(new g.THREE.Vector3(...q))); g.eva.pilot.vel.copy(S.V.vel); }, q);
  for (let k = 0; k < 6; k++) {
    await p.waitForTimeout(700);
    const r = await ev(() => { const g = __game, D = g.fleet.byId.ironwake.decks; return { room: D.here, al: D.al.phase + '/' + D.al.air + '/' + D.al.goal, out: D.doors.alOut.open.toFixed(2), inn: D.doors.alIn.open.toFixed(2), safe: g.eva.safe, st: g.fleet.status(false).replace(/<[^>]+>/g, '') }; });
    console.log(q[0], k, JSON.stringify(r));
  }
}
console.log('errors', errs);
await b.close();
