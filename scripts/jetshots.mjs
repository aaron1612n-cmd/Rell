// Jetpack + suit screenshots in the game: third person thrusting each way, first person with the cutter.
// Usage: node scripts/jetshots.mjs <outdir> [w] [h]   (needs vite on :5173). ONLY=a,b limits the shots.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [out = 'shots/jet', w = 1280, h = 720] = process.argv.slice(2);
const fs = await import('node:fs'); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const mobile = +w < 600;
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 90000 });
const only = (process.env.ONLY || '').split(',').filter(Boolean), want = (n) => !only.length || only.includes(n);
const shot = async (n) => { await p.screenshot({ path: `${out}/${n}.png` }); console.log('shot', n); };
await p.waitForTimeout(2500);
await p.evaluate(() => { const g = window.__game; g.rig.introDur = 0; g.ship.vel.set(0, 0, 0); if (g.tutorial.on) g.tutorial.finish(); });
await p.evaluate(() => window.__game.eva.request());
await p.waitForFunction(() => window.__game.eva.state === 'eva', null, { timeout: 400000 });
// place the pilot beside the ship, camera looking at the sunlit side; keys held through a few frames
const pose = (view, keys, camOff) => p.evaluate(([view, keys, camOff]) => {
  const g = window.__game, T = g.THREE, e = g.eva;
  for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'ShiftLeft', 'KeyC', 'ControlLeft']) g.input.keys.delete(k);
  e.view = view; e.tpInit = false; e.fuel = 1;
  e.pilot.pos.copy(g.ship.pos).add(new T.Vector3(2.5, 2.2, 5).applyQuaternion(g.ship.quat));
  const m = new T.Matrix4().lookAt(e.pilot.pos, g.ship.pos.clone().add(new T.Vector3(camOff, 0, -8).applyQuaternion(g.ship.quat)), new T.Vector3(0, 1, 0).applyQuaternion(g.ship.quat));
  e.pilot.quat.setFromRotationMatrix(m); e.pilot.vel.copy(g.ship.vel);
  for (const k of keys) g.input.keys.add(k);
}, [view, keys, camOff]);
const runs = [['tp-forward', 1, ['KeyW'], 0], ['tp-back', 1, ['KeyS'], 0], ['tp-strafe', 1, ['KeyD'], 0], ['tp-up', 1, ['Space'], 0], ['fp-idle', 0, [], 0], ['fp-back', 0, ['KeyS'], 0]];
for (const [n, view, keys, off] of runs) {
  if (!want(n)) continue;
  await pose(view, keys, off); await p.waitForTimeout(700); await shot(n);
}
await b.close();
