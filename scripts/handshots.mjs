// First-person hands and open-canopy glass shots. Usage: node scripts/handshots.mjs <outdir> [w] [h]  (vite on :5173)
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [out = 'shots/hands', w = 1280, h = 720] = process.argv.slice(2);
const fs = await import('node:fs'); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const mobile = +w < 600;
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 90000 });
const wait = (ms) => p.waitForTimeout(ms);
const shot = async (n) => { await p.screenshot({ path: `${out}/${n}.png` }); console.log('shot', n); };
await wait(3000);
await p.evaluate(() => { const g = window.__game; g.rig.introDur = 0; g.ship.vel.set(0, 0, 0); if (g.tutorial.on) g.tutorial.finish(); g.tutorial.hideIntro?.(); });
await p.evaluate(() => window.__game.eva.request());
await p.waitForFunction(() => window.__game.eva.state === 'eva', null, { timeout: 300000 });
await wait(800);
// first person, floating beside the ship, looking forward: hands idle with cutter
const place = (o, tgt) => p.evaluate(([o, tgt]) => { const g = window.__game, T = g.THREE, e = g.eva; const q = g.ship.quat; e.view = 0;
  e.pilot.pos.copy(g.ship.pos).add(new T.Vector3(...o).applyQuaternion(q)); e.pilot.vel.copy(g.ship.vel);
  const m = new T.Matrix4().lookAt(e.pilot.pos, g.ship.pos.clone().add(new T.Vector3(...tgt).applyQuaternion(q)), new T.Vector3(0, 1, 0).applyQuaternion(q)); e.pilot.quat.setFromRotationMatrix(m); }, [o, tgt]);
await place([2.5, 1.5, -3], [0, 0.6, 0.4]); await wait(1200); await shot('fp-cutter');
await p.evaluate(() => { window.__game.input.mouseFire = true; }); await wait(700); await shot('fp-firing');
await p.evaluate(() => { window.__game.input.mouseFire = false; });
// canopy from outside (third person camera orbiting the ship, canopy up)
for (const [n, o, t] of [['front34', [3.2, 2.4, -4.5], [0, 0.7, -0.6]], ['side', [5.5, 1.2, -0.6], [0, 0.7, -0.6]], ['top', [0.6, 5.5, -2.2], [0, 0.7, -0.6]], ['rear', [2.2, 2.2, 4.2], [0, 0.9, -0.4]]]) {
  await place(o, t); await wait(900); await shot('canopy-' + n);
}
await b.close();
