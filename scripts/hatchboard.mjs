// Float into a fleet ship's side hatch, get sealed in, take the helm, leave again. Screenshots every phase.
// node scripts/hatchboard.mjs <outdir> [w h]   ID=wren SHIPS=1 lists every ship's hatch spot   (vite on :5173)
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [dir = 'shots/hatchboard', w = 1280, h = 720] = process.argv.slice(2);
const fs = await import('node:fs'); fs.mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const mobile = +w < 600, id = process.env.ID || 'wren', VIEW = +(process.env.VIEW ?? 1);
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
let errs = 0;
p.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[h]')) { errs += m.type() === 'error'; console.log('console:', m.text()); } });
p.on('pageerror', (e) => { errs++; console.log('pageerror:', e.message, e.stack?.split('\n').slice(0, 3).join(' | ')); });
await p.addInitScript(() => { try { localStorage.setItem('rell.save', JSON.stringify({ credits: 250000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); localStorage.removeItem('rell.fleet'); } catch {} });
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 180000 });
await p.waitForTimeout(2500);
const spots = await p.evaluate(() => {
  const g = __game; g.rig.introDur = 0; g.tutorial.on && g.tutorial.finish();
  for (const S of g.fleet.ships) { S.found = true; S.owned = true; if (S.stowed) g.fleet.deliver(S); }
  return g.fleet.ships.map((S) => [S.spec.id, S.air ? (S.air.ok ? +S.air.rh.toFixed(2) : 'NO SPOT') : '-']);
});
console.log('[h] spots', JSON.stringify(spots));
if (process.env.SHIPS) { await b.close(); process.exit(0); }
await p.evaluate(({ id, VIEW }) => {
  const g = __game, T = g.THREE, S = g.fleet.byId[id], e = g.eva; window.F = g.fleet; window.S = S;
  // park the jet far off, stand the suit 6 m off the hatch looking at it
  g.ship.pos.copy(S.V.pos).add(new T.Vector3(0, 400, 0)); g.ship.vel.set(0, 0, 0);
  e.state = 'eva'; e.enterEva(); e.hatch.t = 0; document.body.classList.add('eva'); g.cockpit.target = 0; g.cockpit.blend = 0;
  const H = S.air.world(); const off = H.o.clone().addScaledVector(H.n, 6 + S.air.rh * 2).addScaledVector(H.x, 2);
  e.pilot.pos.copy(off); e.pilot.vel.copy(S.V.vel); e.view = VIEW; e.anchorHatch = H;
  e.pilot.quat.setFromRotationMatrix(new T.Matrix4().lookAt(off, H.o, H.u)); e.ropeReset = true; e.tpInit = false;
}, { id, VIEW });
const shot = async (n, wait = 700) => { await p.waitForTimeout(wait); await p.screenshot({ path: `${dir}/${n}.png` }); };
await shot('00-approach', 1500);
if (process.env.STATIC) {
  // fixed vantage shots of the model: DIST=m  (open 0..1 via OPEN)
  for (const [n, d, side, up] of [['a', 3.2, 0, 0.4], ['b', 3.2, 2.6, 1.6], ['c', 2.4, -2.2, 0.6]]) {
    await p.evaluate(({ d, side, up }) => { const H = S.air.world(), e = __game.eva, T = __game.THREE; S.air.hold = true; S.air.target = +(window.OPEN ?? 0); S.air.k = S.air.target;
      const o = H.o.clone().addScaledVector(H.n, d).addScaledVector(H.x, side).addScaledVector(H.u, up); e.pilot.pos.copy(o); e.pilot.vel.copy(S.V.vel); e.pilot.quat.setFromRotationMatrix(new T.Matrix4().lookAt(o, H.o, H.u)); e.view = 0; e.anchorHatch = S.air; }, { d, side, up });
    await p.evaluate((o) => { window.OPEN = o; }, +(process.env.OPEN ?? 0));
    await shot('s-' + n, 900);
  }
  await b.close(); process.exit(0);
}
// drift in: velocity toward the hatch
await p.evaluate(() => { const H = S.air.world(), e = __game.eva; e.pilot.vel.copy(S.V.vel).addScaledVector(H.n, -1.2); });
await p.keyboard.down('KeyW');
for (let i = 1; i <= 14; i++) {
  await shot(String(i).padStart(2, '0') + '-in', 450);
  const st = await p.evaluate(() => [!!__game.eva.lock, +S.air.k.toFixed(2), F.helm?.spec.id || '-', +__game.eva.pilot.pos.distanceTo(S.air.o).toFixed(1)].join(' '));
  console.log('[h] in', i, st);
  if (await p.evaluate(() => !!__game.eva.lock)) await p.keyboard.up('KeyW');
  if (await p.evaluate(() => !!F.helm)) break;
}
console.log('[h] helm', await p.evaluate(() => F.helm?.spec.id), 'hatch', await p.evaluate(() => S.air.state));
await shot('20-helm', 900);
await p.keyboard.press('KeyG');
for (let i = 1; i <= 12; i++) {
  await shot(String(30 + i) + '-out', 450);
  const st = await p.evaluate(() => [!!__game.eva.lock, +S.air.k.toFixed(2), F.helm?.spec.id || '-', __game.eva.state].join(' '));
  console.log('[h] out', i, st);
}
console.log('[h] errors', errs);
await b.close();
