// Order a ship and film the whole delivery through the cinematic camera: berth unfolds, container docks through the
// end doors, doors close. Logs the door state per frame. env OUT, ID=wren, SPEED=3, EVERY=2500 (ms), PHONE=1, URL
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const OUT = process.env.OUT || '/mnt/project-files/low-orbit/hangar/', ID = process.env.ID || 'wren', PHONE = !!process.env.PHONE;
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage(PHONE ? { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true } : { viewport: { width: 960, height: 540 } });
let errs = 0; p.on('console', (m) => { if (m.type() === 'error') { errs++; console.log('console:', m.text()); } }); p.on('pageerror', (e) => { errs++; console.log('pageerror:', e.message); });
await p.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('rell.save', JSON.stringify({ credits: 900000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); } catch {} });
await p.goto(process.env.URL || 'http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 180000 }); await p.waitForTimeout(3000);
const ev = (f, a) => p.evaluate(f, a);
await ev((id) => __game.yard.order(id), ID); await p.waitForTimeout(2000);
await ev((s) => { const J = __game.base.jobs[0]; if (J) J.speed = s; }, +(process.env.SPEED || 3));
let i = 0;
for (let n = 0; n < 400; n++) {
  const st = await ev(() => { const B = __game.base, J = B.jobs[0], bb = B.berths[0]; return { busy: B.busy(), t: J ? +J.t.toFixed(1) : -1, k: bb ? +bb.k.toFixed(2) : -1, door: bb?.door ? +bb.door.open.toFixed(2) : -1, force: !!bb?.doorForce, state: bb?.state }; });
  if (!st.busy) break;
  console.log(JSON.stringify(st));
  await p.screenshot({ path: OUT + (PHONE ? 'ph-' : '') + 'flow-' + String(i++).padStart(2, '0') + '.png' });
  await p.waitForTimeout(+(process.env.EVERY || 2500));
}
await p.waitForTimeout(9000);
console.log('final', JSON.stringify(await ev(() => { const g = __game, bb = g.base.berths[0]; return { parked: g.yard.recs[0]?.parked, door: bb.door.open, state: bb.state }; })), 'errors', errs);
await b.close();
