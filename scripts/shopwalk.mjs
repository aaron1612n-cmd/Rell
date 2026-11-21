// Walk from the cradle into the shop the way a player does: step out, face the shop door, hold forward.
// Logs where the suit stops and which collider it's pressed against. SAVE=fresh|fleet, PHONE=1, URL=...
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const OUT = process.env.OUT || '/mnt/project-files/low-orbit/shopblock/';
const PHONE = !!process.env.PHONE, TAG = (process.env.TAG || 'run') + (PHONE ? '-phone' : '');
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage(PHONE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : { viewport: { width: 960, height: 540 } });
let errs = 0;
p.on('console', (m) => { if (m.type() === 'error') { errs++; console.log('console:', m.text()); } });
p.on('pageerror', (e) => { errs++; console.log('pageerror:', e.message); });
const SAVE = process.env.SAVE || 'fresh';
await p.addInitScript((S) => { try { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', 1); localStorage.clear(); if (S !== 'fresh') localStorage.setItem('rell.save', JSON.stringify({ credits: 90000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); } } catch {} }, SAVE);
await p.goto(process.env.URL || 'http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 180000 });
await p.waitForTimeout(3000);
const ev = (f, a) => p.evaluate(f, a);
const shot = (n) => p.screenshot({ path: `${OUT}${TAG}-${n}.png` });
const info = () => ev(() => { const g = __game, B = g.base, l = g.eva.state === 'eva' ? B.local(g.eva.pilot.pos, new g.THREE.Vector3()) : null;
  // nearest obb surfaces to the pilot
  let near = [];
  if (l) { const P = g.eva.pilot.pos; for (const o of g.world.obbs) { const d = new g.THREE.Vector3().copy(P).sub(o.c).applyQuaternion(o.qi); const q = [Math.max(0, Math.abs(d.x) - o.h.x), Math.max(0, Math.abs(d.y) - o.h.y), Math.max(0, Math.abs(d.z) - o.h.z)]; const dist = Math.hypot(...q); if (dist < 1.5) near.push({ dist: +dist.toFixed(2), chunk: o.chunk, part: o.part?.name || o.part?.id || String(o.part).slice(0, 20), c: B.local(o.c, new g.THREE.Vector3()).toArray().map((v) => +v.toFixed(1)), h: [o.h.x, o.h.y, o.h.z].map((v) => +v.toFixed(2)) }); } }
  near.sort((a, b) => a.dist - b.dist);
  return { eva: g.eva.state, cap: B.captured, here: B.here, pres: +B.pres.toFixed(2), door: +B.doorOpen.toFixed(2), shopDoor: +B.doors.bayShop.open.toFixed(2), safe: g.eva.safe, teth: +(g.eva.tethDist || 0).toFixed(1), l: l && l.toArray().map((v) => +v.toFixed(2)), near: near.slice(0, 4) }; });
console.log('start', JSON.stringify(await info()));
await shot('00-start');
// let the autopilot / spawn settle; then step out
if (PHONE) { const bx = await p.locator('#exitbtn').boundingBox(); if (bx && bx.width) await p.touchscreen.tap(bx.x + bx.width / 2, bx.y + bx.height / 2); else await ev(() => __game.input.onExit()); } else await p.keyboard.press('KeyG');
for (let i = 0; i < 120; i++) { await p.waitForTimeout(500); if (await ev(() => __game.eva.state) === 'eva') break; }
await p.waitForTimeout(1500);
console.log('out', JSON.stringify(await info()));
await shot('01-out');
// face the shop door: aim the pilot's -z at the door centre (local 0,-4.75,-18)
await ev(() => { const g = __game, T = g.THREE, B = g.base; const tgt = B.world(new T.Vector3(0, -4.4, -22), new T.Vector3()); const m = new T.Matrix4().lookAt(g.eva.pilot.pos, tgt, new T.Vector3(0, 1, 0).applyQuaternion(B.site.group.quaternion)); g.eva.pilot.quat.setFromRotationMatrix(m); });
await p.waitForTimeout(800); await shot('02-facing-door');
// hold forward, re-aiming at the door each second (like a player steering)
// phone: push the move stick fully forward (what a thumb on the floating stick does)
const hold = () => (PHONE ? ev(() => { __game.input.stick.y = 1; }) : p.keyboard.down('KeyW'));
await hold();
let last = null;
for (let i = 0; i < 40; i++) {
  await p.waitForTimeout(1000);
  await ev(() => { const g = __game, T = g.THREE, B = g.base; const l = B.local(g.eva.pilot.pos, new T.Vector3()); const tgt = B.world(l.z > -18.5 ? new T.Vector3(0, -4.4, -22) : new T.Vector3(0, -4.0, -24.6), new T.Vector3()); const m = new T.Matrix4().lookAt(g.eva.pilot.pos, tgt, new T.Vector3(0, 1, 0).applyQuaternion(B.site.group.quaternion)); g.eva.pilot.quat.setFromRotationMatrix(m); });
  if (PHONE) await hold();
  const s = await info(); console.log('t' + i, JSON.stringify(s));
  if (i % 4 === 1) await shot('03-walk-' + String(i).padStart(2, '0'));
  if (s.l && s.l[2] < -23.6) { console.log('AT THE COUNTER'); await p.waitForTimeout(1500); console.log('final', JSON.stringify(await info())); await shot('05-counter'); break; }
  last = s;
}
if (PHONE) await ev(() => { __game.input.stick.y = 0; }); else await p.keyboard.up('KeyW');
await shot('04-end');
console.log('errors', errs);
await b.close();
