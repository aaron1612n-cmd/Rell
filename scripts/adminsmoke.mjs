// Presses every admin button once (through the panel's own click handler) and reports errors.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
let errs = 0; p.on('pageerror', (e) => { errs++; console.log('pageerror:', e.message); }); p.on('console', (m) => { if (m.type() === 'error') { errs++; console.log('console:', m.text()); } });
await p.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('rell.save', JSON.stringify({ credits: 5000, tut: true, up: {}, stats: {}, career: {} })); } catch {} });
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 180000 }); await p.waitForTimeout(3000);
const skip = ['Load text', 'Wipe everything', 'Tap again', 'Load', 'Download', 'Replay', 'Cinematic', 'Screenshot'];
for (const tab of ['pilot', 'warp', 'spawn', 'world', 'cam', 'cash', 'story', 'debug', 'saves']) {
  const labels = await p.evaluate((tab) => { const a = __game.admin; a.toggle(true); a.tab = tab; a.render(true); return [...document.querySelectorAll('#adm .body [data-a]')].map((e) => e.textContent.trim()); }, tab);
  for (let i = 0; i < labels.length; i++) {
    if (skip.some((s) => labels[i].startsWith(s))) continue;
    const r = await p.evaluate(([tab, i]) => { const a = __game.admin; a.tab = tab; a.render(); const el = document.querySelectorAll('#adm .body [data-a]')[i]; if (!el || el.disabled) return 'skip'; el.click(); return 'ok'; }, [tab, i]);
    await p.waitForTimeout(120);
    if (r !== 'ok') continue;
  }
  console.log(tab, labels.length, 'buttons, errors so far', errs);
}
// a few frames with everything on
await p.evaluate(() => { const a = __game.admin; a.set('free', true); a.s.frozen = false; a.s.time = 1; }); await p.waitForTimeout(2000);
const st = await p.evaluate(() => ({ nan: [__game.ship.pos.x, __game.camera.position.x].some(Number.isNaN), drones: __game.drones.list.length, hull: __game.ship.hull, helm: !!__game.fleet.helm }));
console.log(JSON.stringify(st), 'errors', errs);
await b.close();
