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
import { Objective } from './objective.js';
import { Quality } from './quality.js';
import { Career, JOB_ICONS } from './career.js';
import { Settings, Menu } from './settings.js';
import { Events } from './events.js';
import { Sound } from './audio.js';
import { DeepScan } from './deepscan.js';
import { Drones } from './drones.js';
import { Systems, SYS } from './systems.js';
import { Hangar, UP_ICONS } from './hangar.js';
import { Tips } from './tips.js';
import { Breakup } from './breakup.js';
import { Story } from './story.js';
import { Fleet } from './fleet.js';
import { Site, Part } from './sites.js';
import { Admin } from './admin.js';
import fleetUrl from './assets/fleet.glb?url';

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

const [shipModel, stationModel, debrisModel, depotModel, freighterModel, salvageModel, fleetModel] = await Promise.all([
  loadModel(urls.ship, mats.shipHull), loadModel(urls.station), loadModel(urls.debris), loadModel(urls.depot), loadModel(urls.freighter), loadModel(urls.salvage), loadModel(fleetUrl)]);
const world = new World(scene, { station: stationModel, stationB: stationModel.clone(true), stationC: stationModel.clone(true), debris: debrisModel, depot: depotModel, freighter: freighterModel, salvage: salvageModel }, { coarse });
const depot = world.site.depot;
// every other ship: the yard row by the depot and the hulls adrift (fleet.js). Built before the nav markers.
const fleet = new Fleet(world, fleetModel, { Site, Part, coarse });
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
addEventListener('keydown', (e) => { if (e.code === 'KeyO' && !e.repeat) document.body.classList.toggle('photo'); });
addEventListener('keydown', (e) => { if (e.code === 'KeyV' && !e.repeat) { if (fleet.helm) fleet.toggleView(); else if (eva.active) eva.toggleView(); else cockpit.toggle(); } });
{ const vb = document.getElementById('viewbtn'); vb.innerHTML = `<svg viewBox="0 0 24 24">${ICONS.view}</svg>`;
  vb.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); if (fleet.helm) fleet.toggleView(); else if (eva.active) eva.toggleView(); else cockpit.toggle(); }); }

const input = new Input(canvas);
const MODES = ['damped', 'hold', 'drift'];
input.onToggleAssist = () => { if (eva.active) return; ship.setMode(MODES[(MODES.indexOf(ship.mode) + 1) % 3]); tips?.show('mode-' + ship.mode); sound.step?.(); };
document.getElementById('assist').addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); input.onToggleAssist(); });
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
  onDeliver: (it, v) => {
    sound.deliver(); econ.earn(v); career.onDeliver(it, v); nav.pop(v); tutorial.delivered(); depotFlash = 1;
    if (it.kind === 'core' && breakup?.melting && breakup.core === it) { econ.bonus(600); setTimeout(() => { nav.pop(600); toast('info', 'Hot delivery +600'); }, 900); }
    if (it.section) toast('info', `${it.label} sold · ${v}`);
    story?.onDeliver(it);
  },
  onEvent: (e, it, p) => {
    if (e === 'snap') { sound.snap(); sparks({ point: p, normal: _c.copy(ship.pos).sub(p).normalize(), speed: 10 }, 40); rig.kick(0.35); hud.pulse(0.12); cockpit.alert(0.5); }
    if (e === 'hook') { rig.kick(0.05); sound.hook(); }
    if (e === 'miss') hud.miss();
    if (e === 'nowinch') { hud.miss(); toast('warn', 'Tow winch broken'); }
  },
});
econ.apply(ship, salvage);
const nav = new Nav({ world, salvage, econ, ship, input });
const applyUpgrades = () => { econ.apply(ship, salvage); if (scan) scan.level = econ.up.scanner; if (drones) drones.jamLevel = econ.up.jammer; };
const career = new Career(econ);
// fuel bar under the speed readout, and the autopilot chip under Impact
ship.fuel = 1;
{ const sp = document.getElementById('speed'); const f = document.createElement('div'); f.id = 'fuel'; f.innerHTML = '<span class="mono">Fuel</span><s><i></i></s>'; sp.appendChild(f);
  const a = document.createElement('div'); a.id = 'auto'; a.innerHTML = '<i></i><span class="mono">Depot</span>'; document.getElementById('hud').appendChild(a); }
const fuelFill = document.querySelector('#fuel i'), autoEl = document.getElementById('auto');
let autopilot = false;
let scan, story = null;
{ const a = document.createElement('div'); a.id = 'scan'; a.innerHTML = '<i></i><span class="mono">Scan</span>'; document.getElementById('hud').appendChild(a);
  const go = () => { if (!eva.active && !menu.open) scan.fire(); };
  addEventListener('keydown', (e) => { if (e.code === 'KeyC' && !e.repeat) go(); }); a.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); go(); }); window.__scanChip = a; }
function setAuto(v) { autopilot = v && !eva.active && !respawnT; autoEl.classList.toggle('on', autopilot); }
addEventListener('keydown', (e) => { if (e.code === 'KeyN' && !e.repeat && !menu.open) setAuto(!autopilot); });
autoEl.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); setAuto(!autopilot); });
const _ap = new THREE.Vector3(), _apQ = new THREE.Quaternion();
// straight-line approach to the depot dock: turn toward it, burn, brake to a stop; any stick input hands control back
function autoCmd(cmd) {
  const d = _ap.copy(depot.dockPt).sub(ship.pos), dist = d.length();
  if (cmd.fwd || cmd.strafe || cmd.vert || Math.abs(cmd.dx) > 2 || Math.abs(cmd.dy) > 2 || cmd.yawKey || cmd.pitchKey || cmd.brake || eva.active || respawnT) { setAuto(false); return; }
  if (dist < depot.dockR * 0.7 && ship.vel.length() < 3) { setAuto(false); return; }
  d.normalize(); _apQ.copy(ship.quat).invert(); const l = d.clone().applyQuaternion(_apQ);
  const ey = Math.atan2(l.x, -l.z), ex = Math.atan2(l.y, Math.hypot(l.x, l.z));
  const cl = (v, m) => Math.max(-m, Math.min(m, v)), w = ship.angVel, G = 0.0105;
  cmd.dx = (w.y + cl(ey * 2, 1.4)) / G; cmd.dy = (w.x - cl(ex * 2, 1.4)) / G;
  const align = Math.abs(ey) < 0.3 && Math.abs(ex) < 0.3, vr = ship.vel.dot(d), vDes = Math.min(75, Math.max(dist > depot.dockR * 0.6 ? 5 : 0, Math.sqrt(2 * 9 * Math.max(0, dist - depot.dockR * 0.5))));
  if (align && vr < vDes - 2) cmd.fwd = 1; else if (vr > vDes + 4) cmd.brake = true;
}
const settings = new Settings();
const sound = new Sound(settings.get('volume'));
input.onGrab = () => { if (!eva.active) salvage.grab(); };
let depotFlash = 0;

world.onSiteEvent = (e, site) => {
  const d = site.pos.distanceTo(ship.pos);
  if (e === 'unstable') { rig.kick(d < 400 ? 0.4 : 0.05); if (d < 400) cockpit.alert(0.6); }
  if (e === 'collapse') {
    shock(site); if (d < 1500) sound.boom();
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
// reactor blast: a shell like a collapse, a flash, and real damage to anything close
function blast(p) {
  shockMesh.position.copy(p); shockT = 0; shockMesh.visible = true;
  fx.emit(p, _b.set(0, 0, 0), fxT, 0.6, 0.8, 90, K.FLASH, 1);
  for (let i = 0; i < 6; i++) sparks({ point: p, normal: _a.set(R() - 0.5, R() - 0.5, R() - 0.5).normalize(), speed: 30 }, 60);
  const d = p.distanceTo(eva.state === 'eva' ? eva.pilot.pos : ship.pos); sound.boom();
  const near = 1 - THREE.MathUtils.clamp((d - 15) / 170, 0, 1);
  if (near > 0) {
    rig.kick(Math.min(1, near * 1.5)); hud.pulse(0.5 * near); cockpit.alert(1);
    const dmg = 0.75 * near * near * (ship.armor ?? 1);
    ship.hull = Math.max(0, ship.hull - dmg); damage.add(_c.copy(ship.pos).add(_a.copy(p).sub(ship.pos).setLength(4)), ship, dmg);
    if (near > 0.35) systems.break(['engines', 'rcs', 'scanner', 'winch'][(R() * 4) | 0]);
    ship.vel.addScaledVector(_c.copy(ship.pos).sub(p).normalize(), 30 * near);
    ship.angVel.add(_c.set(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(4 * near));
    if (eva.state === 'eva') eva.o2 = Math.max(0, eva.o2 - 0.5 * near);
    if (ship.hull <= 0 && !respawnT) { respawnT = 1.6; salvage.releaseAll(); }
  }
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
let fxT = 0, boostSm = 0, heat = 0, hullHeat = 0, offT = 1, onT = 0, wasBoost = false, gx = 0, gy = 0, gr = 0, flashL = 0;
// ---- EVA: bolted lockers on the wrecks, hull damage on the ship, the pilot outside ------------
const lockers = new Lockers(scene, world, { coarse });
const damage = new HullDamage(shipMesh, shipModel);
const eva = new Eva({ scene, camera, world, ship, shipMesh, cockpit, input, fx, rig, coarse, reduced, lockers, damage, env: scene.environment, sunDir: SUN_DIR, hud,
  onStow: (L) => { econ.bonus(L.value); career.onLocker(L.value); nav.pop(L.value); } });
eva.getFxT = () => fxT;
const breakup = new Breakup({ scene, world, salvage, ship, fx, getFxT: () => fxT });
eva.pickers = [breakup];
breakup.onAim = (s) => tips.show(s.kind === 'strut' ? 'seam' : 'reactor');
breakup.onEvent = (e, x) => {
  if (e === 'strut') { const left = x.seams.filter((s) => !s.cut).length; toast('info', `${x.S.label}: ${left} strut${left > 1 ? 's' : ''} left`); }
  if (e === 'section') { econ.stats.sections++; econ.save(); toast('info', `${x.S.label} cut free · ${x.S.value}`); sound.snap(); rig.kick(0.2); story?.onSection(x); }
  if (e === 'core-free') { toast('info', 'Reactor unclamped safely'); sound.chime(false); story?.onCoreFree(); }
  if (e === 'meltdown') { toast('warn', 'Reactor meltdown'); tips.show('meltdown', true); sound.warn(); cockpit.alert(1); }
};
breakup.onBlast = (p) => blast(p);
const systems = new Systems({ ship, damage, econ, fx, getFxT: () => fxT });
damage.onClear = () => { systems.spots = {}; };
systems.onBreak = (k) => { sound.warn(); cockpit.alert(1); toast('warn', SYS[k].name + ' damaged'); tips.show('broken'); };
systems.onFix = (k, welded) => { toast('fix', SYS[k].name + (welded ? ' welded' : ' repaired')); sound.chime(false); };
eva.onFaint = () => { const fee = Math.min(econ.credits, 150); if (fee) { econ.credits -= fee; econ.save(); } toast('warn', fee ? `Out of air · rescue fee ${fee}` : 'Out of air'); };
const relay = world.site.relay.relay; Object.assign(relay, { fx, sound, getFxT: () => fxT, evaRef: eva, sunDir: SUN_DIR }); eva.relay = relay;
fleet.init({ scene, camera, ship, shipMesh, eva, cockpit, input, rig, econ, fx, sound, toast, nav, hud, reduced, depot, getFxT: () => fxT, onSparks: (h, n) => sparks(h, n), onJetHit: (h) => onShipHit(h, 40) });
scan = new DeepScan({ scene, world, salvage, ship, sound, fx, getFxT: () => fxT });
const drones = new Drones({ scene, world, salvage, ship, fx, getFxT: () => fxT, onTheft: (d) => { if (d.pos.distanceTo(ship.pos) < 500) toast('drone', 'Drone took loose cargo'); }, onLost: (d, it) => { if (it.wasMine) toast('warn', 'Cargo lost to a drone'); },
  onEvent: (e, d) => {
    if (e === 'chase') { tips.show('drone'); toast('drone', 'Drone after your cargo'); sound.warn(); }
    if (e === 'latch') { tips.show('latched'); sound.warn(); cockpit.alert(0.4); }
    if (e === 'cut') toast('warn', 'Drone cut your line');
    if (e === 'kill') { econ.stats.drones++; econ.bonus(90); nav.pop(90); sound.boom(); rig.kick(0.25); hud.pulse(0.15); toast('drone', 'Drone wrecked +90'); story?.onDrone(); }
    if (e === 'bump') { sound.hit(d); rig.kick(0.12); }
    if (e === 'jam') { sound.tonePing(180, 0.8, 0.2, 'sawtooth', 2); rig.kick(0.05); if (d) toast('drone', d > 1 ? `${d} drones jammed` : 'Drone jammed'); story?.onJam(d); }
    if (e === 'nojammer') toast('warn', 'No jammer: buy one at the hangar');
  } });
// J: jam pulse. The chip shows only once you own a jammer.
{ const a = document.createElement('div'); a.id = 'jam'; a.innerHTML = '<i></i><span class="mono">Jam</span>'; document.getElementById('hud').appendChild(a);
  const go = () => { if (!eva.active && !menu.open) drones.jam(); };
  addEventListener('keydown', (e) => { if (e.code === 'KeyJ' && !e.repeat) go(); }); a.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); go(); }); window.__jamChip = a; }
const tutorial = new Tutorial({ scene, ship, salvage, world, econ, input, reduced, eva, lockers, career, nav, scan, relay });
const objective = new Objective({ ship, salvage, world, nav, eva, career, input, tutorial, settings });
const replayTutorial = () => { respawn(true); tutorial.start(); };
if (econ.tut) {
  ship.pos.copy(depot.dockPt); const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), depot.axis.clone().negate(), new THREE.Vector3(0, 1, 0)); ship.quat.setFromRotationMatrix(m);
  if (econ.ship) { ship.hull = Math.max(0.15, econ.ship.hull ?? 1); ship.fuel = econ.ship.fuel ?? 1; ship.setMode(econ.ship.mode || 'damped'); }
}
shipMesh.position.copy(ship.pos); shipMesh.quaternion.copy(ship.quat); shipMesh.updateMatrixWorld(true);
systems.restore(); applyUpgrades();
help.onTutorial = replayTutorial;
if (!econ.tut) setTimeout(() => tutorial.start(), reduced ? 300 : 2600);
const events = new Events({ scene, ship, fx, rig, hud, cockpit, nav, sun, coarse, reduced,
  onHit: (h, m) => onShipHit(h, m),
  onStorm: (clean, kind) => { career.onStorm(clean); if (clean) { econ.bonus(120); nav.pop(120); } toast(kind === 'meteor' ? 'meteor' : 'flare'); } });
events.getFxT = () => fxT;
// toasts: icon + number, one at a time
const toastEl = document.createElement('div'); toastEl.id = 'toast'; document.body.appendChild(toastEl);
let toastT = 0;
const WARN_IC = '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>';
function toast(kind, n) {
  const ic = { job: JOB_ICONS.haul, done: JOB_ICONS.clean, rank: JOB_ICONS.up, fail: JOB_ICONS.quick, meteor: JOB_ICONS.meteor, flare: JOB_ICONS.flare, warn: WARN_IC, fix: UP_ICONS.wrench, info: JOB_ICONS.clean, drone: UP_ICONS.jammer }[kind];
  const txt = kind === 'done' ? '+' + n : kind === 'rank' ? n : kind === 'meteor' || kind === 'flare' ? '+120' : n || '';
  toastEl.innerHTML = `<svg viewBox="0 0 24 24">${ic}</svg>${txt ? `<span>${txt}</span>` : ''}`;
  toastEl.classList.toggle('long', String(txt).length > 8); toastEl.classList.toggle('warn', kind === 'warn');
  toastEl.classList.add('show'); toastT = kind === 'warn' || kind === 'fix' || kind === 'info' ? 3.4 : 2.4;
  if (kind === 'done') sound.chime(false); else if (kind === 'rank') sound.chime(true);
}
career.toast = toast;
events.onWarn = () => sound.warn(); tutorial.onStep = () => sound.step();
const stnEl = document.getElementById('stn'); let stnT = 0, stnM = '';
const tips = new Tips({ econ, settings, isBusy: () => tutorial.on || menu.open || hangar.open || !!document.querySelector('#comms.show')?.getClientRects().length });
const hangar = new Hangar({ econ, systems, sound, onBuy: () => applyUpgrades() });
tutorial.hangar = hangar; hangar.onToggle = (v) => { if (v) tutorial.hangarSeen = true; };
nav.onDock = (v) => { hangar.setDocked(v); if (v) { tips.show('hangar'); tips.show('story'); } };
// a small "Saved" tick whenever progress is written
{ const sv = document.createElement('div'); sv.id = 'saved'; sv.className = 'mono'; sv.textContent = 'Saved'; document.body.appendChild(sv);
  let tm = 0; econ.onSave = () => { sv.classList.add('show'); clearTimeout(tm); tm = setTimeout(() => sv.classList.remove('show'), 1400); }; }
// the ship itself (hull, fuel, flight mode) is saved every few seconds and when the tab closes
const saveShip = () => { econ.ship = { hull: +ship.hull.toFixed(3), fuel: +ship.fuel.toFixed(3), mode: ship.mode }; econ.save(true); };
addEventListener('pagehide', saveShip); addEventListener('visibilitychange', () => { if (document.hidden) saveShip(); });
// EVA suit readout: oxygen and jetpack fuel as words and numbers (the visor has gauges in first person)
const suitEl = document.createElement('div'); suitEl.id = 'suit'; suitEl.innerHTML = '<p><span class="mono">O2</span><b></b><s><i></i></s></p><p><span class="mono">Jet</span><b></b><s><i></i></s></p><em></em>';
document.getElementById('hud').appendChild(suitEl);
const suitB = suitEl.querySelectorAll('b'), suitI = suitEl.querySelectorAll('s i'), suitEm = suitEl.querySelector('em');
let suitLast = '';
function suitHud() {
  const on = eva.state === 'eva'; suitEl.classList.toggle('on', on); if (!on) return;
  tips.show('cutter');
  const o = Math.ceil(eva.o2 * 100), f = Math.ceil(eva.fuel * 100), secs = Math.ceil(eva.o2 * 170 * (ship.o2Cap || 1));
  const k = o + '|' + f; if (k === suitLast) return; suitLast = k;
  suitB[0].textContent = o + '%'; suitB[1].textContent = f + '%'; suitI[0].style.width = o + '%'; suitI[1].style.width = f + '%';
  suitEl.classList.toggle('low', eva.o2 < 0.25 && !eva.safe);
  suitEm.textContent = eva.safe ? 'Breathing station air' : eva.o2 < 0.25 ? `Low oxygen · ${secs}s left` : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} of air`;
  if (eva.o2 < 0.3 && !eva.safe) tips.show('o2');
}
story = new Story({ econ, world, salvage, scene, fx, getFxT: () => fxT, toast, sound, nav });
eva.pickers.push(story);
// EVA waypoint: the story's target, else the nearest seam or clamp on the freighter when you're out there
eva.markTarget = (p) => {
  const t = story.target(p); if (t) return t;
  if (p.distanceTo(breakup.site.pos) > 180) return null;
  let best = null, bd = 1e9; for (const sm of breakup.seams) { if (sm.cut || sm.kind === 'coolant') continue; const w = breakup.where(sm); const d = w.distanceTo(p); if (d < bd) { bd = d; best = w; } }
  return best;
};
scan.onSweep = (o, r) => story.onSweep(o, r);
objective.ext = { systems, breakup, drones, story, SYS };
const menu = new Menu({ settings, career, econ, help, onTutorial: replayTutorial, onReset: () => { econ.reset(); location.reload(); } });
const applySettings = (k) => {
  input.invertY = settings.get('invert'); rig.shakeScale = settings.get('shake');
  if (!k || k === 'quality') quality.setMode(settings.get('quality'));
  if (k === 'fov') resize();
  document.getElementById('hint').style.display = settings.get('hints') ? '' : 'none';
};
settings.onChange = (k) => { if (k === 'volume') sound.setVolume(settings.get('volume')); else applySettings(k); }; menu.onToggle = (o) => sound.setPaused(o); applySettings();

look.composer.insertPass(eva.pass, look.composer.passes.indexOf(cockpit.pass) + 1);
input.onExit = () => { if (!fleet.hatch()) eva.request(); };
{ const xb = document.getElementById('exitbtn'); xb.innerHTML = `<svg viewBox="0 0 24 24">${ICONS.exit}</svg>`;
  xb.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); input.onExit(); }); }
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
  { const sp = Math.min(1, ship.vel.length() / 40), tgt = Math.min(1, boostSm * 0.85 + sp * sp * 0.25); hullHeat += (tgt - hullHeat) * Math.min(1, dt * (tgt > hullHeat ? 0.5 : 0.18)); mats.shipHull.userData.heat.uHeat.value = hullHeat; }
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

let respawnT = 0, saveT = 0;
function onShipHit(hit, otherMass) {
  const s = hit.speed; sound.hit(s);
  sparks(hit, Math.min(40, Math.floor(s * 2.5)));
  if (s > 2) { rig.kick(Math.min(1, s / 28)); hud.pulse(Math.min(0.35, s / 70)); }
  if (s > 4) cockpit.alert(Math.min(1, s / 18));
  // glancing bumps are free; real hits cost hull, scaled by what you hit
  const dmg = Math.max(0, s - 7) * 0.011 * Math.min(2, 0.7 + otherMass * 0.15) * (ship.armor ?? 1);
  if (dmg > 0) { ship.hull = Math.max(0, ship.hull - dmg); damage.add(hit.point, ship, dmg); systems.hit(hit.point, dmg); }
  // knock: a hit tumbles you
  ship.angVel.add(_c.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(Math.min(3, s * 0.12)));
  if (ship.hull <= 0 && !respawnT) { respawnT = 1.6; salvage.releaseAll(); }
}

// back at the start for the tutorial, otherwise towed home to the depot's dock
function respawn(start = false) {
  if (fleet.helm) fleet.leave(); fleet.release(false);
  salvage.releaseAll();
  if (!start) { const fee = Math.min(econ.credits, 200 + systems.cost()); if (fee > 0) { econ.credits -= fee; econ.save(); } toast('warn', `Towed home · fee ${fee}`); }
  systems.repairAll();
  ship.vel.set(0, 0, 0); ship.angVel.set(0, 0, 0); ship.hull = 1; damage.clear(); ship.fuel = 1;
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
  const rawDt = (now - last) / 1000; last = now;
  quality.tick(rawDt);
  const raw0 = input.consume();
  raw0.dx *= settings.get('sens'); raw0.dy *= settings.get('sens');
  if (menu.open) { look.render(time, _sunW.copy(SUN_DIR).multiplyScalar(7000).add(camera.position)); return; }
  // admin console: free cam takes the controls, freeze holds the world still, time scale stretches dt
  const raw = admin.input(raw0);
  if (admin.frozen) { admin.update(rawDt); look.render(time, _sunW.copy(SUN_DIR).multiplyScalar(7000).add(camera.position)); admin.afterRender(rawDt); return; }
  const dt = admin.stepOnce ? 1 / 60 : Math.min(0.05, rawDt) * admin.scale; time += dt;
  const helm = !!fleet.helm, cmd = eva.holdShip || helm || fleet.dock ? (fleet.dock && !helm && !eva.active ? { ...HOLD, brake: false } : HOLD) : raw;
  if (!started && (cmd.fwd || cmd.strafe || cmd.vert || cmd.dx || cmd.dy)) { started = true; hud.hideHint(); }
  if (respawnT > 0) { respawnT -= dt; cmd.fwd = cmd.strafe = cmd.vert = cmd.dx = cmd.dy = 0; hud.pulse(0.02); if (respawnT <= 0) { respawnT = 0; respawn(); } }

  if (autopilot) autoCmd(cmd);
  // boost burns fuel; empty tank, no boost. It trickles back in flight and refills at the dock.
  if (cmd.boost && cmd.fwd > 0 && ship.fuel > 0 && ship.eff.boost) ship.fuel = Math.max(0, ship.fuel - dt * 0.045 / (ship.tank || 1)); else { cmd.boost = false; ship.fuel = Math.min(1, ship.fuel + dt * (nav.docked ? 0.4 : 0.012)); }
  fuelFill.style.width = (ship.fuel * 100).toFixed(0) + '%'; fuelFill.parentNode.classList.toggle('low', ship.fuel < 0.2);
  acc += dt; let first = true, n = 0;
  const maxN = 8 * Math.max(1, Math.ceil(admin.scale));
  while (acc >= STEP && n++ < maxN) {
    ship.step(STEP, first ? cmd : { ...cmd, dx: 0, dy: 0, yawKey: cmd.yawKey, pitchKey: cmd.pitchKey });
    world.update(STEP, ship, fleet.dock ? () => {} : onShipHit);
    salvage.step(STEP, depot);
    acc -= STEP; first = false;
  }
  if (n >= maxN) acc = 0;
  fleet.update(dt, raw, time);

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
  if (!eva.active && !helm) rig.update(dt, ship);
  ship.braking = cmd.brake; cockpit.heat = heat;
  cockpit.update(dt, ship, rig);
  partsFx(dt);
  if (!helm) eva.update(dt, fleet.panelOpen ? HOLD : raw);
  relay.update(dt, time, camera.position, eva, ship);
  if ((stnT -= dt) <= 0) { stnT = 0.2; const m = relay.status(eva, ship, input.touchMode) || fleet.status(input.touchMode); if (m !== stnM) { stnM = m; stnEl.innerHTML = m; stnEl.classList.toggle('on', !!m); } }
  scan.update(dt, time); { const c = window.__scanChip; c.classList.toggle('on', scan.t >= 0); c.classList.toggle('cool', scan.t < 0 && scan.cool > 0); }
  breakup.update(dt, time); story.update(dt, time);
  drones.enabled = econ.tut && !tutorial.on; drones.update(dt, time);
  { const c = window.__jamChip; c.classList.toggle('own', drones.jamLevel > 0); c.classList.toggle('on', drones.jamT >= 0); c.classList.toggle('cool', drones.jamT < 0 && drones.jamCool > 0); c.classList.toggle('alert', !!drones.chasing && drones.jamCool <= 0); }
  world.dust.lines.visible = !eva.safe || eva.state !== 'eva';
  { let rs2 = 0; for (let i = 0; i < rcsSm.length; i++) rs2 += rcsSm[i]; sound.update(dt, { main: helm ? fleet.v.fx.main : ship.fx.main, boost: boostSm, rcs: rs2, strain: salvage.ropes.reduce((m, r) => Math.max(m, r.item.strainVis || 0), 0), eva: eva.active, o2low: eva.o2 < 0.25 }); }
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
  career.update(dt, ship, nav.docked); objective.update(dt);
  systems.update(dt); tips.update(dt); suitHud();
  if ((saveT += dt) > 5) { saveT = 0; saveShip(); }
  events.update(dt, { busy: !econ.tut || tutorial.on || nav.docked || eva.active || helm || !!fleet.dock || respawnT > 0 }, camera, innerWidth, innerHeight);
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.classList.remove('show'); }
  admin.update(rawDt);
  quality.begin();
  look.render(time, _sunW.copy(SUN_DIR).multiplyScalar(7000).add(camera.position));
  quality.end();
  admin.afterRender(rawDt);
}
const admin = new Admin({ ship, econ, fleet, eva, salvage, world, drones, events, story, career, tutorial, systems, settings, menu, nav, look, renderer, quality, scene, camera, cockpit, sun, depot, damage,
  toast, blast, respawn, setAuto, applyUpgrades, replayTutorial, saveShip });
menu.onAdmin = () => admin.toggle(true);
requestAnimationFrame(frame);

window.__game = { admin, fleet, story, breakup, systems, hangar, tips, relay, scan, drones, setAuto, autoCmd, events, career, settings, menu, worldAnim, quality, salvage, econ, nav, tutorial, depot, respawn, impact, ship, world, input, rig, camera, scene, THREE, fx, smoke, haze, shipMesh, look, renderer, cockpit, eva, lockers, damage };
