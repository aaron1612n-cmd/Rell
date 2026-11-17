// Engine close-ups and chase-cam shots. Usage: node scripts/engshots.mjs <outdir> [names...]
// Needs the dev server on :5173. Holds the main engine (and boost) on with the ship pinned in place.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const out = process.argv[2] || 'shots/eng'; const only = process.argv.slice(3);
import { mkdirSync } from 'node:fs'; mkdirSync(out, { recursive: true });
// cam: offset from ship and look target (ship-local, ship faces -Z); null = live chase rig
const S = [
  ['closeup-idle', 1280, 720, { fwd: 0 }, [2.4, 0.9, 4.6], [0, 0, 2.2]],
  ['closeup-cruise', 1280, 720, { fwd: 1 }, [2.4, 0.9, 4.6], [0, 0, 2.2]],
  ['closeup-boost', 1280, 720, { fwd: 1, boost: true }, [3.2, 1.2, 6.5], [0, 0, 4]],
  ['side-boost', 1280, 720, { fwd: 1, boost: true }, [7, 1.4, 5], [0, 0, 6]],
  ['rear-cruise', 1280, 720, { fwd: 1 }, [0.4, 0.6, 7], [0, 0, 0]],
  ['bells-cold', 1280, 720, { fwd: 0 }, [1.1, -0.5, 3.6], [0.5, 0, 2.2]],
  ['ignition-boost', 1280, 720, { fwd: 1, boost: true }, [3.2, 1.2, 6.5], [0, 0, 4], 140],
  ['chase-cruise-desktop', 1280, 720, { fwd: 1 }, null],
  ['chase-boost-desktop', 1280, 720, { fwd: 1, boost: true }, null],
  ['chase-cruise-mobile', 390, 844, { fwd: 1 }, null],
  ['chase-boost-mobile', 390, 844, { fwd: 1, boost: true }, null],
  ['closeup-boost-mobile', 390, 844, { fwd: 1, boost: true }, [2.6, 1.2, 6.5], [0, 0, 3.5]],
];
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const [name, w, h, hold, off, tgt, delay] of S) {
  if (only.length && !only.includes(name)) continue;
  const mobile = w < 600;
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  p.on('pageerror', (e) => console.log(name, 'pageerror:', e.message));
  p.on('console', (m) => { if (m.type() === 'error') console.log(name, 'console:', m.text()); });
  await p.goto('http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 60000 });
  await p.waitForTimeout(5000);
  if (process.env.PRE) await p.evaluate(process.env.PRE);
  await p.evaluate(([hold, off, tgt]) => {
    const g = window.__game; g.world.update = () => {};
    document.querySelectorAll('#hud, .hud, #help, .help, #hint, .hint').forEach((e) => (e.style.display = 'none'));
    const P = [30, 14, 142]; const st = g.ship.step.bind(g.ship);
    const pin = (s) => { s.vel.set(0, 0, 0); s.angVel.set(0, 0, 0); s.pos.set(...P); s.quat.set(0, 0, 0, 1); };
    if (off) { pin(g.ship); g.ship.step = function (dt, c) { st(dt, { ...c, ...hold }); pin(this); }; }
    else g.ship.step = function (dt, c) { st(dt, { ...c, ...hold }); };   // chase: really fly
    if (off) { const cp = () => { g.camera.position.set(P[0] + off[0], P[1] + off[1], P[2] + off[2]); g.camera.up.set(0, 1, 0); g.camera.lookAt(P[0] + tgt[0], P[1] + tgt[1], P[2] + tgt[2]); }; g.rig.update = cp; cp(); }
  }, [hold, off, tgt]);
  await p.waitForTimeout(delay || (off ? (hold.fwd ? 2600 : 1500) : 1800));
  await p.screenshot({ path: `${out}/${name}.png` });
  await p.close();
}
await b.close();
