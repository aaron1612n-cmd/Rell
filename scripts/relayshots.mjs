// Relay interior screenshots. Usage: node scripts/relayshots.mjs <outdir> [w h]   (needs vite on :5173)
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [dir = 'shots/relay', w = 1280, h = 720] = process.argv.slice(2);
const fs = await import('node:fs'); fs.mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const mobile = +w < 600;
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
let errs = 0;
p.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[r]')) { errs += m.type() === 'error'; console.log('console:', m.text()); } });
p.on('pageerror', (e) => { errs++; console.log('pageerror:', e.message); });
await p.addInitScript(() => { try { localStorage.setItem('rell.save', JSON.stringify({ credits: 0, tut: true, xp: 0, up: {}, stats: {}, career: {} })); localStorage.removeItem('rell.relay'); } catch {} });
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 120000 });
await p.waitForTimeout(2500);
await p.evaluate(() => { const g = __game; g.rig.introDur = 0; g.tutorial.on && g.tutorial.finish(); });
// helper: stand the pilot at a local point looking at another, in EVA
await p.evaluate(() => {
  const g = __game, T = g.THREE, S = g.world.site.relay;
  window.stand = (pos, look, view = 0) => {
    const e = g.eva; if (e.state !== 'eva') { e.state = 'eva'; e.enterEva(); e.hatch.t = 0; e.pass.enabled = true; document.body.classList.add('eva'); g.cockpit.target = 0; g.cockpit.blend = 0; }
    const wp = S.group.localToWorld(new T.Vector3(...pos)), wl = S.group.localToWorld(new T.Vector3(...look));
    e.pilot.pos.copy(wp); e.pilot.vel.set(0, 0, 0); e.view = view;
    const eye = wp.clone().add(new T.Vector3(0, 0.42, 0)); const m = new T.Matrix4().lookAt(eye, wl, new T.Vector3(0, 1, 0).applyQuaternion(S.group.quaternion)); e.pilot.quat.setFromRotationMatrix(m);
    g.ship.pos.copy(S.group.localToWorld(new T.Vector3(0, 0, 30))); g.ship.vel.set(0, 0, 0); e.ropeReset = true; e.tpInit = false;
  };
  window.ext = (pos, look) => { const wp = S.group.localToWorld(new T.Vector3(...pos)); g.ship.pos.copy(wp); g.ship.vel.set(0, 0, 0); g.ship.quat.setFromRotationMatrix(new T.Matrix4().lookAt(wp, S.group.localToWorld(new T.Vector3(...look)), new T.Vector3(0, 1, 0))); };
});
const shot = async (n, wait = 1500) => { await p.waitForTimeout(wait); await p.screenshot({ path: `${dir}/${n}.png` }); console.log('shot', n); };
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (n) => !only.length || only.includes(n);
const views = JSON.parse(process.env.VIEWS || 'null') || [
  ['hub', [0, 0.2, 3.2], [0, 0, -5]], ['hubup', [3, -1, 3], [0, 2.8, -1]], ['hubfloor', [0, 2.2, 0], [0, -3, 0]],
  ['corrN', [0, 0, 6.2], [0, 0, 14]], ['airlock', [0, 0, 16], [0, 0, 19.3]],
  ['cargo', [0, 0, -16], [0, -0.5, -26]], ['cargo2', [-3.5, -1, -23], [4, 0.5, -17]], ['quarters', [14.5, 0, 0], [21, 0, 0]], ['quarters2', [20.5, 0.5, 3], [15, 0, -3]],
  ['lab', [-14.5, 0.3, 3], [-21, -0.5, -1]], ['lab2', [-23, 0.5, -3.5], [-16, -0.8, 1]], ['corrW', [-6, 0, 0], [-13, 0, 0]], ['bay', [3, 0.2, -1], [4.8, 0.1, -3.4]],
];
for (const [n, pos, look] of views) {
  if (!want(n)) continue;
  await p.evaluate(([a, b]) => { stand(a, b); __game.relay.al.air = true; }, [pos, look]);
  await shot(n);
}
// exterior
const ext = [['ext-front', [8, 5, 42], [0, 0, 5]], ['ext-side', [48, 14, 10], [0, 0, 0]], ['ext-top', [-8, 40, -6], [0, 0, -6]], ['ext-aft', [-6, 8, -48], [0, 0, -15]], ['ext-collar', [3.5, 1.5, 28], [0, 0, 20]]];
await p.evaluate(() => { __game.eva.state = 'off'; });
for (const [n, pos, look] of ext) {
  if (!want(n)) continue;
  await p.evaluate(([a, b]) => { ext(a, b); }, [pos, look]);
  await shot(n, 2200);
}
console.log('errors', errs);
await b.close();
