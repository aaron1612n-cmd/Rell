// The game's pop-ups all at once (story comms, first-time tip, toast, station line, cutter label), on phones and desktop.
// node scripts/alertshots.mjs <outdir>   (needs vite on :5173)
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [out = '/tmp/alerts'] = process.argv.slice(2);
const fs = await import('node:fs'); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const sizes = (process.env.SIZES || 'phone:390x844,land:844x390,desk:1280x720').split(',');
for (const sz of sizes) {
  const [name, wh] = sz.split(':'), [w, h] = wh.split('x').map(Number), mobile = w < 900 && h < 900;
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  p.on('pageerror', (e) => console.log('pageerror:', e.message));
  await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 120000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { const g = window.__game; g.rig.introDur = 0; if (g.tutorial.on) g.tutorial.finish(); g.tutorial.hideIntro?.(); });
  await p.waitForTimeout(600);
  const pop = async () => p.evaluate(() => {
    const g = window.__game;
    g.tutorial.hideIntro?.(); g.story.comms('New hands start small. Bring me two pieces of anything and you get paid twice.', 'First haul');
    g.tips.show('cutter', true); g.tips.t = 0; g.tips.update(0.01);
    g.story.toast('info', 'Reactor unclamped safely');
  });
  await pop(); await p.waitForTimeout(900);
  await p.screenshot({ path: `${out}/${name}-fly.png` });
  await p.evaluate(() => window.__game.eva.request());
  await p.waitForFunction(() => window.__game.eva.state === 'eva', null, { timeout: 300000 });
  await pop(); await p.waitForTimeout(900);
  await p.screenshot({ path: `${out}/${name}-eva.png` });
  await p.close();
}
await b.close();
