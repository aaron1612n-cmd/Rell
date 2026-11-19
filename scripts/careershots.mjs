// Usage: node scripts/careershots.mjs <outdir> [w h]  — menu, job board, meteor shower, solar flare, tutorial tail
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [dir, w = 1280, h = 720] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const mobile = +w < 600;
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
let errs = 0;
p.on('console', (m) => { if (m.type() === 'error') { errs++; console.log('console:', m.text()); } });
p.on('pageerror', (e) => { errs++; console.log('pageerror:', e.message); });
await p.addInitScript(() => { try { localStorage.setItem('rell.save', JSON.stringify({ credits: 800, tut: true, xp: 700, up: {}, stats: { delivered: 7, jobs: 2, lockers: 3, cores: 1, storms: 2, dist: 12400 } })); } catch {} });
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 90000 });
await p.waitForTimeout(3000);
const shot = async (n) => { await p.waitForTimeout(1200); await p.screenshot({ path: `${dir}/${n}.png` }); };
// job board at the dock
await p.evaluate(() => { const g = __game; g.ship.pos.copy(g.depot.dockPt); g.ship.vel.set(0, 0, 0); g.ship.angVel.set(0, 0, 0); });
await p.waitForTimeout(2500); await shot('dock-jobs');
await p.evaluate(() => __game.career.accept(0)); await shot('job-active');
await p.evaluate(() => { const g = __game; g.ship.pos.set(...[0, 0, 0]).addScaledVector(g.world.site.meridian.pos, 1).add(new g.THREE.Vector3(0, 0, 220)); g.ship.vel.set(0, 0, 0); });
// meteor
await p.evaluate(() => { const e = __game.events; e.state = 'idle'; e.start('meteor'); });
await shot('meteor-warn');
await p.evaluate(() => { const e = __game.events; e.state = 'run'; e.t = 0; for (let i = 0; i < 14; i++) e.spawn(); for (const k of e.rocks) k.pos.addScaledVector(k.vel, 3.6); });
await shot('meteor-run');
await p.evaluate(() => { const e = __game.events; e.finish(); e.rocks.length = 0; e.start('flare'); e.state = 'run'; e.t = 6; });
await shot('flare');
await p.evaluate(() => { __game.events.finish(); });
await p.waitForTimeout(3500);
// menu
await p.evaluate(() => __game.menu.toggle(true)); await shot('menu');
await p.evaluate(() => __game.menu.toggle(false));
console.log('errors', errs);
await b.close();
