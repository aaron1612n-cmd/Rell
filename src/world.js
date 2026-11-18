import * as THREE from 'three';
import { mats } from './assets.js';
import { buildSky, buildPlanet, placePlanet } from './sky.js';
import { buildSites, LAYOUT } from './sites.js';
import debrisData from './assets/debris.json';

export const SUN_DIR = new THREE.Vector3(0.62, 0.5, 0.6).normalize();
const V = THREE;
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _sv = new THREE.Vector3();
const _l = new THREE.Vector3(), _n = new THREE.Vector3(), _rv = new THREE.Vector3();

// Seeded RNG so every load lays out the same yard.
let seed = 1337;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const rr = (a, b) => a + rnd() * (b - a);

function panelTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#c3c0b6'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(${rnd() < 0.5 ? '30,32,36' : '255,252,244'},${rnd() * 0.07})`; x.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 3, 1 + rnd() * 3); }
  x.strokeStyle = 'rgba(30,26,22,.55)'; x.lineWidth = 2;
  for (const [a, b, w, h] of [[0, 0, 128, 128], [128, 0, 128, 128], [0, 128, 128, 128], [128, 128, 128, 128]]) { x.strokeRect(a + 1, b + 1, w - 2, h - 2); }
  x.fillStyle = 'rgba(30,26,22,.5)';
  for (const px of [10, 118, 138, 246]) for (const py of [10, 118, 138, 246]) { x.beginPath(); x.arc(px, py, 2.2, 0, 7); x.fill(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace; return t;
}
function hazardTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'); x.fillStyle = '#16181c'; x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#ff5a1f'; for (let i = -2; i < 6; i++) { x.beginPath(); x.moveTo(i * 32, 128); x.lineTo(i * 32 + 16, 128); x.lineTo(i * 32 + 144, 0); x.lineTo(i * 32 + 128, 0); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Box with UVs scaled to world size so panel texture density is uniform.
function box(w, h, d, tile = 9) {
  const g = new THREE.BoxGeometry(w, h, d); const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile); }
  return g;
}

export class World {
  constructor(scene, assets, { coarse = false } = {}) {
    this.scene = scene; this.coarse = coarse;
    // Active collider lists: only sites near the ship (or near moving salvage) are in them.
    // Other modules (impact scan, cockpit scope) read these, so they always see what's around you.
    this.obbs = []; this.statics = []; this.debris = [];
    this.allDebris = [];
    this.tex = panelTexture(); this.haz = hazardTexture();
    this.buildSky();
    this.sites = buildSites(this, assets);
    this.site = Object.fromEntries(this.sites.map((s) => [s.id, s]));
    this.debrisTypes(assets.debris);
    for (const s of this.sites) if (s.debrisSpec) this.buildDebris(s, s.debrisSpec);
    // back-compat for code that predates multiple sites
    const m = this.site.meridian; this.station = m.group; this.chunks = m.nodes; this.ringGroup = m.ringNode; this.lampMats = m.lampMats;
    this.dirty = true; this.refreshActive(new THREE.Vector3(...LAYOUT.spawn.pos), true);
  }

  // which sites are "awake": within their radius + margin of the ship
  refreshActive(p, force = false) {
    let changed = force || this.dirty;
    for (const s of this.sites) {
      const on = s.pos.distanceTo(p) < s.radius + 420;
      if (on !== s.active) { s.active = on; changed = true; if (on) { s.syncSpheres(0); for (const pt of s.parts) pt.sync(0); } }
    }
    if (!changed) return;
    this.dirty = false;
    this.obbs.length = 0; this.statics.length = 0; this.debris.length = 0;
    for (const s of this.sites) {
      if (!s.active) continue;
      s.collectObbs(this.obbs);
      for (const sp of s.spheres) this.statics.push(sp);
      for (const d of s.debris) this.debris.push(d);
    }
  }

  // nearest site to a point (for nav, collapse checks)
  nearest(p) { let b = null, bd = 1e9; for (const s of this.sites) { const d = s.pos.distanceTo(p) - s.radius; if (d < bd) { bd = d; b = s; } } return b; }

  buildSky() {
    const { sky, stars } = buildSky(SUN_DIR, { coarse: this.coarse });
    this.sky = sky; this.stars = stars;
    this.planet = buildPlanet(SUN_DIR, { radius: 5200, coarse: this.coarse });
    placePlanet(this.planet, new THREE.Vector3(300, -5500, -800)); this.scene.add(this.planet);
    // reading-distance dust that wraps around the ship for parallax
    const N = 420; this.dust = { n: N, p: new Float32Array(N * 3), pts: null, lines: null, lp: new Float32Array(N * 6) };
    for (let i = 0; i < N * 3; i++) this.dust.p[i] = (rnd() - 0.5) * 160;
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(this.dust.lp, 3));
    this.dust.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xe8e0cc, transparent: true, opacity: 0.5, depthWrite: false }));
    this.dust.lines.frustumCulled = false; this.scene.add(this.dust.lines);
  }

  updateDust(shipPos, vel) {
    const d = this.dust, S = 160, h = S / 2; const lp = d.lp, p = d.p;
    const k = 0.045;
    for (let i = 0; i < d.n; i++) {
      for (let a = 0; a < 3; a++) { const s = shipPos.getComponent(a); let v = p[i * 3 + a]; v = ((v - s + h) % S + S) % S - h + s; p[i * 3 + a] = v; }
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      lp[i * 6] = x; lp[i * 6 + 1] = y; lp[i * 6 + 2] = z;
      lp[i * 6 + 3] = x - vel.x * k; lp[i * 6 + 4] = y - vel.y * k; lp[i * 6 + 5] = z - vel.z * k;
    }
    d.lines.geometry.attributes.position.needsUpdate = true;
    d.lines.material.opacity = Math.min(0.55, 0.12 + vel.length() * 0.01);
  }

  debrisTypes(model) {
    const nodes = {}; model.traverse((o) => { if (o.name) nodes[o.name] = o; });
    const parts = (n) => { const o = nodes[n]; const out = []; o.traverse((c) => { if (c.isMesh) out.push(c); }); return out; };
    this.dtypes = debrisData.order.map((n) => ({ name: n, radius: debrisData.radius[n], parts: parts(n) }));
  }

  // one InstancedMesh per prop type and part, per site, so a whole far-away field is culled at once
  buildDebris(site, { n, rMin, rMax, flat = 0.6, avoid }) {
    const types = this.dtypes, perType = types.map(() => []);
    for (let i = 0; i < n; i++) perType[Math.floor(rnd() * types.length)].push(i);
    site.inst = types.map((t, ti) => t.parts.map((p) => {
      const im = new THREE.InstancedMesh(p.geometry, p.material, Math.max(1, perType[ti].length));
      im.castShadow = im.receiveShadow = true; im.count = perType[ti].length;
      this.scene.add(im); return im;
    }));
    const slot = new Array(n), tyOf = new Array(n);
    perType.forEach((ids, ti) => ids.forEach((id, k) => { slot[id] = k; tyOf[id] = ti; }));
    const inv = site.group.matrixWorld.clone().invert();
    const clearOf = (wp) => { for (const o of site.parts.flatMap((p) => p.obbs)) { _l.copy(wp).sub(o.c).applyQuaternion(o.qi); if (Math.abs(_l.x) < o.h.x + 6 && Math.abs(_l.y) < o.h.y + 6 && Math.abs(_l.z) < o.h.z + 6) return false; } return true; };
    const place = () => {
      for (let tries = 0; tries < 60; tries++) {
        const dist = rr(rMin, rMax);
        const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        const pos = new THREE.Vector3(s * Math.cos(t), u * flat, s * Math.sin(t)).multiplyScalar(dist).add(site.pos);
        if (!clearOf(pos)) continue;
        if (site.spheres.some((sp) => sp.pos.distanceTo(pos) < sp.rad + 8)) continue;
        if (avoid && avoid(pos)) continue;
        if (pos.distanceTo(_sv.set(...LAYOUT.spawn.pos)) < 18) continue;
        return pos;
      }
      return null;
    };
    for (let i = 0; i < n; i++) {
      const ti = tyOf[i], t = types[ti], scale = rr(0.9, 2.3);
      const radius = Math.max(0.8, t.radius * scale);
      const pos = place(); if (!pos) { _m.makeScale(0, 0, 0); for (const im of site.inst[ti]) im.setMatrixAt(slot[i], _m); continue; }
      const drift = new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).normalize().multiplyScalar(rr(0.3, 2.6));
      const d = { inst: site.inst[ti], slot: slot[i], scale, pos, euler: new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6), vel: drift, radius, mass: Math.pow(radius, 3) * 0.35 + 0.2, spin: new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).multiplyScalar(0.6), site, home: pos.clone() };
      site.debris.push(d); this.allDebris.push(d);
    }
    this.syncDebris(site);
    // bounds for frustum culling: everything stays within the site's reach (debris that drifts too far is pulled home)
    const R = rMax + 120;
    for (const im of site.inst.flat()) { im.boundingSphere = new THREE.Sphere(site.pos.clone(), R); im.frustumCulled = true; }
    site.debrisR = rMax + 60;
  }

  syncDebris(site) {
    for (const d of site.debris) { _q.setFromEuler(d.euler); _m.compose(d.pos, _q, _sv.setScalar(d.scale)); for (const im of d.inst) im.setMatrixAt(d.slot, _m); }
    for (const im of site.inst.flat()) im.instanceMatrix.needsUpdate = true;
  }

  // ---- collisions -------------------------------------------------------------------------
  // Resolve a dynamic sphere body against static geometry. Returns { speed, normal, point } for the hardest hit or null.
  collideStatic(b, e = 0.45) {
    let hit = null;
    for (const o of this.obbs) {
      if (o.br !== undefined && b.pos.distanceToSquared(o.c) > (o.br + b.radius) * (o.br + b.radius)) continue;
      _l.copy(b.pos).sub(o.c).applyQuaternion(o.qi);
      const cx = V.MathUtils.clamp(_l.x, -o.h.x, o.h.x), cy = V.MathUtils.clamp(_l.y, -o.h.y, o.h.y), cz = V.MathUtils.clamp(_l.z, -o.h.z, o.h.z);
      let dx = _l.x - cx, dy = _l.y - cy, dz = _l.z - cz; let d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= b.radius * b.radius) continue;
      let d;
      if (d2 < 1e-8) { // centre inside: push out via smallest penetration axis
        const px = o.h.x - Math.abs(_l.x), py = o.h.y - Math.abs(_l.y), pz = o.h.z - Math.abs(_l.z);
        dx = dy = dz = 0; if (px <= py && px <= pz) dx = Math.sign(_l.x) || 1; else if (py <= pz) dy = Math.sign(_l.y) || 1; else dz = Math.sign(_l.z) || 1;
        d = -Math.min(px, py, pz); _n.set(dx, dy, dz);
      } else { d = Math.sqrt(d2); _n.set(dx / d, dy / d, dz / d); }
      const pen = b.radius - d; _n.applyQuaternion(o.q);
      b.pos.addScaledVector(_n, pen);
      b.contact = { point: b.pos.clone().addScaledVector(_n, -b.radius), normal: _n.clone() };
      const vn = o.v ? _rv.copy(b.vel).sub(o.v).dot(_n) : b.vel.dot(_n);
      if (vn < 0) { b.vel.addScaledVector(_n, -(1 + e) * vn); if (!hit || -vn > hit.speed) hit = { speed: -vn, normal: _n.clone(), point: b.pos.clone().addScaledVector(_n, -b.radius) }; }
    }
    for (const s of this.statics) {
      _n.copy(b.pos).sub(s.pos); const dist = _n.length(), R = b.radius + s.rad;
      if (dist >= R || dist < 1e-6) continue;
      _n.divideScalar(dist); b.pos.addScaledVector(_n, R - dist);
      _rv.copy(b.vel).sub(s.w); const vn = _rv.dot(_n);
      if (vn < 0) { b.vel.addScaledVector(_n, -(1 + e) * vn); if (!hit || -vn > hit.speed) hit = { speed: -vn, normal: _n.clone(), point: b.pos.clone().addScaledVector(_n, -b.radius) }; }
    }
    return hit;
  }

  // sphere-sphere between two dynamic bodies. Returns impact speed or 0.
  collidePair(a, b, e = 0.5) {
    _n.copy(b.pos).sub(a.pos); const dist = _n.length(), R = a.radius + b.radius;
    if (dist >= R || dist < 1e-6) return null;
    _n.divideScalar(dist);
    const ia = 1 / a.mass, ib = 1 / b.mass, tot = ia + ib, pen = R - dist;
    a.pos.addScaledVector(_n, -pen * ia / tot); b.pos.addScaledVector(_n, pen * ib / tot);
    const vn = _rv.copy(b.vel).sub(a.vel).dot(_n);
    if (vn >= 0) return null;
    const j = -(1 + e) * vn / tot; a.vel.addScaledVector(_n, -j * ia); b.vel.addScaledVector(_n, j * ib);
    return { speed: -vn, normal: _n.clone(), point: a.pos.clone().addScaledVector(_n, a.radius) };
  }

  // contacts of a sphere against the active static colliders; calls fn(normal, pen, point, surfaceVel) per contact
  sphereContacts(c, r, fn) {
    for (const o of this.obbs) {
      if (c.distanceToSquared(o.c) > (o.br + r) * (o.br + r)) continue;
      _l.copy(c).sub(o.c).applyQuaternion(o.qi);
      const cx = V.MathUtils.clamp(_l.x, -o.h.x, o.h.x), cy = V.MathUtils.clamp(_l.y, -o.h.y, o.h.y), cz = V.MathUtils.clamp(_l.z, -o.h.z, o.h.z);
      let dx = _l.x - cx, dy = _l.y - cy, dz = _l.z - cz; const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r * r) continue;
      let d;
      if (d2 < 1e-8) {
        const px = o.h.x - Math.abs(_l.x), py = o.h.y - Math.abs(_l.y), pz = o.h.z - Math.abs(_l.z);
        dx = dy = dz = 0; if (px <= py && px <= pz) dx = Math.sign(_l.x) || 1; else if (py <= pz) dy = Math.sign(_l.y) || 1; else dz = Math.sign(_l.z) || 1;
        d = -Math.min(px, py, pz); _n.set(dx, dy, dz);
      } else { d = Math.sqrt(d2); _n.set(dx / d, dy / d, dz / d); }
      _n.applyQuaternion(o.q);
      fn(_n, r - d, _rv.copy(c).addScaledVector(_n, -r), o.v);
    }
    for (const s of this.statics) {
      _n.copy(c).sub(s.pos); const dist = _n.length(), R = r + s.rad;
      if (dist >= R || dist < 1e-6) continue;
      _n.divideScalar(dist); fn(_n, R - dist, _rv.copy(c).addScaledVector(_n, -r), s.w);
    }
  }

  update(dt, ship, onShipHit) {
    for (const s of this.sites) {
      if (s.active || s.state === 'unstable') s.step(dt);
      else if (s.spin && s.ringNode) s.ringNode.rotation.z += s.spin * dt;   // keep turning when seen from afar
    }
    const ds = this.debris;
    for (const d of ds) {
      d.pos.addScaledVector(d.vel, dt);
      d.euler.x += d.spin.x * dt; d.euler.y += d.spin.y * dt; d.euler.z += d.spin.z * dt;
      // a loose leash: debris that wanders out of its field turns back, so fields never empty out
      if (d.site.state !== 'collapsed') { _sv.copy(d.pos).sub(d.site.pos); const L = _sv.length(); if (L > d.site.debrisR) d.vel.addScaledVector(_sv, -0.3 * dt / L); }
      const h = this.collideStatic(d, 0.5);
      if (h && h.speed > 1) d.spin.add(new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).multiplyScalar(Math.min(2, h.speed * 0.2)));
    }
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) { const a = ds[i], b = ds[j]; if (Math.abs(a.pos.x - b.pos.x) < a.radius + b.radius) this.collidePair(a, b); }
    // ship
    ship.contact = null;
    const h1 = this.collideStatic(ship, 0.35); if (h1 && h1.speed > 0.5) onShipHit(h1, 1);
    for (const d of ds) { const h = this.collidePair(ship, d, 0.45); if (h) { d.spin.add(new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).multiplyScalar(Math.min(3, h.speed * 0.25))); if (h.speed > 0.5) onShipHit(h, d.mass); } }
  }

  updateVisual(time, camPos) {
    for (const s of this.sites) if (s.active) this.syncDebris(s);
    this.planet.userData.surf.material.uniforms.uTime.value = time;
    this.sky.position.copy(camPos);
    for (const s of this.sites) {
      if (!s.lampMats.length) continue;
      const shake = s.state === 'unstable' ? 1 : 0;
      s.lampMats.forEach((m, i) => {
        const sn = Math.sin(time * (1.7 + i * 2.3) + i * 4), s2 = Math.sin(time * (6.1 + i * 3.1) + i);
        let v = i === 1 ? (sn > 0.45 && s2 > -0.3 ? 1 : 0.06) : 0.65 + 0.35 * s2;   // group b is a dying circuit
        if (shake) v = Math.sin(time * 31 + i * 7) > 0.2 ? 1.4 : 0.03;              // power surging before the break
        if (s.state === 'collapsed') v = 0.02;
        m.color.setScalar(v);
      });
    }
    const dp = this.site.depot;
    if (dp && dp.beacon) dp.beacon.color.setScalar((time % 1.4) < 0.12 ? 2.2 : 0.05);
  }
}
