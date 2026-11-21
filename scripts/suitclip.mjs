// Suit clipping audit: fly the EVA suit into station walls and corners, the ship's hull and wrecks, with random
// body orientations, and count how often any part of it (helmet, pack, legs, boots, arms, gloves, cutter)
// ends up through the visible geometry. node scripts/suitclip.mjs [trials]   (vite on :5173)
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const N = +(process.argv[2] || 30);
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
p.on('console', (m) => { if (m.text().startsWith('[clip]')) console.log(m.text()); });
await p.goto(process.env.URL || 'http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 120000 });
await p.waitForTimeout(2000);
await p.evaluate(() => { const g = window.__game; g.rig.introDur = 0; g.ship.vel.set(0, 0, 0); if (g.tutorial.on) g.tutorial.finish(); g.tutorial.hideIntro?.(); g.eva.request(); });
await p.waitForFunction(() => window.__game.eva.state === 'eva', null, { timeout: 300000 });
const res = await p.evaluate(([N, process_env_dbg, only]) => {
  const g = window.__game, T = g.THREE, e = g.eva, w = g.world, ship = g.ship; g.look.render = () => {};
  let seed = 11; const R = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const u = e.body.userData, V = (x, y, z) => new T.Vector3(x, y, z);
  // probe points on the posed suit: [bone, local, radius]
  const P = [[u.head, V(0, 0.15, -0.01), 0.2, 'helmet'], [u.body, V(0, 0.16, -0.05), 0.24, 'chest'], [u.body, V(0, 0.3, 0.24), 0.2, 'pack'], [u.body, V(0, 0.5, 0.25), 0.13, 'pack'],
    [u.body, V(0.23, 0.2, 0), 0.14, 'shoulder'], [u.body, V(-0.23, 0.2, 0), 0.14, 'shoulder'], [u.body, V(0.13, -0.38, 0), 0.15, 'hip'], [u.body, V(-0.13, -0.38, 0), 0.15, 'hip']];
  for (const L of [u.legR, u.legL]) P.push([L.knee, V(0, 0, 0), 0.1, 'knee'], [L.ankle, V(0, -0.07, -0.03), 0.08, 'boot'], [L.ankle, V(0, -0.08, -0.17), 0.06, 'boot']);
  for (const A of [u.armR, u.armL]) P.push([A.mid, V(0, 0, 0), 0.08, 'elbow'], [A.wrist, V(0, -0.1, -0.015), 0.07, 'glove']);
  P.push([u.armR.tool, V(-0.01, 0.03, -0.18), 0.05, 'cutter']);
  const FPP = [[e.armR.wrist, 'fpR'], [e.armL.wrist, 'fpL'], [e.tool.userData.tip, 'fpTool']];
  const rc = new T.Raycaster(); rc.layers.enableAll(); const cmd = { fwd: 0, strafe: 0, vert: 0, dx: 0, dy: 0, roll: 0, brake: false, boost: false, yawKey: 0, pitchKey: 0, reel: false, fire: false };
  const shipMeshes = []; g.shipMesh.userData.body.traverse((o) => { if (o.isMesh && o.visible && !/glow|plume|exhaust/i.test(o.name) && o.geometry.attributes.position.count > 30 && !o.material.transparent) shipMeshes.push(o); });
  const relaySite = w.sites.find((s) => s.byName && s.byName.relay);
  const siteMeshes = (s) => { const m = []; s.group.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.visible && !/lamp|light|beacon|glow|holo|float/i.test(o.name) && !(o.material && (o.material.transparent || o.material.blending === 2))) m.push(o); }); return m; };
  const out = {};
  const nameOf = (o) => { const n = []; for (let a = o; a && n.length < 3; a = a.parent) if (a.name) n.push(a.name); return n.join('<') || o.type; };
  console.log('[clip] shipMeshes', shipMeshes.length);
  const pose = (dir) => { // random body orientation, roughly facing the motion so you see it come in from all sides
    const q = new T.Quaternion().setFromUnitVectors(V(0, 0, -1), dir);
    q.multiply(new T.Quaternion().setFromEuler(new T.Euler((R() - 0.5) * 2.4, (R() - 0.5) * 2.8, (R() - 0.5) * 2.0)));
    return q;
  };
  function run(cat, meshes, setup, n) {
    let clipT = 0, fpT = 0, frames = 0, fpFrames = 0, tunnel = 0; const where = {}, hitBy = {}; let noCol = 0; const pts = [];
    for (let t = 0; t < n; t++) {
      const s = setup(t); if (!s) continue;
      e.view = t % 2; e.pilot.pos.copy(s.start); e.pilot.vel.copy(s.dir).multiplyScalar(s.speed).add(ship.vel); e.pilot.quat.copy(pose(s.dir)); e.ropeReset = true; e.tpInit = false;
      e.anim.reset(); e.suit && (e.suit.ready = false, e.suit.arms.R.fix.set(0, 0, 0), e.suit.arms.L.fix.set(0, 0, 0)); if (e.tuck) e.tuck.R = e.tuck.L = 0;
      // thrust into it, in the body's frame
      const th = s.dir.clone().applyQuaternion(e.pilot.quat.clone().invert());
      cmd.strafe = th.x; cmd.vert = th.y; cmd.fwd = -th.z;
      let clipped = false, fpClip = false; const c0 = e.pilot.pos.clone();
      for (let i = 0; i < 100; i++) {
        if (g.relay) g.relay.update(1 / 60, i / 60, g.camera.position, e, ship); e.update(1 / 60, cmd);
        if (i < 20 || i % 8) continue;
        e.body.updateMatrixWorld(true); const c = e.pilot.pos;
        // the body's centre itself must not pass through anything
        { const seg = c.clone().sub(c0), L = seg.length(); if (L > 1e-3 && L < 4 && i > 24) {   /* longer = the game teleported the suit (rope reset); i<=24 = the start position being pushed out of the surface, not a tunnel */
  rc.set(c0, seg.divideScalar(L)); rc.far = L; if (rc.intersectObjects(meshes, false).length) { tunnel++; clipped = true; } } c0.copy(c); }
        if (e.view === 1) {
          frames++; let any = false;
          for (const [o, l, r, nm] of P) {
            if (nm === 'cutter' && !o.visible) continue;
            const pt = l.clone().applyMatrix4(o.matrixWorld), d = pt.clone().sub(c), L = d.length(); if (L < 1e-3) continue;
            rc.set(c, d.divideScalar(L)); rc.far = L + r * 0.3;
            const h = rc.intersectObjects(meshes, false)[0];
            if (h) { any = true; where[nm] = (where[nm] || 0) + 1; const mn = nameOf(h.object); hitBy[mn] = (hitBy[mn] || 0) + 1; let cov = false; w.sphereContacts(h.point, 0.06, () => { cov = true; }); if (!cov) e.meshHit.contacts(h.point, 0.06, () => { cov = true; }, ++e.frameN); /* the suit also collides with the real triangles */ if (!cov) { noCol++; if (pts.length < 12) pts.push((g.relay ? g.relay.local(h.point.clone(), new T.Vector3()) : h.point).toArray().map((v) => +v.toFixed(2)).join(',') + ' ' + nm); } }
          }
          if (any) { clipT++; if (!clipped && process_env_dbg) console.log('[clip] dbg', cat, t, i, s.start.toArray().map((v) => v.toFixed(1)).join(','), c.toArray().map((v) => v.toFixed(1)).join(','), s.dir.toArray().map((v) => v.toFixed(2)).join(',')); clipped = true; }
        } else {
          fpFrames++; let any = false; const eye = g.camera.position;
          e.hands.updateMatrixWorld(true);
          for (const [o, nm] of FPP) {
            if (nm === 'fpTool' && !e.tool.visible) continue;
            const pt = o.getWorldPosition(new T.Vector3()), d = pt.clone().sub(eye), L = d.length();
            rc.set(eye, d.divideScalar(L)); rc.far = L; const h = rc.intersectObjects(meshes, false)[0];
            if (h) { any = true; where[nm] = (where[nm] || 0) + 1; }
          }
          if (any) { fpT++; fpClip = true; }
        }
      }
    }
    out[cat] = { tpFramesClipped: clipT + '/' + frames, fpFramesClipped: fpT + '/' + fpFrames, tunnel, where, hitBy, noCol, pts };
    console.log('[clip]', cat, JSON.stringify(out[cat]));
  }
  // --- relay: walls and corners of every room
  if (relaySite && (!only || only === 'relay')) {
    const vols = g.relay.B.vols, M = relaySite.group.matrixWorld, meshes = siteMeshes(relaySite);
    ship.pos.copy(V(0, 0, 0).applyMatrix4(M)).add(V(0, 60, 0)); ship.vel.set(0, 0, 0); w.refreshActive(ship.pos, true);
    for (const d of Object.values(g.relay.doors)) { d.open = d.target = d.kind === 'outer' ? 0 : 1; g.relay.slide(d); }
    const wall = () => {
      const v = vols[Math.floor(R() * vols.length)], a = Math.floor(R() * 3), sg = R() < 0.5 ? -1 : 1;
      const tgt = V(0, 0, 0); for (let k = 0; k < 3; k++) tgt.setComponent(k, v.min.getComponent(k) + 0.7 + R() * Math.max(0, v.max.getComponent(k) - v.min.getComponent(k) - 1.4));
      tgt.setComponent(a, sg > 0 ? v.max.getComponent(a) : v.min.getComponent(a));
      const n = V(0, 0, 0); n.setComponent(a, -sg);
      const start = tgt.clone().addScaledVector(n, Math.min(1.4, (v.max.getComponent(a) - v.min.getComponent(a)) * 0.45));
      const dir = n.clone().negate().add(V(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(0.6)).normalize();
      return { start: start.applyMatrix4(M), dir: dir.transformDirection(M), speed: 1.5 + R() * 2 };
    };
    const corner = () => {
      const v = vols[Math.floor(R() * vols.length)], c = V(R() < 0.5 ? v.min.x : v.max.x, R() < 0.5 ? v.min.y : v.max.y, R() < 0.5 ? v.min.z : v.max.z);
      const mid = v.min.clone().add(v.max).multiplyScalar(0.5), dir = c.clone().sub(mid).normalize();
      const start = mid.clone().lerp(c, 0.55);
      return { start: start.applyMatrix4(M), dir: dir.transformDirection(M), speed: 2 + R() * 1.5 };
    };
    run('station walls', meshes, wall, N); run('station corners', meshes, corner, N);
  }
  // --- the ship's hull
  if (!only || only === 'ship') {
    ship.pos.set(0, 0, 0); ship.quat.identity(); ship.vel.set(0, 0, 0); g.shipMesh.position.copy(ship.pos); g.shipMesh.quaternion.copy(ship.quat); g.shipMesh.updateMatrixWorld(true); w.refreshActive(V(5000, 5000, 5000), true);
    const setup = () => {
      for (let k = 0; k < 20; k++) {
        const m = shipMeshes[Math.floor(R() * shipMeshes.length)], pa = m.geometry.attributes.position;
        const tgt = V(0, 0, 0).fromBufferAttribute(pa, Math.floor(R() * pa.count)).applyMatrix4(m.matrixWorld);
        const out = tgt.clone().normalize(); out.y = Math.abs(out.y) + 0.2; out.normalize();
        const start = tgt.clone().addScaledVector(out, 2.2);
        rc.set(start, tgt.clone().sub(start).normalize()); rc.far = 2.3; const h = rc.intersectObjects(shipMeshes, false)[0];
        if (!h || h.distance < 1.0) { fails = (fails || 0) + 1; continue; }
        return { start, dir: tgt.clone().sub(start).normalize(), speed: 1.5 + R() * 2 };
      }
      return null;
    };
    let fails = 0; run('ship hull', shipMeshes, setup, N); console.log('[clip] ship setup fails', fails);
  }
  // --- wrecks and stations from outside
  for (const s of w.sites) {
    if (s.kind === 'field' || s === relaySite || (only && only !== 'sites')) continue;
    const meshes = siteMeshes(s); if (!meshes.length) continue;
    s.group.updateMatrixWorld(true);
    const setup = () => {
      for (let k = 0; k < 30; k++) {
        const m = meshes[Math.floor(R() * meshes.length)], pa = m.geometry.attributes.position;
        const tgt = V(0, 0, 0).fromBufferAttribute(pa, Math.floor(R() * pa.count)).applyMatrix4(m.matrixWorld);
        const dir = V(R() - 0.5, R() - 0.5, R() - 0.5).normalize(), start = tgt.clone().addScaledVector(dir, 2.4);
        rc.set(start, dir.clone().negate()); rc.far = 2.5; const h = rc.intersectObjects(meshes, false)[0];
        if (!h || h.distance < 1.8) continue;
        // inside something solid? skip
        rc.set(start, V(0, 1, 0)); rc.far = 40; const up = rc.intersectObjects(meshes, false); if (up.length % 2) continue;
        ship.pos.copy(start).addScaledVector(dir, 14); ship.vel.set(0, 0, 0); w.refreshActive(ship.pos, true); g.shipMesh.position.copy(ship.pos); g.shipMesh.updateMatrixWorld(true);
        return { start, dir: dir.negate(), speed: 1.5 + R() * 2 };
      }
      return null;
    };
    run('site ' + (s.id || s.kind), meshes, setup, Math.ceil(N / 2));
  }
  return out;
}, [N, !!process.env.DBG, process.env.ONLY || '']);
console.log(JSON.stringify(res, null, 1));
await b.close();
{ let tunnel = 0, noCol = 0, tp = 0; for (const r of Object.values(res)) { tunnel += r.tunnel; noCol += r.noCol; tp += +r.tpFramesClipped.split('/')[0]; } console.log('suit: tunnel', tunnel, 'visible-through-uncovered', noCol, 'clipped frames', tp); process.exit(tunnel > 2 || noCol > 5 ? 1 : 0); }
