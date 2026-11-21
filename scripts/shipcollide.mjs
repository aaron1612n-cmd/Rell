// Ram the jet (and an EVA suit, and a debris prop) into every ship from several directions and report
// whether anything got through the hull. node scripts/shipcollide.mjs [url]   (vite on :5173 by default)
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const url = process.argv[2] || 'http://localhost:5173/';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.addInitScript(() => { try { localStorage.setItem('rell.save', JSON.stringify({ credits: 250000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); localStorage.removeItem('rell.fleet'); } catch {} });
await p.goto(url); await p.waitForFunction(() => window.__game, null, { timeout: 180000 });
await p.waitForTimeout(2000);
await p.evaluate(() => { const g = __game; g.rig.introDur = 0; g.tutorial.on && g.tutorial.finish(); });
const ids = (process.env.IDS || 'wren,kite,hornet,mule,packhorse,prospector,lance,atlas,gull,sable,vigil,cinder,ironwake').split(',');
const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0.7, 0.7, 0], [-0.6, -0.5, 0.6]];
let bad = 0;
for (const id of ids) {
  const res = [];
  for (const who of ['jet', 'suit', 'debris']) for (const d of dirs) {
    const r = await p.evaluate(async ([id, d, who]) => {
      const g = __game, T = g.THREE, F = g.fleet, S = F.byId[id]; if (!S) return 'missing';
      // bring the ship (and its collider site) next to the jet's current spot, so the test runs anywhere
      const mn = new T.Vector3(...S.d.min), mx = new T.Vector3(...S.d.max), c = mn.clone().add(mx).multiplyScalar(0.5);
      const dir = new T.Vector3(...d).normalize();
      // aim at a point on the hull: the centre of mass of the colliders nearest the line
      const start = c.clone().addScaledVector(dir, mx.clone().sub(mn).length() * 0.5 + 12);
      const W = (l) => S.site.group.localToWorld(l.clone());
      let body, minIn = 1e9;
      const inside = (wp) => { const l = S.site.group.worldToLocal(wp.clone()); return l; };
      if (who === 'jet') { if (g.eva.active) return 'eva'; body = g.ship; body.pos.copy(W(start)); body.angVel.set(0, 0, 0); }
      else if (who === 'suit') {
        const e = g.eva; if (e.state !== 'eva') { e.state = 'eva'; e.enterEva(); e.hatch.t = 0; e.pass.enabled = true; document.body.classList.add('eva'); }
        body = e.pilot; body.pos.copy(W(start)); e.ropeReset = true;
      } else { body = g.world.allDebris.find((x) => x.radius > 0.6 && x.radius < 3) ; if (!body) return 'nodebris'; body.pos.copy(W(start)); body.free = true; body.asleep = false; }
      const v = dir.clone().negate().applyQuaternion(S.site.group.quaternion).multiplyScalar(who === 'suit' ? 6 : 18);
      g.world.dirty = true; g.world.refreshActive(body.pos, true);
      // only the hull itself matters: how deep did it get along the line?
      const t0 = performance.now(); let depth = -1e9;
      const ext = mx.clone().sub(mn).multiplyScalar(0.5);
      while (performance.now() - t0 < 4000) {
        if (who !== 'suit') body.vel.copy(v); else body.vel.copy(v);
        if (who === 'debris') { g.world.debris.includes(body) || g.world.debris.push(body); }
        await new Promise((r) => requestAnimationFrame(r));
        const l = inside(body.pos).sub(c);
        // how far past the far side of the hull's bounds (along the travel line) it has gone, in units of extent
        const along = -l.dot(dir); depth = Math.max(depth, along);
        if (along > Math.abs(ext.dot(dir)) + 2) break;
      }
      const e = Math.abs(ext.x * dir.x) + Math.abs(ext.y * dir.y) + Math.abs(ext.z * dir.z);
      if (who === 'suit') { const e2 = g.eva; }
      return depth > e * 0.9 ? 'THROUGH' : depth < -(e + 8) ? 'NOMOVE' : 'ok';
    }, [id, d, who]);
    res.push(`${who[0]}${dirs.indexOf(d)}:${r}`);
    if (r === 'THROUGH') bad++;
  }
  console.log(id.padEnd(11), res.join(' '));
}
console.log('through:', bad);
await b.close();
process.exit(bad ? 1 : 0);
