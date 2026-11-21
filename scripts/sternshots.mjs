// Stern close-ups and exhaust states for every fleet ship.  node scripts/sternshots.mjs <outdir> [w h]  (vite on :5173)
// IDS=wren,kite limits ships. VIEWS=rear,left,right,below,top. BURN=cold,idle,cruise,boost (burn states are shot from the rear 3/4 only).
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [dir = 'shots/sterns', w = 1280, h = 720] = process.argv.slice(2);
const fs = await import('node:fs'); fs.mkdirSync(dir, { recursive: true });
const ids = (process.env.IDS || 'wren,kite,hornet,mule,packhorse,prospector,lance,atlas,gull,sable,vigil,cinder,ironwake').split(',');
const views = (process.env.VIEWS || 'rear,left,right,below').split(',');
const burns = (process.env.BURN || 'cold,idle,cruise,boost').split(',').filter((x) => x !== 'none');
const mobile = +w < 600;
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
let errs = 0;
p.on('console', (m) => { if (m.type() === 'error') { errs++; console.log('console:', m.text()); } });
p.on('pageerror', (e) => { errs++; console.log('pageerror:', e.message); });
await p.addInitScript(() => { try { localStorage.setItem('rell.save', JSON.stringify({ credits: 250000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); localStorage.removeItem('rell.fleet'); } catch {} });
await p.goto(process.env.URL || 'http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 180000 });
await p.waitForTimeout(2500);
await p.evaluate(() => {
  const g = __game, T = g.THREE, F = g.fleet; g.rig.introDur = 0; g.tutorial.on && g.tutorial.finish(); window.F = F;
  F.dock && F.release(); g.base.captured = false; g.base.relT = -1e9; const st = document.createElement('style'); st.textContent = 'body>*:not(canvas){visibility:hidden!important}canvas{visibility:visible!important}'; document.head.appendChild(st);
  window.cam = (id, off, look) => {   // offsets in the ship's frame, scaled by its stern size
    const S = F.byId[id], d = S.d, mx = d.max, mn = d.min;
    const wp = S.site.group.localToWorld(new T.Vector3(...off)), wl = S.site.group.localToWorld(new T.Vector3(...look));
    g.ship.pos.copy(wp); g.ship.vel.set(0, 0, 0); g.ship.angVel.set(0, 0, 0);
    g.ship.quat.setFromRotationMatrix(new T.Matrix4().lookAt(wp, wl, new T.Vector3(0, 1, 0).applyQuaternion(S.site.group.quaternion)));
    g.cockpit.target = 0; g.cockpit.blend = 0; g.rig.blendFrom(g.camera, 0.001);
  };
});
const shot = async (n, wait = 900) => { await p.waitForTimeout(wait); await p.screenshot({ path: `${dir}/${n}.png` }); };
for (const id of ids) {
  const ext = await p.evaluate((id) => { const d = F.byId[id].d; return { mn: d.min, mx: d.max, nz: d.nozzles.map((n) => n.p), r: Math.max(...d.nozzles.map((n) => n.r)) }; }, id);
  const cx = (ext.mn[0] + ext.mx[0]) / 2, cy = (ext.mn[1] + ext.mx[1]) / 2, zE = ext.mx[2];
  const wide = Math.max(ext.mx[0] - ext.mn[0], ext.mx[1] - ext.mn[1]), len = ext.mx[2] - ext.mn[2];
  const D = Math.max(wide * 0.5, ext.r * 6) * (mobile ? 1.5 : 1);   // standoff
  await p.evaluate((id) => { const S = F.byId[id]; S.stowed = false; S.V.pos.set(6000, 300, -3000); S.V.vel.set(0, 0, 0); F.place(S, 0); F.fxForce = { k: 0, boost: false }; }, id);
  const V = {
    rear: [[cx, cy + D * 0.12, zE + D], [cx, cy, zE - D * 0.1]],
    left: [[cx - D * 1.0, cy + D * 0.15, zE + D * 0.75], [cx, cy, zE - D * 0.15]],
    right: [[cx + D * 1.0, cy + D * 0.15, zE + D * 0.75], [cx, cy, zE - D * 0.15]],
    below: [[cx + D * 0.2, cy - D * 0.9, zE + D * 0.7], [cx, cy, zE - D * 0.15]],
    top: [[cx + D * 0.2, cy + D * 0.9, zE + D * 0.7], [cx, cy, zE - D * 0.15]],
  };
  for (const v of views) { await p.evaluate(([id, a, l]) => cam(id, a, l), [id, ...V[v]]); await shot(`${id}-${v}`, 700); console.log(id, v); }
  const burnMap = { cold: [0, 0], idle: [0.14, 0], cruise: [0.6, 0], boost: [1, 1] };
  for (const bn of burns) {
    const [k, bo] = burnMap[bn];
    const far = D * 3.2 + (bn === 'boost' ? ext.r * 10 : 0);
    await p.evaluate(([id, a, l, k, bo]) => { F.fxForce = { k, boost: !!bo }; cam(id, a, l); }, [id, [cx + far * 0.55, cy + far * 0.2, zE + far * 0.85], [cx, cy, zE + (bn === 'boost' ? ext.r * 8 : ext.r * 3)], k, bo]);
    await shot(`${id}-burn-${bn}`, bn === 'cold' ? 500 : 1800); console.log(id, bn);
  }
  await p.evaluate(() => { F.fxForce = null; });
}
console.log('console errors', errs);
await b.close();
