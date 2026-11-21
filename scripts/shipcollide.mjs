// Ram things into every ship from 14 directions and report anything that gets through the hull.
//  - jet: the real game loop flies your jet at 18 m/s into the ship
//  - suit (r 0.35) and debris (r 1.0): a sphere stepped at 120 Hz through world.collideStatic, the same call the
//    EVA suit and drifting debris use, at 6 and 14 m/s; it fails if its centre ever ends up inside the hull's solid
// node scripts/shipcollide.mjs [url]   (vite on :5173 by default). IDS=a,b limits ships.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const url = process.argv[2] || 'http://localhost:5173/';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 480, height: 300 } });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.addInitScript(() => { try { localStorage.setItem('rell.save', JSON.stringify({ credits: 250000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); localStorage.removeItem('rell.fleet'); } catch {} });
await p.goto(url); await p.waitForFunction(() => window.__game, null, { timeout: 180000 });
await p.waitForTimeout(2000);
await p.evaluate(() => { const g = __game; g.rig.introDur = 0; g.tutorial.on && g.tutorial.finish(); for (const S of g.fleet.ships) { S.found = true; S.owned = true; if (S.stowed) g.fleet.deliver(S); } });
const ids = (process.env.IDS || 'wren,kite,hornet,mule,packhorse,prospector,lance,atlas,gull,sable,vigil,cinder,ironwake').split(',');
const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0.7, 0.7, 0], [-0.6, -0.5, 0.6], [0.5, -0.6, -0.6], [-0.7, 0.4, -0.5], [0.3, 0.2, 0.9], [-0.2, 0.9, 0.3], [0.9, -0.2, 0.4], [-0.5, -0.8, -0.2]];
let bad = 0;
for (const id of ids) {
  const r = await p.evaluate(async ([id, dirs]) => {
    const g = __game, T = g.THREE, F = g.fleet, S = F.byId[id]; if (!S) return ['missing'];
    const mn = new T.Vector3(...S.d.min), mx = new T.Vector3(...S.d.max), c = mn.clone().add(mx).multiplyScalar(0.5), ext = mx.clone().sub(mn).multiplyScalar(0.5);
    const W = (l) => S.site.group.localToWorld(l.clone()), L = (w) => S.site.group.worldToLocal(w.clone());
    const res = [];
    for (const d of dirs) {
      const dir = new T.Vector3(...d).normalize(), e = Math.abs(ext.x * dir.x) + Math.abs(ext.y * dir.y) + Math.abs(ext.z * dir.z);
      // aim at the centre, or for the Ironwake (a hollow-ish carrier) at its command section
      const aim = id === 'ironwake' ? new T.Vector3(0, 0, -450) : c;
      const start = aim.clone().addScaledVector(dir, ext.length() + 14), wd = dir.clone().negate().applyQuaternion(S.site.group.quaternion);
      const verdict = (wp) => { const l = L(wp).sub(aim); const along = -l.dot(dir); return along > (id === 'ironwake' ? 160 : e * 0.9) ? 'X' : '.'; };
      let out = '';
      // jet, through the real loop
      const ship = g.ship; ship.pos.copy(W(start)); ship.angVel.set(0, 0, 0); g.world.dirty = true; g.world.refreshActive(ship.pos, true);
      const t0 = performance.now();
      while (performance.now() - t0 < (id === 'ironwake' ? 9000 : 3500)) { ship.vel.copy(wd).multiplyScalar(id === 'ironwake' ? 60 : 18); await new Promise((r) => requestAnimationFrame(r)); if (F.dock) F.release(false); if (verdict(ship.pos) === 'X') break; }
      out += verdict(ship.pos);
      // suit-sized and debris-sized spheres through collideStatic
      for (const [rad, sp] of [[0.35, 6], [1.0, 14]]) {
        const body = { pos: W(start), vel: wd.clone().multiplyScalar(sp), radius: rad };
        g.world.refreshActive(body.pos, true);
        let x = '.';
        const steps = Math.ceil((start.distanceTo(aim) + e + 40) / sp * 120);
        // a hard push sideways around a slim hull is fine; what counts is whether the centre ever ends up
        // inside the ship's solid (deeper than its own radius) after the collision step
        for (let i = 0; i < steps; i++) {
          body.vel.copy(wd).multiplyScalar(sp); body.pos.addScaledVector(body.vel, 1 / 120); if (i % 60 === 0) g.world.refreshActive(body.pos);
          g.world.collideStatic(body, 0.2);
          let pen = 0; g.world.sphereContacts(body.pos, rad, (n, p) => { if (p > pen) pen = p; });
          if (pen > rad * 0.95) { x = 'X'; break; }
        }
        out += x;
      }
      res.push(out);
    }
    return res;
  }, [id, dirs]);
  const n = r.join('').split('X').length - 1; bad += n;
  console.log(id.padEnd(11), r.join(' '), n ? `<- ${n} got through` : 'solid');
}
console.log('legend: per direction jet,suit,debris  . = stopped  X = went through');
console.log('through:', bad);
await b.close();
