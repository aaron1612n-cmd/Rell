import * as THREE from 'three';
import { mats } from './assets.js';
import { buildSky, buildPlanet, placePlanet } from './sky.js';
import stationData from './assets/station.json';
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
    this.obbs = [];        // static oriented boxes
    this.statics = [];     // moving static-ish spheres (rotating ring)
    this.debris = [];
    this.flicker = [];
    this.ringGroup = new THREE.Group(); this.ringSpheres = [];
    this.tex = panelTexture(); this.haz = hazardTexture();
    this.buildSky(); this.buildStation(assets.station); this.buildDebris(assets.debris);
  }

  mat(tint) { return new THREE.MeshStandardMaterial({ map: this.tex, color: tint, roughness: 0.85, metalness: 0.12 }); }

  addBox(parent, w, h, d, x, y, z, tint = 0xffffff, rot = [0, 0, 0], collide = true) {
    const m = new THREE.Mesh(box(w, h, d), this.mat(tint));
    m.position.set(x, y, z); m.rotation.set(...rot); m.castShadow = m.receiveShadow = true; parent.add(m);
    if (collide) {
      m.updateMatrixWorld(true);
      const q = new THREE.Quaternion().setFromEuler(m.rotation);
      this.obbs.push({ c: new THREE.Vector3(x, y, z), qi: q.clone().invert(), q, h: new THREE.Vector3(w / 2, h / 2, d / 2) });
    }
    return m;
  }

  hazard(parent, w, h, d, x, y, z) {
    const t = this.haz.clone(); t.needsUpdate = true; t.repeat.set(Math.max(w, d) / 8, 1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }));
    m.position.set(x, y, z); m.receiveShadow = true; parent.add(m); return m;
  }

  windows(parent, x, y, z, n, along, size = 1.1, gap = 3) {
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffb066 });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.6), mat);
      const o = (i - (n - 1) / 2) * gap;
      m.position.set(x + (along === 'x' ? o : 0), y, z + (along === 'z' ? o : 0));
      parent.add(m);
      const lit = rnd() < 0.22;
      mat.color.set(lit ? 0xffb066 : 0x0d0f12);
      if (lit) this.flicker.push({ mat, base: new THREE.Color(0xffb066), ph: rnd() * 10, sp: rr(1, 6), broken: rnd() < 0.5 });
      m.userData.facing = true; m.rotation.y = 0;
      this.windowsMeshes = (this.windowsMeshes || []).concat(m);
    }
  }

  buildStation(model) {
    const st = this.station = new THREE.Group(); this.scene.add(st);
    const nodes = {}; model.traverse((o) => { if (o.name) nodes[o.name] = o; });
    this.chunks = nodes;
    // flickering window lamps: three groups with their own material so they can pulse out of step
    this.lampMats = ['lamps_a', 'lamps_b', 'lamps_c'].map((n) => { const m = mats.lamp.clone(); if (nodes[n]) nodes[n].material = m; return m; });
    st.add(model);
    this.ringGroup = nodes.ring;
    // colliders authored with the chunks
    for (const [name, c] of Object.entries(stationData.chunks)) for (const o of c.obbs) {
      const q = new THREE.Quaternion(...o.q);
      this.obbs.push({ c: new THREE.Vector3(...o.c), qi: q.clone().invert(), q, h: new THREE.Vector3(...o.h), chunk: name });
    }
    // rotating ring + spoke colliders (spheres, positions follow the ring angle)
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + 0.3;
      for (let i = 0; i < 14; i++) { const r = 12 + i * 3; this.ringSpheres.push({ a, r, rad: 2.3, pos: new THREE.Vector3(), w: new THREE.Vector3() }); }
    }
    for (let i = 0; i < 52; i++) { const a = i / 52 * Math.PI * 2; this.ringSpheres.push({ a, r: 50, rad: 4.2, pos: new THREE.Vector3(), w: new THREE.Vector3() }); }
    this.ringAngle = 0; this.updateRing(0);
    this.statics = this.ringSpheres;
  }

  updateRing(dt) {
    this.ringAngle += 0.045 * dt; if (this.ringGroup) this.ringGroup.rotation.z = this.ringAngle;
    for (const s of this.ringSpheres) {
      const a = s.a + this.ringAngle; s.pos.set(Math.cos(a) * s.r, Math.sin(a) * s.r, 0);
      s.w.set(-Math.sin(a) * s.r * 0.045, Math.cos(a) * s.r * 0.045, 0); // surface velocity
    }
  }

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

  buildDebris(model) {
    // one InstancedMesh per prop type (shared geometry + materials), updated from the body list each frame
    const nodes = {}; model.traverse((o) => { if (o.name) nodes[o.name] = o; });
    const parts = (n) => { const o = nodes[n]; const out = []; o.traverse((c) => { if (c.isMesh) out.push(c); }); return out; };
    const types = debrisData.order.map((n) => ({ name: n, radius: debrisData.radius[n], parts: parts(n) }));
    const COUNT = 90, perType = types.map(() => []);
    for (let i = 0; i < COUNT; i++) perType[Math.floor(rnd() * types.length)].push(i);
    this.debrisInst = types.map((t, ti) => t.parts.map((p) => {
      const im = new THREE.InstancedMesh(p.geometry, p.material, Math.max(1, perType[ti].length));
      im.castShadow = im.receiveShadow = true; im.frustumCulled = false; im.count = perType[ti].length;
      this.scene.add(im); return im;
    }));
    this.allInst = this.debrisInst.flat();
    const slot = new Array(COUNT), tyOf = new Array(COUNT);
    perType.forEach((ids, ti) => ids.forEach((id, k) => { slot[id] = k; tyOf[id] = ti; }));
    const place = (i) => {
      for (let tries = 0; tries < 40; tries++) {
        const near = i < 28;
        const dist = near ? rr(30, 110) : rr(90, 330);
        const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        const pos = new THREE.Vector3(s * Math.cos(t), u * 0.6, s * Math.sin(t)).multiplyScalar(dist).add(new THREE.Vector3(0, 0, near ? 40 : 0));
        if (Math.abs(pos.x) < 70 && Math.abs(pos.y) < 70 && Math.abs(pos.z) < 125) continue; // keep clear of station
        if (pos.distanceTo(new THREE.Vector3(28, 14, 140)) < 14) continue;                       // keep clear of spawn
        return pos;
      }
      return new THREE.Vector3(200, 0, 200);
    };
    for (let i = 0; i < COUNT; i++) {
      const ti = tyOf[i], t = types[ti], scale = rr(0.9, 2.3);
      const radius = Math.max(0.8, t.radius * scale);
      const pos = place(i);
      const drift = new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).normalize().multiplyScalar(rr(0.4, 3.4));
      this.debris.push({ inst: this.debrisInst[ti], slot: slot[i], scale, pos, euler: new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6), vel: drift, radius, mass: Math.pow(radius, 3) * 0.35 + 0.2, spin: new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).multiplyScalar(0.6) });
    }
    this.syncDebris();
  }

  syncDebris() {
    for (const d of this.debris) { _q.setFromEuler(d.euler); _m.compose(d.pos, _q, _sv.setScalar(d.scale)); for (const im of d.inst) im.setMatrixAt(d.slot, _m); }
    for (const im of this.allInst) im.instanceMatrix.needsUpdate = true;
  }

  // ---- collisions -------------------------------------------------------------------------
  // Resolve a dynamic sphere body against static geometry. Returns { speed, normal, point } for the hardest hit or null.
  collideStatic(b, e = 0.45) {
    let hit = null;
    for (const o of this.obbs) {
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
      const vn = b.vel.dot(_n);
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

  update(dt, ship, onShipHit) {
    this.updateRing(dt);
    const ds = this.debris;
    for (const d of ds) {
      d.pos.addScaledVector(d.vel, dt);
      d.euler.x += d.spin.x * dt; d.euler.y += d.spin.y * dt; d.euler.z += d.spin.z * dt;
      const h = this.collideStatic(d, 0.5);
      if (h && h.speed > 1) d.spin.add(new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).multiplyScalar(Math.min(2, h.speed * 0.2)));
    }
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) this.collidePair(ds[i], ds[j]);
    // ship
    ship.contact = null;
    const h1 = this.collideStatic(ship, 0.35); if (h1 && h1.speed > 0.5) onShipHit(h1, 1);
    for (const d of ds) { const h = this.collidePair(ship, d, 0.45); if (h) { d.spin.add(new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).multiplyScalar(Math.min(3, h.speed * 0.25))); if (h.speed > 0.5) onShipHit(h, d.mass); } }
  }

  updateVisual(time, camPos) {
    this.syncDebris();
    this.planet.userData.surf.material.uniforms.uTime.value = time;
    this.sky.position.copy(camPos);
    this.lampMats.forEach((m, i) => {
      const s = Math.sin(time * (1.7 + i * 2.3) + i * 4), s2 = Math.sin(time * (6.1 + i * 3.1) + i);
      const v = i === 1 ? (s > 0.45 && s2 > -0.3 ? 1 : 0.06) : 0.65 + 0.35 * s2;   // group b is a dying circuit
      m.color.setScalar(v);
    });
  }
}
