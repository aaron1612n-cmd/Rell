// Classic jet admin toggle with REAL input. node scripts/classicjet.mjs <outdir>   (vite on :5173)  MOBILE=1 for phone taps
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [dir = 'shots/classic'] = process.argv.slice(2);
(await import('node:fs')).mkdirSync(dir, { recursive: true });
const mobile = !!process.env.MOBILE;
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext(mobile ? { ...devices['iPhone 13'], deviceScaleFactor: 2 } : { viewport: { width: 1440, height: 860 } });
const p = await ctx.newPage(); let errs = 0, fails = 0;
p.on('pageerror', (e) => { errs++; console.log('pageerror:', e.message); }); p.on('console', (m) => { if (m.type() === 'error') { errs++; console.log('console:', m.text()); } });
await p.addInitScript(() => { try { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', 1); localStorage.clear(); localStorage.setItem('rell.save', JSON.stringify({ credits: 5000, tut: true, up: {}, stats: {}, career: {} })); } } catch {} });
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 180000 }); await p.waitForTimeout(3500);
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const vis = () => p.evaluate(() => { const m = __game.admin.g.shipMesh; return { modern: m.userData.body.visible, classic: !!__game.admin.classic?.visible }; });
if (mobile) { await p.tap('body', { position: { x: 200, y: 400 } }).catch(() => {}); await p.evaluate(() => __game.menu.toggle(true)); await p.waitForTimeout(500); await p.locator('text=Admin').first().tap(); }
else { await p.mouse.click(700, 400); await p.waitForTimeout(400); ok(await p.evaluate(() => !!document.pointerLockElement), 'pointer locked'); await p.keyboard.press('Backquote'); }
await p.waitForTimeout(800);
const btn = p.locator('#adm .atg', { hasText: 'Classic jet' }).first(); await btn.scrollIntoViewIfNeeded();
mobile ? await btn.tap() : await btn.click(); await p.waitForTimeout(800);
let v = await vis(); ok(!v.modern && v.classic, 'classic on'); await p.screenshot({ path: `${dir}/on-panel.png` });
await p.evaluate(() => { __game.admin.toggle(false); __game.camera.position.copy(__game.ship.pos).add({ x: 6, y: 3, z: 6, isVector3: true }); });
await p.keyboard.press('Backquote').catch(() => {});
await p.evaluate(() => { const a = __game.admin; a.set('orbit', true); }); await p.waitForTimeout(2500); await p.screenshot({ path: `${dir}/on-orbit.png` });
await p.evaluate(() => { const a = __game.admin; a.set('orbit', false); a.toggle(true); a.tab = 'pilot'; a.render(true); });
const btn2 = p.locator('#adm .atg', { hasText: 'Classic jet' }).first(); await btn2.scrollIntoViewIfNeeded(); mobile ? await btn2.tap() : await btn2.click(); await p.waitForTimeout(600);
v = await vis(); ok(v.modern && !v.classic, 'modern restored'); ok(errs === 0, 'no console errors'); console.log('fails', fails);
await b.close();
