// In-game fleet checks + screenshots. node scripts/fleetgame.mjs <outdir> [w h]   (vite on :5173)
// ONLY=a,b limits steps.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [dir = 'shots/fleet', w = 1280, h = 720] = process.argv.slice(2);
const fs = await import('node:fs'); fs.mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const mobile = +w < 600 || !!process.env.MOBILE;
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
let errs = 0;
p.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[f]')) { errs += m.type() === 'error'; console.log('console:', m.text()); } });
p.on('pageerror', (e) => { errs++; console.log('pageerror:', e.message, e.stack?.split('\n').slice(0, 3).join(' | ')); });
await p.addInitScript(() => { try { localStorage.setItem('rell.save', JSON.stringify({ credits: 250000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); localStorage.removeItem('rell.fleet'); localStorage.removeItem('rell.ironwake.power'); } catch {} });
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 180000 });
await p.waitForTimeout(2500);
await p.evaluate(() => {
  const g = __game, T = g.THREE; g.rig.introDur = 0; g.tutorial.on && g.tutorial.finish();
  window.F = g.fleet;
  // jet at a point in a ship's frame, looking at another
  window.ext = (id, pos, look, view = 0) => {
    const S = F.byId[id]; const wp = S.site.group.localToWorld(new T.Vector3(...pos)), wl = S.site.group.localToWorld(new T.Vector3(...look));
    g.ship.pos.copy(wp); g.ship.vel.set(0, 0, 0); g.ship.angVel.set(0, 0, 0);
    g.ship.quat.setFromRotationMatrix(new T.Matrix4().lookAt(wp, wl, new T.Vector3(0, 1, 0).applyQuaternion(S.site.group.quaternion)));
    g.cockpit.target = view; g.cockpit.blend = view; g.rig.blendFrom(g.camera, 0.001);
  };
  window.stand = (id, pos, look, view = 0) => {
    const S = F.byId[id], e = g.eva;
    if (e.state !== 'eva') { e.state = 'eva'; e.enterEva(); e.hatch.t = 0; e.pass.enabled = true; document.body.classList.add('eva'); g.cockpit.target = 0; g.cockpit.blend = 0; }
    const wp = S.site.group.localToWorld(new T.Vector3(...pos)), wl = S.site.group.localToWorld(new T.Vector3(...look));
    e.pilot.pos.copy(wp); e.pilot.vel.copy(S.V.vel); e.view = view;
    const m = new T.Matrix4().lookAt(wp, wl, new T.Vector3(0, 1, 0).applyQuaternion(S.site.group.quaternion)); e.pilot.quat.setFromRotationMatrix(m);
    e.ropeReset = true; e.tpInit = false;
  };
});
const shot = async (n, wait = 1500) => { await p.waitForTimeout(wait); await p.screenshot({ path: `${dir}/${n}.png` }); console.log('shot', n); };
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (n) => !only.length || only.includes(n);

if (want('yard')) {
  await p.evaluate(() => { const S = F.byId.mule; window.ext('mule', [-90, 40, 160], [60, 0, 0]); });
  await shot('yard-row', 2500);
  await p.evaluate(() => window.ext('lance', [40, 18, 70], [0, 0, 0]));
  await shot('yard-lance', 2000);
}
if (want('dock')) {
  // fly the Wren: settle on its collar, take the helm, burn
  await p.evaluate(() => { F.buy('wren'); const S = F.byId.wren; F.dockPose(S, __game.ship.pos, __game.ship.quat); F.attach(S, true); });
  await p.waitForTimeout(800);
  console.log('[f] status', await p.evaluate(() => F.status(false)));
  await shot('wren-docked', 600);
  await p.keyboard.press('KeyG'); await p.waitForTimeout(1200);
  console.log('[f] helm', await p.evaluate(() => F.helm?.spec.id));
  await p.keyboard.down('KeyW'); await p.waitForTimeout(2500); await p.keyboard.up('KeyW');
  console.log('[f] wren speed', await p.evaluate(() => F.v.speed.toFixed(1) + ' set ' + F.v.set.toFixed(1) + ' fuel ' + F.v.fuel.toFixed(4)));
  await shot('wren-flying', 300);
  await p.keyboard.press('KeyV'); await shot('wren-eye', 800); await p.keyboard.press('KeyV');
  await p.keyboard.press('KeyX'); await p.waitForTimeout(3000);
  await p.keyboard.press('KeyG'); await p.waitForTimeout(1200);
  console.log('[f] after leave', await p.evaluate(() => [F.helm, !!F.dock, F.byId.wren.V.speed.toFixed(2)].join(' ')));
}
if (want('far')) {
  await p.evaluate(() => window.ext('ironwake', [700, 250, 300], [0, 0, 0]));
  await shot('ironwake-far', 3500);
  await p.evaluate(() => window.ext('ironwake', [160, 30, -330], [40, -10, -440]));
  await shot('ironwake-bay', 3000);
  for (const id of ['gull', 'sable', 'vigil', 'cinder']) { await p.evaluate((id) => { const S = F.byId[id]; const L = S.spec.len || 40; window.ext(id, [L * 0.9, L * 0.35, L * 0.8], [0, 0, 0]); }, id); await shot('adrift-' + id, 2500); }
}
if (want('inside')) {
  await p.evaluate(() => { const S = F.byId.ironwake; F.dockPose(S, __game.ship.pos, __game.ship.quat); F.attach(S, true); });
  await p.waitForTimeout(800);
  const rooms = [['iw-bayfloor', [44, -12.5, -425], [30, -12, -440]], ['iw-airlock', [27.5, -13, -440], [20, -13, -440]], ['iw-corridor', [22, -13, -440], [0, -13, -440]],
    ['iw-junction', [3, -12.6, -436], [0, -12.6, -428]], ['iw-mess', [0, -12, -432], [0, -12.5, -422]], ['iw-eng', [0, -12, -447], [0, -13, -458]],
    ['iw-shaft', [0, -10, -440], [0, 40, -440.1]], ['iw-lobby', [0, 60, -444], [0, 60, -452]], ['iw-bridge', [0, 61, -456], [0, 60, -475]], ['iw-bridge2', [10, 62.5, -466], [-6, 59, -458]]];
  for (const [n, a, l] of rooms) { if (!want('inside') ) continue; await p.evaluate(([a, l]) => { window.stand('ironwake', a, l); __game.fleet.byId.ironwake.decks.al.air = true; }, [a, l]); await shot(n, 1800); }
  // take the helm from the bridge
  await p.evaluate(() => window.stand('ironwake', [0, 58.6, -467], [0, 59, -475]));
  await p.waitForTimeout(500);
  console.log('[f] canHelm', await p.evaluate(() => F.canHelm()?.spec.id), await p.evaluate(() => F.status(false)));
  await p.keyboard.press('KeyG'); await p.waitForTimeout(1500);
  console.log('[f] helm', await p.evaluate(() => F.helm?.spec.id));
  await shot('iw-helm-eye', 4000);
  await p.keyboard.down('KeyW'); await p.waitForTimeout(4000); await p.keyboard.up('KeyW');
  console.log('[f] ironwake speed', await p.evaluate(() => F.v.speed.toFixed(2) + ' set ' + F.v.set.toFixed(2)));
  await p.keyboard.press('KeyV'); await shot('iw-helm-chase', 2500);
  await p.mouse.move(640, 360); await p.keyboard.down('ArrowLeft'); await p.waitForTimeout(3000); await p.keyboard.up('ArrowLeft');
  await shot('iw-helm-turn', 500);
}
if (want('panel')) {
  await p.evaluate(() => F.togglePanel(true)); await shot('panel-yard', 600);
  await p.evaluate(() => { F.tab = 'derelict'; F.render(); }); await shot('panel-derelict', 400);
  await p.evaluate(() => { F.tab = 'own'; F.render(); }); await shot('panel-own', 400);
  await p.evaluate(() => F.togglePanel(false));
}
console.log('errors', errs);
await b.close();
