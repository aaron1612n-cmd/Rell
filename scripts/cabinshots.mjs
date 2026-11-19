// The cockpit from outside: canopy open and shut, from several angles, one page.
// Usage: node scripts/cabinshots.mjs <outdir> [w h]   (needs vite on :5173)
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [out = 'shots/cabin', w = 1280, h = 720] = process.argv.slice(2);
const fs = await import('node:fs'); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const mobile = +w < 600;
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 90000 });
await p.waitForTimeout(3000);
await p.evaluate(() => {
  const g = window.__game; if (g.tutorial.on) g.tutorial.finish();
  g.ship.vel.set(0, 0, 0); g.ship.angVel.set(0, 0, 0); g.ship.pos.set(30, 14, 142); g.ship.quat.set(0, 0, 0, 1); g.ship.step = () => {};
  document.querySelectorAll('#hud, .hud').forEach((e) => (e.style.display = 'none'));
  window.__cam = [0, 0, 0, 0, 0, 0]; const T = g.THREE; g.rig.update = () => { const c = window.__cam, q = g.ship.quat; g.camera.position.copy(new T.Vector3(c[0], c[1], c[2]).applyQuaternion(q).add(g.ship.pos)); g.camera.up.set(0, 1, 0).applyQuaternion(q); g.camera.lookAt(new T.Vector3(c[3], c[4], c[5]).applyQuaternion(q).add(g.ship.pos)); g.camera.updateMatrixWorld(); };
});
const views = (process.env.VIEWS || 'front34:2.6,1.9,-3.2,0,.3,-.3;side:3.6,1.0,-.2,0,.3,-.3;top:.6,3.4,.6,0,.2,-.3;rear34:-2.2,1.8,2.6,0,.3,-.3;low:-3.2,-.2,-1.6,0,.3,-.4;close:1.1,1.4,-1.1,0,.35,-.1').split(';').map((s) => { const [n, v] = s.split(':'); return [n, v.split(',').map(Number)]; });
for (const open of (process.env.OPEN || '1,0').split(',').map(Number)) {
  await p.evaluate((o) => window.__game.cockpit.setCanopy(!!o), open);
  await p.waitForFunction((o) => Math.abs(window.__game.cockpit.open - o) < 0.001, open, { timeout: 120000 });
  for (const [n, v] of views) {
    await p.evaluate((v) => { window.__cam = v; }, v);
    await p.waitForTimeout(700);
    await p.screenshot({ path: `${out}/${open ? 'open' : 'shut'}-${n}.png` });
    console.log('shot', n, open, await p.evaluate(() => { const g = window.__game; return `cabin ${g.eva.cabinOn} open ${g.cockpit.open.toFixed(2)} kids ${g.shipMesh ? g.shipMesh.children.length : '?'}`; }));
  }
  if (process.env.ONLYOPEN) break;
}
await b.close();
