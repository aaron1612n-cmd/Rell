// Hangar expansion shots: order ships (IDS=wren,atlas), then photograph the yard from set viewpoints (base-local coords).
// Also PHASES=1 captures the extend animation at fixed progress values. env OUT, URL, PHONE=1
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const OUT = process.env.OUT || '/mnt/project-files/low-orbit/hangar/', PHONE = !!process.env.PHONE;
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage(PHONE ? { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true } : { viewport: { width: 960, height: 540 } });
let errs = 0;
p.on('console', (m) => { if (m.type() === 'error') { errs++; console.log('console:', m.text()); } });
p.on('pageerror', (e) => { errs++; console.log('pageerror:', e.message); });
await p.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('rell.save', JSON.stringify({ credits: 900000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); } catch {} });
await p.goto(process.env.URL || 'http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 180000 });
await p.waitForTimeout(3000);
const ev = (f, a) => p.evaluate(f, a);
const pre = PHONE ? 'ph-' : '';
const look = async (n, pos, tgt) => {
  await ev(([pos, tgt]) => { const g = __game, T = g.THREE, B = g.base; B.captured = false; document.body.classList.add('photo');
    const wp = B.world(new T.Vector3(...pos), new T.Vector3()); g.ship.pos.copy(wp).addScalar(260); g.ship.vel.set(0, 0, 0); g.ship.angVel.set(0, 0, 0);
    g.rig.update = () => {}; g.camera.position.copy(wp); g.camera.up.set(0, 1, 0).applyQuaternion(B.site.group.quaternion); g.camera.lookAt(B.world(new T.Vector3(...tgt), new T.Vector3())); g.camera.updateMatrixWorld(); }, [pos, tgt]);
  await p.waitForTimeout(2500); await p.screenshot({ path: OUT + pre + n + '.png' });
};
const ids = (process.env.IDS || 'wren').split(',').filter(Boolean);
if (process.env.PHASES && ids.length) {
  // order, then freeze the berth at progress values while the camera sits off the corner
  const id = ids[0];
  await ev((id) => __game.yard.order(id), id); await p.waitForTimeout(2500);
  await ev(() => { const g = __game, J = g.base.jobs[0]; J.speed = 0; g.base.cine = null; document.body.classList.remove('cine', 'cin'); });
  for (const k of (process.env.KS || '0.05,0.15,0.25,0.3,0.45,0.6,0.8,1').split(',').map(Number)) {
    await ev((k) => { const J = __game.base.jobs[0], b = J.b; J.t = J.tKeel + k * (3 + 0.8 * b.n) + 0.001; __game.base.cine = null; }, k);
    await p.waitForTimeout(600);
    await look('phase-' + k, JSON.parse(process.env.CAM || '[-62,24,52]'), [-34, 0, 8]);
  }
} else {
  for (const id of ids) {
    await ev((id) => __game.yard.order(id), id); await p.waitForTimeout(3000);
    await ev(() => { const J = __game.base.jobs[0]; if (J) J.speed = 12; });
    for (let i = 0; i < 300; i++) { await p.waitForTimeout(500); if (await ev(() => !__game.base.busy())) break; }
  }
  const V = JSON.parse(process.env.VIEWS || 'null') || {
    'a-corner': [[-60, 22, 48], [-40, 0, 6]], 'b-end': [[-90, 6, 8], [-40, 0, 8]], 'c-top': [[-38, 55, 8], [-34, 0, 8]], 'd-below': [[-38, -55, 8], [-34, 0, 8]],
    'e-rear': [[-62, 18, -30], [-38, 0, 8]], 'f-close': [[-52, 8, 24], [-40, 0, 8]], 'g-seam': [[-30, 14, 26], [-30, 0, 4]],
  };
  for (const [n, [a, t]] of Object.entries(V)) await look(n, a, t);
}
console.log('errors', errs);
await b.close();
