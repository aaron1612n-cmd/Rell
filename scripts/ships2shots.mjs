// Done-checklist screenshots for the fleet, in the real game: every ship from front, back, both sides, top,
// below and a close-up; the chase and helm views when flying each; the Ironwake inside (bay, door opening,
// bridge view). node scripts/ships2shots.mjs <outdir> [url]   MOBILE=1 for a phone. ONLY=ext,helm,iron
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [dir = 'shots/ships2', url = 'http://localhost:4173/'] = process.argv.slice(2);
const fs = await import('node:fs'); fs.mkdirSync(dir, { recursive: true });
const mobile = !!process.env.MOBILE, only = (process.env.ONLY || 'ext,helm,iron').split(',');
const ids = (process.env.IDS || 'wren,kite,hornet,mule,packhorse,prospector,lance,atlas,gull,sable,vigil,cinder,ironwake').split(',');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext(mobile ? { ...devices['iPhone 13'] } : { viewport: { width: 1280, height: 760 } });
const p = await ctx.newPage(); let errs = 0;
p.on('pageerror', (e) => { errs++; console.log('pageerror:', e.message); }); p.on('console', (m) => { if (m.type() === 'error') { errs++; console.log('console:', m.text()); } });
await p.addInitScript(() => { try { localStorage.setItem('rell.save', JSON.stringify({ credits: 900000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); localStorage.removeItem('rell.fleet'); localStorage.removeItem('rell.admin'); } catch {} });
await p.goto(url); await p.waitForFunction(() => window.__game, null, { timeout: 180000 }); await p.waitForTimeout(2500);
await p.evaluate(() => {
  const g = __game, T = g.THREE, F = g.fleet; g.rig.introDur = 0; g.tutorial.on && g.tutorial.finish();
  for (const S of F.ships) { S.found = true; S.owned = true; if (S.stowed) F.deliver(S); }
  // free camera parked anywhere, looking at a point (ship-local coordinates)
  window.look = (id, eye, at) => {
    const S = F.byId[id], A = g.admin, c = g.camera;
    if (!A.s.free) A.set('free', true);
    const e = S.site.group.localToWorld(new T.Vector3(...eye)), t = S.site.group.localToWorld(new T.Vector3(...at));
    // keep the jet out of the picture
    g.ship.pos.copy(e).add(new T.Vector3(0, 400, 0)); g.ship.vel.set(0, 0, 0);
    const d = t.clone().sub(e).normalize(); A.cam.pos.copy(e); A.cam.yaw = Math.atan2(-d.x, -d.z); A.cam.pitch = Math.asin(d.y);
    g.world.dirty = true; g.world.refreshActive(e, true);
  };
});
const shot = async (n, w = 1200) => { await p.waitForTimeout(w); await p.screenshot({ path: `${dir}/${n}.png` }); console.log('shot', n); };
if (only.includes('ext')) for (const id of ids) {
  const box = await p.evaluate((id) => { const S = __game.fleet.byId[id]; return [S.d.min, S.d.max]; }, id);
  const [mn, mx] = box, c = mn.map((v, i) => (v + mx[i]) / 2), sz = mx.map((v, i) => v - mn[i]), R = Math.hypot(...sz) / 2, D = R * 1.9;
  const views = { front: [0, R * 0.25, -D], back: [0, R * 0.25, D], left: [-D, R * 0.2, 0], right: [D, R * 0.2, 0], top: [0.01, D, 0.01], below: [0.01, -D, 0.01] };
  for (const [n, o] of Object.entries(views)) { await p.evaluate(([id, e, a]) => window.look(id, e, a), [id, o.map((v, i) => v + c[i]), c]); await shot(`${id}-${n}`, 900); }
  // close-up: a third of the way along the upper flank
  await p.evaluate(([id, e, a]) => window.look(id, e, a), [id, [mx[0] * 0.9 + sz[0] * 0.15, mx[1] + sz[1] * 0.15, c[2] - sz[2] * 0.12], [c[0] + sz[0] * 0.1, c[1] + sz[1] * 0.2, c[2] + sz[2] * 0.08]]);
  await shot(`${id}-close`, 900);
}
await p.evaluate(() => __game.admin.set('free', false));
if (only.includes('helm')) for (const id of ids) {
  if (id === 'ironwake') continue;
  await p.evaluate((id) => { const g = __game, F = g.fleet, S = F.byId[id]; if (F.helm) { F.helm = null; document.body.classList.remove('helm'); } F.release(false); F.dockPose(S, g.ship.pos, g.ship.quat); F.attach(S, true); }, id);
  await p.waitForTimeout(600);
  await p.evaluate((id) => { const F = __game.fleet; F.take(F.byId[id]); F.view = 0; }, id); await shot(`${id}-chase`, 1500);
  await p.evaluate(() => { __game.fleet.view = 1; }); await shot(`${id}-helm`, 1200);
  await p.evaluate(() => { const F = __game.fleet; F.helm = null; F.v = null; document.body.classList.remove('helm'); F.release(false); });
}
if (only.includes('iron')) {
  // walk the Ironwake: bay, the airlock's outer door mid-open, the bridge from the helm, then fly it
  await p.evaluate(() => {
    const g = __game, F = g.fleet, S = F.byId.ironwake, T = g.THREE, e = g.eva;
    F.dockPose(S, g.ship.pos, g.ship.quat); F.attach(S, true);
    window.stand = (pos, look, view = 0) => {
      if (e.state !== 'eva') { e.state = 'eva'; e.enterEva(); e.hatch.t = 0; e.pass.enabled = true; document.body.classList.add('eva'); g.cockpit.target = 0; g.cockpit.blend = 0; }
      const wp = S.site.group.localToWorld(new T.Vector3(...pos)), wl = S.site.group.localToWorld(new T.Vector3(...look));
      e.pilot.pos.copy(wp); e.pilot.vel.copy(S.V.vel); e.view = view;
      e.pilot.quat.setFromRotationMatrix(new T.Matrix4().lookAt(wp, wl, new T.Vector3(0, 1, 0).applyQuaternion(S.site.group.quaternion)));
      e.ropeReset = true; e.tpInit = false;
    };
  });
  await p.waitForTimeout(800);
  await p.evaluate(() => window.stand([62, -10, -440], [30, -13, -440], 1)); await shot('iron-bay-fp', 1800);
  await p.evaluate(() => window.stand([36, -13, -440], [28, -13, -440], 1)); await p.evaluate(() => { const d = __game.fleet.byId.ironwake.decks; const o = Object.values(d.doors || {})[0]; if (o) { o.target = 1; } }); await shot('iron-door-opening', 700); await shot('iron-door-open', 1500);
  await p.evaluate(() => window.stand([0, 58.6, -466.5], [0, 59.5, -480], 1)); await shot('iron-bridge-fp', 1800);
  await p.evaluate(() => window.stand([0, 58.6, -466.5], [0, 59.5, -480], 0)); await shot('iron-bridge-tp', 1800);
  await p.evaluate(() => { const F = __game.fleet; F.take(F.byId.ironwake); F.view = 1; }); await shot('ironwake-helm', 2000);
  await p.evaluate(() => { __game.fleet.view = 0; }); await shot('ironwake-chase', 2000);
}
console.log('errors', errs);
await b.close();
