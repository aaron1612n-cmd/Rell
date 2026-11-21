// Yard hangar flight: launch out of the bay, autopilot home from 400 m, ram the hull at speed.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const OUT = process.env.OUT || '/mnt/project-files/low-orbit/base/';
const URL = process.env.URL || 'http://localhost:5173/';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
let errs = 0;
p.on('console', (m) => { if (m.type() === 'error') { errs++; console.log('console:', m.text()); } });
p.on('pageerror', (e) => { errs++; console.log('pageerror:', e.message); });
await p.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('rell.save', JSON.stringify({ credits: 90000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); } catch {} });
await p.goto(URL); await p.waitForFunction(() => window.__game, null, { timeout: 180000 });
await p.waitForTimeout(3000);
const ev = (f, a) => p.evaluate(f, a);
const shot = (n) => p.screenshot({ path: OUT + n + '.png' });
const st = () => ev(() => { const g = __game, B = g.base, l = B.local(g.ship.pos, new g.THREE.Vector3()); return { cap: B.captured, door: +B.doorOpen.toFixed(2), docked: g.nav.docked, l: l.toArray().map((x) => +x.toFixed(1)), v: +g.ship.vel.length().toFixed(1) }; });
// 1) launch: hold W
await p.keyboard.down('KeyW');
for (let i = 0; i < 12; i++) { await p.waitForTimeout(700); const s = await st(); console.log('launch', JSON.stringify(s)); if (s.l[2] > 30) break; }
await p.keyboard.up('KeyW'); await shot('f1-launched');
// 2) autopilot home from 400 m out in front of the mouth
await ev((near) => { const g = __game, T = g.THREE, B = g.base; g.ship.pos.copy(B.world(new T.Vector3(...(near ? [0, -2, 40] : [60, 30, 400])), new T.Vector3())); g.ship.vel.set(0, 0, 0); g.ship.angVel.set(0, 0, 0); B.captured = false; B.relT = 10; g.setAuto(true); }, !!process.env.NEAR);
for (let i = 0; i < 160; i++) { await p.waitForTimeout(700); const s = await st(); if (i % 8 === 0) console.log('auto', JSON.stringify(s)); if (i === 30) await shot('f2-approach'); if (s.cap) { console.log('captured at', i, JSON.stringify(s)); break; } }
await p.waitForTimeout(3000); await shot('f3-docked'); console.log('docked', JSON.stringify(await st()));
// 3) ram: from outside, 40 m/s straight at the side wall (x+)
await ev(() => { const g = __game, T = g.THREE, B = g.base; g.setAuto(false); B.captured = false; B.relT = 0; g.ship.pos.copy(B.world(new T.Vector3(60, 1, 0), new T.Vector3())); g.ship.vel.copy(B.world(new T.Vector3(20, 1, 0), new T.Vector3())).sub(g.ship.pos).setLength(40); g.ship.angVel.set(0, 0, 0); });
let minX = 99; for (let i = 0; i < 20; i++) { await p.waitForTimeout(400); const s = await st(); minX = Math.min(minX, s.l[0]); }
console.log('ram side: closest x', minX, '(wall outer face ~15.35; inside means it went through)');
// 4) ram the back of the shop from below/behind
await ev(() => { const g = __game, T = g.THREE, B = g.base; g.ship.pos.copy(B.world(new T.Vector3(0, -3, -70), new T.Vector3())); g.ship.vel.copy(B.forward).multiplyScalar(40); g.ship.angVel.set(0, 0, 0); });
let maxZ = -99; for (let i = 0; i < 20; i++) { await p.waitForTimeout(400); const s = await st(); maxZ = Math.max(maxZ, s.l[2]); }
console.log('ram back: furthest z', maxZ, '(shop back wall ~ -30.5)');
console.log('errors', errs);
await b.close();
