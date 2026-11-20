// How deep the suit's legs (and the rest of the body) sink into the ship's hull while climbing out of the seat and
// back in. Scrubs the hatch clock, poses the third-person suit at each time and samples the leg spheres against the
// baked hull field. Optional shots from fixed ship-space cameras at the worst moments.
// Usage: node scripts/legcheck.mjs [outdir]   (needs vite on :5173)
//   SHOTS=1.6,2.0 takes shots at those exit times; CAMS=side,low,front,under
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [out = '/tmp/legcheck'] = process.argv.slice(2);
const fs = await import('node:fs'); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const w = +(process.env.W || 1280), h = +(process.env.H || 720), mobile = w < 600;
const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
p.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
await p.goto(process.env.URL || 'http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 120000 });
await p.waitForTimeout(2000);
await p.evaluate(() => { const g = window.__game; g.rig.introDur = 0; g.ship.vel.set(0, 0, 0); if (g.tutorial.on) g.tutorial.finish(); g.tutorial.hideIntro?.(); });
await p.waitForTimeout(500);
await p.evaluate(() => window.__game.eva.request());
await p.waitForFunction(() => window.__game.eva.state === 'out', null, { timeout: 60000 });
const scan = async (dir) => p.evaluate(async (dir) => {
  const { exposed, legProbes } = await import('/src/hatch.js');
  const { field } = await import('/src/suitBody.js');
  const g = window.__game, e = g.eva, H = e.hatch, T = g.THREE, ship = g.ship;
  H.speed = 0;
  const qi = ship.quat.clone().invert(), v = new T.Vector3();
  const core = e.suit.core;
  const names = ['helmet', 'chest', 'belly', 'shR', 'shL', 'pack', 'pack2', 'packTop', 'hipR', 'hipL'];
  const legN = ['thighA', 'thighB', 'knee', 'shin', 'ankle', 'toe'];
  const rows = [];
  const end = dir === 'out' ? 3.3 : H.A + 1.9;
  for (let t = 0; t <= end; t += 0.05) {
    H.t = t; if (dir === 'out') H.exit(0); else H.entry(0);
    e.body.updateMatrixWorld(true);
    let worst = 0, who = '';
    core.forEach((s, i) => {
      v.copy(s.l).applyMatrix4(s.o.matrixWorld).sub(ship.pos).applyQuaternion(qi);
      // below the cockpit floor a part must stay buried in the hull (else it shows through the skin)
      const pen = Math.sqrt(exposed(v, s.r));
      const nm = i < 10 ? names[i] : (i < 16 ? 'R.' : 'L.') + legN[(i - 10) % 6];
      if (pen > worst) { worst = pen; who = nm + ' @' + v.toArray().map((x) => x.toFixed(2)).join(','); }
    });
    for (const leg of [e.body.userData.legR, e.body.userData.legL]) for (const [o, pts] of legProbes(leg)) for (const q of pts) {
      v.copy(q).applyMatrix4(o.matrixWorld).sub(ship.pos).applyQuaternion(qi);
      if (v.y > 0.06) continue;
      const f = field(v.x, v.y, v.z); if (f > worst) { worst = f; who = 'shell @' + v.toArray().map((x) => x.toFixed(2)).join(','); }
    }
    rows.push([+t.toFixed(2), +worst.toFixed(3), who]);
  }
  return rows;
}, dir);
const rows = await scan('out');
let maxOut = 0; for (const r of rows) { if (r[1] > maxOut) maxOut = r[1]; if (r[1] > 0.01) console.log('out', ...r); }
console.log('MAX out exposure', maxOut);
if (process.env.IN) {
  // drift back to the seat and board, then scrub the way in
  await p.evaluate(() => { const g = window.__game, e = g.eva; e.hatch.speed = 1; });
  await p.waitForFunction(() => window.__game.eva.state === 'eva', null, { timeout: 300000 });
  await p.evaluate(() => { const g = window.__game, T = g.THREE, e = g.eva; e.pilot.pos.copy(g.ship.pos).add(new T.Vector3(0.9, 1.9, -1.6).applyQuaternion(g.ship.quat)); e.pilot.vel.copy(g.ship.vel); e.ropeReset = true; });
  await p.waitForTimeout(800);
  await p.evaluate(() => window.__game.eva.request());
  const rin = await scan('in'); let m = 0; for (const r of rin) { if (r[1] > m) m = r[1]; if (r[1] > 0.01) console.log('in', ...r); }
  console.log('MAX in exposure', m);
  await p.evaluate(() => { window.__game.eva.hatch.speed = 1; });
}
const shots = (process.env.SHOTS || '').split(',').filter(Boolean).map(Number);
const CAM = { side: [-3.2, 0.9, 0.2], low: [-2.6, -1.4, 0.3], front: [0.8, 0.9, -4], under: [0.3, -2.6, 0.6], rear: [1.6, 1.4, 3.4] };
const cams = (process.env.CAMS || 'side,low,front').split(',');
for (const t of shots) for (const c of cams) {
  await p.evaluate(([t, c]) => {
    const g = window.__game, e = g.eva, H = e.hatch, T = g.THREE, ship = g.ship;
    H.speed = 0; H.t = t;
    const orig = H._ex || (H._ex = H.exit.bind(H));
    H.exit = (dt) => { orig(0); const cam = g.camera; cam.position.set(...c).applyQuaternion(ship.quat).add(ship.pos); cam.up.set(0, 1, 0).applyQuaternion(ship.quat); cam.lookAt(new T.Vector3(0, 0.3, -0.1).applyQuaternion(ship.quat).add(ship.pos)); cam.fov = 50; cam.updateProjectionMatrix(); cam.updateMatrixWorld(); return false; };
  }, [t, CAM[c]]);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/out-${t}-${c}.png` });
}
await b.close();
