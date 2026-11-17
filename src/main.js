import * as THREE from 'three';
import { Ship } from './ship.js';
import { buildShip } from './shipMesh.js';
import { loadModel, urls, mats } from './assets.js';
import { World, SUN_DIR } from './world.js';
import { Input } from './input.js';
import { CamRig } from './camera.js';
import { Hud } from './hud.js';
import { Help } from './help.js';
import { GpuParticles, HeatHazePass, K } from './gpufx.js';
import { Engine } from './engine.js';
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

const input = new Input(canvas);
input.onToggleAssist = () => { ship.assist = !ship.assist; };
const rig = new CamRig(camera, reduced);
const hud = new Hud();
new Help(input);

// post (look.js): heat haze (desktop), bloom on HDR only, lens ghosts, grade, vignette, grain. Phones skip haze and bloom.
const hazeScene = new THREE.Scene();   // heat-shimmer particles, rendered only into the haze pass
const hazePass = coarse ? null : new HeatHazePass(hazeScene, camera);
const look = new Look(renderer, scene, camera, coarse, hazePass ? [hazePass] : []);

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
// Quality tier: phones get fewer particles, no heat haze and no bloom (particles add their own halo there).
const Q = coarse ? 0.45 : 1;
const fx = new GpuParticles(coarse ? 2400 : 7000, 'add', { glow: coarse ? 1 : 0 }); scene.add(fx.mesh);
const smoke = new GpuParticles(coarse ? 260 : 700, 'smoke'); scene.add(smoke.mesh);
const haze = coarse ? null : new GpuParticles(500, 'haze'); if (haze) hazeScene.add(haze.mesh);
const engU = Engine.uniforms(coarse);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _ax = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
const R = Math.random, rs = () => R() - 0.5;
let fxT = 0, boostSm = 0, heat = 0, offT = 1, onT = 0, wasBoost = false, gx = 0, gy = 0, gr = 0, flashL = 0;
const E = [0, 1].map(() => ({ prev: new THREE.Vector3(), cur: new THREE.Vector3(), axis: new THREE.Vector3(), u: new THREE.Vector3(), w: new THREE.Vector3(), acc: [0, 0, 0, 0, 0], has: false }));

// random point on the exit disc and a direction inside a cone around the engine axis
function coneDir(e, spread, out) {
  const a = R() * Math.PI * 2, r = Math.sqrt(R()) * spread;
  return out.copy(e.axis).addScaledVector(e.u, Math.cos(a) * r).addScaledVector(e.w, Math.sin(a) * r).normalize();
}
function exitPoint(e, f, rad, out) {
  const a = R() * Math.PI * 2, r = Math.sqrt(R()) * rad;
  return out.lerpVectors(e.prev, e.cur, f).addScaledVector(e.u, Math.cos(a) * r).addScaledVector(e.w, Math.sin(a) * r);
}

function ignite(strong) {
  const n = strong ? 1.6 : 1;
  for (const e of E) {
    _b.copy(ship.vel).addScaledVector(e.axis, 3);
    fx.emit(e.cur, _b, fxT, 0.12, 0.4, strong ? 1.8 : 1.3, K.FLASH, 3);
    _b.copy(ship.vel).addScaledVector(e.axis, strong ? 9 : 5);
    fx.emit(e.cur, _b, fxT, strong ? 0.35 : 0.28, 0.3, strong ? 3.2 : 2.0, strong ? K.RING_B : K.RING, 2.5);
    for (let i = 0; i < 46 * n * Q; i++) {
      coneDir(e, 1.1, _a); _b.copy(ship.vel).addScaledVector(_a, 8 + R() * 26 * n);
      fx.emit(exitPoint(e, 1, 0.2, _c), _b, fxT - R() * 0.02, 0.3 + R() * 0.45, 0.25, 0.9 + R() * 0.7, strong ? K.BOOST : K.PLASMA, 2.4, 0.01);
    }
    for (let i = 0; i < 28 * n * Q; i++) {
      coneDir(e, 0.9, _a); _b.copy(ship.vel).addScaledVector(_a, 20 + R() * 45);
      fx.emit(exitPoint(e, 1, 0.25, _c), _b, fxT, 0.3 + R() * 0.6, 0.03, 0.02, K.SPARK, 0.6, 0.045);
    }
    for (let i = 0; i < 10 * n * Q; i++) {
      coneDir(e, 0.8, _a); _b.copy(ship.vel).addScaledVector(_a, 4 + R() * 8);
      smoke.emit(exitPoint(e, 1, 0.25, _c), _b, fxT, 1.2 + R() * 1.0, 0.4, 1.6 + R() * 1.2, K.SMOKE, 1.4);
    }
    if (haze) for (let i = 0; i < 10; i++) { coneDir(e, 0.6, _a); _b.copy(ship.vel).addScaledVector(_a, 6 + R() * 8); haze.emit(e.cur, _b, fxT, 0.5 + R() * 0.3, 0.6, 2.4, K.HAZE, 2); }
  }
  rig.kick(strong ? 0.22 : 0.07); flashL = strong ? 1 : 0.6;
}

function shutdown() {
  for (const e of E) for (let i = 0; i < 6 * Q + 2; i++) {
    coneDir(e, 0.5, _a); _b.copy(ship.vel).addScaledVector(_a, 3 + R() * 5);
    smoke.emit(exitPoint(e, 1, 0.2, _c), _b, fxT, 1 + R() * 0.8, 0.3, 1.4 + R(), K.SMOKE, 1.6);
    _b.copy(ship.vel).addScaledVector(_a, 10 + R() * 20);
    fx.emit(_c, _b, fxT, 0.3 + R() * 0.4, 0.03, 0.02, K.EMBER, 0.8, 0.04);
  }
}

function engineFx(dt) {
  const { glows, light, engines } = shipMesh.userData, f = ship.fx, main = f.main;
  const flick = 0.92 + 0.08 * Math.sin(fxT * 47) * Math.sin(fxT * 13.7 + 1) + 0.04 * rs();
  boostSm = THREE.MathUtils.damp(boostSm, f.boost ? 1 : 0, 8, dt);
  // metal heats slowly and cools slower still
  const ht = main * (0.6 + 0.5 * boostSm); heat += (ht - heat) * Math.min(1, dt * (ht > heat ? 0.9 : 0.22));
  engU.heat.uHeat.value = heat; engU.heat.uBoost.value = boostSm;
  engU.inner.uPower.value = main * (0.85 + 0.35 * boostSm) * flick; engU.inner.uTime.value = fxT;

  // gimbal: bells swing to help the turn (pitch/yaw from angular accel, roll as a split)
  const gk = 0.025 * (0.35 + 0.65 * main), lim = 0.12, cl = (v) => THREE.MathUtils.clamp(v, -lim, lim);
  gx = THREE.MathUtils.damp(gx, cl(-_alpha.x * gk), 7, dt); gy = THREE.MathUtils.damp(gy, cl(-_alpha.y * gk), 7, dt); gr = THREE.MathUtils.damp(gr, cl(_alpha.z * gk), 7, dt);
  engines.forEach((en, i) => en.gimbal(gx + Math.sign(en.position.x) * gr, gy));
  shipMesh.updateMatrixWorld(true);

  const len = main * (3.6 + 4.2 * boostSm) * flick, wid = 0.5 + 0.12 * main + 0.12 * boostSm;
  for (const g of glows) { g.tick(fxT); g.set(main * (0.4 - 0.12 * boostSm), Math.max(0.05, len), wid, boostSm, 1 + 0.25 * boostSm); }
  flashL = Math.max(0, flashL - dt * 5);
  light.intensity = main * (18 + 26 * boostSm) * flick + flashL * 60;
  light.color.setRGB(1, 0.42 + 0.25 * boostSm, 0.16 + 0.3 * boostSm);

  // engine frames in world space
  engines.forEach((en, i) => {
    const e = E[i];
    e.prev.copy(e.has ? e.cur : en.exit.getWorldPosition(e.cur)); en.exit.getWorldPosition(e.cur);
    en.exit.getWorldQuaternion(_q);
    e.axis.set(0, 0, 1).applyQuaternion(_q); e.u.set(1, 0, 0).applyQuaternion(_q); e.w.set(0, 1, 0).applyQuaternion(_q);
    if (!e.has) e.prev.copy(e.cur); e.has = true;
  });

  // ignition / boost / shutdown moments
  if (main < 0.06) { offT += dt; if (onT > 0.4) shutdown(); onT = 0; }
  else { if (onT === 0 && offT > 0.3 && main > 0.1) ignite(false); onT += dt; offT = 0; }
  if (f.boost && !wasBoost) ignite(true);
  wasBoost = f.boost;
  if (main < 0.03) return;

  const B = boostSm;
  const rates = [main * (260 + 300 * B), main * (90 + 90 * B), main * (12 + 40 * B), 2 + 7 * B, main * 45];
  for (const e of E) {
    // 0: plasma body. Spawned along the path the nozzle swept this frame, so fast flight leaves no gaps.
    e.acc[0] += dt * rates[0] * Q;
    for (let n = Math.floor(e.acc[0]), k = 0; k < n; k++) {
      const s = (k + R()) / n; e.acc[0]--;
      coneDir(e, 0.07 + 0.05 * (1 - B), _a);
      _b.copy(ship.vel).addScaledVector(_a, (20 + R() * 10) * (1 + 0.8 * B));
      fx.emit(exitPoint(e, s, 0.2, _c), _b, fxT - (1 - s) * dt, (0.26 + R() * 0.26) * (1 + 0.25 * B), 0.17, (0.38 + R() * 0.32) * (1 + 0.35 * B) / Math.pow(Q, 0.25),
        B > 0.5 && R() < 0.75 ? K.BOOST : K.PLASMA, 1.3, 0.012);
    }
    // 1: fast tight core: the white-hot spine near the nozzle
    e.acc[1] += dt * rates[1] * Q;
    for (let n = Math.floor(e.acc[1]), k = 0; k < n; k++) {
      const s = (k + R()) / n; e.acc[1]--;
      coneDir(e, 0.03, _a); _b.copy(ship.vel).addScaledVector(_a, 34 + 20 * B + R() * 10);
      fx.emit(exitPoint(e, s, 0.08, _c), _b, fxT - (1 - s) * dt, 0.05 + 0.03 * B, 0.2, 0.3, K.CORE, 3, 0.01);
    }
    // 2: sparks: fast streaks that outrun the plume
    e.acc[2] += dt * rates[2] * Q;
    for (let n = Math.floor(e.acc[2]), k = 0; k < n; k++) {
      const s = (k + R()) / n; e.acc[2]--;
      coneDir(e, 0.18, _a); _b.copy(ship.vel).addScaledVector(_a, 38 + R() * 40);
      fx.emit(exitPoint(e, s, 0.15, _c), _b, fxT - (1 - s) * dt, 0.25 + R() * 0.5, 0.05, 0.03, R() < 0.3 ? K.EMBER : K.SPARK, 0.4, 0.035);
    }
    // 3: thin smoke trail on boost (incomplete burn), lit by the plume then sunlit
    e.acc[3] += dt * rates[3] * Q * main;
    for (let n = Math.floor(e.acc[3]), k = 0; k < n; k++) {
      const s = (k + R()) / n; e.acc[3]--;
      coneDir(e, 0.15, _a); _b.copy(ship.vel).addScaledVector(_a, 18 + R() * 10);
      smoke.emit(exitPoint(e, s, 0.2, _c), _b, fxT - (1 - s) * dt, 1.0 + R() * 0.8, 0.35, 1.5 + R(), K.SMOKE, 1.8);
    }
    // 4: heat shimmer around the plume
    if (haze) {
      e.acc[4] += dt * rates[4];
      for (let n = Math.floor(e.acc[4]), k = 0; k < n; k++) {
        const s = (k + R()) / n; e.acc[4]--;
        coneDir(e, 0.2, _a); _b.copy(ship.vel).addScaledVector(_a, 10 + R() * 8);
        haze.emit(exitPoint(e, s, 0.25, _c), _b, fxT - (1 - s) * dt, 0.45 + R() * 0.3, 0.5, 1.6 + B, K.HAZE, 1.8);
      }
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
    _a.copy(n.pos).addScaledVector(n.dir, 0.1).applyQuaternion(ship.quat).add(ship.pos);
    _ax.copy(n.dir).applyQuaternion(ship.quat);
    rcsAcc[i] += dt * 70 * Q * v;
    while (rcsAcc[i] > 1) {
      rcsAcc[i]--;
      _b.copy(_ax).multiplyScalar(5 + R() * 4 * v).add(_c.set(rs(), rs(), rs()).multiplyScalar(1.4)).add(ship.vel);
      fx.emit(_a, _b, fxT - R() * dt, 0.16 + R() * 0.14, 0.05, 0.3 + v * 0.25, K.RCS, 2.2, 0.01);
    }
  }
}

function sparks(hit, n) {
  n = Math.ceil(n * Q);
  // slow dull chips of hull alongside the bright sparks
  for (let i = 0; i < n * 0.4; i++) {
    _b.copy(hit.normal).multiplyScalar(2 + R() * 4).add(_c.set(rs(), rs(), rs()).multiplyScalar(5));
    fx.emit(hit.point, _b, fxT, 0.9 + R() * 0.8, 0.12, 0.09, K.CHIP);
  }
  for (let i = 0; i < n * 1.5; i++) {
    _b.copy(hit.normal).multiplyScalar(4 + R() * 12).add(_c.set(rs(), rs(), rs()).multiplyScalar(12));
    fx.emit(hit.point, _b, fxT, 0.35 + R() * 0.55, 0.035, 0.02, K.SPARK, 0.8, 0.04);
  }
  fx.emit(hit.point, _c.set(0, 0, 0), fxT, 0.1, 0.3, 1.2, K.FLASH);
}

// hull scrape: while pressed against a surface and sliding, throw a stream of sparks along the slide
const _t1 = new THREE.Vector3();
let scrapeAcc = 0;
function scrapeFx(dt) {
  const c = ship.contact; if (!c) return;
  _t1.copy(ship.vel); _t1.addScaledVector(c.normal, -_t1.dot(c.normal));
  const slide = _t1.length(); if (slide < 3) return;
  scrapeAcc += dt * Math.min(140, slide * 8) * Q;
  while (scrapeAcc > 1) {
    scrapeAcc--;
    _b.copy(_t1).multiplyScalar(-0.25 - R() * 0.3).addScaledVector(c.normal, 2 + R() * 4).add(_c.set(rs(), rs(), rs()).multiplyScalar(3));
    fx.emit(c.point, _b, fxT - R() * dt, 0.25 + R() * 0.35, 0.03, 0.02, R() < 0.3 ? K.EMBER : K.SPARK, 0.5, 0.04);
  }
  if (slide > 8) rig.kick(0.01);
}

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
  fxT += dt;
  rcsFx(dt);
  engineFx(dt);
  scrapeFx(dt);
  navFx(time);
  fx.update(fxT); smoke.update(fxT); if (haze) haze.update(fxT);
  world.updateDust(ship.pos, ship.vel);
  rig.update(dt, ship);
  world.updateVisual(time, camera.position);

  sun.position.copy(ship.pos).addScaledVector(SUN_DIR, 250); sun.target.position.copy(ship.pos);
  hud.update(dt, ship, camera, innerWidth, innerHeight);
  look.render(time, _sunW.copy(SUN_DIR).multiplyScalar(7000).add(camera.position));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__game = { ship, world, input, rig, camera, scene, THREE, fx, smoke, haze, shipMesh, look, renderer };
