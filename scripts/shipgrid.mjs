// node scripts/shipgrid.mjs <outdir> [ids...]: 6 views per ship (front34, rear34, side, top, below, close) -> <id>.png grid + singles
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [out, ...ids0] = process.argv.slice(2);
const ids = ids0.length ? ids0 : ['wren', 'kite', 'hornet', 'mule', 'packhorse', 'prospector', 'lance', 'atlas', 'gull', 'sable', 'vigil', 'cinder', 'ironwake'];
const views = [['front', 25, 12, .62], ['rear', 160, 14, .62], ['side', 90, 2, .6], ['top', 0, 88, .58], ['below', 30, -50, .62], ['close', 55, 18, .32]];
const fs = await import('node:fs'); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
for (const id of ids) {
  for (const [n, yaw, pitch, dist] of views) {
    await p.goto(`http://localhost:5173/tools/view/fleet.html?id=${id}&yaw=${yaw}&pitch=${pitch}&dist=${dist}${process.env.WIRE ? '&wire=1' : ''}`);
    await p.waitForFunction(() => window.__done, null, { timeout: 90000 });
    await p.screenshot({ path: `${out}/${id}-${n}.png` });
  }
  execSync(`python3 -c "
from PIL import Image
ims=[Image.open('${out}/${id}-'+n+'.png') for n in ['front','rear','side','top','below','close']]
W=Image.new('RGB',(1920,800))
for i,im in enumerate(ims): W.paste(im,((i%3)*640,(i//3)*400))
W.save('${out}/${id}.png')"`);
  console.log(id);
}
await b.close();
