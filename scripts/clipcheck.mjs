// Collision audit: fire the ship at random points on every site's meshes and count how often it ends up
// past the surface it was aimed at. node scripts/clipcheck.mjs  (vite on :5173)
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto(process.env.URL || 'http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 120000 });
const SEED = +(process.env.SEED || 7);
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const res = await p.evaluate(([ONLY, SEED]) => {
  const g = window.__game, T = g.THREE, w = g.world, s = g.ship; g.look.render = () => {};
  let seed = SEED; const R = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const rc = new T.Raycaster(); const out = {};
  const cmd = { fwd: 0, strafe: 0, vert: 0, dx: 0, dy: 0, roll: 0, brake: false, boost: false };
  for (const site of w.sites) {
    if (site.kind === 'field' || (ONLY.length && !ONLY.includes(site.id))) continue;
    const meshes = []; const vis = (o) => { for (let a = o; a && a !== site.group; a = a.parent) if (!a.visible) return false; return true; };
    site.group.traverse((o) => { if (o.isMesh && !/lamp|light|beacon/.test(o.name) && vis(o)) meshes.push(o); });   // hidden plumes are not hull
    site.group.updateMatrixWorld(true);
    let clips = 0, n = 0; const where = {};
    for (let t = 0; t < 160; t++) {
      const m = meshes[Math.floor(R() * meshes.length)], pa = m.geometry.attributes.position;
      const tgt = new T.Vector3().fromBufferAttribute(pa, Math.floor(R() * pa.count)).applyMatrix4(m.matrixWorld);
      const dir = new T.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize();
      const start = tgt.clone().addScaledVector(dir, 60); dir.negate();
      rc.set(start, dir); rc.far = 80; const hit = rc.intersectObjects(meshes, false)[0]; if (!hit) continue;
      if (hit.distance < 8) continue;
      w.refreshActive(start, true);
      // a start inside some other solid part of the same model (e.g. inside a neighbouring cargo can) is a place the ship can't be
      { let inside = false; w.sphereContacts(start, 1.0, (n, pen) => { if (pen > 0.5) inside = true; }); if (inside) continue; }
      s.pos.copy(start); s.vel.copy(dir).multiplyScalar(45); s.angVel.set(0, 0, 0); s.assist = false;
      s.quat.setFromUnitVectors(new T.Vector3(0, 0, -1), dir);
      // clipped = the ship's centre crossed a mesh surface at any point of its flight
      let crossed = null; const prev = start.clone(), seg = new T.Vector3();
      for (let i = 0; i < 240; i++) {
        s.step(1 / 120, cmd); w.update(1 / 120, s, () => {});
        if (i % 6 === 5) { seg.copy(s.pos).sub(prev); const L = seg.length(); if (L > 1e-3) { rc.set(prev, seg.divideScalar(L)); rc.far = L; const h = rc.intersectObjects(meshes, false)[0]; if (h && !crossed) crossed = h; } prev.copy(s.pos); }
      }
      n++;
      if (crossed) { hit.object = crossed.object; clips++; let o = hit.object; while (o && !o.name) o = o.parent; const nm = o ? o.name : "?"; where[nm] = (where[nm] || 0) + 1; if (ONLY.length) (where.log ||= []).push(site.group.worldToLocal(crossed.point.clone()).toArray().map((x) => Math.round(x)).join(',') + ' from ' + site.group.worldToLocal(start.clone()).toArray().map((x) => Math.round(x)).join(',')); }
    }
    out[site.id] = { shots: n, clips, where };
  }
  s.assist = true; g.respawn();
  return out;
}, [ONLY, SEED]);
console.log(JSON.stringify(res, null, 1));
await b.close();
const clips = Object.values(res).reduce((a, r) => a + r.clips, 0); console.log('clips:', clips); process.exit(clips ? 1 : 0);
