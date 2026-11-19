import * as THREE from 'three';
import { K } from './gpufx.js';
import { JOB_ICONS } from './career.js';

// Space weather. Every few minutes of flight something happens, announced a few seconds early by an
// icon on the screen edge that points at where it comes from:
//   meteor shower: a swarm of rocks streaks through the lane. Dodge, or take hull damage.
//   solar flare:  the sun surges, flight assist glitches out and the markers jam until it passes.
// Surviving one counts toward the "storm" job and pays a small bonus when nothing touched you.
const R = Math.random;
const svg = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const MAX = 40;

function rockGeo() {
  const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const n = Math.sin(v.x * 3.1 + 1.3) * Math.cos(v.y * 2.7) + Math.sin(v.z * 4.3 + v.x * 1.7) * 0.6;
    v.multiplyScalar(0.72 + 0.2 * n + 0.08 * Math.sin(v.y * 9 + v.z * 7));
    v.x *= 1.25; v.z *= 0.85;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals(); return g;
}

export class Events {
  constructor({ scene, ship, fx, rig, hud, cockpit, nav, sun, onHit, onStorm, coarse, reduced }) {
    Object.assign(this, { scene, ship, fx, rig, hud, cockpit, nav, sun, onHit, onStorm, coarse, reduced });
    this.state = 'idle'; this.kind = null; this.t = 0; this.next = 80; this.clean = true; this.enabled = true;
    this.sunBase = sun.intensity;
    this.rocks = []; this.max = coarse ? 22 : MAX; this.spawnAcc = 0;
    this.mesh = new THREE.InstancedMesh(rockGeo(), new THREE.MeshStandardMaterial({ color: 0x5b5148, roughness: 0.92, metalness: 0.15, flatShading: true }), MAX);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = false; scene.add(this.mesh);
    // warning glyph pinned toward the source
    this.warn = document.createElement('div'); this.warn.id = 'evw'; document.getElementById('hud').appendChild(this.warn);
    this.flare = document.createElement('div'); this.flare.id = 'flare'; document.body.appendChild(this.flare);
    this.dir = new THREE.Vector3(0, 0, -1);
  }

  start(kind) {
    if (this.state !== 'idle') return;
    this.kind = kind; this.state = 'warn'; this.t = 0; this.clean = true; this.hits = 0;
    // incoming lane: mostly across the ship's path, from a random side
    this.dir.set(R() - 0.5, (R() - 0.5) * 0.5, R() - 0.5).normalize();
    this.warn.innerHTML = svg(JOB_ICONS[kind === 'meteor' ? 'meteor' : 'flare']); this.warn.className = kind;
    this.warn.style.display = 'block'; this.onWarn?.(kind);
  }

  update(dt, ctx, camera, w, h) {
    const { ship } = this;
    if (this.state === 'idle') {
      if (this.enabled && !ctx.busy) { this.next -= dt; if (this.next <= 0) this.start(R() < 0.6 ? 'meteor' : 'flare'); }
    } else {
      this.t += dt;
      if (this.state === 'warn' && this.t > 6) { this.state = 'run'; this.t = 0; this.rig.kick(0.15); }
      if (this.state === 'run') this.run(dt, ctx);
      this.placeWarn(camera, w, h);
    }
    this.fxFlare(dt);
    this.moveRocks(dt, ship);
  }

  run(dt, ctx) {
    if (this.kind === 'meteor') {
      const dur = 15;
      this.spawnAcc += dt * 2.2;
      while (this.spawnAcc > 1 && this.t < dur) { this.spawnAcc--; this.spawn(); }
      if (this.t > dur + 7) this.finish();
    } else {
      this.flareT = this.t;
      if (this.t > 13) this.finish();
    }
  }

  spawn() {
    if (this.rocks.length >= this.max) return;
    const ship = this.ship, D = _d.copy(this.dir);
    // two perpendiculars
    _a.set(0, 1, 0); if (Math.abs(D.y) > 0.9) _a.set(1, 0, 0);
    _a.cross(D).normalize(); _b.copy(D).cross(_a).normalize();
    const aimed = R() < 0.22, off = aimed ? 6 : 70 + R() * 90, ang = R() * Math.PI * 2, r = Math.sqrt(R()) * off;
    const target = _p.copy(ship.pos).addScaledVector(_a, Math.cos(ang) * r).addScaledVector(_b, Math.sin(ang) * r).addScaledVector(ship.vel, 4.5);
    const speed = 115 + R() * 70, size = 1.2 + R() * R() * 4.5;
    const pos = target.clone().addScaledVector(D, -speed * 4.5);
    this.rocks.push({ pos, vel: D.clone().multiplyScalar(speed).addScaledVector(_a, rsr() * 4), r: size, spin: new THREE.Vector3(rsr(), rsr(), rsr()).multiplyScalar(1.4), rot: new THREE.Euler(R() * 6, R() * 6, R() * 6), age: 0, passed: false });
  }

  moveRocks(dt, ship) {
    const L = this.rocks, mesh = this.mesh;
    for (let i = L.length - 1; i >= 0; i--) {
      const k = L[i]; k.age += dt;
      k.pos.addScaledVector(k.vel, dt); k.rot.x += k.spin.x * dt; k.rot.y += k.spin.y * dt;
      _a.copy(k.pos).sub(ship.pos); const d = _a.length();
      if (d < k.r + 2.2) { this.hit(k, _a); L.splice(i, 1); continue; }
      if (!k.passed && _a.dot(k.vel) > 0) { k.passed = true; if (d < k.r + 30) { this.rig.kick(Math.min(0.3, 6 / d)); this.hud.pulse(0.03); } }
      // trailing embers: sparse, pooled by the GPU particle system
      if (d < 700 && R() < (this.coarse ? 0.35 : 0.8)) { _b.copy(k.vel).multiplyScalar(-0.08).add(_s.set(rsr(), rsr(), rsr()).multiplyScalar(4)); this.fx.emit(k.pos, _b, this.fxT(), 0.5 + R() * 0.5, k.r * 0.12, 0.02, R() < 0.5 ? K.EMBER : K.SPARK, 0.6, 0.05); }
      if (d > 1100 || k.age > 14) L.splice(i, 1);
    }
    mesh.count = L.length;
    for (let i = 0; i < L.length; i++) {
      const k = L[i]; _q.setFromEuler(k.rot); _m.compose(k.pos, _q, _s.setScalar(k.r)); mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  fxT() { return this.getFxT ? this.getFxT() : performance.now() / 1000; }

  hit(k, rel) {
    this.clean = false; this.hits++;
    _b.copy(rel).normalize().negate();                         // normal pointing from the ship's surface out at the rock
    this.onHit({ point: _p.copy(this.ship.pos).addScaledVector(rel.normalize(), 1.6), normal: rel.clone().normalize(), speed: 10 + k.r * 2.5 }, k.r * 1.2);
    const t = this.fxT();
    this.fx.emit(_p, _s.set(0, 0, 0), t, 0.18, 0.5, 2.2 + k.r * 0.4, K.FLASH, 0);
    for (let i = 0; i < 14; i++) this.fx.emit(_p, _b.set(rsr(), rsr(), rsr()).normalize().multiplyScalar(6 + R() * 16).add(this.ship.vel), t, 0.4 + R() * 0.6, 0.04, 0.02, K.SPARK, 0.6, 0.05);
  }

  placeWarn(camera, w, h) {
    // pin to the edge of the screen toward where the rocks come from (flare: above the sun-facing edge)
    _p.copy(this.ship.pos).addScaledVector(this.dir, -200).project(camera);
    const behind = _p.z > 1; let x = _p.x, y = _p.y; if (behind) { x = -x; y = -y; }
    const m = Math.max(Math.abs(x), Math.abs(y), 1e-3), k = Math.min(1, 0.78 / m);
    if (m > 0.78 || behind) { x *= k; y *= k; }
    const px = (x * 0.5 + 0.5) * w, py = (-y * 0.5 + 0.5) * h;
    this.warn.style.transform = `translate(${px.toFixed(0)}px,${py.toFixed(0)}px)`;
    this.warn.classList.toggle('run', this.state === 'run');
  }

  fxFlare(dt) {
    const on = this.kind === 'flare' && this.state === 'run';
    const t = this.flareT || 0, k = on ? Math.min(1, t / 1.2) * Math.min(1, (13 - t) / 2.5) : 0;
    this.k = THREE.MathUtils.damp(this.k || 0, Math.max(0, k), 6, dt);
    const flick = this.reduced ? 1 : 0.85 + 0.15 * Math.sin(performance.now() * 0.03);
    this.flare.style.opacity = (this.k * 0.8 * flick).toFixed(3);
    this.sun.intensity = this.sunBase * (1 + 1.1 * this.k);
    if (on) { if (!this.jamOn) { this.jamOn = true; this.prevAssist = this.ship.assist; } this.ship.assist = false; this.nav.root.classList.add('jam'); this.nav.jam = true; if (!this.reduced && (t * 7 | 0) % 5 === 0) this.rig.kick(0.01); }
    else if (this.nav.jam) { this.nav.root.classList.remove('jam'); this.nav.jam = false; this.jamOn = false; this.ship.assist = this.prevAssist; }
  }

  finish() {
    const clean = this.clean; this.state = 'idle'; this.warn.style.display = 'none'; this.next = 140 + R() * 110;
    this.onStorm(clean, this.kind);
  }
}
const rsr = () => R() - 0.5;
