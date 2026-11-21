// Yard rooms: walk-through stills of bay, shop (Ilse), shaft and bunk, plus the finished berth from outside.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const OUT = process.env.OUT || '/mnt/project-files/low-orbit/base/';
const PHONE = !!process.env.PHONE, pre = PHONE ? 'p-' : '';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage(PHONE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 960, height: 540 } });
let errs = 0;
p.on('console', (m) => { if (m.type() === 'error') { errs++; console.log('console:', m.text()); } });
p.on('pageerror', (e) => { errs++; console.log('pageerror:', e.message); });
await p.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('rell.save', JSON.stringify({ credits: 90000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); } catch {} });
await p.goto(process.env.URL || 'http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 180000 });
await p.waitForTimeout(3000);
const ev = (f, a) => p.evaluate(f, a);
const shot = (n) => p.screenshot({ path: OUT + pre + n + '.png' });
await ev(() => __game.input.onExit());
for (let i = 0; i < 120; i++) { await p.waitForTimeout(500); if (await ev(() => __game.eva.state) === 'eva') break; }
const tp = (q, yaw = 0, pitch = 0, view = 1) => ev(([q, yaw, pitch, view]) => { const g = __game, T = g.THREE; g.eva.pilot.pos.copy(g.base.world(new T.Vector3(...q), new T.Vector3())); g.eva.pilot.vel.set(0, 0, 0);
  g.eva.pilot.quat.copy(g.base.site.group.quaternion).multiply(new T.Quaternion().setFromEuler(new T.Euler(pitch, yaw, 0, 'YXZ'))); g.eva.view = view; g.eva.tpInit = true; }, [q, yaw, pitch, view]);
const st = () => ev(() => { const g = __game; return { here: g.base.here, near: g.merchant.near, bed: g.merchant.nearBed, safe: g.eva.safe, obj: document.querySelector('#obj, #objective')?.textContent?.slice(0, 80) }; });
const spots = [
  ['r1-bay-from-shop-door', [0, -3.5, -14], Math.PI, 0.05, 0],
  ['r2-bay-cradle', [9, 2, -10], Math.PI * 0.8, -0.25, 0],
  ['r3-shop-ilse', [0, -3.6, -21.2], 0, -0.05, 0],
  ['r4-shop-ilse-tp', [0.6, -3.6, -21.0], 0, -0.05, 1],
  ['r5-shop-lounge', [-7, -3.5, -21], -Math.PI * 0.6, 0, 0],
  ['r6-shaft-up', [9, -1, -25.5], 0, 1.2, 0],
  ['r7-bunk', [6, 7.6, -20.5], 0.4, -0.1, 0],
  ['r8-bed', [0.9, 7.6, -22.6], 0, -0.1, 0],
  ['r9-bunk-gym', [3, 7.6, -27], Math.PI * 0.75, -0.1, 0],
];
for (const [n, q, yaw, pitch, view] of spots) { await tp(q, yaw, pitch, view); await p.waitForTimeout(3500); console.log(n, JSON.stringify(await st())); await shot(n); }
// outside: free orbit view of the whole yard
await ev(() => { const g = __game; g.eva.request?.(); });
console.log('errors', errs);
await b.close();
