// Strict-GPU check: bash -> node scripts/nanscan.mjs [w h] (needs vite on :5173). Reports NaN/Inf pixels per view.
// Emulates strict GPU math (Windows/ANGLE-like): pow() of a negative base and normalize() of a zero
// vector give NaN. Then counts NaN/Inf pixels in the scene buffer for a few views.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [w=1280, h=720] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
await p.addInitScript(() => {
  const o = WebGL2RenderingContext.prototype.shaderSource;
  const N = 'uintBitsToFloat(0x7fc00000u)';
  const fns = ['float','vec2','vec3','vec4'].map(t => `${t} _pw(${t} a, ${t} b){ return any(lessThan(${t}(a) * ${t}(1.), ${t}(0.))) ? ${t}(${N}) : pow(a, b); }`).join('\n').replace(/any\(lessThan\(float\(a\) \* float\(1\.\), float\(0\.\)\)\)/, 'a < 0.')
    + '\n' + ['vec2','vec3','vec4'].map(t => `${t} _nz(${t} a){ return dot(a, a) == 0. ? ${t}(${N}) : normalize(a); }`).join('\n') + '\nfloat _nz(float a){ return a == 0. ? ' + N + ' : sign(a); }';
  WebGL2RenderingContext.prototype.shaderSource = function (sh, src) {
    if (/#version 300 es/.test(src)) {
      const lines = src.split('\n'); let i = 0; lines.forEach((l, k) => { if (/^\s*precision /.test(l)) i = k + 1; });
      if (i) { lines.splice(i, 0, fns, '#define pow _pw', '#define normalize _nz'); src = lines.join('\n'); }
    }
    return o.call(this, sh, src);
  };
});
p.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 600)); });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto('http://127.0.0.1:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 90000 });
await p.waitForTimeout(4000);
const scan = (label) => p.evaluate((label) => {
  const g = window.__game, R = g.renderer, c = g.look.composer, rp = c.passes[0];
  return new Promise((res) => {
    const orig = rp.render.bind(rp);
    rp.render = (r, wb, rb, ...a) => { orig(r, wb, rb, ...a); rp.render = orig;
      const t = rb; const W = t.width, H = t.height, buf = new Uint16Array(W * H * 4); R.readRenderTargetPixels(t, 0, 0, W, H, buf);
      let bad = 0, sx = 0, sy = 0; for (let i = 0; i < buf.length; i += 4) { let x = false; for (let j = 0; j < 3; j++) if (((buf[i + j] >> 10) & 31) === 31) x = true; if (x) { bad++; const px = i >> 2; sx += px % W; sy += (px / W) | 0; } }
      let nz = 0; for (let i = 0; i < buf.length; i += 4) if (buf[i]) nz++; res({ label, nz, W, H, bad, at: bad ? [Math.round(sx / bad), H - Math.round(sy / bad)] : null });
    };
  });
}, label);
console.log(JSON.stringify(await scan('start')));
await p.screenshot({ path: '/tmp/claude-0/diag/ns-start.png' });
await p.keyboard.down('KeyW'); await p.waitForTimeout(2500); console.log(JSON.stringify(await scan('thrust'))); await p.screenshot({ path: '/tmp/claude-0/diag/ns-thrust.png' }); await p.keyboard.up('KeyW');
await p.keyboard.press('KeyV'); await p.waitForTimeout(2500); console.log(JSON.stringify(await scan('cockpit'))); await p.screenshot({ path: '/tmp/claude-0/diag/ns-cockpit.png' });
await p.keyboard.press('KeyV'); await p.waitForTimeout(1500);
await p.evaluate(() => { const g = window.__game; g.ship.quat.setFromAxisAngle(new g.THREE.Vector3(1,0,0), 1.4); });
await p.waitForTimeout(2000); console.log(JSON.stringify(await scan('down'))); await p.screenshot({ path: '/tmp/claude-0/diag/ns-down.png' });
await b.close();
