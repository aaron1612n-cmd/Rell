// Order a ship and fast-forward the delivery: it must end parked in its berth, in the world (collidable), with the cinematic gone.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const OUT = process.env.OUT || '/mnt/project-files/low-orbit/base/';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
let errs = 0;
p.on('console', (m) => { if (m.type() === 'error') { errs++; console.log('console:', m.text()); } });
p.on('pageerror', (e) => { errs++; console.log('pageerror:', e.message); });
await p.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('rell.save', JSON.stringify({ credits: 900000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); } catch {} });
await p.goto(process.env.URL || 'http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 180000 });
await p.waitForTimeout(3000);
const ev = (f, a) => p.evaluate(f, a);
const ids = (process.env.IDS || 'wren').split(',');
for (const id of ids) {
  console.log('order', id, await ev((id) => __game.yard.order(id), id));
  await p.waitForTimeout(3000);
  await ev(() => { const J = __game.base.jobs[0]; if (J) J.speed = 12; });
  for (let i = 0; i < 200; i++) { await p.waitForTimeout(500); if (await ev(() => !__game.base.busy())) break; }
  console.log(id, JSON.stringify(await ev((id) => { const g = __game, S = g.fleet.byId[id]; return { parked: g.yard.rec(id)?.parked, inWorld: g.world.sites.includes(S.site), vis: S.site.group.visible, cine: !!g.base.cine, letterbox: document.body.classList.contains('cine'), pos: g.base.local(S.V.pos, new g.THREE.Vector3()).toArray().map((x) => +x.toFixed(1)) }; }, id)));
}
// look at the yard from outside
for (const [n, v] of [['d1-yard-front', [30, 35, 150]], ['d2-yard-side', [170, 30, 10]], ['d3-yard-high', [-90, 110, 90]]]) {
  await ev((v) => { const g = __game, T = g.THREE, B = g.base; B.captured = false; g.ship.pos.copy(B.world(new T.Vector3(...v), new T.Vector3())); g.ship.vel.set(0, 0, 0); g.ship.angVel.set(0, 0, 0);
    g.ship.quat.setFromRotationMatrix(new T.Matrix4().lookAt(g.ship.pos, B.site.pos, new T.Vector3(0, 1, 0).applyQuaternion(B.site.group.quaternion))); }, v);
  await p.waitForTimeout(4000); await p.screenshot({ path: OUT + n + '.png' });
}
console.log('errors', errs);
await b.close();
