// Turntable shots of the suit: node scripts/suitshots.mjs <outdir> "name:query" ...   (needs vite on :5173)
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [out, ...views] = process.argv.slice(2);
const fs = await import('node:fs'); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +(process.env.W || 900), height: +(process.env.H || 900) } });
p.on('pageerror', (e) => console.log('pageerror:', e.message)); p.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
for (const v of views) {
  const [name, qs] = v.split(':');
  await p.goto('http://localhost:5173/tools/suitview/?' + qs); await p.waitForFunction(() => window.__ready, null, { timeout: 120000 });
  await p.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name);
}
await b.close();
