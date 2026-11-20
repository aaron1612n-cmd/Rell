// node scripts/fleetshots.mjs <outdir> [ids...]  (vite dev on :5173): two views per ship from the dev viewer
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [out, ...ids0] = process.argv.slice(2);
const ids = ids0.length ? ids0 : ['wren', 'kite', 'hornet', 'mule', 'packhorse', 'prospector', 'lance', 'atlas', 'gull', 'sable', 'vigil', 'cinder', 'ironwake'];
const views = (process.env.VIEWS || 'f:35:14,r:150:18').split(',').map((v) => v.split(':'));
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +(process.env.W || 900), height: +(process.env.H || 560) } });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
for (const id of ids) for (const [n, yaw, pitch, dist = 1.3] of views) {
  await p.goto(`http://localhost:5173/tools/view/fleet.html?id=${id}&yaw=${yaw}&pitch=${pitch}&dist=${dist}${process.env.WIRE ? '&wire=1' : ''}`);
  await p.waitForFunction(() => window.__done, null, { timeout: 90000 });
  await p.screenshot({ path: `${out}/${id}-${n}.png` }); console.log(id, n);
}
await b.close();
