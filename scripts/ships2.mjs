// Checks for the ships rebuild (vite on :5173): node scripts/ships2.mjs <outdir> [mobile]
// collisions (jet, debris vs ships), Ships panel with real clicks under pointer lock / taps, no lineup, labels.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [dir = '/tmp/s/s2', mob] = process.argv.slice(2);
const fs = await import('node:fs'); fs.mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const mobile = !!mob;
const ctx = mobile ? await b.newContext({ ...(await import('/opt/node-tools/node_modules/playwright/index.js').catch(() => ({}))), viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true }) : await b.newContext({ viewport: { width: 1280, height: 720 } });
const p = await ctx.newPage();
let errs = 0;
p.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[t]')) { if (m.type() === 'error') errs++; console.log('console:', m.text()); } });
p.on('pageerror', (e) => { errs++; console.log('pageerror:', e.message); });
await p.addInitScript(() => { try { localStorage.setItem('rell.save', JSON.stringify({ credits: 250000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); localStorage.removeItem('rell.fleet'); } catch {} });
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 180000 });
await p.waitForTimeout(2500);
await p.evaluate(() => { const g = __game; g.rig.introDur = 0; g.tutorial.on && g.tutorial.finish(); window.F = g.fleet; });
const shot = async (n, wait = 1200) => { await p.waitForTimeout(wait); await p.screenshot({ path: `${dir}/${n}.png` }); console.log('shot', n); };
const log = async (n, f, a) => console.log('[t]', n, JSON.stringify(await p.evaluate(f, a)));

await log('in world', () => F.ships.map((S) => S.spec.id + ':' + (S.inWorld ? 'Y' : '-')).join(' '));
// 1. jet flies into a derelict at 20 m/s: must stop at the hull
await log('jet vs gull', async () => {
  const g = __game, T = g.THREE, S = F.byId.gull;
  const c = S.V.pos.clone(), dir = new T.Vector3(1, 0, 0).applyQuaternion(S.V.quat);
  g.ship.pos.copy(c).addScaledVector(dir, 40); g.ship.vel.copy(dir).multiplyScalar(-20); g.ship.angVel.set(0, 0, 0);
  g.ship.quat.setFromRotationMatrix(new T.Matrix4().lookAt(g.ship.pos, c, new T.Vector3(0, 1, 0)));
  g.world.refreshActive(g.ship.pos, true);
  let minD = 1e9; for (let i = 0; i < 240; i++) { await new Promise((r) => requestAnimationFrame(r)); minD = Math.min(minD, g.ship.pos.distanceTo(c)); }
  return { minDistToCentre: +minD.toFixed(2), obbs: g.world.obbs.filter((o) => o.part?.site === S.site).length };
});
// 2. debris thrown at the Lance (buy it first: it appears at its berth)
await log('buy lance', () => { const ok = F.buy('lance'); const S = F.byId.lance; return { ok, inWorld: S.inWorld, distDepot: Math.round(S.V.pos.distanceTo(F.depot.dockPt)) }; });
await log('debris vs lance', async () => {
  const g = __game, T = g.THREE, S = F.byId.lance;
  g.ship.pos.copy(S.V.pos).add(new T.Vector3(0, 60, 0)); g.ship.vel.set(0, 0, 0); g.world.refreshActive(g.ship.pos, true);
  const d = g.world.debris[0]; if (!d) return 'no debris near';
  const up = new T.Vector3(0, 1, 0).applyQuaternion(S.V.quat);
  d.pos.copy(S.V.pos).addScaledVector(up, 30); d.vel.copy(up).multiplyScalar(-15);
  let minUp = 1e9; for (let i = 0; i < 200; i++) { await new Promise((r) => requestAnimationFrame(r)); minUp = Math.min(minUp, d.pos.clone().sub(S.V.pos).dot(up)); }
  return { minHeightAboveCentre: +minUp.toFixed(2), r: d.radius };
});
// 3. look at the bought ship at its berth (no lineup)
await p.evaluate(() => { const g = __game, T = g.THREE, S = F.byId.lance; const wp = S.site.group.localToWorld(new T.Vector3(70, 30, -60)); g.ship.pos.copy(wp); g.ship.vel.set(0, 0, 0); g.ship.angVel.set(0, 0, 0); g.ship.quat.setFromRotationMatrix(new T.Matrix4().lookAt(wp, S.V.pos, new T.Vector3(0, 1, 0))); g.rig.blendFrom(g.camera, 0.001); });
await shot('berth-lance', 2500);
// depot area: nothing lined up
await p.evaluate(() => { const g = __game, T = g.THREE; g.ship.pos.set(520, 120, 1300); g.ship.vel.set(0, 0, 0); g.ship.quat.setFromRotationMatrix(new T.Matrix4().lookAt(g.ship.pos, new T.Vector3(300, 40, 850), new T.Vector3(0, 1, 0))); g.rig.blendFrom(g.camera, 0.001); });
await shot('depot-view', 2500);
// 4. the panel, with real input
if (!mobile) {
  await p.mouse.click(640, 400); await p.waitForTimeout(400);
  await log('locked', () => !!document.pointerLockElement);
  await p.keyboard.press('KeyL'); await p.waitForTimeout(1200);
  await log('after L', () => ({ panel: F.panelOpen, menu: document.getElementById('menu')?.classList.contains('open') || getComputedStyle(document.getElementById('menu')).opacity, lock: !!document.pointerLockElement }));
} else {
  const bb = await p.locator('#shipbtn').boundingBox(); await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(1500);
  await log('after tap', () => F.panelOpen);
}
await shot('panel-yard', 600);
const tap = async (sel) => { const el = p.locator(sel).first(); await el.scrollIntoViewIfNeeded(); const bb = await el.boundingBox(); if (!bb) { console.log('[t] missing', sel); return; } if (mobile) await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); else await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(500); };
await tap('#ships .cd[data-sel="hornet"]'); await log('sel', () => F.sel);
await shot('panel-hornet', 300);
await tap('#ships .act button[data-a="buy"]'); await log('hornet owned', () => F.byId.hornet.owned + ' credits ' + __game.econ.credits);
await tap('#ships .tabs button[data-tab="own"]'); await shot('panel-own', 300);
await tap('#ships .tabs button[data-tab="derelict"]'); await shot('panel-derelict', 300);
await tap('#ships .x'); await log('closed', () => F.panelOpen);
await shot('after-close', 500);
console.log('errors', errs);
await b.close();
