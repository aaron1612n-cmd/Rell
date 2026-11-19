import * as THREE from 'three';
import { Ship } from './ship.js';
import { buildShip } from './shipMesh.js';
import { poseShip, fadeCanopy } from './shipRig.js';
import { WorldAnim, DebrisSparks } from './worldAnim.js';
import { loadModel, urls, mats } from './assets.js';
import { World, SUN_DIR } from './world.js';
import { Input, ICONS } from './input.js';
import { CamRig } from './camera.js';
import { Hud } from './hud.js';
import { Impact } from './impact.js';
import { Help } from './help.js';
import { GpuParticles, HeatHazePass, K } from './gpufx.js';
import { Engine } from './engine.js';
import { setupLights, Look } from './look.js';
import { bakeSky, bakePlanet } from './sky.js';
import { NOZZLES, solveRcs } from './rcs.js';
import { Cockpit } from './cockpit.js';
import { Eva } from './eva.js';
import { loadSuit } from './astronaut.js';
import { Lockers } from './lockers.js';
import { HullDamage } from './damage.js';
import { LAYOUT } from './sites.js';
import { Salvage, addHitch } from './salvage.js';

// Sprites (beacons, flares) hang off ship and wreck nodes. Sprite.raycast needs raycaster.camera and
// throws without it, which killed the frame whenever a ray (impact scanner, hull damage, tow hook)
// crossed a node that carries one. None of our rays want sprites, so skip them.
{ const sr = THREE.Sprite.prototype.raycast; THREE.Sprite.prototype.raycast = function (rc, out) { if (rc.camera) sr.call(this, rc, out); }; }
import { Econ } from './economy.js';
import { Nav, NAV_ICONS } from './nav.js';
import { Tutorial } from './tutorial.js';
import { Quality } from './quality.js';
import { Career, JOB_ICONS } from './career.js';
import { Settings, Menu } from './settings.js';
import { Events } from './events.js';

const canvas = document.getElementById('view');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

// the frame is drawn into the composer's own (multisampled) target, so the canvas itself needs no MSAA
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 1.5));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(66, 1, 0.1, 20000);

// light rig, reflection environment and tone mapping live in look.js
const { sun } = setupLights(scene, renderer, SUN_DIR, coarse);

const [shipModel, stationModel, debrisModel, depotModel, freighterModel, salvageModel] = await Promise.all([
  loadModel(urls.ship, mats.shipHull), loadModel(urls.station), loadModel(urls.debris), loadModel(urls.depot), loadModel(urls.freighter), loadModel(urls.salvage)]);
const world = new World(scene, { station: stationModel, stationB: stationModel.clone(true), debris: debrisModel, depot: depotModel, freighter: freighterModel, salvage: salvageModel }, { coarse });
const depot = world.site.depot;
scene.add(world.sky);
// dark glass (station domes, ports) mirrors black space and reads as a hole: let it pick up more of the planet glow
scene.traverse((o) => { const m = o.material; if (m && m.isMeshStandardMaterial && m.metalness > 0.6 && m.roughness < 0.2 && m.color.getHSL({}).l < 0.1) m.envMapIntensity = 2.6; });
bakeSky(renderer, world.sky); bakePlanet(renderer, world.planet, coarse ? 768 : 1024);   // static sky and planet layers baked to cube maps once (sky.js)

const ship = new Ship();
ship.pos.set(...LAYOUT.spawn.pos); ship.quat.setFromEuler(new THREE.Euler(...LAYOUT.spawn.euler));
const shipMesh = buildShip(shipModel, coarse); scene.add(shipMesh); addHitch(shipMesh);
// the ship's meshes live on layer 1: the chase camera sees them, the cockpit view doesn't, the sun's shadow always does
shipMesh.traverse((o) => { if (o.isMesh || o.isSprite || o.isPoints) o.layers.set(1); });
camera.layers.enable(1); sun.shadow.camera.layers.enable(1);
const cockpit = new Cockpit({ renderer, camera, shipModel, env: scene.environment, sunDir: SUN_DIR, world, coarse, reduced });
await Promise.all([cockpit.load(), loadSuit()]);
addEventListener('keydown', (e) => { if (e.code === 'KeyV' && !e.repeat) { if (eva.active) eva.toggleView(); else cockpit.toggle(); } });
{ const vb = document.getElementById('viewbtn'); vb.innerHTML = `<svg viewBox="0 0 24 24">${ICONS.view}</svg>`;
  vb.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); if (eva.active) eva.toggleView(); else cockpit.toggle(); }); }

const input = new Input(canvas);
input.onToggleAssist = () => { ship.assist = !ship.assist; };
const impact = new Impact(scene, world, ship, { reduced, coarse });
{
  const el = document.getElementById('impact');
  let on = true; try { on = localStorage.getItem('rell.impact') !== '0'; } catch {}
  const set = (v) => { on = v; impact.setEnabled(v); el.classList.toggle('on', v); try { localStorage.setItem('rell.impact', v ? '1' : '0'); } catch {} };
  set(on);
  input.onToggleImpact = () => set(!on);
  el.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); set(!on); });
}
const rig = new CamRig(camera, reduced);
const hud = new Hud();
const help = new Help(input);

// ---- salvage loop: tow line, depot, credits, upgrades, tutorial ------------------------------
const econ = new Econ();
const salvage = new Salvage({
  scene, world, ship, models: { salvage: salvageModel }, coarse,
  onImpact: (h, m) => onShipHit(h, Math.min(3, m * 0.3)),
  onDeliver: (it, v) => { econ.earn(v); career.onDeliver(it, v); nav.pop(v); tutorial.delivered(); depotFlash = 1; },
  onEvent: (e, it, p) => {
    if (e === 'snap') { sparks({ point: p, normal: _c.copy(ship.pos).sub(p).normalize(), speed: 10 }, 40); rig.kick(0.35); hud.pulse(0.12); cockpit.alert(0.5); }
    if (e === 'hook') rig.kick(0.05);
    if (e === 'miss') hud.miss();
  },
});
econ.apply(ship, salvage);
const nav = new Nav({ world, salvage, econ, ship, input });
nav.onBuy = () => econ.apply(ship, salvage);
const career = new Career(econ);
const settings = new Settings();
input.onGrab = () => { if (!eva.active) salvage.grab(); };
let depotFlash = 0;

world.onSiteEvent = (e, site) => {
  const d = site.pos.distanceTo(ship.pos);
  if (e === 'unstable') { rig.kick(d < 400 ? 0.4 : 0.05); if (d < 400) cockpit.alert(0.6); }
  if (e === 'collapse') {
    shock(site);
    const near = 1 - THREE.MathUtils.clamp((d - site.radius * 0.3) / 260, 0, 1);
    if (near > 0) {
      rig.kick(Math.min(1, near * 1.4)); hud.pulse(0.45 * near); cockpit.alert(near);
      ship.hull = Math.max(0, ship.hull - 0.5 * near * near * (ship.armor ?? 1));
      ship.vel.addScaledVector(_c.copy(ship.pos).sub(site.pos).normalize(), 22 * near);
      ship.angVel.add(_c.set(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(3 * near));
      if (ship.hull <= 0 && !respawnT) { respawnT = 1.6; salvage.releaseAll(); }
    }
  }
};
// collapse shockwave: a bright shell that races out from the wreck
const shockMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uA: { value: 0 } },
  vertexShader: 'varying vec3 vN, vV; void main(){ vec4 w = modelMatrix * vec4(position,1.); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }',
  fragmentShader: 'uniform float uA; varying vec3 vN, vV; void main(){ float f = pow(max(0., 1. - abs(dot(vN, vV))), 3.); gl_FragColor = vec4(vec3(1.4,.62,.3) * f * uA, 1.); }',
});
const shockMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), shockMat); shockMesh.visible = false; shockMesh.frustumCulled = false; scene.add(shockMesh);
let shockT = -1;
function shock(site) {
  shockMesh.position.copy(site.pos); shockT = 0; shockMesh.visible = true;
  for (const p of site.parts) if (p.pivot) { _c.copy(p.pivot.position); sparks({ point: _c, normal: _a.copy(_c).sub(site.pos).normalize(), speed: 20 }, 50); }
  fx.emit(site.pos, _b.set(0, 0, 0), fxT, 0.5, 0.6, 60, K.FLASH, 1);
}
function shockFx(dt) {
  if (shockT < 0) return;
  shockT += dt; const k = shockT / 2.2;
  if (k >= 1) { shockT = -1; shockMesh.visible = false; return; }
  shockMesh.scale.setScalar(20 + 380 * (1 - Math.pow(1 - k, 2.2))); shockMat.uniforms.uA.value = (1 - k) * 1.6;
}
// weld tearing throws sparks where the line bites
let strainAcc = 0;
function strainFx(dt) {
  for (const r of salvage.ropes) {
    const s = r.item.strainVis || 0; if (r.item.state !== 'welded' || s < 0.05) continue;
    strainAcc += dt * 160 * s * Q;
    while (strainAcc > 1) {
      strainAcc--;
      _b.copy(r.pa).sub(r.pb).normalize().multiplyScalar(3 + R() * 8).add(_c.set(rs(), rs(), rs()).multiplyScalar(9));
      fx.emit(r.pb, _b, fxT - R() * dt, 0.3 + R() * 0.5, 0.03, 0.02, R() < 0.4 ? K.EMBER : K.SPARK, 0.6, 0.04);
    }
    if (s > 0.4) rig.kick(0.008 * s);
  }
}
// docked at the depot: hull gets patched up, upgrade tiles open
function dockCheck(dt) {
  const docked = ship.pos.distanceTo(depot.dockPt) < depot.dockR && ship.vel.length() < 6 && !respawnT;
  nav.setDocked(docked);
  if (docked && ship.hull < 1) ship.hull = Math.min(1, ship.hull + dt * 0.2);
  depotFlash = Math.max(0, depotFlash - dt * 0.8);
  const towing = salvage.ropes.length > 0;
  const k = towing ? 0.7 + 0.5 * Math.sin(time * 6) : 0.55;
  depot.catchMat.color.setRGB(k + depotFlash * 2, k * (towing ? 0.45 : 1) + depotFlash, k * (towing ? 0.2 : 1) + depotFlash * 0.5);
}

// post (look.js): heat haze (desktop), bloom on HDR only, lens ghosts, grade, vignette, grain. Phones skip haze and bloom.
const hazeScene = new THREE.Scene();   // heat-shimmer particles, rendered only into the haze pass
const hazePass = coarse ? null : new HeatHazePass(hazeScene, camera);
const look = new Look(renderer, scene, camera, coarse, [hazePass, cockpit.pass].filter(Boolean));

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  // keep the ship readable on tall phone screens
  camera.fov = rig.baseFov = (w / h < 0.8 ? 80 : 66) + settings.get('fov'); camera.updateProjectionMatrix();
  look.setSize(w, h, renderer.getPixelRatio()); cockpit.setSize(w, h);
  world.stars.material.uniforms.uPR.value = renderer.getPixelRatio();
}
addEventListener('resize', resize); resize();
// adaptive quality (quality.js): render scale, MSAA, shadow map size, bloom/haze step with frame time
const quality = new Quality({ renderer, look, sun, hazePass, world, coarse, onResize: resize });
if (settings.get('quality') !== 'auto') quality.setMode(settings.get('quality'));

// ---- effects ----------------------------------------------------------------------------
// Quality tier: phones get fewer particles, no heat haze and no bloom (particles add their own halo there).
const Q = coarse ? 0.45 : 1;
const fx = new GpuParticles(coarse ? 2400 : 7000, 'add', { glow: coarse ? 1 : 0 }); scene.add(fx.mesh);
const worldAnim = new WorldAnim(world), debrisSparks = new DebrisSparks(fx, K);
const smoke = new GpuParticles(coarse ? 260 : 700, 'smoke'); scene.add(smoke.mesh);
const haze = coarse ? null : new GpuParticles(500, 'haze'); if (haze) hazeScene.add(haze.mesh);
const engU = Engine.uniforms(coarse);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _ax = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
const R = Math.random, rs = () => R() - 0.5;
let fxT = 0, boostSm = 0, heat = 0, offT = 1, onT = 0, wasBoost = false, gx = 0, gy = 0, gr = 0, flashL = 0;
// ---- EVA: bolted lockers on the wrecks, hull damage on the ship, the pilot outside ------------
const lockers = new Lockers(scene, world, { coarse });
const damage = new HullDamage(shipMesh, shipModel);
const eva = new Eva({ scene, camera, world, ship, shipMesh, cockpit, input, fx, rig, coarse, reduced, lockers, damage, env: scene.environment, sunDir: SUN_DIR, hud,
  onStow: (L) => { econ.bonus(L.value); career.onLocker(L.value); nav.pop(L.value); } });
eva.getFxT = () => fxT;
const tutorial = new Tutorial({ scene, ship, salvage, world, econ, input, reduced, eva, lockers, career, nav });
const replayTutorial = () => { respawn(true); tutorial.start(); };
help.onTutorial = replayTutorial;
if (!econ.tut) setTimeout(() => tutorial.start(), reduced ? 300 : 2600);
const events = new Events({ scene, ship, fx, rig, hud, cockpit, nav, sun, coarse, reduced,
  onHit: (h, m) => onShipHit(h, m),
  onStorm: (clean, kind) => { career.onStorm(clean); if (clean) { econ.bonus(120); nav.pop(120); } toast(kind === 'meteor' ? 'meteor' : 'flare'); } });
events.getFxT = () => fxT;
// toasts: icon + number, one at a time
const toastEl = document.createElement('div'); toastEl.id = 'toast'; document.body.appendChild(toastEl);
let toastT = 0;
function toast(kind, n) {
  const ic = { job: JOB_ICONS.haul, done: JOB_ICONS.clean, rank: JOB_ICONS.up, fail: JOB_ICONS.quick, meteor: JOB_ICONS.meteor, flare: JOB_ICONS.flare }[kind];
  const txt = kind === 'done' ? '+' + n : kind === 'rank' ? n : kind === 'meteor' || kind === 'flare' ? '+120' : '';
  toastEl.innerHTML = `<svg viewBox="0 0 24 24">${ic}</svg>${txt ? `<span>${txt}</span>` : ''}`;
  toastEl.classList.add('show'); toastT = 2.4;
}
career.toast = toast;
const menu = new Menu({ settings, career, econ, help, onTutorial: replayTutorial, onReset: () => { econ.reset(); location.reload(); } });
const applySettings = (k) => {
  input.invertY = settings.get('invert'); rig.shakeScale = settings.get('shake');
  if (!k || k === 'quality') quality.setMode(settings.get('quality'));
  if (k === 'fov') resize();
  document.getElementById('hint').style.display = settings.get('hints') ? '' : 'none';
};
settings.onChange = applySettings; applySettings();

look.composer.insertPass(eva.pass, look.composer.passes.indexOf(cockpit.pass) + 1);
input.onExit = () => eva.request();
{ const xb = document.getElementById('exitbtn'); xb.innerHTML = `<svg viewBox="0 0 24 24">${ICONS.exit}</svg>`;
  xb.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); eva.request(); }); }
const HOLD = { fwd: 0, strafe: 0, vert: 0, roll: 0, boost: false, brake: true, yawKey: 0, pitchKey: 0, dx: 0, dy: 0 };
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
    fx.emit(e.cur, _b, fxT, strong ? 0.22 : 0.18, 0.2, strong ? 1.5 : 1.0, strong ? K.RING_B : K.RING, 2.5);
    for (let i = 0; i < 18 * n * Q; i++) {
      coneDir(e, 0.7, _a); _b.copy(ship.vel).addScaledVector(_a, 8 + R() * 26 * n);
      fx.emit(exitPoint(e, 1, 0.2, _c), _b, fxT - R() * 0.02, 0.3 + R() * 0.45, 0.25, 0.9 + R() * 0.7, strong ? K.BOOST : K.PLASMA, 2.4, 0.01);
    }
    for (let i = 0; i < 12 * n * Q; i++) {
      coneDir(e, 0.45, _a); _b.copy(ship.vel).addScaledVector(_a, 20 + R() * 45);
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

let jetLen = 0;
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
  engines.forEach((en, i) => { en.gimbal(gx + Math.sign(en.position.x) * gr, gy); en.update(dt, main, boostSm, heat); });
  shipMesh.updateMatrixWorld(true);

  // volumetric jet: length and brightness follow throttle, boost stretches it and adds shock cells
  const len = jetLen = (1.2 + main * (4.2 + 5.5 * boostSm)) * flick, r0 = 0.2 + 0.03 * main + 0.09 * boostSm;
  for (const g of glows) { g.tick(fxT); g.set(main * (0.75 + 0.35 * boostSm) * flick, len, r0, boostSm); }
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
  // the volumetric jet (src/exhaust.js) is the flame now; particles only add what a volume can't:
  // a thin wake of cooling gas past its tip, sparks, boost smoke, and heat shimmer
  const rates = [main * (34 + 46 * B), 0, main * (5 + 16 * B), 2 + 7 * B, main * 45];
  for (const e of E) {
    // 0: plasma body. Spawned along the path the nozzle swept this frame, so fast flight leaves no gaps.
    e.acc[0] += dt * rates[0] * Q;
    for (let n = Math.floor(e.acc[0]), k = 0; k < n; k++) {
      const s = (k + R()) / n; e.acc[0]--;
      coneDir(e, 0.06 + 0.04 * (1 - B), _a);
      _b.copy(ship.vel).addScaledVector(_a, (16 + R() * 8) * (1 + 0.6 * B));
      exitPoint(e, s, 0.15, _c).addScaledVector(e.axis, jetLen * (0.55 + R() * 0.3));
      fx.emit(_c, _b, fxT - (1 - s) * dt, (0.3 + R() * 0.3) * (1 + 0.25 * B), 0.3, (0.5 + R() * 0.4) * (1 + 0.35 * B) / Math.pow(Q, 0.25),
        K.PLASMA, 1.6, 0.006);
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
      coneDir(e, 0.12, _a); _b.copy(ship.vel).addScaledVector(_a, 30 + R() * 30);
      fx.emit(exitPoint(e, s, 0.12, _c), _b, fxT - (1 - s) * dt, 0.15 + R() * 0.3, 0.035, 0.02, R() < 0.4 ? K.EMBER : K.SPARK, 0.6, 0.02);
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

// moving parts: canopy on its hinge, trailing-edge vanes following the turn
const vanes = { pitch: 0, roll: 0 };
function partsFx(dt) {
  const w = ship.angVel, cl = (v) => THREE.MathUtils.clamp(v, -1, 1);
  vanes.pitch = THREE.MathUtils.damp(vanes.pitch, cl(-w.x * 0.9 - _alpha.x * 0.08), 6, dt);
  vanes.t = time;
  vanes.roll = THREE.MathUtils.damp(vanes.roll, cl(w.z * 0.7 + _alpha.z * 0.06), 6, dt);
  poseShip(shipMesh.userData.rig, cockpit.openAngle || 0, vanes);
  if (cockpit.extRig) poseShip(cockpit.extRig, 0, vanes);
  fadeCanopy(shipMesh.userData.rig, camera.position, eva.active);
}

function navFx(t) {
  const navs = shipMesh.userData.navs;
  navs[0].material.opacity = navs[1].material.opacity = 0.55 + 0.1 * Math.sin(t * 2);
  navs[2].material.opacity = (t % 1.6) < 0.09 ? 1 : 0.05;    // short white strobe every 1.6s
  const L = shipMesh.userData.lights;
  // mast beacon: double blink; leading-edge lights chase outboard; pod beacons breathe, faster while boosting
  const b = t % 2.2; L.beacon.material.opacity = (b < 0.07 || (b > 0.22 && b < 0.29)) ? 1 : 0.04;
  for (const c of L.chase) { const ph = ((t * 1.6 - c.i * 0.16) % 1 + 1) % 1; c.sp.material.opacity = 0.08 + 0.92 * Math.max(0, 1 - ph * 6); }
  const pp = 0.5 + 0.5 * Math.sin(t * (2 + 5 * boostSm)); for (const s of L.pods) s.material.opacity = 0.15 + 0.7 * pp * pp;
}

let respawnT = 0;
function onShipHit(hit, otherMass) {
  const s = hit.speed;
  sparks(hit, Math.min(40, Math.floor(s * 2.5)));
  if (s > 2) { rig.kick(Math.min(1, s / 28)); hud.pulse(Math.min(0.35, s / 70)); }
  if (s > 4) cockpit.alert(Math.min(1, s / 18));
  // glancing bumps are free; real hits cost hull, scaled by what you hit
  const dmg = Math.max(0, s - 7) * 0.011 * Math.min(2, 0.7 + otherMass * 0.15) * (ship.armor ?? 1);
  if (dmg > 0) { ship.hull = Math.max(0, ship.hull - dmg); damage.add(hit.point, ship, dmg); }
  // knock: a hit tumbles you
  ship.angVel.add(_c.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(Math.min(3, s * 0.12)));
  if (ship.hull <= 0 && !respawnT) { respawnT = 1.6; salvage.releaseAll(); }
}

// back at the start for the tutorial, otherwise towed home to the depot's dock
function respawn(start = false) {
  salvage.releaseAll();
  ship.vel.set(0, 0, 0); ship.angVel.set(0, 0, 0); ship.hull = 1; damage.clear();
  if (start) { ship.pos.set(...LAYOUT.spawn.pos); ship.quat.setFromEuler(new THREE.Euler(...LAYOUT.spawn.euler)); return; }
  ship.pos.copy(depot.dockPt);
  // face away from the depot, out toward the wrecks
  _m4.lookAt(_c.set(0, 0, 0), _a.copy(depot.axis).negate(), _b.set(0, 1, 0)); ship.quat.setFromRotationMatrix(_m4);
}
const _m4 = new THREE.Matrix4();

// ---- loop -------------------------------------------------------------------------------
const STEP = 1 / 120;
const _sunW = new THREE.Vector3();
let acc = 0, last = performance.now(), time = 0, started = false;
// compile every shader up front (in parallel where the driver allows) so the first seconds of flight don't hitch
// compile() covers hidden objects too (engine plumes, impact fx, the suit, tool beam, EVA hands).
// On Windows each program built mid-game is a visible freeze.
async function precompile(sc, cam) {
  if (!sc || !cam) return;
  try { await renderer.compileAsync(sc, cam); } catch {}
}
// compile against the composer's float target: program keys include the output colour space and tone
// mapping, and those differ between the screen and a render target, so compiling for the screen built a
// set of programs the game never used and the real ones still compiled mid-flight
renderer.setRenderTarget(look.composer.renderTarget1);
await Promise.all([precompile(scene, camera), precompile(cockpit.scene, cockpit.cam), precompile(eva.handScene, eva.handCam)]);
eva.setCabin(true); await precompile(scene, camera); eva.setCabin(false);   // the open-canopy cabin and cutaway hull
renderer.setRenderTarget(null);
requestAnimationFrame(() => document.getElementById('veil').classList.add('go'));

// one bad frame must never stop the loop: an exception in here used to skip the next
// requestAnimationFrame and the game froze for good
function frame(now) {
  requestAnimationFrame(frame);
  try { tickFrame(now); } catch (e) { console.error(e); }
}
function tickFrame(now) {
  const rawDt = (now - last) / 1000, dt = Math.min(0.05, rawDt); last = now; time += dt;
  quality.tick(rawDt);
  const raw = input.consume();
  raw.dx *= settings.get('sens'); raw.dy *= settings.get('sens');
  if (menu.open) { look.render(time, _sunW.copy(SUN_DIR).multiplyScalar(7000).add(camera.position)); return; }
  const cmd = eva.holdShip ? HOLD : raw;
  if (!started && (cmd.fwd || cmd.strafe || cmd.vert || cmd.dx || cmd.dy)) { started = true; hud.hideHint(); }
  if (respawnT > 0) { respawnT -= dt; cmd.fwd = cmd.strafe = cmd.vert = cmd.dx = cmd.dy = 0; hud.pulse(0.02); if (respawnT <= 0) { respawnT = 0; respawn(); } }

  acc += dt; let first = true, n = 0;
  while (acc >= STEP && n++ < 8) {
    ship.step(STEP, first ? cmd : { ...cmd, dx: 0, dy: 0, yawKey: cmd.yawKey, pitchKey: cmd.pitchKey });
    world.update(STEP, ship, onShipHit);
    salvage.step(STEP, depot);
    acc -= STEP; first = false;
  }
  if (n >= 8) acc = 0;

  world.refreshActive(ship.pos);
  dockCheck(dt);
  shipMesh.position.copy(ship.pos); shipMesh.quaternion.copy(ship.quat);
  fxT += dt;
  strainFx(dt); shockFx(dt);
  rcsFx(dt);
  engineFx(dt);
  scrapeFx(dt);
  navFx(time);
  fx.update(fxT); smoke.update(fxT); if (haze) haze.update(fxT);
  impact.update(dt, time);
  world.updateDust(ship.pos, ship.vel);
  rig.tow = salvage.ropes.reduce((m, r) => Math.max(m, r.shoot < 1 ? 0 : r.rest + r.item.body.radius), 0);
  if (!eva.active) rig.update(dt, ship);
  ship.braking = cmd.brake; cockpit.heat = heat;
  cockpit.update(dt, ship, rig);
  partsFx(dt);
  eva.update(dt, raw);
  if (eva.state === 'eva' && (time % 0.1) < dt) cockpit.drawInstruments(0.1, ship);
  world.updateVisual(time, camera.position);
  worldAnim.update(dt, time);
  debrisSparks.update(dt, fxT, world.debris, camera.position, ship.vel);

  const focus = eva.state === 'eva' ? eva.pilot.pos : ship.pos;
  sun.position.copy(focus).addScaledVector(SUN_DIR, 250); sun.target.position.copy(focus);
  salvage.update(dt, time, camera);
  hud.update(dt, ship, camera, innerWidth, innerHeight);
  nav.update(dt, camera, innerWidth, innerHeight, time);
  tutorial.update(dt, time, camera, innerWidth, innerHeight);
  career.update(dt, ship, nav.docked);
  events.update(dt, { busy: !econ.tut || tutorial.on || nav.docked || eva.active || respawnT > 0 }, camera, innerWidth, innerHeight);
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.classList.remove('show'); }
  quality.begin();
  look.render(time, _sunW.copy(SUN_DIR).multiplyScalar(7000).add(camera.position));
  quality.end();
}
requestAnimationFrame(frame);

window.__game = { events, career, settings, menu, worldAnim, quality, salvage, econ, nav, tutorial, depot, respawn, impact, ship, world, input, rig, camera, scene, THREE, fx, smoke, haze, shipMesh, look, renderer, cockpit, eva, lockers, damage };
