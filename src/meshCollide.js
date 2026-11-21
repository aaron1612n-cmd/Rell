import * as THREE from 'three';

// Sphere-vs-triangle-mesh contacts for the EVA suit, against the real station and wreck meshes (the box
// colliders are sized for the ship; a glove or a boot is small enough to slip into what they miss).
// Each geometry gets a small AABB tree over its triangles, built once, the first time the suit comes near.

const LEAF = 8;
class TriTree {
  constructor(geo) {
    const pa = geo.attributes.position, idx = geo.index, n = idx ? idx.count / 3 : pa.count / 3;
    const P = this.P = new Float32Array(n * 9), Nn = this.N = new Float32Array(n * 3), C = new Float32Array(n * 3);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    for (let t = 0; t < n; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pa, i0); b.fromBufferAttribute(pa, i1); c.fromBufferAttribute(pa, i2);
      P.set([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], t * 9);
      e1.subVectors(b, a); e2.subVectors(c, a); e1.cross(e2); const l = e1.length() || 1;
      Nn[t * 3] = e1.x / l; Nn[t * 3 + 1] = e1.y / l; Nn[t * 3 + 2] = e1.z / l;
      C[t * 3] = (a.x + b.x + c.x) / 3; C[t * 3 + 1] = (a.y + b.y + c.y) / 3; C[t * 3 + 2] = (a.z + b.z + c.z) / 3;
    }
    const order = new Uint32Array(n); for (let i = 0; i < n; i++) order[i] = i;
    // nodes: [minx,miny,minz,maxx,maxy,maxz, left|start, right|-count]
    const nodes = []; this.order = order;
    const build = (s, e) => {
      const id = nodes.length / 8; nodes.push(0, 0, 0, 0, 0, 0, 0, 0);
      let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9, cx0 = 1e9, cy0 = 1e9, cz0 = 1e9, cx1 = -1e9, cy1 = -1e9, cz1 = -1e9;
      for (let i = s; i < e; i++) {
        const t = order[i];
        for (let k = 0; k < 3; k++) { const x = P[t * 9 + k * 3], y = P[t * 9 + k * 3 + 1], z = P[t * 9 + k * 3 + 2]; if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z; }
        const x = C[t * 3], y = C[t * 3 + 1], z = C[t * 3 + 2]; if (x < cx0) cx0 = x; if (y < cy0) cy0 = y; if (z < cz0) cz0 = z; if (x > cx1) cx1 = x; if (y > cy1) cy1 = y; if (z > cz1) cz1 = z;
      }
      const o = id * 8; nodes[o] = x0; nodes[o + 1] = y0; nodes[o + 2] = z0; nodes[o + 3] = x1; nodes[o + 4] = y1; nodes[o + 5] = z1;
      if (e - s <= LEAF) { nodes[o + 6] = s; nodes[o + 7] = -(e - s); return id; }
      const dx = cx1 - cx0, dy = cy1 - cy0, dz = cz1 - cz0, ax = dx > dy ? (dx > dz ? 0 : 2) : (dy > dz ? 1 : 2), mid = [(cx0 + cx1) / 2, (cy0 + cy1) / 2, (cz0 + cz1) / 2][ax];
      let i = s, j = e - 1;
      while (i <= j) { if (C[order[i] * 3 + ax] < mid) i++; else { const t = order[i]; order[i] = order[j]; order[j] = t; j--; } }
      if (i === s || i === e) i = (s + e) >> 1;
      const l = build(s, i), r = build(i, e);
      nodes[o + 6] = l; nodes[o + 7] = r; return id;
    };
    if (n) build(0, n);
    this.nodes = new Float32Array(nodes);
    this.stack = new Int32Array(128);
  }

  // nearest triangle point to p within r: fills out {q (Vector3), d2, tri} and returns true if found
  nearest(px, py, pz, r, out) {
    const nd = this.nodes, P = this.P, st = this.stack; if (!nd.length) return false;
    let best = r * r, found = false, sp = 0; st[sp++] = 0;
    while (sp) {
      const o = st[--sp] * 8;
      const dx = Math.max(nd[o] - px, 0, px - nd[o + 3]), dy = Math.max(nd[o + 1] - py, 0, py - nd[o + 4]), dz = Math.max(nd[o + 2] - pz, 0, pz - nd[o + 5]);
      if (dx * dx + dy * dy + dz * dz > best) continue;
      if (nd[o + 7] < 0) {
        const s = nd[o + 6], e = s - nd[o + 7];
        for (let i = s; i < e; i++) {
          const t = this.order[i], d2 = closest(P, t * 9, px, py, pz, _q);
          if (d2 < best) { best = d2; found = true; out.q.copy(_q); out.d2 = d2; out.tri = t; }
        }
      } else if (sp < 126) { st[sp++] = nd[o + 6]; st[sp++] = nd[o + 7]; }
    }
    return found;
  }
}

// closest point on triangle (Ericson 5.1.5); writes q, returns squared distance
const _q = new THREE.Vector3();
function closest(P, o, px, py, pz, q) {
  const ax = P[o], ay = P[o + 1], az = P[o + 2], bx = P[o + 3], by = P[o + 4], bz = P[o + 5], cx = P[o + 6], cy = P[o + 7], cz = P[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let x, y, z;
  if (d1 <= 0 && d2 <= 0) { x = ax; y = ay; z = az; } else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { x = bx; y = by; z = bz; } else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); x = ax + abx * v; y = ay + aby * v; z = az + abz * v; } else {
        const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { x = cx; y = cy; z = cz; } else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); x = ax + acx * w; y = ay + acy * w; z = az + acz * w; } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); x = bx + (cx - bx) * w; y = by + (cy - by) * w; z = bz + (cz - bz) * w; } else {
              const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; x = ax + abx * v + acx * w; y = ay + aby * v + acy * w; z = az + abz * v + acz * w;
            }
          }
        }
      }
    }
  }
  q.set(x, y, z); const dx = px - x, dy = py - y, dz = pz - z; return dx * dx + dy * dy + dz * dz;
}

// ---- the registry: which meshes of which sites the suit can touch ------------------------------------
const SKIP = /lamp|light|beacon|glow|holo|halo|flare|dust|plume|beam|sprite/i;
const trees = new WeakMap();
function treeOf(geo) { let t = trees.get(geo); if (!t) { t = new TriTree(geo); trees.set(geo, t); } return t; }

export class MeshCollide {
  constructor(world) { this.world = world; this.cache = new Map(); this.skip = new WeakSet(); }
  // never collide with these (and their children): loot you fly into to pick up, sliding props that have
  // their own boxes, etc.
  exclude(o) { o.traverse((c) => this.skip.add(c)); }
  meshes(site) {
    let m = this.cache.get(site);
    if (!m) {
      m = [];
      site.group.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || this.skip.has(o)) return;
        const mat = Array.isArray(o.material) ? o.material[0] : o.material;
        if (!mat || mat.transparent || mat.blending === THREE.AdditiveBlending || mat.visible === false) return;
        let bad = false; for (let a = o; a && a !== site.group; a = a.parent) if (SKIP.test(a.name || '')) bad = true;
        if (bad || !o.geometry.attributes.position) return;
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        m.push({ o, tree: null, inv: new THREE.Matrix4(), frame: -1, s: 1 });
      });
      this.cache.set(site, m);
    }
    return m;
  }
  // build the trees of everything within reach of p now (a hitch here is hidden by the hatch animation)
  prepare(p, reach = 120) {
    for (const s of this.world.sites) {
      if (!s.active) continue;
      for (const e of this.meshes(s)) { e.o.updateWorldMatrix(true, false); _c.copy(e.o.geometry.boundingSphere.center).applyMatrix4(e.o.matrixWorld); if (_c.distanceTo(p) < reach + e.o.geometry.boundingSphere.radius * e.o.matrixWorld.getMaxScaleOnAxis()) e.tree = e.tree || treeOf(e.o.geometry); }
    }
  }
  // contacts of a world sphere: fn(normal, pen)
  contacts(c, r, fn, frame) {
    for (const s of this.world.sites) {
      if (!s.active || (this.only && !this.only.has(s.kind))) continue;
      for (const e of this.meshes(s)) {
        const o = e.o; let hid = false; for (let q = o; q; q = q.parent) if (q.visible === false) { hid = true; break; }
        if (hid) continue;   // hidden anywhere up the chain (Ilse's tool tray under a hidden group used to stay solid)
        const bs = o.geometry.boundingSphere, M = o.matrixWorld;
        if (e.frame !== frame) { e.frame = frame; e.s = M.getMaxScaleOnAxis(); e.inv.copy(M).invert(); e.cw = (e.cw || new THREE.Vector3()).copy(bs.center).applyMatrix4(M); }
        const R = bs.radius * e.s + r; if (c.distanceToSquared(e.cw) > R * R) continue;
        e.tree = e.tree || treeOf(o.geometry);
        _c.copy(c).applyMatrix4(e.inv); const rl = r / e.s;
        if (!e.tree.nearest(_c.x, _c.y, _c.z, rl, _hit)) continue;
        const t = _hit.tri, N = e.tree.N;
        _fn.set(N[t * 3], N[t * 3 + 1], N[t * 3 + 2]);
        _d.copy(_c).sub(_hit.q); const d = Math.sqrt(_hit.d2);
        let pen;
        // centre just behind the face it's nearest: it got inside, so out through the front. (Further behind is
        // more likely the back of an open panel, so that pushes back the way it came.)
        if (_d.dot(_fn) < 0 && d < rl * 0.5) { _d.copy(_fn); pen = rl + d; }
        else if (d > 1e-6) { _d.divideScalar(d); pen = rl - d; } else { _d.copy(_fn); pen = rl; }
        // to world (directions through the normal matrix; the scale is uniform)
        _n.copy(_d).transformDirection(M);
        fn(_n, pen * e.s);
      }
    }
  }
}
const _c = new THREE.Vector3(), _d = new THREE.Vector3(), _fn = new THREE.Vector3(), _n = new THREE.Vector3(), _hit = { q: new THREE.Vector3(), d2: 0, tri: 0 };
