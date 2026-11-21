// Ships panel: real clicks on desktop (with pointer lock taken first) and real taps on a phone, screenshots of
// each step. node scripts/shipspanel.mjs <outdir> [url]
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [dir = 'shots/panel', url = 'http://localhost:5173/'] = process.argv.slice(2);
const fs = await import('node:fs'); fs.mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
for (const phone of [false, true]) {
  const ctx = await b.newContext(phone ? { ...devices['iPhone 13'] } : { viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage(); const tag = phone ? 'phone' : 'desk';
  let errs = 0; p.on('pageerror', (e) => { errs++; console.log('pageerror', e.message); }); p.on('console', (m) => { if (m.type() === 'error') { errs++; console.log('console', m.text()); } });
  await p.addInitScript(() => { try { localStorage.setItem('rell.save', JSON.stringify({ credits: 60000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); localStorage.removeItem('rell.fleet'); } catch {} });
  await p.goto(url); await p.waitForFunction(() => window.__game, null, { timeout: 180000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { const g = __game; g.rig.introDur = 0; g.tutorial.on && g.tutorial.finish(); });
  await p.waitForTimeout(500);
  if (!phone) {
    await p.mouse.click(720, 450); await p.waitForTimeout(400);
    console.log('pointer lock taken:', await p.evaluate(() => !!document.pointerLockElement));
    await p.keyboard.press('KeyL');
  } else {
    await p.tap('#shipbtn');
  }
  await p.waitForTimeout(1500);
  ok(await p.evaluate(() => __game.fleet.panelOpen), `${tag}: panel opens`);
  ok(!(await p.evaluate(() => __game.menu.open)), `${tag}: pause menu stays shut`);
  await p.screenshot({ path: `${dir}/${tag}-1-yard.png` });
  const press = async (sel) => { const el = await p.$(sel); if (!el) return false; if (phone) await el.tap(); else await el.click(); await p.waitForTimeout(500); return true; };
  ok(await press('#ships .it[data-sel="kite"]'), `${tag}: pick Kite`);
  ok(await p.evaluate(() => __game.fleet.sel === 'kite'), `${tag}: Kite selected`);
  await p.screenshot({ path: `${dir}/${tag}-2-kite.png` });
  const cr0 = await p.evaluate(() => __game.econ.credits);
  ok(await press('#ships .act button[data-a="buy"]'), `${tag}: press Buy`);
  ok(await p.evaluate(() => __game.fleet.byId.kite.owned), `${tag}: Kite owned`);
  ok(await p.evaluate((c) => __game.econ.credits === c - 18000, cr0), `${tag}: credits taken`);
  ok(await p.evaluate(() => { const S = __game.fleet.byId.kite; return !S.stowed && S.site.group.visible && __game.world.sites.includes(S.site); }), `${tag}: Kite delivered to its berth`);
  await p.screenshot({ path: `${dir}/${tag}-3-bought.png` });
  if (phone) { ok(await press('#ships .back'), `${tag}: back to list`); }
  ok(await press('#ships .tabs button[data-tab="derelict"]'), `${tag}: Adrift tab`);
  await p.screenshot({ path: `${dir}/${tag}-4-adrift.png` });
  ok(await press('#ships .tabs button[data-tab="own"]'), `${tag}: Yours tab`);
  ok(await p.evaluate(() => [...document.querySelectorAll('#ships .it')].some((e) => e.dataset.sel === 'kite')), `${tag}: Kite listed as yours`);
  await p.screenshot({ path: `${dir}/${tag}-5-yours.png` });
  ok(await press('#ships .x'), `${tag}: close`);
  ok(!(await p.evaluate(() => __game.fleet.panelOpen)), `${tag}: panel closed`);
  ok(!(await p.evaluate(() => __game.menu.open)), `${tag}: no pause menu after close`);
  ok(errs === 0, `${tag}: no console errors (${errs})`);
  await ctx.close();
}
console.log('fails', fails);
await b.close();
