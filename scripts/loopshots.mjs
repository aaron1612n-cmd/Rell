// Gameplay HUD shots: towing, docked, unstable wreck. node scripts/loopshots.mjs <outdir> <w> <h>  (vite on :5173)
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [out = 'shots/loop', w = 1280, h = 720] = process.argv.slice(2);
const mobile = +w < 600;
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 90000 });
const tag = mobile ? 'm' : 'd';
// physics runs fast with rendering off; turn it back on for the shot
const fast = (on) => p.evaluate((on) => { const g = window.__game; g.__r = g.__r || g.look.render.bind(g.look); g.look.render = on ? () => {} : g.__r; }, on);
const shot = async (name) => { await fast(false); await p.waitForTimeout(2500); await p.screenshot({ path: `${out}/${name}-${tag}.png` }); await fast(true); };
await fast(true);
await p.evaluate(() => { const g = window.__game; g.econ.tut = true; g.tutorial.start = () => {}; g.tutorial.finish(); g.rig.introDur = 0; });
// 1. towing a crate away from the Meridian, another canister in reach
await p.evaluate(() => {
  const g = window.__game, T = g.THREE, s = g.ship;
  const it = g.salvage.items.find((i) => i.kind === 'crate' && i.site.id === 'meridian'); window.__it = it;
  s.pos.copy(it.body.pos).add(new T.Vector3(0, 2, 14)); s.vel.set(0, 0, 0); s.angVel.set(0, 0, 0);
  s.quat.setFromUnitVectors(new T.Vector3(0, 0, -1), it.body.pos.clone().sub(s.pos).normalize());
  g.world.refreshActive(s.pos, true); g.salvage.attach(it);
  s.quat.setFromUnitVectors(new T.Vector3(0, 0, -1), new T.Vector3(0.3, 0.05, 1).normalize()); g.input.keys.add('KeyW');
});
await p.waitForTimeout(5000);
await p.evaluate(() => { const g = window.__game; g.input.keys.clear(); });
await p.waitForTimeout(1500);
await shot('tow');
// 2. docked at the depot with some credits
await p.evaluate(() => {
  const g = window.__game, T = g.THREE, s = g.ship; g.salvage.releaseAll(); g.econ.credits = 1340; g.econ.up.thrust = 1; g.ship.hull = 0.5;
  g.respawn(); g.world.refreshActive(s.pos, true);
  s.quat.setFromUnitVectors(new T.Vector3(0, 0, -1), g.depot.axis.clone().negate().add(new T.Vector3(0.25, 0.1, 0)).normalize());
});
await p.waitForTimeout(1500);
await shot('dock');
// 3. a wreck coming apart, seen from a safe distance
await p.evaluate(() => {
  const g = window.__game, T = g.THREE, s = g.ship, site = g.world.site.meridian;
  s.pos.set(160, 50, 300); s.vel.set(0, 0, 0); s.angVel.set(0, 0, 0);
  s.quat.setFromUnitVectors(new T.Vector3(0, 0, -1), site.pos.clone().sub(s.pos).normalize());
  g.world.refreshActive(s.pos, true); site.destabilise(3);
});
await p.waitForTimeout(1200);
await shot('unstable');
await p.waitForTimeout(4500);
await shot('collapse');
await b.close();
