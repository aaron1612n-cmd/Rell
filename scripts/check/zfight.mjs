// Z-fighting audit: finds coplanar (or near-coplanar) overlapping faces that belong to different meshes, plus
// duplicate faces inside one mesh, in every site/ship/suit model of the running game, then repeats the relay
// with its doors at several open amounts. Reports per model and part. Exit 1 if any unmitigated hits.
// node scripts/check/zfight.mjs [outfile.json]   (vite on :5173, or URL=...)   env: EPS (m, default 0.004)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const outFile = process.argv[2];
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.addInitScript(() => { try { localStorage.setItem('rell.save', JSON.stringify({ credits: 250000, tut: true, xp: 0, up: {}, stats: {}, career: {} })); } catch {} });
await p.goto(process.env.URL || 'http://localhost:5173/'); await p.waitForFunction(() => window.__game, null, { timeout: 180000 });
await p.waitForTimeout(2500);
const res = await p.evaluate(async (EPS) => {
  const g = window.__game, T = g.THREE, w = g.world; g.look.render = () => {};
  g.rig.introDur = 0; if (g.tutorial.on) g.tutorial.finish();
  const meshId = new Map(); const nameOf = (o) => { const n = []; for (let a = o; a && n.length < 3; a = a.parent) if (a.name && !/^(Scene|Object3D|Group)$/.test(a.name)) n.push(a.name); let nm = n.reverse().join('/'); if (!nm) { const m0 = Array.isArray(o.material) ? o.material[0] : o.material; if (!meshId.has(o)) meshId.set(o, meshId.size); nm = (o.parent?.name ? o.parent.name + '/' : '') + (m0?.name || 'mesh') + '#' + meshId.get(o) + '(' + o.geometry.attributes.position.count + 'v)'; } return nm; };
  const vis = (o) => { for (let a = o; a; a = a.parent) if (!a.visible) return false; return true; };
  function audit(root) {
    root.updateMatrixWorld(true);
    const tris = []; // {a,b,c: Vector3, n, d, mesh, area}
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !vis(o)) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material; const tr = !!(m && (m.transparent || m.depthWrite === false || m.blending === 2)); if (!m || m.colorWrite === false || m.depthTest === false || (tr && (m.opacity < 0.02 || /shadow/i.test(o.name)))) return;
      if (m.polygonOffset) return;                       // already nudged
      const ca = o.geometry.attributes.color, pa = o.geometry.attributes.position, ix = o.geometry.index, n = ix ? ix.count : pa.count, dbl = m.side === 2;
      const v = (i) => new T.Vector3().fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld);
      for (let i = 0; i + 2 < n; i += 3) {
        const a = v(ix ? ix.getX(i) : i), b = v(ix ? ix.getX(i + 1) : i + 1), c = v(ix ? ix.getX(i + 2) : i + 2);
        const nn = b.clone().sub(a).cross(c.clone().sub(a)); const area = nn.length() / 2; if (area < 2e-4) continue;
        nn.normalize(); const col = new T.Color(1, 1, 1); if (m.color) col.copy(m.color); if (ca) { const ii = [i, i + 1, i + 2].map((x) => (ix ? ix.getX(x) : x)); col.multiply(new T.Color((ca.getX(ii[0]) + ca.getX(ii[1]) + ca.getX(ii[2])) / 3, (ca.getY(ii[0]) + ca.getY(ii[1]) + ca.getY(ii[2])) / 3, (ca.getZ(ii[0]) + ca.getZ(ii[1]) + ca.getZ(ii[2])) / 3)); } tris.push({ tr, col, mat: m,  a, b, c, n: nn, d: nn.dot(a), mesh: o, dbl, area, cen: a.clone().add(b).add(c).divideScalar(3) });
      }
    });
    const CELL = 1.5, grid = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
    tris.forEach((t, i) => {
      const lo = new T.Vector3(Math.min(t.a.x, t.b.x, t.c.x), Math.min(t.a.y, t.b.y, t.c.y), Math.min(t.a.z, t.b.z, t.c.z)), hi = new T.Vector3(Math.max(t.a.x, t.b.x, t.c.x), Math.max(t.a.y, t.b.y, t.c.y), Math.max(t.a.z, t.b.z, t.c.z));
      const c0 = lo.clone().divideScalar(CELL).floor(), c1 = hi.clone().divideScalar(CELL).floor();
      const cnt = (c1.x - c0.x + 1) * (c1.y - c0.y + 1) * (c1.z - c0.z + 1);
      if (cnt > 64) { const k = key(...t.cen.clone().divideScalar(CELL).floor().toArray()); (grid.get(k) || grid.set(k, []).get(k)).push(i); return; }
      for (let x = c0.x; x <= c1.x; x++) for (let y = c0.y; y <= c1.y; y++) for (let z = c0.z; z <= c1.z; z++) { const k = key(x, y, z); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
    });
    const proj = (t, e1, e2, p) => [p.dot(e1), p.dot(e2)];
    const clipArea = (A, B) => { // Sutherland-Hodgman, both CCW-normalised
      const ccw = (P) => (((P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[1][1] - P[0][1]) * (P[2][0] - P[0][0])) < 0 ? [P[0], P[2], P[1]] : P);
      A = ccw(A); B = ccw(B); let out = A;
      for (let i = 0; i < 3 && out.length; i++) {
        const p1 = B[i], p2 = B[(i + 1) % 3], inside = (q) => (p2[0] - p1[0]) * (q[1] - p1[1]) - (p2[1] - p1[1]) * (q[0] - p1[0]) >= -1e-9;
        const inp = out; out = [];
        for (let j = 0; j < inp.length; j++) {
          const c = inp[j], d = inp[(j + 1) % inp.length], ci = inside(c), di = inside(d);
          const X = () => { const a1 = d[0] - c[0], b1 = d[1] - c[1], a2 = p2[0] - p1[0], b2 = p2[1] - p1[1], den = a1 * b2 - b1 * a2, tt = ((p1[0] - c[0]) * b2 - (p1[1] - c[1]) * a2) / den; return [c[0] + a1 * tt, c[1] + b1 * tt]; };
          if (ci) { out.push(c); if (!di) out.push(X()); } else if (di) out.push(X());
        }
      }
      let s = 0; for (let i = 0; i < out.length; i++) { const q = out[i], r = out[(i + 1) % out.length]; s += q[0] * r[1] - r[0] * q[1]; } return Math.abs(s) / 2;
    };
    const seen = new Set(), groups = {}; let dupes = 0;
    for (const list of grid.values()) {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const ia = list[i], ib = list[j];
        const A = tris[ia], B = tris[ib];
        const same = A.n.dot(B.n); if (Math.abs(same) < 0.9995) continue;
        if (same < 0 && !(A.dbl || B.dbl)) continue;        // back to back, culled from each side
        // plane distance of every B vertex from A's plane
        const dc = Math.abs(A.col.r - B.col.r) + Math.abs(A.col.g - B.col.g) + Math.abs(A.col.b - B.col.b); const sameLook = dc < 0.04 && (A.mat === B.mat || (A.mat.roughness === B.mat.roughness && A.mat.metalness === B.mat.metalness && A.mat.map === B.mat.map && (!A.mat.emissive || A.mat.emissive.equals(B.mat.emissive)))); if (sameLook && !A.tr && !B.tr) continue;
        const dd = [B.a, B.b, B.c].map((q) => Math.abs(A.n.dot(q) - A.d)); if (Math.max(...dd) > EPS) continue;
        const k = ia < ib ? ia * 1e7 + ib : ib * 1e7 + ia; if (seen.has(k)) continue; seen.add(k);
        if (A.mesh === B.mesh && same < 0) continue;
        const e1 = Math.abs(A.n.x) < 0.9 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 1, 0); e1.sub(A.n.clone().multiplyScalar(e1.dot(A.n))).normalize(); const e2 = A.n.clone().cross(e1);
        const ar = clipArea([A.a, A.b, A.c].map((q) => proj(0, e1, e2, q)), [B.a, B.b, B.c].map((q) => proj(0, e1, e2, q)));
        if (ar < 1e-3) continue;                              // < 10 cm^2
        const na = nameOf(A.mesh), nb = nameOf(B.mesh), id = na <= nb ? na + '  <>  ' + nb : nb + '  <>  ' + na;
        const gp = (groups[id] = groups[id] || { tr: A.tr || B.tr, n: 0, area: 0, at: null, dup: A.mesh === B.mesh }); gp.n++; gp.area += ar; if (!gp.at) gp.at = A.cen.toArray().map((x) => +x.toFixed(2));
        if (A.mesh === B.mesh) dupes++;
      }
    }
    return { tris: tris.length, groups, dupes };
  }
  const out = {};
  const roots = [];
  for (const s of w.sites) if (s.group) roots.push([s.id || s.kind, s.group, s]);
  for (const [id, S] of Object.entries(g.fleet.byId)) { if (S.site && !roots.some((r) => r[1] === S.site.group)) { S.site.group.visible = true; roots.push(['fleet:' + id, S.site.group, S.site]); } }
  roots.push(['player-ship', g.shipMesh], ['suit', g.eva.body]);
  const relaySite = w.sites.find((s) => s.byName && s.byName.relay);
  for (const [id, grp, s] of roots) {
    if (s === relaySite) continue;
    out[id] = audit(grp);
  }
  // relay with doors shut / half / open
  if (relaySite && g.relay) {
    for (const o of [0, 0.5, 1]) {
      for (const d of Object.values(g.relay.doors)) { d.open = d.target = o; }
      for (let i = 0; i < 6; i++) g.relay.update(1 / 60, i / 60, g.camera.position, g.eva, g.ship);
      for (const d of Object.values(g.relay.doors)) { d.open = d.target = o; g.relay.slide(d); }
      out['relay doors=' + o] = audit(relaySite.group);
    }
  }
  return out;
}, +(process.env.EPS || 0.004));
let total = 0, minor = 0; const MINA = +(process.env.MINAREA || 5);
for (const [model, r] of Object.entries(res)) {
  const gs = Object.entries(r.groups).sort((a, b) => b[1].area - a[1].area); total += gs.filter(([, v]) => v.area >= MINA).length; minor += gs.filter(([, v]) => v.area < MINA).length;
  console.log(`\n## ${model}: ${r.tris} tris, ${gs.length} clashing part pairs, ${r.dupes} duplicate-face overlaps`);
  for (const [k, v] of gs.slice(0, 15)) console.log(`  ${v.dup ? '[dup] ' : ''}${v.tr ? '[glass/glow] ' : ''}${k}  x${v.n}  ${v.area.toFixed(2)} m2  at ${v.at}`);
}
console.log(`\nz-fight part pairs: ${total} visible (>= ${MINA} m2), ${minor} minor`);
if (outFile) fs.writeFileSync(outFile, JSON.stringify(res, null, 1));
await b.close();
process.exit(total ? 1 : 0);
