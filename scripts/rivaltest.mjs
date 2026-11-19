// deep scan + drone + heat test. Usage: node scripts/rivaltest.mjs <outdir> (needs vite)
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const dir = process.argv[2] || 'shots/rival'; (await import('node:fs')).mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
p.on('pageerror', (e) => console.log('pageerror:', e.message)); p.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
await p.addInitScript(() => { try { localStorage.setItem('rell.save', JSON.stringify({ tut: true })); } catch {} });
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 120000 });
await p.waitForTimeout(2500);
await p.evaluate(() => { const g = __game; g.rig.introDur = 0; g.tutorial.on && g.tutorial.finish(); g.ship.pos.copy(g.world.site.meridian.pos).add(new g.THREE.Vector3(0, 0, 150)); g.ship.vel.set(0, 0, 0); });
console.log('caches hidden', await p.evaluate(() => __game.scan.left));
await p.evaluate(() => __game.scan.fire()); await p.waitForTimeout(900); await p.screenshot({ path: `${dir}/scan-sweep.png` });
await p.waitForTimeout(6000);
console.log('left after scan', await p.evaluate(() => __game.scan.left));
await p.evaluate(() => { const g = __game; const c = g.scan.caches.find((c) => !c.hidden); if (c) { g.ship.pos.copy(c.body.pos).add(new g.THREE.Vector3(0, 6, 14)); g.ship.quat.setFromRotationMatrix(new g.THREE.Matrix4().lookAt(g.ship.pos, c.body.pos, new g.THREE.Vector3(0, 1, 0))); } });
await p.waitForTimeout(1500); await p.screenshot({ path: `${dir}/cache.png` });
// drone: send one at a canister
await p.evaluate(() => { const g = __game, d = g.drones.list[1]; d.mode = 'idle'; d.t = 0; g.ship.pos.copy(d.pos).add(new g.THREE.Vector3(0, 8, 22)); g.ship.vel.set(0, 0, 0); g.ship.quat.setFromRotationMatrix(new g.THREE.Matrix4().lookAt(g.ship.pos, d.pos, new g.THREE.Vector3(0, 1, 0))); });
await p.waitForTimeout(2500); await p.screenshot({ path: `${dir}/drone.png` });
console.log('drone mode', await p.evaluate(() => __game.drones.list.map((d) => d.mode)));
// heat
await p.evaluate(() => { const g = __game; g.ship.pos.set(0, 40, 400); g.ship.vel.set(0, 0, -45); g.ship.quat.identity(); });
await p.evaluate(() => { __game.input.keys.add('KeyW'); __game.input.keys.add('ShiftLeft'); });
await p.waitForTimeout(9000); await p.screenshot({ path: `${dir}/heat.png` });
await b.close();
