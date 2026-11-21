// Admin console check with REAL input: mouse clicks (after grabbing pointer lock) on desktop, taps on a phone.
// node scripts/adminshots.mjs <outdir>        (vite on :5173)   MOBILE=1 for the phone run
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [dir = 'shots/admin'] = process.argv.slice(2);
const fs = await import('node:fs'); fs.mkdirSync(dir, { recursive: true });
const mobile = !!process.env.MOBILE;
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext(mobile ? { ...devices['iPhone 13'], deviceScaleFactor: 2 } : { viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
let errs = 0, fails = 0;
p.on('pageerror', (e) => { errs++; console.log('pageerror:', e.message); });
p.on('console', (m) => { if (m.type() === 'error') { errs++; console.log('console:', m.text()); } });
await p.addInitScript(() => { try { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', 1); localStorage.clear(); localStorage.setItem('rell.save', JSON.stringify({ credits: 5000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); } } catch {} });
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 180000 });
await p.waitForTimeout(3500);
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const st = (f) => p.evaluate(f);
const shot = async (n, w = 700) => { await p.waitForTimeout(w); await p.screenshot({ path: `${dir}/${n}.png` }); console.log('shot', n); };
const tap = async (sel, text) => { const l = text ? p.locator(sel, { hasText: text }).first() : p.locator(sel).first(); await l.scrollIntoViewIfNeeded(); if (mobile) await l.tap(); else await l.click(); await p.waitForTimeout(250); };

if (!mobile) {
  // grab the mouse like a player does, then open with the backquote key
  await p.mouse.click(700, 400); await p.waitForTimeout(400);
  ok(await st(() => !!document.pointerLockElement), 'pointer locked before opening');
  await p.keyboard.press('Backquote'); await p.waitForTimeout(400);
} else {
  await tap('#menubtn'); await p.waitForTimeout(400);
  await tap('#menu [data-a=admin]'); await p.waitForTimeout(400);
}
ok(await st(() => __game.admin.open && document.querySelector('#adm').classList.contains('show')), 'panel open');
ok(await st(() => !__game.menu.open), 'pause menu not covering it');
await shot('01-pilot');
await tap('#adm .atg', 'God mode'); ok(await st(() => __game.admin.s.god), 'God mode toggled by a real click/tap');
await tap('#adm .atg', 'Ghost hull'); ok(await st(() => __game.admin.s.noclip), 'Ghost hull toggled');
await tap('#adm .abt', 'Kick +150'); ok(await st(() => __game.ship.vel.length() > 20), 'Kick moved the ship');
await tap('#adm .abt', 'All stop'); ok(await st(() => __game.ship.vel.length() < 5), 'All stop');
await shot('02-pilot-on');
await tap('#adm nav button', 'Cash'); const c0 = await st(() => __game.econ.credits);
await tap('#adm .abt', '+100k'); ok(await st(() => __game.econ.credits) === c0 + 100000, 'credits +100k');
await tap('#adm .abt', 'Max all'); ok(await st(() => __game.econ.up.thrust === 3), 'max upgrades');
await shot('03-cash');
await tap('#adm nav button', 'Warp'); await shot('04-warp');
await tap('#adm .ali:has-text("halves") .abt', 'Go'); ok(await st(() => __game.ship.pos.distanceTo(__game.world.site.halves.pos) < 400), 'warped to the Halves');
await tap('#adm nav button', 'Spawn'); await tap('#adm .abt', 'Crate rain'); ok(await st(() => __game.salvage.items.length > 12), 'crates spawned');
await shot('05-spawn');
await tap('#adm nav button', 'World'); await tap('#adm .abt', 'Dusk'); await shot('06-world');
await tap('#adm nav button', 'Camera'); await shot('07-camera');
await tap('#adm nav button', 'Debug'); await tap('#adm .atg', 'Stats readout'); await tap('#adm .atg', 'Show colliders');
ok(await st(() => document.querySelector('#admstat').classList.contains('on')), 'stats overlay on');
await shot('08-debug');
await tap('#adm nav button', 'Career'); await shot('09-progress');
await tap('#adm nav button', 'Saves'); await tap('#adm .ali:has-text("Slot 1") .abt', 'Save'); ok(await st(() => !!localStorage.getItem('rell.admin.slot1')), 'slot saved');
await shot('10-saves');
// close, then free cam + colliders in the world
await tap('#adm .x'); ok(await st(() => !__game.admin.open), 'closed with X');
await shot('11-colliders-world', 1500);
await st(() => { __game.admin.set('colliders', false); __game.admin.set('orbit', true); __game.admin.set('letter', true); document.body.classList.add('photo'); });
await shot('12-cinematic', 2500);
console.log(`errors ${errs} fails ${fails}`);
await b.close();
