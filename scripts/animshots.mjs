// World/ship animation spot checks. Usage: node scripts/animshots.mjs <outdir> [w h]  (vite on :5173)
// Frames each radar head, a ship close-up from the side (vanes, dish, lights), and a debris spark.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [out = 'shots/anim', w = 1280, h = 720] = process.argv.slice(2);
const fs = await import('node:fs'); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const mobile = +w < 600;
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 90000 });
await p.waitForTimeout(3000);
await p.evaluate(() => { const g = window.__game; if (g.tutorial.on) g.tutorial.finish(); document.querySelectorAll('#hud, .hud').forEach((e) => (e.style.display = 'none')); });
const n = await p.evaluate(() => window.__game.worldAnim.radars.length);
for (let i = 0; i < n; i++) {
  await p.evaluate((i) => {
    const g = window.__game, T = g.THREE, r = g.worldAnim.radars[i].obj; r.updateWorldMatrix(true, false);
    const c = r.getWorldPosition(new T.Vector3()), up = new T.Vector3(0, 1, 0).applyQuaternion(r.getWorldQuaternion(new T.Quaternion()));
    const s = r.getWorldScale(new T.Vector3()).x;
    g.ship.pos.copy(c).addScaledVector(up, 40); g.ship.vel.set(0, 0, 0); g.ship.step = () => {};
    const cam = c.clone().addScaledVector(up, 6 * s).add(new T.Vector3(9, 2, 9).multiplyScalar(s));
    g.rig.update = () => { g.camera.position.copy(cam); g.camera.up.copy(up); g.camera.lookAt(c.clone().addScaledVector(up, 1.5 * s)); };
    g.world.refreshActive(g.ship.pos);
  }, i);
  await p.waitForTimeout(2500); await p.screenshot({ path: `${out}/radar-${i}.png` });
}
// ship side: banking so the vanes deflect
await p.evaluate(() => {
  const g = window.__game, P = [30, 14, 142]; g.world.update = () => {};
  g.ship.pos.set(...P); g.ship.quat.set(0, 0, 0, 1); g.ship.vel.set(0, 0, 0);
  g.ship.step = function () { this.angVel.set(0.6, 0, 0.9); this.pos.set(...P); this.quat.set(0, 0, 0, 1); };
  g.rig.update = () => { g.camera.position.set(P[0] + 3.4, P[1] + 1.6, P[2] + 3.2); g.camera.up.set(0, 1, 0); g.camera.lookAt(P[0] + 0.6, P[1] + 0.3, P[2] + 0.6); };
});
await p.waitForTimeout(2500); await p.screenshot({ path: `${out}/ship-vanes.png` });
await p.waitForTimeout(700); await p.screenshot({ path: `${out}/ship-vanes-b.png` });
await b.close();
