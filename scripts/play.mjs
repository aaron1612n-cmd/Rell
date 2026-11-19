// Scripted gameplay checks: node scripts/play.mjs (vite on :5173). Prints state over time.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
p.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[t]')) console.log(m.text()); });
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 90000 });
await p.evaluate(() => { const g = window.__game; g.look.render = () => {}; g.econ.tut = true; g.tutorial.start = () => {}; g.tutorial.finish(); });
const run = async (name, setup, ms, probe) => {
  console.log('==', name);
  await p.evaluate(setup);
  for (let t = 0; t < ms; t += 1000) { await p.waitForTimeout(1000); console.log('[t]', (t / 1000 + 1) + 's', await p.evaluate(probe)); }
};
const probe = `(() => { const g = window.__game, s = g.ship, sal = g.salvage, it = window.__it; return JSON.stringify({ shipV: s.vel.length().toFixed(1), hull: s.hull.toFixed(2), it: it && { st: it.state, strain: (it.strain||0).toFixed(2), d: it.body.pos.distanceTo(s.pos).toFixed(1), v: it.body.vel.length().toFixed(1), integ: it.integrity.toFixed(2) }, ropes: sal.ropes.length, cr: g.econ.credits, fps: window.__fps }); })()`;
await p.evaluate(() => { let n = 0, t0 = performance.now(); const f = () => { n++; const t = performance.now(); if (t - t0 > 1000) { window.__fps = n; n = 0; t0 = t; } requestAnimationFrame(f); }; f(); });
// 1: tear a pod off the Meridian with boost
await run('pod tear', () => {
  const g = window.__game, T = g.THREE, it = g.salvage.items.find((i) => i.part && i.part.name === 'pod_0'); window.__it = it;
  g.ship.pos.copy(it.body.pos).add(new T.Vector3(18, 0, 0)); g.ship.vel.set(0, 0, 0); g.ship.angVel.set(0, 0, 0);
  g.ship.quat.setFromUnitVectors(new T.Vector3(0, 0, -1), new T.Vector3(-1, 0, 0));   // nose at the pod
  g.salvage.candidate = it; g.salvage.attach(it);
  g.ship.quat.setFromUnitVectors(new T.Vector3(0, 0, -1), new T.Vector3(1, 0, 0));    // turn away
  g.input.keys.add('KeyW'); g.input.keys.add('ShiftLeft');
}, 8000, probe);
// 2: tow it toward the depot
await run('tow', () => { const g = window.__game, T = g.THREE; g.input.keys.delete('ShiftLeft'); const d = g.depot.mouth.clone().sub(g.ship.pos).normalize(); g.ship.quat.setFromUnitVectors(new T.Vector3(0, 0, -1), d); }, 5000, probe);
// 3: deliver a canister into the catch
await run('deliver', () => {
  const g = window.__game, T = g.THREE; g.input.keys.clear(); g.salvage.releaseAll();
  const it = g.salvage.items.find((i) => i.kind === 'canister' && i.state === 'free'); window.__it = it;
  const out = g.depot.axis.clone();
  it.body.pos.copy(g.depot.mouth).addScaledVector(out, 48); it.body.vel.set(0, 0, 0);
  g.ship.pos.copy(g.depot.mouth).addScaledVector(out, 36); g.ship.vel.set(0, 0, 0); g.ship.angVel.set(0, 0, 0);
  g.ship.quat.setFromUnitVectors(new T.Vector3(0, 0, -1), out.clone().negate());
  g.salvage.attach(it); g.input.keys.add('KeyW');
}, 5000, probe);
// 4: pull a core -> collapse
await run('core', () => {
  const g = window.__game, T = g.THREE; g.input.keys.clear(); g.salvage.releaseAll();
  const it = g.world.site.freighter.core; window.__it = it;
  const up = new T.Vector3(0, 1, 0).applyQuaternion(g.world.site.freighter.group.quaternion);
  g.ship.pos.copy(it.body.pos).addScaledVector(up, 14); g.ship.vel.set(0, 0, 0); g.ship.angVel.set(0, 0, 0);
  g.ship.quat.setFromUnitVectors(new T.Vector3(0, 0, -1), up.clone().negate()); g.world.refreshActive(g.ship.pos, true);
  g.salvage.attach(it); g.ship.quat.setFromUnitVectors(new T.Vector3(0, 0, -1), up); g.input.keys.add('KeyW'); g.input.keys.add('ShiftLeft');
}, 6000, `${probe} + ' site:' + window.__game.world.site.freighter.state + ' ' + window.__game.world.site.freighter.timer.toFixed(1)`);
await p.screenshot({ path: process.argv[2] || 'shots/play.png' });
await run('collapse', () => {}, 26000, `(() => { const g = window.__game; return g.world.site.freighter.state + ' ' + g.world.site.freighter.timer.toFixed(1) + ' hull ' + g.ship.hull.toFixed(2); })()`);
await b.close();
