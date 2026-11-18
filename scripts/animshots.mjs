// Suit + cutter animation screenshots in the game: leaning into thrust, cutting (steadying hand, heat, recoil),
// the cutter holstered, hauling on the tether. Usage: node scripts/animshots.mjs <outdir> [w] [h]  (vite on :5173)
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [out = 'shots/anim', w = 1280, h = 720] = process.argv.slice(2);
const fs = await import('node:fs'); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const mobile = +w < 600;
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
p.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[anim]')) console.log('console:', m.text()); });
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 90000 });
const only = (process.env.ONLY || '').split(',').filter(Boolean), want = (n) => !only.length || only.includes(n);
const shot = async (n) => { await p.screenshot({ path: `${out}/${n}.png` }); console.log('shot', n); };
await p.waitForTimeout(2500);
await p.evaluate(() => { const g = window.__game, T = g.THREE; g.rig.introDur = 0; g.ship.vel.set(0, 0, 0); if (g.tutorial.on) g.tutorial.finish();
  g.ship.hull = 0.7; g.damage.add(new T.Vector3(1, 1.5, -0.5).applyQuaternion(g.ship.quat).add(g.ship.pos), g.ship, 0.18); });
await p.evaluate(() => window.__game.eva.request());
await p.waitForFunction(() => window.__game.eva.state === 'eva', null, { timeout: 400000 });
const frames = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const clear = () => p.evaluate(() => { const g = window.__game; for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'ShiftLeft', 'KeyC', 'ControlLeft', 'KeyR']) g.input.keys.delete(k); g.input.mouseFire = false; });
// free flight beside the ship
const fly = (view, keys) => p.evaluate(([view, keys]) => {
  const g = window.__game, T = g.THREE, e = g.eva;
  e.view = view; e.tpInit = false; e.fuel = 1; e.o2 = 1;
  e.pilot.pos.copy(g.ship.pos).add(new T.Vector3(2.5, 2.2, 5).applyQuaternion(g.ship.quat));
  const m = new T.Matrix4().lookAt(e.pilot.pos, g.ship.pos.clone().add(new T.Vector3(0, 0, -8).applyQuaternion(g.ship.quat)), new T.Vector3(0, 1, 0).applyQuaternion(g.ship.quat));
  e.pilot.quat.setFromRotationMatrix(m); e.pilot.vel.copy(g.ship.vel); e.prevRel.set(0, 0, 0);
  for (const k of keys) g.input.keys.add(k);
}, [view, keys]);
// at the scorch, working it
const weld = (view) => p.evaluate((view) => {
  const g = window.__game, T = g.THREE, e = g.eva; e.view = view; e.tpInit = false;
  const s = g.damage.spots[0]; if (!s) return false; s.weld = 0; s.amt = 1; s.u.uAmt.value = 1;
  const c = g.damage.world(s, g.ship, new T.Vector3()), n = s.n.clone().applyQuaternion(g.ship.quat);
  e.pilot.pos.copy(c).addScaledVector(n, 1.6).add(new T.Vector3(0, -0.42, 0).applyQuaternion(g.ship.quat));
  const m = new T.Matrix4().lookAt(e.pilot.pos.clone().add(new T.Vector3(0, 0.42, 0).applyQuaternion(g.ship.quat)), c, new T.Vector3(0, 1, 0).applyQuaternion(g.ship.quat));
  e.pilot.quat.setFromRotationMatrix(m); e.pilot.vel.copy(g.ship.vel); e.prevRel.set(0, 0, 0); g.input.mouseFire = true; return true;
}, view);
const runs = [
  ['tp-forward', async () => { await fly(1, ['KeyW']); await frames(14); }],
  ['tp-boost', async () => { await fly(1, ['KeyW', 'ShiftLeft']); await frames(14); }],
  ['tp-strafe', async () => { await fly(1, ['KeyD']); await frames(12); }],
  ['tp-cut', async () => { await weld(1); await frames(20); }],
  ['fp-cut', async () => { await weld(0); await frames(20); }],
  ['fp-vent', async () => { await weld(0); await frames(40); await clear(); await frames(5); }],
  ['fp-holster', async () => { await fly(0, []); await p.evaluate(() => { window.__game.eva.idleT = 99; }); await p.waitForFunction(() => { const H = window.__game.eva.holster; return !H.inHand && !H.active; }, null, { timeout: 120000 }); await frames(3); }],
  ['tp-holster', async () => { await fly(1, []); await p.evaluate(() => { window.__game.eva.idleT = 99; }); await frames(6); }],
  ['fp-reel', async () => { await fly(0, ['KeyR']); await p.evaluate(() => { const g = window.__game; g.eva.pilot.pos.add(new g.THREE.Vector3(6, 3, 8)); }); await frames(10); }],
  ['tp-reel', async () => { await fly(1, ['KeyR']); await p.evaluate(() => { const g = window.__game; g.eva.pilot.pos.add(new g.THREE.Vector3(6, 3, 8)); }); await frames(10); }],
];
for (const [n, f] of runs) {
  if (!want(n)) continue;
  await clear(); await f(); await shot(n);
  await p.evaluate(() => { const e = window.__game.eva, H = e.holster; console.log('[anim]', 'heat', e.heat.toFixed(2), 'hand', H.inHand, 'firing', e.firing, 'acc', e.accB.toArray().map((x) => x.toFixed(2)).join(',')); });
}
await b.close();
