// EVA screenshots: canopy opening, first person outside, third person, cutting a locker, welding.
// Usage: node scripts/evashots.mjs <outdir> [w] [h]   (needs vite on :5173)
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [out = 'shots/eva', w = 1280, h = 720] = process.argv.slice(2);
const fs = await import('node:fs'); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const mobile = +w < 600;
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
p.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[eva]')) console.log('console:', m.text()); });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 90000 });
const wait = (ms) => p.waitForTimeout(ms);
const shot = async (n) => { await p.screenshot({ path: `${out}/${n}.png` }); console.log('shot', n); };
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (n) => !only.length || only.includes(n);
await wait(3000);
// park: kill the intro sweep, stop the ship
await p.evaluate(() => { const g = window.__game; g.rig.introDur = 0; g.ship.vel.set(0, 0, 0); if (g.tutorial.on) g.tutorial.finish(); g.tutorial.hideIntro?.(); });
// put a couple of scorches on the hull so there's something to weld
await p.evaluate(() => { const g = window.__game; const T = g.THREE; g.ship.hull = 0.7; g.damage.add(new T.Vector3(1, 1.5, -0.5).applyQuaternion(g.ship.quat).add(g.ship.pos), g.ship, 0.18); g.damage.add(new T.Vector3(-1.4, 0.8, 0.9).applyQuaternion(g.ship.quat).add(g.ship.pos), g.ship, 0.12); });
await wait(600);
if (want('hint')) await shot('0-hint');
await p.evaluate(() => window.__game.eva.request());
await p.waitForFunction(() => window.__game.cockpit.open > 0.45, null, { timeout: 300000 });
if (want('canopy')) await shot('1-canopy-opening');
await p.waitForFunction(() => window.__game.eva.state !== 'off' && window.__game.eva.hatch && window.__game.cockpit.open > 0.9, null, { timeout: 300000 });
if (want('rising')) await shot('2-rising');
await p.waitForFunction(() => window.__game.eva.state === 'eva', null, { timeout: 300000 });
await wait(800);
await p.evaluate(() => console.log('[eva] state', window.__game.eva.state, 'lockers', window.__game.lockers.lockers.length));
if (want('out')) await shot('3-out-first');
// look back at the ship: turn around
await p.evaluate(() => { const g = window.__game, T = g.THREE, e = g.eva; e.pilot.pos.copy(g.ship.pos).add(new T.Vector3(1.8, 1.6, -4.5).applyQuaternion(g.ship.quat)); const m = new T.Matrix4().lookAt(e.pilot.pos, g.ship.pos.clone().add(new T.Vector3(0, 0.5, 0.3).applyQuaternion(g.ship.quat)), new T.Vector3(0, 1, 0).applyQuaternion(g.ship.quat)); e.pilot.quat.setFromRotationMatrix(m); e.pilot.vel.copy(g.ship.vel); });
await wait(1200);
if (want('back')) await shot('4-look-back');
// third person
await p.evaluate(() => { const g = window.__game, T = g.THREE, e = g.eva; e.view = 1; e.pilot.pos.copy(g.ship.pos).add(new T.Vector3(3, 2.4, 6).applyQuaternion(g.ship.quat)); const m = new T.Matrix4().lookAt(e.pilot.pos, g.ship.pos, new T.Vector3(0, 1, 0).applyQuaternion(g.ship.quat)); e.pilot.quat.setFromRotationMatrix(m); g.input.keys.add('KeyW'); });
await wait(900);
if (want('third')) await shot('5-third');
await p.evaluate(() => { window.__game.input.keys.delete('KeyW'); });
// weld: float by a scorch and work it
await p.evaluate(() => { const g = window.__game, T = g.THREE, e = g.eva; e.view = 0; const s = g.damage.spots[0]; const c = g.damage.world(s, g.ship, new T.Vector3()), n = s.n.clone().applyQuaternion(g.ship.quat); e.pilot.pos.copy(c).addScaledVector(n, 1.6).add(new T.Vector3(0, -0.42, 0).applyQuaternion(g.ship.quat)); const m = new T.Matrix4().lookAt(e.pilot.pos.clone().add(new T.Vector3(0, 0.42, 0).applyQuaternion(g.ship.quat)), c, new T.Vector3(0, 1, 0).applyQuaternion(g.ship.quat)); e.pilot.quat.setFromRotationMatrix(m); e.pilot.vel.copy(g.ship.vel); g.input.mouseFire = true; });
await wait(900);
if (want('weld')) await shot('6-weld');
await p.evaluate(() => { window.__game.input.mouseFire = false; });
// a locker: go to the nearest, face it, cut
const ok = await p.evaluate(() => { const g = window.__game, T = g.THREE, e = g.eva; const L = g.lockers.lockers[0]; if (!L) return false; const n = L.n; const tgt = L.g.localToWorld(new T.Vector3(0.43, 0.27, 0.35)); e.pilot.pos.copy(L.wp).addScaledVector(n, 2.0).add(new T.Vector3(0.25, -0.5, 0)); e.pilot.vel.set(0, 0, 0); g.ship.pos.copy(L.wp).addScaledVector(n, 14); const eye = e.pilot.pos.clone().add(new T.Vector3(0, 0.42, 0)); const m = new T.Matrix4().lookAt(eye, tgt, new T.Vector3(0, 1, 0)); e.pilot.quat.setFromRotationMatrix(m); e.ropeReset = true; g.input.mouseFire = true; return true; });
console.log('locker', ok);
await wait(1200);
if (want('cut')) await shot('7-cut');
await p.evaluate(() => { const L = window.__game.lockers.lockers[0]; L.bolts.forEach((b, i) => { if (i) b.heat = 0.99; }); });
await p.waitForFunction(() => window.__game.lockers.lockers[0].state !== 'bolted', null, { timeout: 60000 }); await wait(1500);
await p.evaluate(() => { const g = window.__game, T = g.THREE, e = g.eva; const L = g.lockers.lockers[0]; const eye = e.pilot.pos.clone().add(new T.Vector3(0, 0.42, 0)); const m = new T.Matrix4().lookAt(eye, L.g.localToWorld(new T.Vector3(0, 0, 0.18)), new T.Vector3(0, 1, 0)); e.pilot.quat.setFromRotationMatrix(m); console.log('[eva] locker state', L.state); });
await wait(500);
if (want('open')) await shot('8-open');
await p.waitForFunction(() => window.__game.lockers.towing.length > 0, null, { timeout: 60000 }); await wait(1500);
if (want('tag')) await shot('9-tagged');
await p.evaluate(() => { window.__game.input.mouseFire = false; console.log('[eva] cargo', window.__game.eva.cargo, window.__game.lockers.towing.length); });
await b.close();
