// Usage: node scripts/shot.mjs <out.png> <w> <h> [js to eval in page] [url]
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [out, w = 1280, h = 720, js = '', url = 'http://localhost:5173/'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const mobile = +w < 600;
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
p.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto(url); await p.waitForFunction(() => window.__game, null, { timeout: 60000 });
await p.waitForTimeout(+(process.env.WAIT||2500));
if (js) await p.evaluate(js);
await p.waitForTimeout(1500);
await p.screenshot({ path: out });
await b.close();
