// npm run check [-- --only=zfight,collide,clip,legs,suit,sheet] [--skip=...]
// Runs every automatic visual-bug check against a running game (starts `vite` on :5173 if nothing is there),
// prints pass/fail per check, writes checks/report.md and exits 1 if any check fails. Turntable sheets go to
// OUT (default ./checks, i.e. /mnt/project-files/low-orbit/checks in the cloud thread).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const arg = (k) => (process.argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1]?.split(',').filter(Boolean) || [];
const only = arg('only'), skip = arg('skip'), OUT = process.env.OUT || 'checks';
fs.mkdirSync(OUT, { recursive: true });
const CHECKS = [
  ['zfight', 'z-fighting (coplanar faces, glow vs hull, relay doors open/shut)', ['scripts/check/zfight.mjs', `${OUT}/zfight.json`]],
  ['coverage', 'every visible hull of every ship/station/wreck is solid to a jet-sized body', ['scripts/check/coverage.mjs', '300']],
  ['rams', 'slow: fly jet, suit, debris at every ship from 8 directions (--only=rams)', ['scripts/shipcollide.mjs'], {}, false, true],
  ['clip', 'jet cannot pass through any site mesh (stations, wrecks, depot)', ['scripts/clipcheck.mjs']],
  ['legs', 'suit legs and body stay out of the hull during hatch exit + entry', ['scripts/legcheck.mjs', OUT + '/legs'], { IN: '1' }],
  ['suit', 'suit parts do not clip walls, hull, wrecks (random approaches)', ['scripts/suitclip.mjs', '30']],
  ['sheet', 'turntable contact sheets (always passes, look at the PNGs)', ['scripts/check/turntable.mjs', OUT], {}, true],
];
const up = async () => { try { return (await fetch('http://localhost:5173/')).ok; } catch { return false; } };
let vite = null;
if (!process.env.URL && !(await up())) { vite = spawn('npx', ['vite', '--port', '5173', '--strictPort'], { stdio: 'ignore' }); for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500)); }
const rows = []; let failed = 0;
for (const [id, what, args, env = {}, soft, optIn] of CHECKS) {
  if ((optIn && !only.includes(id)) || (only.length && !only.includes(id)) || skip.includes(id)) continue;
  const t0 = Date.now(); let log = '';
  const code = await new Promise((res) => { const c = spawn('node', args, { env: { ...process.env, ...env } }); c.stdout.on('data', (d) => { log += d; }); c.stderr.on('data', (d) => { log += d; }); c.on('close', res); });
  const ok = code === 0 || soft; if (!ok) failed++;
  const s = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(8)} ${what}  (${s}s)`);
  if (!ok) console.log(log.split('\n').slice(-25).join('\n'));
  rows.push({ id, what, ok, s, log });
}
fs.writeFileSync(`${OUT}/report.md`, `# Check report\n\n` + rows.map((r) => `## ${r.ok ? 'PASS' : 'FAIL'} ${r.id}: ${r.what} (${r.s}s)\n\n\`\`\`\n${r.log.split('\n').slice(-60).join('\n')}\n\`\`\`\n`).join('\n'));
if (vite) vite.kill();
console.log(failed ? `${failed} check(s) failed, see ${OUT}/report.md` : 'all checks passed');
process.exit(failed ? 1 : 0);
