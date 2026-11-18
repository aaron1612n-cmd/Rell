// Rough per-feature GPU cost on SwiftShader (CPU raster, so ALU-heavy shaders dominate as on a weak GPU).
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [w=960, h=540] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
await p.goto('http://127.0.0.1:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 90000 });
await p.waitForTimeout(4000);
const r = await p.evaluate(async () => {
  const g = window.__game, R = g.renderer, gl = R.getContext();
  // freeze the game loop
  const raf = window.requestAnimationFrame; window.requestAnimationFrame = () => 0; await new Promise(r => setTimeout(r, 200));
  const sun = g.camera.position.clone().add(new g.THREE.Vector3(1, 1, 1));
  const px = new Uint8Array(4);
  const time = (n = 4) => { R.setRenderTarget(null); g.look.render(0, sun); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t = performance.now(); for (let i = 0; i < n; i++) { g.look.render(0, sun); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } return +((performance.now() - t) / n).toFixed(1); };
  const out = { base: time() };
  const tog = (o, label) => { const v = o.visible; o.visible = false; out[label] = +(out.base - time()).toFixed(1); o.visible = v; };
  const w = g.world;
  tog(w.planet.userData.surf, 'planet');
  tog(w.planet.userData.atm, 'atmosphere');
  tog(w.sky, 'sky (dome+stars+sun)');
  R.shadowMap.enabled = false; for (const m of [] ) ; out['shadows'] = +(out.base - time()).toFixed(1); R.shadowMap.enabled = true;
  if (g.look.bloom) { g.look.bloom.enabled = false; out['bloom'] = +(out.base - time()).toFixed(1); g.look.bloom.enabled = true; }
  const hp = g.look.composer.passes[1]; hp.enabled = false; out['haze'] = +(out.base - time()).toFixed(1); hp.enabled = true;
  const c = g.look.composer; for (const rt of [c.renderTarget1, c.renderTarget2]) { rt.samples = 0; rt.dispose(); } time(1); out['msaa4'] = +(out.base - time()).toFixed(1);
  let mesh = 0; const hidden = []; g.scene.traverse(o => { if ((o.isMesh) && o.visible && !w.planet.getObjectById(o.id) && !w.sky.getObjectById(o.id)) { o.visible = false; hidden.push(o); } }); out['all meshes'] = +(out.base - time()).toFixed(1); hidden.forEach(o => o.visible = true);
  return out;
});
console.log(JSON.stringify(r));
await b.close();
