// Tutorial walk-through: shots of the first steps and a check that every step advances.
// node scripts/tutshots.mjs <outdir> <w> <h>  (vite on :5173)
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [out = 'shots/tut', w = 1280, h = 720] = process.argv.slice(2);
const mobile = +w < 600, tag = mobile ? 'm' : 'd';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 90000 });
const fast = (on) => p.evaluate((on) => { const g = window.__game; g.__r = g.__r || g.look.render.bind(g.look); g.look.render = on ? () => {} : g.__r; }, on);
const shot = async (n) => { await fast(false); await p.waitForTimeout(2500); await p.screenshot({ path: `${out}/${n}-${tag}.png` }); await fast(true); };
await fast(true);
await p.evaluate(() => { const g = window.__game; g.rig.introDur = 0; try { localStorage.clear(); } catch {} g.econ.tut = false; if (!g.tutorial.on) g.tutorial.start(); });
await p.waitForTimeout(500);
await shot('t0');
const step = () => p.evaluate(() => window.__game.tutorial.step);
// fly through each ring by teleporting just in front of it
for (let i = 0; i < 4; i++) {
  await p.evaluate(() => { const g = window.__game, t = g.tutorial, T = g.THREE; const tg = t.target().clone(); const s = g.ship; s.vel.set(0, 0, 0); s.angVel.set(0, 0, 0);
    s.pos.copy(tg).add(new T.Vector3(0, 0, 30).applyQuaternion(t.activeRing ? (t.activeRing()?.quaternion || new T.Quaternion()) : new T.Quaternion()));
    s.quat.setFromUnitVectors(new T.Vector3(0, 0, -1), tg.clone().sub(s.pos).normalize()); });
  if (i === 1) await shot('t1');
  await p.evaluate(() => { const g = window.__game, t = g.tutorial; g.ship.pos.copy(t.target()); });
  await p.waitForTimeout(300);
  console.log('after ring', i, 'step', await step());
}
await shot('t-brake');
await p.evaluate(() => { const g = window.__game, t = g.tutorial; g.ship.pos.copy(t.target()); g.ship.vel.set(0, 0, 0); });
await p.waitForTimeout(400); console.log('after brake step', await step());
await p.evaluate(() => { const g = window.__game, t = g.tutorial, T = g.THREE; const tg = t.target(); g.ship.pos.copy(tg).add(new T.Vector3(0, 0, -16)); g.ship.quat.setFromUnitVectors(new T.Vector3(0, 0, -1), tg.clone().sub(g.ship.pos).normalize()); });
await p.waitForTimeout(400);
await shot('t-grab');
await p.evaluate(() => window.__game.salvage.grab());
await p.waitForTimeout(400); console.log('after grab step', await step(), 'ropes', await p.evaluate(() => window.__game.salvage.ropes.length));
await shot('t-deliver');
await b.close();
