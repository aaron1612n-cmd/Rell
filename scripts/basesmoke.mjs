// Yard hangar smoke: load, dock via autopilot, step out, talk to Ilse, order a ship, watch the delivery.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const OUT = process.env.OUT || '/mnt/project-files/low-orbit/base/';
const PHONE = !!process.env.PHONE;
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage(PHONE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : { viewport: { width: 960, height: 540 } });
const pre = PHONE ? 'p-' : '';
let errs = 0;
p.on('console', (m) => { if (m.type() === 'error') { errs++; console.log('console:', m.text()); } });
p.on('pageerror', (e) => { errs++; console.log('pageerror:', e.message, e.stack?.split('\n').slice(0, 4).join(' | ')); });
await p.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('rell.save', JSON.stringify({ credits: 90000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); } catch {} });
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 180000 });
await p.waitForTimeout(3000);
const ev = (f, a) => p.evaluate(f, a);
const shot = (n) => p.screenshot({ path: OUT + pre + n + '.png' });
console.log('start', JSON.stringify(await ev(() => { const g = __game; return { cap: g.base.captured, docked: g.nav.docked, pos: g.ship.pos.toArray().map(Math.round) }; })));
await shot('00-start');
console.log('errors', errs);
if (process.env.STOP === '0') { await b.close(); process.exit(); }
const tp = (q) => ev((q) => { const g = __game; g.eva.pilot.pos.copy(g.base.world(new g.THREE.Vector3(...q), new g.THREE.Vector3())); g.eva.pilot.vel.set(0, 0, 0); g.eva.pilot.quat.copy(g.base.site.group.quaternion); if (q[3]) g.eva.pilot.quat.multiply(new g.THREE.Quaternion().setFromAxisAngle(new g.THREE.Vector3(0, 1, 0), q[3])); }, q);
const st = () => ev(() => { const g = __game; return { eva: g.eva.state, here: g.base.here, near: g.merchant.near, open: g.merchant.open, busy: g.base.busy(), safe: g.eva.safe, status: (document.querySelector('#status, .status')?.textContent || '').slice(0, 90) }; });
const exitKey = async () => { if (PHONE) { const bx = await p.locator('#exitbtn').boundingBox(); console.log('exitbtn', JSON.stringify(bx)); if (bx && bx.width) await p.touchscreen.tap(bx.x + bx.width / 2, bx.y + bx.height / 2); else await ev(() => __game.input.onExit()); } else await p.keyboard.press('KeyG'); };
await exitKey();
for (let i = 0; i < 120; i++) { await p.waitForTimeout(500); if (await ev(() => __game.eva.state) === 'eva') break; }
console.log('out', JSON.stringify(await st()));
await p.waitForTimeout(1500); await shot('01-bay-eva');
await tp([0, -3.6, -21.6]); await p.waitForTimeout(2500);
console.log('counter', JSON.stringify(await st()));
await shot('02-counter');
await exitKey(); await p.waitForTimeout(1200);
console.log('ticket', JSON.stringify(await st()));
await shot('03-ticket');
const click = async (sel) => { const bx = await p.locator(sel).first().boundingBox(); if (!bx) { console.log('NO', sel); return false; } const x = bx.x + bx.width / 2, y = bx.y + bx.height / 2; if (PHONE) await p.touchscreen.tap(x, y); else await p.mouse.click(x, y); await p.waitForTimeout(500); return true; };
await click('#ticket [data-tab="yard"]'); await shot('04-ships-tab');
await click('#ticket [data-a="pick"]'); await shot('05-ship-detail');
console.log('sel', await ev(() => __game.merchant.sel));
await click('#ticket [data-a="order"]');
console.log('ordered', JSON.stringify(await st()), await ev(() => __game.econ.credits));
for (let i = 0; i < 40; i++) { await p.waitForTimeout(4000); if (i % 2 === 0) await shot('06-deliver-' + String(i).padStart(2, '0')); console.log('job', await ev(() => { const J = __game.base.jobs?.[0]; return J ? (J.t || 0).toFixed(1) : 'none'; })); if (await ev(() => !__game.base.busy())) break; }
console.log('after', JSON.stringify(await st()), JSON.stringify(await ev(() => __game.yard.recs)));
await p.waitForTimeout(2000); await shot('07-after-delivery');
await tp([1.5, 7.0, -21.5, 0]); await p.waitForTimeout(3000); console.log('bunk', JSON.stringify(await st())); await shot('08-bunk');
await tp([0.9, 7.6, -22.4, 0]); await p.waitForTimeout(3000); console.log('bed', JSON.stringify(await st())); await shot('09-bed');
console.log('errors', errs);
await b.close();
