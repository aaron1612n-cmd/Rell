// Turntable contact sheets: every fleet ship, station/wreck site and the player jet from front, back, left,
// right, top, below and a close-up, one row per model, into PNG sheets. Eyeball them (or diff them between builds).
// node scripts/check/turntable.mjs [outdir]   (vite on :5173, or URL=...)   env: W,H cell size (default 360x225), ONLY=ironwake,wren
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const out = process.argv[2] || '/mnt/project-files/low-orbit/checks'; fs.mkdirSync(out, { recursive: true });
const W = +(process.env.W || 360), H = +(process.env.H || 225), only = (process.env.ONLY || '').split(',').filter(Boolean);
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.addInitScript(() => { try { localStorage.setItem('rell.save', JSON.stringify({ credits: 250000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); } catch {} });
await p.goto(process.env.URL || 'http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 180000 });
await p.waitForTimeout(2500);
const models = await p.evaluate(() => {
  const g = window.__game; g.rig.introDur = 0; if (g.tutorial.on) g.tutorial.finish(); g.tutorial.hideIntro?.();
  document.querySelectorAll('body > *:not(canvas)').forEach((e) => { e.style.display = 'none'; }); window.__rigUpdate = g.rig.update; g.rig.update = () => {};
  const list = [];
  for (const [id, S] of Object.entries(g.fleet.byId)) { S.site.group.visible = true; if (!g.world.sites.includes(S.site)) g.world.sites.push(S.site); list.push({ sheet: 'fleet', id, get: 'fleet:' + id }); }
  g.world.sites.forEach((s, i) => { if (s.kind !== 'field' && s.group && !Object.values(g.fleet.byId).some((S) => S.site === s)) list.push({ sheet: 'sites', id: s.id || s.kind + i, get: 'site:' + i }); });
  list.push({ sheet: 'sites', id: 'player-jet', get: 'jet' });
  return list;
});
const VIEWS = [['front', [0, 0, -1]], ['back', [0, 0, 1]], ['left', [-1, 0, 0]], ['right', [1, 0, 0]], ['top', [0, 1, 0.001]], ['below', [0, -1, 0.001]], ['3/4', [0.7, 0.45, -0.7]], ['close', [0.35, 0.2, -0.45]]];
const shots = {};
for (const m of models) {
  if (only.length && !only.includes(m.id)) continue;
  const rowImgs = [];
  for (const [vn, dir] of VIEWS) {
    await p.evaluate(([get, dir, vn]) => {
      const g = window.__game, T = g.THREE;
      let obj; if (get === 'jet') obj = g.shipMesh; else if (get.startsWith('fleet:')) obj = g.fleet.byId[get.slice(6)].site.group; else obj = g.world.sites[+get.slice(5)].group;
      const V = (window.__vis = window.__vis || new Map()); for (const ch of g.scene.children) { if (!V.has(ch)) V.set(ch, ch.visible); const has = (a, b2) => { for (let o = b2; o; o = o.parent) if (o === a) return true; return false; };
        ch.visible = V.get(ch) && (ch.isLight || ch === g.world.sky || has(ch, obj) || has(obj, ch) || (/^(Points|Sprite)$/.test(ch.type) && false)) ? true : (ch.isLight || ch === g.world.sky || has(ch, obj)); }
      obj.visible = true; for (let o = obj.parent; o; o = o.parent) o.visible = true;
      obj.updateMatrixWorld(true);
      const bx = new T.Box3().setFromObject(obj), c = bx.getCenter(new T.Vector3()), sz = bx.getSize(new T.Vector3()), r = Math.max(1, sz.length() / 2);
      g.ship.pos.copy(c).add(new T.Vector3(0, 0, r * 2.5)); g.ship.vel.set(0, 0, 0); if (g.world.refreshActive) g.world.refreshActive(g.ship.pos, true);
      const cam = g.camera, d = new T.Vector3(...dir).normalize(), k = vn === 'close' ? 0.8 : 1.5;
      cam.fov = 40; cam.aspect = innerWidth / innerHeight; cam.near = Math.max(0.05, r * 0.01); cam.far = r * 40;
      const tgt = vn === 'close' ? c.clone().add(new T.Vector3(sz.x * 0.2, -sz.y * 0.1, sz.z * 0.35)) : c;
      cam.position.copy(tgt).addScaledVector(d, r * k); cam.up.set(0, 1, 0); if (Math.abs(d.y) > 0.99) cam.up.set(0, 0, -1); cam.lookAt(tgt); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      g.ship.pos.copy(cam.position);
    }, [m.get, dir, vn]);
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
    // re-assert the camera in case something moved it during those frames, then grab it
    rowImgs.push((await p.screenshot({ type: 'png' })).toString('base64'));
  }
  (shots[m.sheet] = shots[m.sheet] || []).push({ id: m.id, imgs: rowImgs }); console.log(m.sheet, m.id);
}
// compose the rows into sheets in the page (a canvas), one PNG per sheet
const sp = await b.newPage({ viewport: { width: 400, height: 300 } });
for (const [name, rows] of Object.entries(shots)) {
  const data = await sp.evaluate(async ([rows, W, H, names]) => {
    const LW = 110, cv = document.createElement('canvas'); cv.width = LW + W * names.length; cv.height = 22 + H * rows.length; const x = cv.getContext('2d');
    x.fillStyle = '#0b0d10'; x.fillRect(0, 0, cv.width, cv.height); x.font = '12px monospace'; x.fillStyle = '#e8c27a';
    names.forEach((n, i) => x.fillText(n, LW + i * W + 6, 15));
    for (let r = 0; r < rows.length; r++) {
      x.fillStyle = '#e8c27a'; x.fillText(rows[r].id, 6, 22 + r * H + 16);
      for (let c = 0; c < names.length; c++) { const im = new Image(); await new Promise((ok) => { im.onload = ok; im.src = 'data:image/png;base64,' + rows[r].imgs[c]; }); x.drawImage(im, LW + c * W, 22 + r * H, W, H); x.strokeStyle = '#000'; x.strokeRect(LW + c * W, 22 + r * H, W, H); }
    }
    return cv.toDataURL('image/png').split(',')[1];
  }, [rows, W, H, VIEWS.map((v) => v[0])]);
  const f = `${out}/turntable-${name}.png`; fs.writeFileSync(f, Buffer.from(data, 'base64')); console.log('wrote', f);
}
await b.close();
