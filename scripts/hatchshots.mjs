// Getting out of the ship and back in, as frame strips. VIEW=fp (cockpit) or tp (chase).
// Usage: VIEW=tp node scripts/hatchshots.mjs <outdir> [w] [h]   (needs vite on :5173)
// Frames are taken when the hatch clock passes each time, so they match at any frame rate.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [out = 'shots/hatch', w = 1280, h = 720] = process.argv.slice(2);
const view = process.env.VIEW || 'tp';
const fs = await import('node:fs'); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const mobile = +w < 600;
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
if (process.env.REDUCED) await p.emulateMedia({ reducedMotion: 'reduce' });
p.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[hatch]')) console.log('console:', m.text()); });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 90000 });
await p.waitForTimeout(3000);
await p.evaluate((v) => { const g = window.__game; g.rig.introDur = 0; g.ship.vel.set(0, 0, 0); if (g.tutorial.on) g.tutorial.finish(); g.tutorial.hideIntro?.(); if (v === 'fp') g.cockpit.toggle(); }, view);
await p.waitForTimeout(view === 'fp' ? 2500 : 800);
const at = async (state, t, name) => {
  await p.waitForFunction(([s, t]) => { const e = window.__game.eva; return e.state !== s || e.hatch.t >= t; }, [state, t], { timeout: 300000, polling: 16 });
  await p.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name, await p.evaluate(() => { const g = window.__game, e = g.eva, q = g.ship.quat.clone().invert(), f = (v) => v.toArray().map((x) => x.toFixed(2)).join(','); return `t ${e.hatch.t.toFixed(2)} cam ${f(g.camera.position.clone().sub(g.ship.pos).applyQuaternion(q))} torso ${f(e.hatch.torso)} open ${g.cockpit.open.toFixed(2)} mode ${g.cockpit.mode}`; }));
};
const exitT = (process.env.EXIT || '0.3,0.9,1.5,2.0,2.5,2.9,3.25').split(',').map(Number);
await p.evaluate(() => window.__game.eva.request());
for (const [i, t] of exitT.entries()) await at('out', t, `out-${i}-${t}`);
await p.waitForFunction(() => window.__game.eva.state === 'eva', null, { timeout: 300000 });
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/eva.png` });
// drift back to the seat, facing the ship, then board
await p.evaluate(() => { const g = window.__game, T = g.THREE, e = g.eva; e.pilot.pos.copy(g.ship.pos).add(new T.Vector3(0.9, 1.9, -1.6).applyQuaternion(g.ship.quat)); const m = new T.Matrix4().lookAt(e.pilot.pos, g.ship.pos.clone().add(new T.Vector3(0, 0.9, 0.3).applyQuaternion(g.ship.quat)), new T.Vector3(0, 1, 0).applyQuaternion(g.ship.quat)); e.pilot.quat.setFromRotationMatrix(m); e.pilot.vel.copy(g.ship.vel); e.ropeReset = true; });
await p.waitForTimeout(1500);
await p.evaluate(() => { const e = window.__game.eva; console.log('[hatch] canBoard', e.canBoard); e.request(); console.log('[hatch] A', e.hatch.A); });
const A = await p.evaluate(() => window.__game.eva.hatch.A);
const inT = (process.env.IN || '0.4,1.0,1.6,2.2,2.8,3.4,4.0').split(',').map(Number).map((x) => x * (A + 1.8) / 4);
for (const [i, t] of inT.entries()) await at('in', t, `in-${i}-${t.toFixed(2)}`);
await p.waitForFunction(() => window.__game.eva.state === 'off', null, { timeout: 300000 });
await p.waitForTimeout(800); await p.screenshot({ path: `${out}/in-end-a.png` });
await p.waitForTimeout(1800); await p.screenshot({ path: `${out}/in-end-b.png` });
await b.close();
