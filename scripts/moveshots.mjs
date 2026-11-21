import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const PHONE = !!process.env.PHONE, OUT = '/mnt/project-files/low-orbit/move/' + (PHONE ? 'phone-' : 'desk-');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage(PHONE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 960, height: 540 } });
let errs = 0; p.on('console', (m) => { if (m.type() === 'error') { errs++; console.log('console:', m.text()); } }); p.on('pageerror', (e) => { errs++; console.log('pageerror', e.message); });
await p.addInitScript(() => { try { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', 1); localStorage.clear(); localStorage.setItem('rell.save', JSON.stringify({ credits: 90000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); } } catch {} });
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 180000 }); await p.waitForTimeout(3000);
const B_L = 0; const ev = (f, a) => p.evaluate(f, a);
await ev(() => __game.input.onExit());
for (let i = 0; i < 120; i++) { await p.waitForTimeout(500); if (await ev(() => __game.eva.state) === 'eva') break; }
await p.waitForTimeout(1500);
for (let i = 0; i < 60 && !(await ev(() => __game.eva.safe)); i++) await p.waitForTimeout(500);
await ev(() => { const g = __game, T = g.THREE, B = g.base, e = g.eva; e.pilot.pos.copy(B.world(new T.Vector3(-12, -3, -10), new T.Vector3())); e.pilot.vel.set(0, 0, 0); const t = B.world(new T.Vector3(-30, -3, -10), new T.Vector3()); const m = new T.Matrix4().lookAt(e.pilot.pos, t, new T.Vector3(0, 1, 0).applyQuaternion(B.site.group.quaternion)); e.pilot.quat.setFromRotationMatrix(m); });
await p.keyboard.down('KeyW'); let k = 0;
for (let i = 0; i < 24; i++) { await p.waitForTimeout(700); const s = await ev(() => { const e = __game.eva; return [+e.wallS.toFixed(2), +e.braceK.toFixed(2), +e.pilot.vel.length().toFixed(2), e.suit.touching]; }); console.log(i, JSON.stringify(s)); if (s[1] > 0.4 && k < 2) { await p.screenshot({ path: OUT + 'brace-tp-' + k++ + '.png' }); } }
await p.keyboard.up('KeyW');
await ev(() => dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV' }))); await p.waitForTimeout(1500); await p.screenshot({ path: OUT + 'fp.png' });
console.log('errors', errs); await b.close();
