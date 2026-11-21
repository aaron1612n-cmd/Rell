import * as THREE from 'three';
import { SHIPS, BY_ID, SKIFF, G0, derived, fmtMass, fmtForce, fmtCr } from './fleetData.js';
import fleetData from './assets/fleet.json';
import { NAV_ICONS } from './nav.js';
import { buildIronwake, HELM, BAY_DOCK } from './ironwake.js';
import { addHullDetail } from './hullDetail.js';
import { mats } from './assets.js';
import { ShipHatch, LockDrive } from './shipHatch.js';

// Every other ship in the yard: thirteen hulls you can buy at the shipyard by the depot or find adrift,
// all of them flyable. Each is a world Site (so the jet, debris and the suit collide with it) whose group is
// moved by a Vessel: the flight model in here, driven entirely by the ship's spec in fleetData.js.
//
// Getting aboard: fly your jet slowly onto a ship's docking collar (orange ring with amber lamps on its back)
// and the clamps take it; then G (Hatch on touch) moves you to the helm, and G again brings you back to your
// jet. The Ironwake is boarded on foot: fly into its hangar bay, the cradle clamps the jet, get out and float
// through the airlock, up the lift shaft to the bridge, and take the helm there.
// L (or the ship button) opens the registry: every ship's numbers, buy / sell / claim, and "fly" for ships you
// own that are near the depot.

NAV_ICONS.ship = '<path d="M12 2l3 7v8l-3 3-3-3V9z"/><path d="M9 13l-4 3v2l4-1M15 13l4 3v2l-4-1"/>';
const ICON_SHIPS = '<path d="M12 3l3 7v7l-3 3-3-3v-7z"/><path d="M9 13l-4 3v2l4-1M15 13l4 3v2l-4-1"/>';

// where everything is parked. Ships for sale aren't out in space at all: buy one and it is delivered to its own
// berth in the open space past the depot (scattered, at different heights and headings, never in a row). A later
// hangar can take over delivery by setting fleet.onDeliver(S) -> true. Derelicts are spread out past the wrecks.
const BERTH = {
  wren: { pos: [470, 55, 1000], euler: [0.05, 0.4, 0.04] },
  kite: { pos: [505, 78, 1045], euler: [-0.04, -0.3, -0.06] },
  hornet: { pos: [445, 38, 1070], euler: [0.06, 0.9, 0.08] },
  mule: { pos: [565, 58, 985], euler: [-0.03, 0.2, 0.03] },
  packhorse: { pos: [605, 92, 1085], euler: [0.04, -0.6, -0.04] },
  prospector: { pos: [690, 36, 995], euler: [-0.05, 0.5, 0.05] },
  lance: { pos: [725, 104, 1120], euler: [0.03, -0.2, -0.05] },
  atlas: { pos: [860, 58, 1010], euler: [0.02, 0.35, 0.03] },
};
const ADRIFT = {
  gull: { pos: [-470, 30, -1460], euler: [0.3, 2.2, 0.5] },
  sable: { pos: [-1560, 320, -330], euler: [-0.2, -0.8, 0.25] },
  vigil: { pos: [980, -60, 1960], euler: [0.1, 1.1, -0.2] },
  cinder: { pos: [2180, 70, -360], euler: [0.15, -2.4, 0.6] },
  ironwake: { pos: [2750, 230, 1450], euler: [0.04, -2.25, 0.08] },
};
const CLAIM_R = (s) => 1400 + s.len;            // a find counts as brought home inside this range of the depot
const SAVE = 'rell.fleet';
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _e = new THREE.Euler();
const _x = new THREE.Vector3(1, 0, 0), _y = new THREE.Vector3(0, 1, 0), _z = new THREE.Vector3(0, 0, 1);
const approach = (v, t, s) => (v > t ? Math.max(t, v - s) : Math.min(t, v + s));
const D2R = Math.PI / 180;

// ---- flight ----------------------------------------------------------------------------------------------
// The flight computer holds a set speed along the nose (W/S raise and lower it, X is all stop) and kills drift
// you aren't commanding with the RCS. Turning is rate command: the stick asks for a turn rate up to the ship's
// limit, the attitude system gets there at its angular acceleration, so heavy ships lag and overshoot less.
export class Vessel {
  constructor(spec) {
    this.spec = spec; this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.quat = new THREE.Quaternion();
    this.w = new THREE.Vector3(); this.cw = new THREE.Vector3();    // local rad/s: actual and commanded (x pitch, y yaw, z roll)
    this.set = 0; this.fuel = 1; this.hull = 1; this.boostT = 0;
    this.fx = { main: 0, x: 0, y: 0, z: 0, boost: false }; this.acc = new THREE.Vector3();
    this.mode = 'damped';
  }
  get speed() { return this.vel.length(); }
  forwardSpeed() { _q.copy(this.quat).invert(); return -_v.copy(this.vel).applyQuaternion(_q).z; }
  step(dt, cmd) {
    const s = this.spec, m = s.dry + s.prop * this.fuel, alive = this.hull > 0.02;
    const dry = this.fuel <= 0;
    const boost = cmd.boost && cmd.fwd >= 0 && !dry && alive;
    const aMain = alive && !dry ? s.thrust / m * (boost ? 1.3 : 1) : 0;
    const aRcs = (s.rcs / m) * (dry ? 0.3 : 1) * (alive ? 1 : 0.2), aRev = Math.max(aRcs, aMain * 0.45);
    const maxS = s.maxSpd * (boost ? 1.25 : 1);
    _q.copy(this.quat).invert(); const lv = _v.copy(this.vel).applyQuaternion(_q), l0 = _v2.copy(lv);
    // set speed: the stick moves it about as fast as the ship can follow; brake is all stop
    if (cmd.brake) this.set = 0;
    else this.set = THREE.MathUtils.clamp(this.set + cmd.fwd * Math.max(aMain, 0.6) * 0.9 * dt, -maxS * 0.25, maxS);
    if (!cmd.brake && cmd.fwd > 0 && this.set < -lv.z) this.set = Math.max(this.set, -lv.z);
    const want = -this.set;
    lv.z = approach(lv.z, want, (lv.z > want ? aMain : aRev) * dt);
    const lat = cmd.brake ? aRcs * 1.5 : aRcs;
    lv.x = Math.abs(cmd.strafe) > 0.05 ? lv.x + cmd.strafe * aRcs * dt : approach(lv.x, 0, lat * dt);
    lv.y = Math.abs(cmd.vert) > 0.05 ? lv.y + cmd.vert * aRcs * dt : approach(lv.y, 0, lat * dt);
    const dvx = lv.x - l0.x, dvy = lv.y - l0.y, dvz = lv.z - l0.z;
    this.acc.set(dvx, dvy, dvz).divideScalar(Math.max(dt, 1e-4));
    this.vel.copy(lv).applyQuaternion(this.quat);
    const sp = this.vel.length(); if (sp > maxS * 1.05) this.vel.multiplyScalar(Math.max(maxS / sp, 1 - dt));
    // propellant: mass flow = thrust / (Isp g0), in proportion to the acceleration actually used
    const used = Math.hypot(dvx, dvy, dvz) / Math.max(dt, 1e-4);
    if (s.prop > 0) this.fuel = Math.max(0, this.fuel - used * m / (s.isp * G0 * s.prop) * dt * (boost ? 1.6 : 1));
    this.fx.main = THREE.MathUtils.damp(this.fx.main, -dvz > 1e-5 ? Math.min(1, (-dvz / dt) / Math.max(aMain, 1e-3) * 1.2 + 0.25) * (boost ? 1.25 : 1) : 0, 8, dt);
    this.fx.boost = boost;
    this.pos.addScaledVector(this.vel, dt);
    // attitude
    const rate = s.turn * D2R, acc = s.angAcc * D2R * (alive ? 1 : 0.3) * (dry ? 0.5 : 1), cw = this.cw;
    const g = rate * 0.02;   // ~50 px of mouse asks for the full turn rate
    cw.y = THREE.MathUtils.clamp(cw.y - cmd.dx * g - cmd.yawKey * rate * 3 * dt, -rate, rate);
    cw.x = THREE.MathUtils.clamp(cw.x - cmd.dy * g + cmd.pitchKey * rate * 3 * dt, -rate, rate);
    cw.z = THREE.MathUtils.clamp(cw.z - cmd.roll * rate * 3 * dt, -rate * 1.2, rate * 1.2);
    const decay = Math.exp(-3.2 * dt);
    if (!cmd.dx && !cmd.yawKey) cw.y *= decay; if (!cmd.dy && !cmd.pitchKey) cw.x *= decay; if (!cmd.roll) cw.z *= decay;
    const w = this.w;
    w.x = approach(w.x, cw.x, acc * dt); w.y = approach(w.y, cw.y, acc * dt); w.z = approach(w.z, cw.z, acc * dt);
    const wl = w.length(); if (wl > 1e-6) { _q2.setFromAxisAngle(_v3.copy(w).divideScalar(wl), wl * dt); this.quat.multiply(_q2).normalize(); }
  }
  idle(dt) {
    // nobody aboard: whatever it was doing, the flight computer winds it down to a stop
    this.step(dt, { fwd: 0, strafe: 0, vert: 0, roll: 0, boost: false, brake: true, yawKey: 0, pitchKey: 0, dx: 0, dy: 0 });
  }
}

// ---- the registry in the world ----------------------------------------------------------------------------
export class Fleet {
  constructor(world, model, { Site, Part, coarse }) {
    this.world = world; this.coarse = coarse; this.ships = []; this.byId = {};
    let save = {}; try { save = JSON.parse(localStorage.getItem(SAVE) || '{}') || {}; } catch {}
    this.save0 = save;
    const nodes = {}; model.traverse((o) => { if (o.name && BY_ID[o.name] && !nodes[o.name]) nodes[o.name] = o; });
    // big hulls get a coarser surface-detail tile so the panels read at their scale
    const bigMat = addHullDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.28 }), { scale: 0.03, grime: 1.0, bump: 1.2 });
    const midMat = addHullDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.3 }), { scale: 0.09, grime: 0.8, bump: 1.3 });
    for (const spec of SHIPS) {
      const d = fleetData[spec.id], node = nodes[spec.id]; if (!d || !node) continue;
      spec.len = +(d.max[2] - d.min[2]).toFixed(1); spec.beam = +(d.max[0] - d.min[0]).toFixed(1); spec.height = +(d.max[1] - d.min[1]).toFixed(1);
      const R = Math.hypot(d.max[0] - d.min[0], d.max[1] - d.min[1], d.max[2] - d.min[2]) / 2;
      const st = save[spec.id] || {};
      const home = new THREE.Vector3(), homeQ = new THREE.Quaternion();
      { const a = spec.cat === 'yard' ? BERTH[spec.id] : ADRIFT[spec.id]; home.set(...a.pos); homeQ.setFromEuler(_e.set(...a.euler, 'YXZ')); }
      const site = new Site(world, { id: 'ship-' + spec.id, kind: 'ship', pos: home.toArray(), radius: Math.max(40, R) });
      site.group.quaternion.copy(homeQ); site.group.updateMatrixWorld(true);
      node.removeFromParent(); node.updateMatrix();
      // the .glb is quantized: the node keeps its dequantize offset/scale, so keep that on a child
      const holder = new THREE.Group(); holder.name = spec.id + '-holder'; site.group.add(holder);
      const src = node; holder.add(src);
      src.traverse((o) => { if (o.isMesh) { const mm = Array.isArray(o.material) ? o.material : [o.material]; o.material = mm.map((x) => (x === mats.hull ? (R > 150 ? bigMat : R > 30 ? midMat : mats.hull) : x)); if (o.material.length === 1) o.material = o.material[0]; } });
      site.group.updateMatrixWorld(true);
      const part = new Part(site, spec.id, src, d.obbs); part.sync(0); site.parts.push(part); site.byName[spec.id] = part;
      const V = new Vessel(spec); V.pos.copy(st.pos ? _v.fromArray(st.pos) : home); V.quat.copy(st.quat ? _q.fromArray(st.quat) : homeQ);
      V.fuel = st.fuel ?? 1; V.hull = st.hull ?? (spec.id === 'cinder' ? 0.55 : spec.cat === 'derelict' ? 0.8 : 1);
      if (spec.id === 'cinder' && st.fuel === undefined) V.fuel = 0.62; if (spec.cat === 'derelict' && st.fuel === undefined && spec.id !== 'cinder') V.fuel = 0.45;
      const S = { spec, site, part, node: src, V, d, R, home, homeQ, owned: !!st.owned, found: spec.cat === 'yard' || !!st.found, sold: !!st.sold,
        unq: part.unq, probes: d.probes.map((p) => ({ l: new THREE.Vector3(p[0], p[1], p[2]), r: p[3] })), glows: [] };
      if (spec.cat === 'yard' && !S.owned) { V.pos.copy(home); V.quat.copy(homeQ); }
      this.place(S, 0);
      if (spec.walk) S.decks = buildIronwake(site, { Part }); else S.air = new ShipHatch(S);
      site.hidden = true;
      // a Site only collides once it's in the world's list (that's what refreshActive walks), so register it
      if (!world.sites.includes(site)) world.sites.push(site);
      world.dirty = true;
      this.ships.push(S); this.byId[spec.id] = S;
      if (S.sold) this.remove(S);
      else if (spec.cat === 'yard' && !S.owned) this.stow(S);
    }
    this.v = null; this.helm = null; this.dock = null; this.view = 0;
  }

  // one ship's frame from its vessel state; colliders follow (with their velocity, so collisions see it move)
  place(S, dt) {
    S.site.group.position.copy(S.V.pos); S.site.group.quaternion.copy(S.V.quat); S.site.group.updateMatrixWorld(true);
    S.part.sync(dt); const dp = S.site.byName.decks; if (dp) dp.sync(dt);
  }
  // a ship still on the market isn't in the world: no model, no colliders, no marker
  stow(S) { S.stowed = true; this.remove(S); }
  deliver(S) {
    S.stowed = false; S.site.group.visible = true;
    if (!this.world.sites.includes(S.site)) this.world.sites.push(S.site);
    if (this.onDeliver?.(S)) { this.world.dirty = true; return; }
    S.V.pos.copy(S.home); S.V.quat.copy(S.homeQ); S.V.vel.set(0, 0, 0); S.V.w.set(0, 0, 0); this.place(S, 0);
    this.world.dirty = true;
  }
  remove(S) {
    S.site.group.visible = false; const i = this.world.sites.indexOf(S.site); if (i >= 0) this.world.sites.splice(i, 1);
    this.world.dirty = true;
  }

  // local (authoring-frame) point of a ship to world
  toWorld(S, l, out) { return out.copy(l).applyQuaternion(S.V.quat).add(S.V.pos); }

  init(o) {
    Object.assign(this, o);   // scene, camera, ship, shipMesh, eva, cockpit, input, rig, econ, fx, sound, toast, nav, hud, coarse, reduced, getFxT, depot
    for (const S of this.ships) if (S.decks) Object.assign(S.decks, { fx: this.fx, sound: this.sound, getFxT: this.getFxT });
    this.eva.habitats = this.ships.filter((S) => S.decks).map((S) => S.decks);
    this.buildFx(); this.buildDom();
    this.saveT = 0; this.dockT = 0; this.fade = 0; this.pending = null;
  }

  // ---- engines: a hot glow in every bell and a plume cone that grows with thrust ----
  buildFx() {
    const tex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,.4)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
    const cone = new THREE.ConeGeometry(1, 1, 18, 1, true); cone.translate(0, -0.5, 0); cone.rotateX(-Math.PI / 2);   // apex at 0, opening toward +z... flipped below
    const plumeMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
      uniforms: { uP: { value: 0 }, uB: { value: 0 } },
      vertexShader: 'varying float vZ; varying vec3 vN, vV; void main(){ vZ = clamp(-position.z, 0., 1.); vec4 w = modelMatrix * vec4(position,1.); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: 'uniform float uP, uB; varying float vZ; varying vec3 vN, vV; void main(){ float f = abs(dot(vN, vV)); f = f * f; float a = (1. - vZ) * (1. - vZ) * f * uP; vec3 c = mix(vec3(1.4,.55,.22), vec3(1.3,1.1,1.6), (1. - vZ) * (.3 + .5 * uB)); gl_FragColor = vec4(c * a * 1.3, 1.); }',
    });
    for (const S of this.ships) {
      for (const n of S.d.nozzles) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(1.6, 0.7, 0.3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 }));
        sp.position.set(...n.p); sp.scale.setScalar(n.r * 2.6); sp.visible = false; S.site.group.add(sp);
        const pm = new THREE.Mesh(cone, plumeMat.clone()); pm.position.set(n.p[0], n.p[1], n.p[2] - n.r * 0.3); pm.rotation.y = Math.PI; pm.visible = false; S.site.group.add(pm);
        S.glows.push({ sp, pm, r: n.r });
      }
    }
  }

  // ---- DOM: helm readout, dock prompt, the registry ----
  buildDom() {
    const css = document.createElement('style'); css.textContent = `
#helm{position:fixed;left:50%;bottom:max(14px,env(safe-area-inset-bottom));transform:translateX(-50%);display:none;align-items:flex-end;gap:22px;padding:10px 18px 10px 14px;background:rgba(7,9,13,.62);border-left:3px solid var(--hazard);color:var(--bone);font:500 11px/1.3 ui-monospace,Menlo,monospace;letter-spacing:.06em;pointer-events:none;z-index:3;max-width:calc(100vw - 32px)}
body.helm #helm{display:flex}
#helm .id b{display:block;font-size:15px;letter-spacing:.08em;text-transform:uppercase;color:var(--hazard)}#helm .id span{color:var(--dim)}
#helm .sp b{font-size:40px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.02em;line-height:.9}#helm .sp span{display:block;color:var(--dim)}
#helm .set{width:120px}#helm .set s{display:block;height:4px;background:rgba(232,224,204,.15);margin:5px 0 3px;position:relative}#helm .set s i{position:absolute;left:0;top:0;bottom:0;background:var(--bone)}#helm .set s u{position:absolute;top:-4px;width:2px;height:12px;background:var(--hazard)}
#helm .gs{display:grid;grid-template-columns:auto auto;gap:1px 10px;font-variant-numeric:tabular-nums}#helm .gs em{font-style:normal;color:var(--dim)}#helm .gs .low{color:var(--hazard)}
#helm .keys{position:absolute;left:0;bottom:calc(100% + 6px);white-space:nowrap;color:var(--dim);font-size:10px;letter-spacing:.1em;text-transform:uppercase}
body.touch #helm{left:max(12px,env(safe-area-inset-left));right:auto;transform:none;bottom:max(10px,env(safe-area-inset-bottom));gap:12px;padding:7px 10px 7px 9px}
body.touch #helm .sp b{font-size:26px}body.touch #helm .set{width:70px}body.touch #helm .keys,body.touch #helm .gs .x{display:none}body.touch #helm .id b{font-size:12px}
body.helm #speed,body.helm #hullwrap,body.helm #reticle,body.helm #pro,body.helm #assist,body.helm #impact,body.helm #auto,body.helm #scan,body.helm #jam,body.helm #suit,body.helm #evaret,body.helm #evause,body.helm #evalbl,body.helm #evamark,body.helm #evahome,body.helm #evabtns,body.helm #hangarbtn{opacity:0!important;pointer-events:none!important}
body.helm.touch #btns{display:grid!important}body.helm #evabtns{display:none!important}
#shipfade{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:6;transition:opacity .35s}
#shipbtn{position:absolute;right:max(16px,env(safe-area-inset-right));top:calc(max(12px,env(safe-area-inset-top)) + 58px);width:40px;height:40px;border-radius:50%;border:1.5px solid rgba(232,224,204,.35);background:rgba(7,9,13,.5);display:grid;place-items:center;cursor:pointer;pointer-events:auto;padding:0}
#shipbtn svg{width:22px;height:22px;stroke:var(--bone);fill:none;stroke-width:1.7;stroke-linejoin:round}
#ships{--plate:#0c1014;--line:rgba(232,224,204,.1);--ink:rgba(232,224,204,.62);position:fixed;inset:0;z-index:7;display:none;color:var(--bone);font:500 12px/1.4 "Bahnschrift","DIN Alternate","Arial Narrow","Roboto Condensed",sans-serif;
  background:#080b0e;background-image:linear-gradient(rgba(120,160,190,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(120,160,190,.045) 1px,transparent 1px);background-size:28px 28px;touch-action:auto;user-select:none}
#ships.open{display:grid;grid-template-rows:auto 1fr}
#ships .bar{display:flex;align-items:center;gap:18px;padding:max(12px,env(safe-area-inset-top)) max(18px,env(safe-area-inset-right)) 12px max(18px,env(safe-area-inset-left));border-bottom:1px solid var(--line);background:rgba(8,11,14,.92)}
#ships .bar h2{margin:0;font-weight:700;font-size:26px;line-height:1;letter-spacing:.06em;text-transform:uppercase}#ships .bar h2 small{display:block;font:500 9px ui-monospace,Menlo,monospace;letter-spacing:.3em;color:var(--dim);margin-bottom:4px}
#ships .tabs{display:flex;gap:2px;background:rgba(232,224,204,.06);padding:2px;border-radius:3px}
#ships .tabs button{all:unset;cursor:pointer;padding:9px 14px;font:600 11px ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);border-radius:2px}
#ships .tabs button.on{background:var(--bone);color:#0b0d10}#ships .tabs button i{font-style:normal;opacity:.6;margin-left:6px}
#ships .cr{margin-left:auto;text-align:right;font:700 20px/1 "Bahnschrift","DIN Alternate","Arial Narrow",sans-serif;font-variant-numeric:tabular-nums}#ships .cr small{display:block;font:500 9px ui-monospace,Menlo,monospace;letter-spacing:.3em;color:var(--dim);margin-bottom:4px}
#ships .x{all:unset;cursor:pointer;width:44px;height:44px;display:grid;place-items:center;border:1px solid rgba(232,224,204,.25);border-radius:50%}#ships .x svg{width:18px;height:18px;stroke:var(--bone);stroke-width:2;fill:none}
#ships .body{display:grid;grid-template-columns:minmax(260px,330px) 1fr;min-height:0}
#ships .list{overflow:auto;border-right:1px solid var(--line);padding:6px 0 max(20px,env(safe-area-inset-bottom));-webkit-overflow-scrolling:touch}
#ships .it{all:unset;box-sizing:border-box;cursor:pointer;display:grid;grid-template-columns:104px 1fr;gap:12px;align-items:center;width:100%;padding:8px 14px 8px max(14px,env(safe-area-inset-left));border-left:3px solid transparent}
#ships .it:hover{background:rgba(232,224,204,.04)}#ships .it.on{border-left-color:var(--hazard);background:rgba(232,224,204,.07)}
#ships .it img,#ships .it .ph{width:104px;height:58px;object-fit:contain;display:block;background:rgba(0,0,0,.25);border:1px solid var(--line)}
#ships .it b{display:block;font-size:17px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;line-height:1}#ships .it span{display:block;color:var(--dim);font-size:11px;margin-top:3px}
#ships .it em{display:inline-block;margin-top:5px;font:600 10px ui-monospace,Menlo,monospace;letter-spacing:.1em;font-style:normal;color:var(--ink)}#ships .it em.own{color:var(--hazard)}
#ships .det{overflow:auto;padding:18px max(22px,env(safe-area-inset-right)) max(28px,env(safe-area-inset-bottom)) 26px;-webkit-overflow-scrolling:touch}
#ships .hero{position:relative;max-width:820px}#ships .hero img{width:100%;max-height:42vh;aspect-ratio:2.2;object-fit:contain;display:block}
#ships .hero .tag{position:absolute;left:0;top:0;font:600 10px ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;padding:4px 8px;background:var(--hazard);color:#0b0d10}
#ships h3{margin:6px 0 2px;font-size:44px;line-height:.95;font-weight:700;letter-spacing:.02em;text-transform:uppercase}
#ships .sub{font:500 11px ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
#ships .note{margin:10px 0 16px;max-width:60ch;font-size:15px;line-height:1.4;color:var(--ink)}
#ships .meters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;max-width:820px;margin-bottom:16px}
#ships .m small{display:block;font:500 9px ui-monospace,Menlo,monospace;letter-spacing:.2em;text-transform:uppercase;color:var(--dim)}#ships .m b{display:block;font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;margin:2px 0 5px}
#ships .m s{display:block;height:3px;background:rgba(232,224,204,.12)}#ships .m s i{display:block;height:100%;background:var(--bone)}
#ships .spec{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:0 22px;max-width:820px;font:500 11px/1.3 ui-monospace,Menlo,monospace}
#ships .spec div{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px dashed var(--line)}#ships .spec dt{color:var(--dim);letter-spacing:.08em;text-transform:uppercase;font-size:9.5px}#ships .spec dd{margin:0;text-align:right}
#ships .act{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:4px 0 20px;max-width:820px}
#ships .act button{all:unset;cursor:pointer;box-sizing:border-box;min-height:46px;padding:0 22px;display:inline-flex;align-items:center;font:700 15px "Bahnschrift","DIN Alternate","Arial Narrow",sans-serif;letter-spacing:.1em;text-transform:uppercase;border:1.5px solid rgba(232,224,204,.35);color:var(--bone)}
#ships .act button.go{background:var(--hazard);border-color:var(--hazard);color:#0b0d10}#ships .act button:disabled{opacity:.35;cursor:default}
#ships .act p{margin:0;color:var(--dim);font-size:13px}
#ships .back{display:none}
#ships .empty{padding:24px;color:var(--dim)}
@media (max-width:760px){#ships .bar{flex-wrap:wrap;gap:10px 14px;padding-bottom:10px}#ships .bar h2{font-size:20px}#ships .tabs{order:3;width:100%}#ships .tabs button{flex:1;text-align:center;padding:10px 4px}#ships .cr{font-size:16px}
  #ships .body{grid-template-columns:1fr}#ships .list{border-right:0}#ships.sel .list{display:none}#ships:not(.sel) .det{display:none}
  #ships .det{padding:10px 16px max(24px,env(safe-area-inset-bottom))}#ships .back{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;min-height:40px;font:600 11px ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
  #ships h3{font-size:32px}#ships .meters{grid-template-columns:repeat(2,minmax(0,1fr))}#ships .act button{flex:1;justify-content:center}}
`; document.head.appendChild(css);
    const el = this.el = document.createElement('div'); el.id = 'helm';
    el.innerHTML = '<div class="keys"></div><div class="id"><b></b><span></span></div><div class="sp"><b>0</b><span>m/s</span></div><div class="set"><span>Set <i class="sv">0</i></span><s><i></i><u></u></s><span class="ac"></span></div><div class="gs"><em>Prop</em><span class="fu"></span><em>Hull</em><span class="hu"></span><em class="x">Δv</em><span class="x dv"></span><em class="x">Mass</em><span class="x ma"></span></div>';
    document.body.appendChild(el);
    this.h = { name: el.querySelector('.id b'), cls: el.querySelector('.id span'), sp: el.querySelector('.sp b'), sv: el.querySelector('.sv'), bar: el.querySelector('.set s i'), mark: el.querySelector('.set s u'), ac: el.querySelector('.ac'), fu: el.querySelector('.fu'), hu: el.querySelector('.hu'), dv: el.querySelector('.dv'), ma: el.querySelector('.ma'), keys: el.querySelector('.keys') };
    const f = this.fadeEl = document.createElement('div'); f.id = 'shipfade'; document.body.appendChild(f);
    const b = document.createElement('button'); b.id = 'shipbtn'; b.setAttribute('aria-label', 'Ships'); b.innerHTML = `<svg viewBox="0 0 24 24">${ICON_SHIPS}</svg>`;
    document.getElementById('hud').appendChild(b);
    b.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); this.togglePanel(); });
    const p = this.panel = document.createElement('div'); p.id = 'ships'; document.body.appendChild(p);
    p.addEventListener('click', (e) => this.onPanel(e));
    // the game's own pointer handlers (look, fire, pointer-lock grab) must never see taps meant for the panel
    for (const t of ['pointerdown', 'pointerup', 'mousedown', 'touchstart']) p.addEventListener(t, (e) => e.stopPropagation());
    this.tab = 'yard';
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyL' && !e.repeat) this.togglePanel();
      if (e.code === 'Escape' && this.panel.classList.contains('open')) { e.stopImmediatePropagation(); this.togglePanel(false); }
    }, true);
  }

  // ---- registry (also the API a hangar / merchant screen can use) ------------------------------------
  state(S) {
    const dd = S.V.pos.distanceTo(this.depot.dockPt);
    return { ...S.spec, owned: S.owned, found: S.found, sold: S.sold, home: dd < CLAIM_R(S.spec), dist: dd, fuel: S.V.fuel, cond: S.V.hull, flying: this.helm === S, docked: this.dock?.S === S,
      sell: S.spec.cat === 'yard' ? Math.round(S.spec.price * 0.6) : S.spec.salvage, ...derived(S.spec, S.V.fuel) };
  }
  list() { return this.ships.map((S) => this.state(S)); }
  saveAll() {
    const o = {};
    for (const S of this.ships) o[S.spec.id] = { owned: S.owned, found: S.found, sold: S.sold, fuel: +S.V.fuel.toFixed(4), hull: +S.V.hull.toFixed(4), pos: S.owned || S.spec.cat !== 'yard' ? S.V.pos.toArray().map((x) => +x.toFixed(2)) : undefined, quat: S.owned || S.spec.cat !== 'yard' ? S.V.quat.toArray().map((x) => +x.toFixed(5)) : undefined };
    try { localStorage.setItem(SAVE, JSON.stringify(o)); } catch {}
  }
  buy(id) {
    const S = this.byId[id]; if (!S || S.spec.cat !== 'yard' || S.owned || S.sold) return false;
    if (this.econ.credits < S.spec.price) { this.toast('warn', 'Not enough credits'); return false; }
    this.econ.credits -= S.spec.price; this.econ.save(); S.owned = true; this.deliver(S); this.saveAll(); this.sound?.chime?.(true); this.toast('info', `${S.spec.name} is yours · waiting at its berth past the depot`); return true;
  }
  sell(id) {
    const S = this.byId[id]; if (!S || S.sold || this.helm === S || this.dock?.S === S) return false;
    if (S.spec.cat === 'yard') {
      if (!S.owned) return false;
      const v = Math.round(S.spec.price * 0.6); this.econ.bonus(v); this.nav.pop(v); S.owned = false;
      S.V.pos.copy(S.home); S.V.quat.copy(S.homeQ); S.V.vel.set(0, 0, 0); S.V.w.set(0, 0, 0); S.V.fuel = 1; S.V.hull = 1; this.place(S, 0); this.stow(S);
    } else {
      if (!S.found || this.state(S).home === false) return false;
      const v = Math.round(S.spec.salvage * (0.5 + 0.5 * S.V.hull)); this.econ.bonus(v); this.nav.pop(v); S.sold = true; S.owned = false; this.remove(S);
    }
    this.econ.save(); this.saveAll(); this.sound?.chime?.(false); this.toast('info', `${S.spec.name} sold`); return true;
  }
  claim(id) {
    const S = this.byId[id]; if (!S || S.spec.cat !== 'derelict' || !S.found || S.owned || S.sold || !this.state(S).home) return false;
    S.owned = true; this.saveAll(); this.sound?.chime?.(true); this.toast('info', `${S.spec.name} registered to you`); return true;
  }
  // from the depot: put the jet on the ship's collar (or in the Ironwake's bay)
  fly(id) {
    const S = this.byId[id]; if (!S || !S.owned || S.sold || this.helm || this.eva.active) return false;
    if (!this.nav.docked) { this.toast('warn', 'Dock at the depot first'); return false; }
    if (!this.state(S).home) { this.toast('warn', `${S.spec.name} is too far from the depot`); return false; }
    this.release(); this.attach(S, true); this.togglePanel(false); return true;
  }

  // ---- docking ----
  dockPose(S, outP, outQ) {
    // collar: the jet sits on it, belly down, nose with the ship. Bay: on the cradle, nose out of the mouth.
    if (S.decks) {
      outP.copy(BAY_DOCK).applyQuaternion(S.V.quat).add(S.V.pos);
      outQ.copy(S.V.quat).multiply(_q2.setFromAxisAngle(_y, -Math.PI / 2));
    } else {
      const a = S.d.anchor.collar; _v3.fromArray(a.p).addScaledVector(_v2.fromArray(a.n), 1.05);
      outP.copy(_v3).applyQuaternion(S.V.quat).add(S.V.pos);
      outQ.copy(S.V.quat);
    }
  }
  attach(S, snap = false) {
    this.dock = { S, t: snap ? 1 : 0, p0: this.ship.pos.clone(), q0: this.ship.quat.clone() };
    this.dockT = 0; this.sound?.hook?.(); this.rig?.kick(0.12);
    if (!S.found) this.discover(S);
  }
  release(push = true) {
    const D = this.dock; if (!D) return;
    this.dock = null;
    if (push) { this.dockPose(D.S, _v, _q); const up = _v2.set(0, 1, 0).applyQuaternion(_q); this.ship.vel.copy(D.S.V.vel).addScaledVector(up, D.S.decks ? 0.6 : 2.2); }
    this.ship.angVel.set(0, 0, 0);
  }
  discover(S) {
    if (S.found) return; S.found = true; this.saveAll();
    this.toast('info', `Found: ${S.spec.name}`); this.sound?.chime?.(true);
  }

  // ---- helm ----
  canHelm() {
    if (this.helm || this.fade) return null;
    if (this.eva.state === 'eva') {
      for (const S of this.ships) if (S.decks && S.decks.here === 9) { const l = S.decks.local(this.eva.pilot.pos, _v); if (l.distanceTo(HELM.board) < 2.2) return S; }
    }
    return null;
  }
  // G / Hatch: take the helm, or leave it. Returns true if it handled the press.
  hatch() {
    if (this.fade) return true;
    if (this.helm) { this.leave(); return true; }
    const A = this.hatchNear(); if (A) { this.board(A, true); return true; }
    const S = this.canHelm(); if (!S) return false;
    const yard = S.spec.cat === 'yard' && !S.owned;
    if (yard) { this.toast('warn', `${S.spec.name}: buy it first (L)`); return true; }
    this.fadeTo(() => this.take(S)); return true;
  }
  fadeTo(fn) { this.fade = 1; this.fadeEl.style.opacity = 1; setTimeout(() => { fn(); this.fadeEl.style.opacity = 0; setTimeout(() => { this.fade = 0; }, 350); }, this.reduced ? 60 : 380); }
  take(S, via = false) {
    this.helm = S; this.v = S.V; this.fromEva = this.eva.state === 'eva'; this.via = via && this.fromEva && !!S.air;
    if (this.via) { this.eva.o2 = 1; this.eva.fuel = 1; }
    S.V.set = Math.max(0, S.V.forwardSpeed());
    document.body.classList.add('helm');
    this.ckTarget = this.cockpit.target; this.cockpit.target = 0; this.cockpit.blend = 0;
    if (this.fromEva) { this.eva.body.visible = false; this.eva.jets.visible = false; this.eva.pass.enabled = false; this.eva.ropeMesh.visible = false; this.eva.beam.visible = false; this.eva.toolLight.intensity = 0; }
    this.camInit = true; this.view = S.decks ? 1 : 0;
    if (S.decks && S.decks.power < 1) { S.decks.restore(); setTimeout(() => this.toast('info', 'Reactor online'), 2500); }
    this.h.name.textContent = S.spec.name; this.h.cls.textContent = S.spec.cls;
    this.h.keys.textContent = 'W/S set speed · mouse steer · Q/E roll · X all stop · Shift boost · V view · G leave helm';
    if (!S.found) this.discover(S);
    this.sound?.chime?.(false);
  }
  leave() {
    const S = this.helm; if (!S) return;
    this.fadeTo(() => {
      this.helm = null; this.v = null; document.body.classList.remove('helm');
      this.camera.near = 0.1; this.camera.updateProjectionMatrix();
      this.cockpit.target = this.ckTarget ?? 0; this.cockpit.blend = this.cockpit.target;
      if (this.fromEva && this.via && S.air?.ok) {
        // out through the hatch it came in by: the door swings open and you rise out of the lock
        const E = this.eva; this.via = false; S.air.world(); S.air.fromLocal3(_v.set(0, -1.3, 0), E.pilot.pos); E.pilot.vel.copy(S.V.vel);
        E.lock = new LockDrive(this, S, 'out'); E.anchorHatch = S.air; E.pilot.quat.copy(E.lock.q.up); E.ropeReset = true; E.tpInit = false;
      } else if (this.fromEva) {
        const p = this.eva.pilot; this.toWorld(S, HELM.board, p.pos); p.vel.copy(S.V.vel); p.quat.copy(S.V.quat);
        this.eva.ropeReset = true;
      } else this.rig.blendFrom(this.camera, 0.01);
      this.saveAll();
    });
  }

  // ---- hatches: boarding on foot ----
  lockedFor(S) { return S.spec.cat === 'yard' && !S.owned; }
  // the ship whose hatch funnel the suit is in (any distance along the axis up to a few metres)
  hatchNear() {
    const E = this.eva; if (E.state !== 'eva' || E.lock || this.helm) return null;
    for (const S of this.ships) if (S.air?.ok && !S.sold && !S.stowed && S.air.inFunnel(E.pilot.pos)) return S;
    return null;
  }
  board(S, byKey = false) {
    const A = S.air, E = this.eva; if (!A?.ok || this.fade || E.lock) return;
    if (this.lockedFor(S)) { if (byKey || (this.lockT || 0) < performance.now() - 2500) { this.lockT = performance.now(); this.toast('warn', `${S.spec.name}: buy it first (L)`); } return; }
    if (A.k < 0.85) { if (byKey) this.toast('info', 'Hatch is opening'); return; }
    E.lock = new LockDrive(this, S, 'in'); E.anchorHatch = A; this.sound?.hook?.();
  }
  // the door has sealed behind you: now take the helm
  finishBoard(S) { this.fadeTo(() => { this.eva.lock = null; this.take(S, true); }); }

  status(touch) {
    if (this.helm) {
      const S = this.helm, st = this.state(S);
      if (S.spec.cat === 'derelict' && !S.owned && st.home) return `<b>${S.spec.name}</b> In range of the depot · claim it or sell it in Ships (L)`;
      return '';
    }
    const dk = this.dock;
    if (dk && dk.t >= 1 && !this.eva.active) {
      if (dk.S.decks) return `<b>${dk.S.spec.name}</b> Clamped in the hangar bay · ${touch ? 'tap Hatch' : 'press G'} to get out and find the bridge · thrust to undock`;
      const yard = dk.S.spec.cat === 'yard' && !dk.S.owned;
      return yard ? `<b>${dk.S.spec.name}</b> For sale · ${fmtCr(dk.S.spec.price)} Cr · buy in Ships (L) · thrust to undock` : `<b>${dk.S.spec.name}</b> Docked · ${touch ? 'tap Hatch' : 'press G'} to get out, then float into its side hatch · thrust to undock`;
    }
    for (const S of this.ships) {
      if (S.decks) { const m = S.decks.status(this.eva, touch, !!(this.eva.state === 'eva' && this.canHelm() === S)); if (m) return m; }
    }
    if (this.eva.state === 'eva' && !this.eva.lock) {
      for (const S of this.ships) {
        if (!S.air?.ok || S.sold || S.stowed || S.air.world().o.distanceTo(this.eva.pilot.pos) > 36 + S.air.rh * 8) continue;
        const near = this.hatchNear() === S;
        if (this.lockedFor(S)) return `<b>${S.spec.name}</b> For sale · ${fmtCr(S.spec.price)} Cr · buy in Ships (L)`;
        return `<b>${S.spec.name}</b> ${near ? (S.air.k > 0.85 ? 'Float in' : 'Hatch opening') : 'Hatch on its starboard flank (lamp on): float into it'}${near ? ` · or ${touch ? 'tap Hatch' : 'press G'}` : ''}`;
      }
    }
    if (this.eva.active) return '';
    const n = this.nearCollar; if (n) {
      const yard = n.S.spec.cat === 'yard' && !n.S.owned;
      if (n.S.decks) return `<b>${n.S.spec.name}</b> Fly into the open hangar bay and settle on the lit cradle`;
      return `<b>${n.S.spec.name}</b> ${yard ? `For sale · ${fmtCr(n.S.spec.price)} Cr · ` : ''}Settle onto the docking collar on its back, slowly`;
    }
    return '';
  }

  // ---- per frame ---------------------------------------------------------------------------------------
  // cmd is the raw input. Runs after the jet's physics: steps every vessel, carries a docked jet, drives the
  // camera at the helm.
  update(dt, cmd, time) {
    const ship = this.ship;
    // vessels: the flown one takes the stick; the rest wind down (and sit still once stopped)
    for (const S of this.ships) {
      if (S.sold || S.stowed) continue;
      const V = S.V, moving = V.vel.lengthSq() > 1e-4 || V.w.lengthSq() > 1e-8;
      if (this.helm === S) { const n = Math.max(1, Math.ceil(dt / (1 / 60))); for (let i = 0; i < n; i++) { V.step(dt / n, i ? { ...cmd, dx: 0, dy: 0 } : cmd); this.collide(S, dt / n); } this.place(S, dt); }
      else if (moving) { V.idle(dt); this.collide(S, dt); this.place(S, dt); if (V.vel.lengthSq() < 1e-4 && V.w.lengthSq() < 1e-8) { V.vel.set(0, 0, 0); V.w.set(0, 0, 0); this.place(S, 0); } }
      // engine glow
      const k = this.helm === S ? Math.max(V.hull > 0.02 && V.fuel > 0 ? 0.14 : 0, V.fx.main) : 0;   // pilot lights idle while someone's at the helm
      for (const g of S.glows) {
        const on = k > 0.02; g.sp.visible = g.pm.visible = on; if (!on) continue;
        const fl = 0.9 + 0.1 * Math.sin(time * 41 + g.r) * Math.sin(time * 13);
        g.sp.material.opacity = Math.min(1, k * 1.2) * fl; g.sp.scale.setScalar(g.r * (2.2 + 1.2 * k));
        g.pm.scale.set(g.r * 0.85, g.r * 0.85, g.r * (2 + 7 * k * (V.fx.boost ? 1.5 : 1)) * fl); g.pm.material.uniforms.uP.value = k * fl; g.pm.material.uniforms.uB.value = V.fx.boost ? 1 : 0;
      }
      // finding: get close enough to make it out
      if (!S.found && ship.pos.distanceTo(V.pos) < Math.max(450, S.spec.len * 1.6)) this.discover(S);
      // nav: yard ships are covered by the depot marker; finds and your own ships away from the yard get one
      S.site.hidden = !S.found || S.sold || (S.spec.cat === 'yard' && (!S.owned || V.pos.distanceTo(S.home) < 60)) || !!this.berthed?.(S) || this.helm === S || this.dock?.S === S;
    }
    // the docked jet rides along
    const D = this.dock;
    if (D) {
      this.dockPose(D.S, _v, _q);
      D.t = Math.min(1, D.t + dt / 1.2); const e = D.t * D.t * (3 - 2 * D.t);
      ship.pos.lerpVectors(D.p0, _v, e); ship.quat.slerpQuaternions(D.q0, _q, e);
      if (D.t >= 1) { ship.pos.copy(_v); ship.quat.copy(_q); }
      ship.vel.copy(D.S.V.vel); ship.angVel.set(0, 0, 0);
      if (D.t < 1) D.p0.addScaledVector(D.S.V.vel, dt);
      this.dockT += dt;
      // thrust to undock (not while someone's at the helm or out on foot)
      if (!this.helm && !this.eva.active && this.dockT > 1.6 && (cmd.fwd > 0.5 || cmd.vert > 0.5 || cmd.fwd < -0.5 || cmd.vert < -0.5)) { this.release(); this.sound?.snap?.(); }
    } else if (!this.helm && !this.eva.active) {
      // capture: slow and close to a collar or the bay cradle
      this.nearCollar = null; let best = 1e9;
      for (const S of this.ships) {
        if (S.sold || S.stowed) continue;
        if (ship.pos.distanceTo(S.V.pos) > S.R + 80) continue;
        this.dockPose(S, _v, _q); const d = ship.pos.distanceTo(_v);
        const rv = _v2.copy(ship.vel).sub(S.V.vel).length();
        if (d < 60 && d < best) { best = d; this.nearCollar = { S, d }; }
        if (d < (S.decks ? 7 : 3.2) && rv < 4.5 && (this.releasedFrom !== S || this.relT > 3)) { this.attach(S); break; }
      }
      this.relT = (this.relT || 0) + dt;
    }
    if (this.lastDock && !this.dock) { this.releasedFrom = this.lastDock; this.relT = 0; }
    this.lastDock = this.dock?.S || null;
    // hatches: open for a suit that drifts near, and take a slow one that floats into the mouth
    for (const S of this.ships) if (S.air?.ok && !S.sold && !S.stowed) S.air.update(dt, this.eva, this.lockedFor(S), this.helm === S || this.eva.lock?.S === S || !!S.air.hold);
    { const E = this.eva; if (!this.fade && !this.helm && E.state === 'eva' && !E.lock) for (const S of this.ships) {
      if (!S.air?.ok || S.sold || S.stowed || !S.air.inFunnel(E.pilot.pos)) continue;
      if (_v.copy(E.pilot.vel).sub(S.V.vel).dot(S.air.n) < -0.12) this.board(S);
    } }
    // decks
    for (const S of this.ships) if (S.decks && !S.sold && !S.stowed) S.decks.update(dt, time, this.camera.position, this.eva);
    if (this.helm) { this.camHelm(dt); this.readout(); if (this.fromEva && !this.via) { this.toWorld(this.helm, HELM.seat, this.eva.pilot.pos); this.eva.pilot.vel.copy(this.helm.V.vel); } }
    // repairs and refuelling for ships near the depot
    for (const S of this.ships) if (!S.sold && S.owned && S.V.pos.distanceTo(this.depot.dockPt) < CLAIM_R(S.spec) * 0.6) { S.V.fuel = Math.min(1, S.V.fuel + dt * 0.02); S.V.hull = Math.min(1, S.V.hull + dt * 0.01); }
    if ((this.saveT += dt) > 6) { this.saveT = 0; if (this.helm || this.dock) this.saveAll(); }
  }

  // probes (spheres along the hull) against everything else: stations, wrecks, other ships, debris, the planet
  collide(S, dt) {
    const V = S.V, w = this.world, R = S.R + 10;
    let hit = null;
    const near = [];
    for (const o of w.obbs) { if (o.part && o.part.site === S.site) continue; if (o.c.distanceToSquared(V.pos) < (R + o.br) * (R + o.br)) near.push(o); }
    const nearS = w.statics.filter((s) => s.pos.distanceToSquared(V.pos) < (R + s.rad) ** 2);
    const nearD = w.debris.filter((d) => d.pos.distanceToSquared(V.pos) < (R + d.radius) ** 2);
    const jet = !this.dock && !this.eva.active ? this.ship : null;
    if (!near.length && !nearS.length && !nearD.length && !jet && V.pos.y > -200) return;
    const m = S.spec.dry + S.spec.prop * V.fuel;
    for (const pr of S.probes) {
      const c = _v.copy(pr.l).applyQuaternion(V.quat).add(V.pos), r = pr.r;
      const push = (n, pen, sv) => {
        if (!(pen > 0) || pen > r * 1.5) return;
        V.pos.addScaledVector(n, pen); c.addScaledVector(n, pen);
        const vn = _v3.copy(V.vel).sub(sv || _v3.set(0, 0, 0)).dot(n);
        if (vn < 0) { V.vel.addScaledVector(n, -1.25 * vn); if (!hit || -vn > hit.speed) hit = { speed: -vn, point: c.clone().addScaledVector(n, -r), normal: n.clone() }; }
      };
      for (const o of near) {
        if (c.distanceToSquared(o.c) > (o.br + r) ** 2) continue;
        const l = _v2.copy(c).sub(o.c).applyQuaternion(o.qi);
        const cx = THREE.MathUtils.clamp(l.x, -o.h.x, o.h.x), cy = THREE.MathUtils.clamp(l.y, -o.h.y, o.h.y), cz = THREE.MathUtils.clamp(l.z, -o.h.z, o.h.z);
        const dx = l.x - cx, dy = l.y - cy, dz = l.z - cz, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r * r || d2 < 1e-10) continue;
        const d = Math.sqrt(d2); const n = new THREE.Vector3(dx / d, dy / d, dz / d).applyQuaternion(o.q);
        push(n, r - d, o.v);
      }
      for (const s of nearS) { const n = _v2.copy(c).sub(s.pos); const d = n.length(); if (d < r + s.rad && d > 1e-6) push(n.divideScalar(d).clone(), r + s.rad - d, s.w); }
      for (const db of nearD) {
        const n = _v2.copy(db.pos).sub(c); const d = n.length(), RR = r + db.radius; if (d >= RR || d < 1e-6) continue;
        n.divideScalar(d); db.pos.addScaledVector(n, RR - d);
        const vn = _v3.copy(db.vel).sub(V.vel).dot(n); if (vn < 0) db.vel.addScaledVector(n, -1.6 * vn);
      }
      if (jet) {
        // the jet: a ship this heavy just shoves it
        const n = _v2.copy(jet.pos).sub(c); const d = n.length(), RR = r + 1.5;
        if (d < RR && d > 1e-6) { n.divideScalar(d); jet.pos.addScaledVector(n, RR - d); const vn = _v3.copy(jet.vel).sub(V.vel).dot(n); if (vn < 0) { jet.vel.addScaledVector(n, -1.4 * vn); if (-vn > 2) this.onJetHit?.({ speed: -vn, point: jet.pos.clone().addScaledVector(n, -1.5), normal: n.clone() }); } }
      }
      if (c.y - r < -280) push(_v2.set(0, 1, 0).clone(), -280 - (c.y - r), null);
    }
    if (hit && hit.speed > 1) {
      const dmg = Math.max(0, hit.speed - 3) * 0.012 * Math.min(1, 300 / Math.max(50, S.spec.hull) * 3);
      V.hull = Math.max(0, V.hull - dmg);
      if (this.helm === S) { this.rig.kick(Math.min(1, hit.speed / 20)); this.hud?.pulse?.(Math.min(0.3, hit.speed / 60)); this.sound?.hit?.(hit.speed); this.onSparks?.(hit, Math.min(40, hit.speed * 3)); }
      if (V.hull <= 0.02 && this.helm === S && !this.dead) { this.dead = true; this.toast('warn', `${S.spec.name}: drives offline`); }
    }
    if (V.hull > 0.05) this.dead = false;
  }

  // chase camera scaled to the ship, or the view from the helm seat (the Ironwake's bridge, a small ship's canopy)
  toggleView() { if (this.helm) this.view = this.view ? 0 : 1; }
  camHelm(dt) {
    const S = this.helm, V = S.V, cam = this.camera;
    if (!this.qs || this.camInit) { this.qs = V.quat.clone(); this.camInit = false; this.cs = null; }
    this.qs.slerp(V.quat, 1 - Math.exp(-(this.reduced ? 10 : 3.5) * dt));
    if (this.view === 1) {
      const eye = S.decks ? HELM.eye : _v2.fromArray(S.d.anchor.eye.p);
      this.toWorld(S, eye, cam.position); cam.quaternion.copy(V.quat); cam.up.set(0, 1, 0).applyQuaternion(V.quat);
      cam.near = 0.05; cam.fov = THREE.MathUtils.damp(cam.fov, this.rig.baseFov, 4, dt);
    } else {
      // pull back by the ship's size so the whole hull sits in frame, from a 1-seat runabout to the 1.1 km Ironwake:
      // the camera trails the stern and looks past the ship's middle toward the bow
      const len = S.spec.len, d = S.d, cz = (d.min[2] + d.max[2]) / 2, cy = (d.min[1] + d.max[1]) / 2;
      const half = Math.tan(THREE.MathUtils.degToRad(this.rig.baseFov / 2)), Rr = S.R;
      const dist = Math.max(14, Rr / half * 1.08) + V.speed * 0.12, hgt = Math.max(4, Rr * 0.42);
      _v.set(0, cy + hgt, cz + dist).applyQuaternion(this.qs).add(V.pos).addScaledVector(V.vel, -0.03);
      cam.position.copy(_v);
      _v2.set(0, 1, 0).applyQuaternion(this.qs); cam.up.copy(_v2);
      _v3.set(0, cy, cz - len * 0.12).applyQuaternion(this.qs).add(V.pos); cam.lookAt(_v3);
      cam.near = Math.max(0.1, dist * 0.004); if (cam.far < dist + Rr * 2.5) cam.far = dist + Rr * 2.5;
      const fov = this.rig.baseFov + (this.reduced ? 0 : Math.min(14, V.speed / S.spec.maxSpd * 14) + (V.fx.boost ? 4 : 0));
      cam.fov = THREE.MathUtils.damp(cam.fov, fov, 3, dt);
      if (this.rig.shake > 0.001) { const s = this.rig.shake * Math.max(0.5, len * 0.01); cam.position.x += (Math.random() - 0.5) * s; cam.position.y += (Math.random() - 0.5) * s; cam.position.z += (Math.random() - 0.5) * s; this.rig.shake *= Math.exp(-5.5 * dt); }
    }
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  }

  readout() {
    const S = this.helm, V = S.V, spec = S.spec, h = this.h, d = derived(spec, V.fuel);
    const fs = V.forwardSpeed();
    h.sp.textContent = Math.round(V.speed); h.sv.textContent = Math.round(V.set);
    h.bar.style.width = Math.max(0, Math.min(100, fs / spec.maxSpd * 100)).toFixed(1) + '%'; h.mark.style.left = Math.max(0, Math.min(100, V.set / spec.maxSpd * 100)).toFixed(1) + '%';
    h.ac.textContent = `${(d.accel / G0).toFixed(2)} g · ${spec.turn}°/s`;
    h.fu.textContent = Math.round(V.fuel * 100) + '%'; h.fu.classList.toggle('low', V.fuel < 0.15);
    h.hu.textContent = Math.round(V.hull * 100) + '%'; h.hu.classList.toggle('low', V.hull < 0.3);
    h.dv.textContent = (spec.isp * G0 * Math.log((spec.dry + spec.prop * V.fuel) / spec.dry) / 1000).toFixed(1) + ' km/s';
    h.ma.textContent = fmtMass(d.mass);
  }

  // ---- the registry panel ----
  togglePanel(v) {
    const open = v ?? !this.panel.classList.contains('open');
    this.panel.classList.toggle('open', open); this.panelOpen = open;
    if (open) {
      const m = this.menu; if (m?.open) m.toggle(false);
      // let go of the mouse without the pause menu taking it for an Esc press and popping over the panel
      if (document.pointerLockElement) { if (m) m.quiet = true; document.exitPointerLock?.(); setTimeout(() => { if (m) m.quiet = false; }, 300); }
      this.render();
    }
  }

  // a small picture of a ship for the registry, drawn once with the game's own renderer and kept
  thumb(S, w = 320, h = 160, dark = false) {
    const key = S.spec.id + (dark ? ':d' : '') + ':' + w;
    this.thumbs ??= {}; if (this.thumbs[key]) return this.thumbs[key];
    const r = this.renderer; if (!r) return '';
    try {
      if (!this.tScene) {
        const sc = this.tScene = new THREE.Scene();
        sc.add(new THREE.HemisphereLight(0xcfd8e6, 0x2a2018, 1.1));
        const k = new THREE.DirectionalLight(0xfff1dc, 3.2); k.position.set(-3, 4, 2); sc.add(k);
        const f = new THREE.DirectionalLight(0x9fc2ff, 0.9); f.position.set(4, -1, -3); sc.add(f);
        this.tCam = new THREE.PerspectiveCamera(26, 2, 0.1, 5000);
        this.tDark = new THREE.MeshBasicMaterial({ color: 0x1c232a });
      }
      const sc = this.tScene, cam = this.tCam, obj = S.node.clone(true);
      const pivot = new THREE.Group(); pivot.add(obj); sc.add(pivot);
      pivot.rotation.set(0, -2.45, 0); pivot.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(pivot), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
      cam.aspect = w / h; const rad = sz.length() / 2;
      const dist = rad / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * 0.6;
      cam.position.copy(c).add(new THREE.Vector3(0, 0.42, 1).normalize().multiplyScalar(dist)); cam.near = dist / 50; cam.far = dist * 4;
      cam.lookAt(c); cam.updateProjectionMatrix();
      sc.overrideMaterial = dark ? this.tDark : null;
      const pr = r.getPixelRatio(), W = Math.round(w), H = Math.round(h);
      const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4, type: THREE.HalfFloatType });
      const prevT = r.getRenderTarget(), prevC = r.getClearColor(new THREE.Color()), prevA = r.getClearAlpha();
      r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(); r.render(sc, cam);
      const px = new Uint16Array(W * H * 4); r.readRenderTargetPixels(rt, 0, 0, W, H, px);
      r.setRenderTarget(prevT); r.setClearColor(prevC, prevA); rt.dispose();
      sc.remove(pivot);
      // half floats, linear: tone map (ACES-ish) and encode to sRGB by hand
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const cx = cv.getContext('2d'), id = cx.createImageData(W, H);
      const f16 = THREE.DataUtils.fromHalfFloat, enc = (x) => { x *= 1.35; x = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14); x = Math.min(1, Math.max(0, x)); return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055); };
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = ((H - 1 - y) * W + x) * 4, o = (y * W + x) * 4;
        id.data[o] = enc(f16(px[i])); id.data[o + 1] = enc(f16(px[i + 1])); id.data[o + 2] = enc(f16(px[i + 2])); id.data[o + 3] = Math.min(255, f16(px[i + 3]) * 255);
      }
      cx.putImageData(id, 0, 0);
      return (this.thumbs[key] = cv.toDataURL('image/png'));
    } catch (e) { console.warn('thumb', e); return ''; }
  }

  render() {
    const all = this.list(), tabs = [['yard', 'Shipyard'], ['derelict', 'Adrift'], ['own', 'Yours']];
    const rowsOf = (t) => t === 'own' ? [{ ...SKIFF, ...derived(SKIFF), skiff: true, owned: true }, ...all.filter((s) => s.owned)] : all.filter((s) => s.cat === t);
    const count = { yard: all.filter((s) => s.cat === 'yard').length, derelict: `${all.filter((s) => s.cat === 'derelict' && s.found).length}/${all.filter((s) => s.cat === 'derelict').length}`, own: all.filter((s) => s.owned).length + 1 };
    const rows = rowsOf(this.tab);
    if (!rows.some((r) => r.id === this.sel)) this.selPicked = false;
    const sel = rows.find((r) => r.id === this.sel) || rows[0];
    this.sel = sel?.id;
    const unk = (s) => s.cat === 'derelict' && !s.found && !s.skiff;
    const img = (s, w, h) => { if (s.skiff) return ''; const S = this.byId[s.id]; const u = S ? this.thumb(S, w, h, unk(s)) : ''; return u ? `<img alt="" src="${u}">` : '<div class="ph"></div>'; };
    const badge = (s) => s.flying ? 'At the helm' : s.docked ? 'Docked' : s.skiff ? 'Your jet' : s.owned ? 'Owned' : s.cat === 'yard' ? `${fmtCr(s.price)} Cr` : unk(s) ? 'Not found' : s.sold ? 'Sold' : 'Found';
    const list = rows.map((s) => `<button class="it ${s.id === this.sel ? 'on' : ''}" data-sel="${s.id}">${s.skiff ? '<div class="ph"></div>' : img(s, 208, 116)}<div><b>${unk(s) ? 'Unknown hull' : s.name}</b><span>${s.cls}</span><em class="${s.owned ? 'own' : ''}">${badge(s)}</em></div></button>`).join('');
    // the four numbers that tell ships apart, scaled against the whole fleet (log, so a tug and a courier both read)
    const ref = [...SHIPS, SKIFF];
    const lg = (v, k) => { const mx = Math.max(...ref.map(k)), mn = Math.min(...ref.map(k)); return Math.max(0.04, (Math.log(v) - Math.log(mn)) / (Math.log(mx) - Math.log(mn) || 1)); };
    let det = '<p class="empty">Nothing here yet.</p>';
    if (sel) {
      const s = sel, u = unk(s), dv = derived(s), acc = s.thrust / (s.dry + s.prop) / G0;
      const meter = (k, v, f) => `<div class="m"><small>${k}</small><b>${v}</b><s><i style="width:${(f * 100).toFixed(0)}%"></i></s></div>`;
      const meters = u ? '' : `<div class="meters">${meter('Accel', acc.toFixed(2) + ' g', lg(acc, (x) => x.thrust / (x.dry + x.prop) / G0))}${meter('Turn', s.turn + '°/s', lg(s.turn, (x) => x.turn))}${meter('Cargo', fmtMass(s.cargo), lg(s.cargo, (x) => x.cargo))}${meter('Δv', dv.dv.toFixed(1) + ' km/s', lg(dv.dv, (x) => derived(x).dv))}</div>`;
      const st = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
      const spec = u ? st('Length', `~${s.len} m`) + st('Class', s.cls) + st('Salvage', `~${fmtCr(s.salvage)} Cr`) : [
        st('Length', `${s.len} m`), st('Beam', `${s.beam} m`), st('Dry mass', fmtMass(s.dry)), st('Propellant', fmtMass(s.prop)), st('Thrust', fmtForce(s.thrust)), st('Isp', `${fmtCr(s.isp)} s`),
        st('RCS', fmtForce(s.rcs)), st('Top speed', `${s.maxSpd} m/s`), st('Hull', `${fmtCr(s.hull)} · ${s.armor} mm`), ...(s.owned && !s.skiff || s.cat === 'derelict' && s.found ? [st('Condition', `${Math.round(s.cond * 100)}% · ${Math.round(s.fuel * 100)}% prop`)] : []),
        st('Crew', `${s.crew} / ${s.berths}`), st('Reactor', s.reactor), st('Drive', s.drive), st('Sensors', `${fmtCr(s.sensors)} km`), st('Built', `${s.built}, ${s.maker}`)].join('');
      let act = '';
      if (s.skiff) act = '<p>Your jet. Always with you.</p>';
      else if (s.cat === 'yard') {
        if (!s.owned) act = `<button class="go" data-a="buy" data-id="${s.id}" ${this.econ.credits < s.price ? 'disabled' : ''}>Buy · ${fmtCr(s.price)} Cr</button><p>${this.econ.credits < s.price ? `Need ${fmtCr(s.price - this.econ.credits)} Cr more` : 'Delivered to a berth by the depot'}</p>`;
        else act = `<button class="go" data-a="fly" data-id="${s.id}">Fly</button><button data-a="sell" data-id="${s.id}">Sell · ${fmtCr(s.sell)} Cr</button>`;
      } else if (u) act = '<p>Somewhere out past the wrecks. Find it to learn more.</p>';
      else if (s.owned) act = `<button class="go" data-a="fly" data-id="${s.id}">Fly</button><button data-a="sell" data-id="${s.id}" ${s.home ? '' : 'disabled'}>Sell · ${fmtCr(s.sell)} Cr</button>`;
      else act = `<button class="go" data-a="claim" data-id="${s.id}" ${s.home ? '' : 'disabled'}>Keep it</button><button data-a="sell" data-id="${s.id}" ${s.home ? '' : 'disabled'}>Sell · ${fmtCr(s.sell)} Cr</button><p>${s.home ? 'At the depot: keep it or sell it' : `Bring it within ${(CLAIM_R(s) / 1000).toFixed(1)} km of the depot (${(s.dist / 1000).toFixed(1)} km now)`}</p>`;
      const tag = s.flying ? 'At the helm' : s.docked ? 'Docked' : s.owned && !s.skiff ? 'Owned' : '';
      det = `<button class="back" data-a="back">‹ All ships</button><div class="hero">${s.skiff ? '' : img(s, 760, 345)}${tag ? `<span class="tag">${tag}</span>` : ''}</div>
        <h3>${u ? 'Unknown hull' : s.name}</h3><div class="sub">${s.cls}${u ? '' : ` · ${s.maker} · ${s.built}`}</div>${u ? '' : `<p class="note">${s.note}</p>`}<div class="act">${act}</div>${meters}<dl class="spec">${spec}</dl>`;
    }
    const X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    this.panel.classList.toggle('sel', !!this.selPicked);
    this.panel.innerHTML = `<div class="bar"><h2><small>Registry</small>Ships</h2><div class="tabs">${tabs.map(([k, n]) => `<button data-tab="${k}" class="${this.tab === k ? 'on' : ''}">${n}<i>${count[k]}</i></button>`).join('')}</div><div class="cr"><small>Credits</small>${fmtCr(this.econ.credits)}</div><button class="x" data-a="close" aria-label="Close">${X}</button></div>
      <div class="body"><div class="list">${list}</div><div class="det">${det}</div></div>`;
  }
  onPanel(e) {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tab) { this.tab = b.dataset.tab; this.sel = null; this.selPicked = false; this.render(); return; }
    if (b.dataset.sel) { this.sel = b.dataset.sel; this.selPicked = true; const sc = this.panel.querySelector('.list')?.scrollTop; this.render(); const l = this.panel.querySelector('.list'); if (l && sc) l.scrollTop = sc; return; }
    const a = b.dataset.a, id = b.dataset.id;
    if (a === 'close') return this.togglePanel(false);
    if (a === 'back') { this.selPicked = false; this.render(); return; }
    if (a === 'buy') this.buy(id); else if (a === 'sell') this.sell(id); else if (a === 'claim') this.claim(id); else if (a === 'fly') this.fly(id);
    if (this.panelOpen) this.render();
  }
}
