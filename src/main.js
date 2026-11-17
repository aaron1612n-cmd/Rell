import * as THREE from 'three';
import { Ship } from './ship.js';
import { buildShip } from './shipMesh.js';
import { loadModel, urls, mats } from './assets.js';
import { World, SUN_DIR } from './world.js';
import { Input } from './input.js';
import { CamRig } from './camera.js';
import { Hud } from './hud.js';
import { Help } from './help.js';
import { Particles } from './particles.js';
import { setupLights, Look } from './look.js';
import { NOZZLES, solveRcs } from './rcs.js';

const canvas = document.getElementById('view');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(66, 1, 0.1, 20000);

// light rig, reflection environment and tone mapping live in look.js
const { sun } = setupLights(scene, renderer, SUN_DIR, coarse);

const [shipModel, stationModel, debrisModel] = await Promise.all([loadModel(urls.ship, mats.shipHull), loadModel(urls.station), loadModel(urls.debris)]);
const world = new World(scene, { station: stationModel, debris: debrisModel }, { coarse });
scene.add(world.sky);

const ship = new Ship();
ship.pos.set(30, 14, 142); ship.quat.setFromEuler(new THREE.Euler(-0.06, 0.28, 0));
const shipMesh = buildShip(shipModel, coarse); scene.add(shipMesh);
const parts = new Particles(900); scene.add(parts.points);

const input = new Input(canvas);
input.onToggleAssist = () => { ship.assist = !ship.assist; };
const rig = new CamRig(camera, reduced);
const hud = new Hud();
new Help(input);

// post: bloom, lens ghosts, grade, vignette, grain (lighter chain on phones)
const look = new Look(renderer, scene, camera, coarse);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  // keep the ship readable on tall phone screens
  camera.fov = rig.baseFov = w / h < 0.8 ? 80 : 66; camera.updateProjectionMatrix();
  look.setSize(w, h, renderer.getPixelRatio());
  world.stars.material.uniforms.uPR.value = renderer.getPixelRatio();
}
addEventListener('resize', resize); resize();

// ---- effects ----------------------------------------------------------------------------
const Q = coarse ? 0.5 : 1;   // quality tier: half the particle rate on phones
const C = { blue: new THREE.Color(0.55, 0.75, 1), core: new THREE.Color(1, 0.95, 0.85), chip: new THREE.Color(0.8, 0.72, 0.6), hot: new THREE.Color(1, 0.55, 0.22), warm: new THREE.Color(1, 0.8, 0.5), white: new THREE.Color(0.8, 0.85, 1), cool: new THREE.Color(0.75, 0.9, 1), spark: new THREE.Color(1, 0.7, 0.35) };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
let emitAcc = 0, fxT = 0, boostSm = 0;

function engineFx(dt) {
  const { glows, light } = shipMesh.userData, f = ship.fx;
  fxT += dt;
  const flick = 0.92 + 0.08 * Math.sin(fxT * 47) * Math.sin(fxT * 13.7 + 1) + 0.04 * (Math.random() - 0.5);
  const b = f.boost ? 1 : 0; boostSm = THREE.MathUtils.damp(boostSm, b, 8, dt);
  const len = f.main * (3.4 + 3.2 * boostSm) * flick, wid = 0.62 + 0.14 * f.main + 0.1 * boostSm;
  for (const g of glows) { g.tick(fxT); g.set(f.main * 0.85, Math.max(0.05, len), wid, boostSm, 1 + 0.15 * boostSm); }
  light.intensity = f.main * (f.boost ? 40 : 18) * flick;
  emitAcc += dt * 55 * Q * f.main;
  while (emitAcc > 1) {
    emitAcc--;
    for (const x of [-0.55, 0.55]) {
      _a.set(x + (Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25, 2.3).applyQuaternion(ship.quat).add(ship.pos);
      _b.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 11 + Math.random() * 6 * (f.boost ? 2 : 1)).applyQuaternion(ship.quat).add(ship.vel);
      const r = Math.random();
      parts.emit(_a, _b, 0.35 + Math.random() * 0.35, 0.3, f.boost && r < 0.3 ? C.blue : r < 0.35 ? C.warm : C.hot);
      if (r < 0.25) { _b.multiplyScalar(0.55); parts.emit(_a, _b, 0.12, 0.25, C.core); }
    }
  }
}

// RCS: every nozzle fires in proportion to the acceleration actually applied this frame,
// so assist and brake visibly burn opposite to the drift or spin they cancel.
const rcsLvl = new Float32Array(NOZZLES.length), rcsSm = new Float32Array(NOZZLES.length), rcsAcc = new Float32Array(NOZZLES.length);
const _accel = new THREE.Vector3(), _alpha = new THREE.Vector3();
function rcsFx(dt) {
  ship.takeFx(_accel, _alpha);
  // a main-engine burn also shows when assist or brake kills backward drift
  const f = ship.fx, cover = Math.max(0, -_accel.z) / 18;
  if (cover > f.main) f.main = Math.min(1, cover);
  solveRcs(_accel, _alpha, rcsLvl);
  const nub = shipMesh.userData.nubs;
  for (let i = 0; i < NOZZLES.length; i++) {
    const k = rcsLvl[i] > rcsSm[i] ? 30 : 14;                 // fast attack, short tail
    rcsSm[i] = THREE.MathUtils.damp(rcsSm[i], rcsLvl[i], k, dt);
    const v = rcsSm[i]; nub[i].tick(fxT); nub[i].set(v > 0.06 ? v * 0.8 : 0, 0.22 + v * 0.38, 0.05 + v * 0.03, 0, 0.8);
    if (v < 0.06) continue;
    const n = NOZZLES[i];
    // short bright core (this frame only) plus a trail of pooled puffs
    _a.copy(n.pos).addScaledVector(n.dir, 0.12).applyQuaternion(ship.quat).add(ship.pos);
    _b.copy(n.dir).multiplyScalar(4 + v * 3).applyQuaternion(ship.quat).add(ship.vel);
    parts.emit(_a, _b, 0.05, 0.3 + v * 0.25, C.cool);
    rcsAcc[i] += dt * 14 * Q * v;
    while (rcsAcc[i] > 1) {
      rcsAcc[i]--;
      _b.copy(n.dir).multiplyScalar(4 + Math.random() * 3 * v).add(_c.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1)).applyQuaternion(ship.quat).add(ship.vel);
      parts.emit(_a, _b, 0.18 + Math.random() * 0.12, 0.2, C.white);
    }
  }
}

function sparks(hit, n) {
  n = Math.ceil(n * Q);
  // slow dull chips of hull alongside the bright sparks
  for (let i = 0; i < n * 0.4; i++) {
    _b.copy(hit.normal).multiplyScalar(2 + Math.random() * 4).add(_c.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(5));
    parts.emit(hit.point, _b, 0.9 + Math.random() * 0.8, 0.22, C.chip);
  }
  for (let i = 0; i < n; i++) {
    _b.copy(hit.normal).multiplyScalar(4 + Math.random() * 10).add(_c.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(10));
    parts.emit(hit.point, _b, 0.4 + Math.random() * 0.5, 0.35, C.spark);
  }
}

// hull scrape: while pressed against a surface and sliding, throw a stream of sparks along the slide
const _t1 = new THREE.Vector3();
function scrapeFx(dt) {
  const c = ship.contact; if (!c) return;
  _t1.copy(ship.vel); _t1.addScaledVector(c.normal, -_t1.dot(c.normal));
  const slide = _t1.length(); if (slide < 3) return;
  scrapeAcc += dt * Math.min(90, slide * 5) * Q;
  while (scrapeAcc > 1) {
    scrapeAcc--;
    _b.copy(_t1).multiplyScalar(-0.25 - Math.random() * 0.3).addScaledVector(c.normal, 2 + Math.random() * 4).add(_c.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(3));
    parts.emit(c.point, _b, 0.25 + Math.random() * 0.35, 0.22, Math.random() < 0.3 ? C.warm : C.spark);
  }
  if (slide > 8) rig.kick(0.01);
}
let scrapeAcc = 0;

function navFx(t) {
  const navs = shipMesh.userData.navs;
  navs[0].material.opacity = navs[1].material.opacity = 0.55 + 0.1 * Math.sin(t * 2);
  navs[2].material.opacity = (t % 1.6) < 0.09 ? 1 : 0.05;    // short white strobe every 1.6s
}

let respawnT = 0;
function onShipHit(hit, otherMass) {
  const s = hit.speed;
  sparks(hit, Math.min(40, Math.floor(s * 2.5)));
  if (s > 2) { rig.kick(Math.min(1, s / 28)); hud.pulse(Math.min(0.35, s / 70)); }
  // glancing bumps are free; real hits cost hull, scaled by what you hit
  const dmg = Math.max(0, s - 7) * 0.011 * Math.min(2, 0.7 + otherMass * 0.15);
  if (dmg > 0) ship.hull = Math.max(0, ship.hull - dmg);
  // knock: a hit tumbles you
  ship.angVel.add(_c.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(Math.min(3, s * 0.12)));
  if (ship.hull <= 0 && !respawnT) respawnT = 1.6;
}

function respawn() {
  ship.pos.set(30, 14, 142); ship.vel.set(0, 0, 0); ship.angVel.set(0, 0, 0); ship.quat.setFromEuler(new THREE.Euler(-0.06, 0.28, 0)); ship.hull = 1;
}

// ---- loop -------------------------------------------------------------------------------
const STEP = 1 / 120;
const _sunW = new THREE.Vector3();
let acc = 0, last = performance.now(), time = 0, started = false;
requestAnimationFrame(() => document.getElementById('veil').classList.add('go'));

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
  const cmd = input.consume();
  if (!started && (cmd.fwd || cmd.strafe || cmd.vert || cmd.dx || cmd.dy)) { started = true; hud.hideHint(); }
  if (respawnT > 0) { respawnT -= dt; cmd.fwd = cmd.strafe = cmd.vert = cmd.dx = cmd.dy = 0; hud.pulse(0.02); if (respawnT <= 0) { respawnT = 0; respawn(); } }

  acc += dt; let first = true, n = 0;
  while (acc >= STEP && n++ < 8) {
    ship.step(STEP, first ? cmd : { ...cmd, dx: 0, dy: 0, yawKey: cmd.yawKey, pitchKey: cmd.pitchKey });
    world.update(STEP, ship, onShipHit);
    acc -= STEP; first = false;
  }
  if (n >= 8) acc = 0;

  shipMesh.position.copy(ship.pos); shipMesh.quaternion.copy(ship.quat);
  rcsFx(dt);
  engineFx(dt);
  scrapeFx(dt);
  navFx(time);
  parts.update(dt, innerHeight, renderer.getPixelRatio());
  world.updateDust(ship.pos, ship.vel);
  rig.update(dt, ship);
  world.updateVisual(time, camera.position);

  sun.position.copy(ship.pos).addScaledVector(SUN_DIR, 250); sun.target.position.copy(ship.pos);
  hud.update(dt, ship, camera, innerWidth, innerHeight);
  look.render(time, _sunW.copy(SUN_DIR).multiplyScalar(7000).add(camera.position));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__game = { ship, world, input, rig, camera, scene, THREE, look, renderer };
