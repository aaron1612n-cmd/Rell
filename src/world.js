import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(0.62, 0.5, 0.6).normalize();
const V = THREE;
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
  constructor(scene) {
    this.scene = scene;
    this.obbs = [];        // static oriented boxes
    this.statics = [];     // moving static-ish spheres (rotating ring)
    this.debris = [];
    this.flicker = [];
    this.ringGroup = new THREE.Group(); this.ringSpheres = [];
    this.tex = panelTexture(); this.haz = hazardTexture();
    this.buildSky(); this.buildStation(); this.buildDebris();
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

  buildStation() {
    const st = this.station = new THREE.Group(); this.scene.add(st);
    const B = (...a) => this.addBox(st, ...a);
    // spine + hub
    B(10, 10, 150, 0, 0, 0, 0xd8d0bc);
    B(24, 24, 28, 0, 0, 0, 0xffffff);
    B(17, 17, 24, 0, 0, 84, 0xe0d8c4);                   // nose module
    B(12, 12, 10, 0, 0, 102, 0x8a8170);                 // docking collar
    B(16, 16, 28, 0, 0, -86, 0xa59c88);                 // aft engine block
    B(10, 10, 10, 0, 0, -106, 0x4a433b);
    // cargo pods
    for (const [x, z] of [[14, 32], [-14, 32], [14, -38], [-14, -38]]) B(11, 11, 20, x, 0, z, 0xbfb6a0);
    for (const [y, z] of [[15, 44], [-15, -52]]) B(8, 8, 18, 0, y, z, 0x8a8170);
    // solar: boom along X, panels; one torn off at an angle
    B(120, 1.6, 1.6, 0, 0, -26, 0x55504a);
    B(50, 0.7, 22, 42, 0, -26, 0x2c3b4d, [0, 0, 0.03]);
    B(50, 0.7, 22, -42, 0, -26, 0x2c3b4d, [0, 0, -0.55]);
    // antennae
    B(0.8, 0.8, 40, 6, 12, 60, 0x55504a, [0, 0.18, 0]);
    B(0.8, 30, 0.8, -4, 18, -66, 0x55504a, [0.2, 0, 0.1]);
    // hazard bands (visual)
    for (const z of [74, 94, -78, -92]) this.hazard(st, 17.4, 17.4, 2.4, 0, 0, z);
    this.hazard(st, 24.4, 24.4, 2.4, 0, 0, -16);
    // dim windows along the nose module, flat on +Y face and sides
    const wy = this.windowsGroup = new THREE.Group(); wy.position.set(0, 8.55, 84); wy.rotation.x = -Math.PI / 2; st.add(wy);
    this.windows(wy, 0, 0, 0, 5, 'x', 1.4, 2.6);
    const wy2 = new THREE.Group(); wy2.position.set(0, 8.55, 84 - 6); wy2.rotation.x = -Math.PI / 2; st.add(wy2); this.windows(wy2, 0, 0, 0, 5, 'x', 1.4, 2.6);
    const wx = new THREE.Group(); wx.position.set(8.55, 0, 84); wx.rotation.y = Math.PI / 2; st.add(wx); this.windows(wx, 0, 0, 0, 6, 'x', 1.4, 3);
    // rotating ring + spokes
    const rg = this.ringGroup; st.add(rg);
    const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(50, 3.6, 8, 40), this.mat(0xc9c0aa));
    ringMesh.castShadow = ringMesh.receiveShadow = true; rg.add(ringMesh);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + 0.3; const L = 40;
      const sp = new THREE.Mesh(box(3, L, 3), this.mat(0xa59c88));
      sp.position.set(Math.cos(a) * (12 + L / 2), Math.sin(a) * (12 + L / 2), 0); sp.rotation.z = a - Math.PI / 2; sp.castShadow = sp.receiveShadow = true; rg.add(sp);
      for (let i = 0; i < 14; i++) { const r = 12 + i * 3; this.ringSpheres.push({ a, r, rad: 2.3, pos: new THREE.Vector3(), w: new THREE.Vector3() }); }
    }
    for (let i = 0; i < 52; i++) { const a = i / 52 * Math.PI * 2; this.ringSpheres.push({ a, r: 50, rad: 3.8, pos: new THREE.Vector3(), w: new THREE.Vector3() }); }
    this.ringAngle = 0; this.updateRing(0);
    this.statics = this.ringSpheres;
  }

  updateRing(dt) {
    this.ringAngle += 0.045 * dt; this.ringGroup.rotation.z = this.ringAngle;
    for (const s of this.ringSpheres) {
      const a = s.a + this.ringAngle; s.pos.set(Math.cos(a) * s.r, Math.sin(a) * s.r, 0);
      s.w.set(-Math.sin(a) * s.r * 0.045, Math.cos(a) * s.r * 0.045, 0); // surface velocity
    }
  }

  buildSky() {
    // stars
    const n = 2600, p = new Float32Array(n * 3), c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      p.set([s * Math.cos(t) * 8000, u * 8000, s * Math.sin(t) * 8000], i * 3);
      const b = 0.35 + rnd() * 0.65, w = rnd(); c.set([b * (0.85 + w * 0.15), b * 0.92, b * (1 - w * 0.2)], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.8, sizeAttenuation: false, vertexColors: true, depthWrite: false, fog: false }));
    this.stars.frustumCulled = false;
    this.sky = new THREE.Group(); this.sky.add(this.stars);
    // sun disc
    const sun = new THREE.Mesh(new THREE.SphereGeometry(110, 16, 16), new THREE.MeshBasicMaterial({ color: 0xfff1d2, fog: false }));
    sun.position.copy(SUN_DIR).multiplyScalar(7000); this.sky.add(sun);
    // planet below: slate with soft terminator and a thin amber rim
    const planet = new THREE.Mesh(new THREE.SphereGeometry(5200, 64, 48), new THREE.ShaderMaterial({
      uniforms: { uSun: { value: SUN_DIR.clone() }, uTime: { value: 0 } },
      vertexShader: `varying vec3 vN; varying vec3 vW; varying vec3 vO; void main(){ vN=normalize(mat3(modelMatrix)*normal); vO=normal; vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `varying vec3 vN; varying vec3 vW; varying vec3 vO; uniform vec3 uSun; uniform float uTime;
        float h(vec3 p){ return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
        float n(vec3 p){ vec3 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
          return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
        void main(){
          vec3 p=vO*3.2; float f=n(p)*.55+n(p*2.3)*.3+n(p*5.1)*.15;
          vec3 land=mix(vec3(.05,.09,.11),vec3(.14,.17,.17),smoothstep(.45,.62,f));
          float cl=smoothstep(.55,.8,n(p*1.7+vec3(uTime*.02,0,0))*.7+n(p*4.)*.3);
          vec3 col=mix(land,vec3(.42,.48,.5),cl*.6);
          float l=clamp(dot(normalize(vN),uSun)*.9+.15,0.,1.);
          vec3 v=normalize(cameraPosition-vW); float fr=pow(1.-clamp(dot(normalize(vN),v),0.,1.),3.);
          vec3 rim=vec3(1.,.55,.28)*fr*(.25+l*1.2);
          gl_FragColor=vec4(col*l*.7+rim*.4,1.); }`,
    }));
    planet.position.set(300, -5500, -800); this.planet = planet; this.scene.add(planet);
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

  buildDebris() {
    const geos = [
      new THREE.IcosahedronGeometry(1, 0), new THREE.DodecahedronGeometry(1, 0), box(1.6, 0.25, 1.1, 4), box(0.35, 0.35, 3.2, 4),
      new THREE.CylinderGeometry(0.5, 0.5, 1.6, 6), box(1.2, 1.2, 1.2, 4),
    ];
    const tints = [0x9a917d, 0x6e665a, 0xbfb6a0, 0x4a433b];
    const mats = tints.map((t) => this.mat(t));
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
    for (let i = 0; i < 90; i++) {
      const gi = Math.floor(rnd() * geos.length), scale = rr(0.9, 3.2) * (gi === 0 || gi === 1 ? 1.4 : 1);
      const mesh = new THREE.Mesh(geos[gi], mats[Math.floor(rnd() * mats.length)]);
      mesh.scale.setScalar(scale); mesh.castShadow = mesh.receiveShadow = true;
      const radius = Math.max(0.8, scale * (gi === 3 ? 1.3 : gi === 2 ? 0.95 : 0.95));
      const pos = place(i);
      mesh.position.copy(pos); mesh.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6); this.scene.add(mesh);
      const drift = new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).normalize().multiplyScalar(rr(0.4, 3.4));
      this.debris.push({ mesh, pos: mesh.position, vel: drift, radius, mass: Math.pow(radius, 3) * 0.35 + 0.2, spin: new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).multiplyScalar(0.6) });
    }
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
      d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt; d.mesh.rotation.z += d.spin.z * dt;
      const h = this.collideStatic(d, 0.5);
      if (h && h.speed > 1) d.spin.add(new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).multiplyScalar(Math.min(2, h.speed * 0.2)));
    }
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) this.collidePair(ds[i], ds[j]);
    // ship
    const h1 = this.collideStatic(ship, 0.35); if (h1 && h1.speed > 0.5) onShipHit(h1, 1);
    for (const d of ds) { const h = this.collidePair(ship, d, 0.45); if (h) { d.spin.add(new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).multiplyScalar(Math.min(3, h.speed * 0.25))); if (h.speed > 0.5) onShipHit(h, d.mass); } }
  }

  updateVisual(time, camPos) {
    this.planet.material.uniforms.uTime.value = time;
    this.sky.position.copy(camPos);
    for (const f of this.flicker) {
      const s = Math.sin(time * f.sp + f.ph), s2 = Math.sin(time * f.sp * 3.7 + f.ph * 2);
      const v = f.broken ? (s > 0.5 && s2 > -0.2 ? 1 : 0.05) : 0.6 + 0.4 * s2;
      f.mat.color.copy(f.base).multiplyScalar(v);
    }
  }
}
