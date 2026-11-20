import * as THREE from 'three';
import { SHIPS, BY_ID, SKIFF, G0, derived, fmtMass, fmtForce, fmtCr } from './fleetData.js';
import fleetData from './assets/fleet.json';
import { NAV_ICONS } from './nav.js';
import { buildIronwake, HELM, BAY_DOCK } from './ironwake.js';
import { addHullDetail } from './hullDetail.js';
import { mats } from './assets.js';

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

// where everything is parked. Ships you buy are moored at berths spread round a holding point past the depot
// (each at its own height and heading, not in a row); derelicts are spread out past the wrecks. Ships for sale
// are not in the world at all: you buy them from the Ships panel and they turn up at their berth.
const YARD = { origin: new THREE.Vector3(560, 70, 1160), depot: new THREE.Vector3(250, 40, 820) };
function berth(i, R, out, outQ) {
  const a = -0.9 + i * 0.66, r = 150 + R * 1.1 + (i % 2) * 40;
  out.set(YARD.origin.x + Math.cos(a) * r, YARD.origin.y + ((i * 37) % 5 - 2) * 18, YARD.origin.z + Math.sin(a) * r);
  for (let k = 0; k < 8 && out.distanceTo(YARD.depot) < 230 + R; k++) out.addScaledVector(_v3.copy(out).sub(YARD.depot).setY(0).normalize(), 60);
  outQ.setFromEuler(_e.set(((i * 13) % 7 - 3) * 0.03, a + Math.PI / 2 + ((i * 7) % 5 - 2) * 0.12, ((i * 11) % 5 - 2) * 0.04, 'YXZ'));
}
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
    let yi = 0;
    // big hulls get a coarser surface-detail tile so the panels read at their scale
    const bigMat = addHullDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.28 }), { scale: 0.03, grime: 1.0, bump: 1.2 });
    const midMat = addHullDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.3 }), { scale: 0.09, grime: 0.8, bump: 1.3 });
    for (const spec of SHIPS) {
      const d = fleetData[spec.id], node = nodes[spec.id]; if (!d || !node) continue;
      spec.len = +(d.max[2] - d.min[2]).toFixed(1); spec.beam = +(d.max[0] - d.min[0]).toFixed(1); spec.height = +(d.max[1] - d.min[1]).toFixed(1);
      const R = Math.hypot(d.max[0] - d.min[0], d.max[1] - d.min[1], d.max[2] - d.min[2]) / 2;
      const st = save[spec.id] || {};
      const home = new THREE.Vector3(), homeQ = new THREE.Quaternion();
      if (spec.cat === 'yard') {
        berth(yi++, R, home, homeQ);
      } else { const a = ADRIFT[spec.id]; home.set(...a.pos); homeQ.setFromEuler(_e.set(...a.euler, 'YXZ')); }
      const site = new Site(world, { id: 'ship-' + spec.id, kind: 'ship', pos: home.toArray(), radius: Math.max(40, R) });
      site.group.quaternion.copy(homeQ); site.group.updateMatrixWorld(true);
      node.removeFromParent(); node.position.set(0, 0, 0); node.updateMatrix();
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
      if (spec.walk) S.decks = buildIronwake(site, { Part });
      site.hidden = true;
      this.ships.push(S); this.byId[spec.id] = S;
      // in the world (drawn, colliding, on the nav) unless it's still for sale or was sold
      this.show(S, !S.sold && (spec.cat !== 'yard' || S.owned));
    }
    this.v = null; this.helm = null; this.dock = null; this.view = 0;
  }

  // one ship's frame from its vessel state; colliders follow (with their velocity, so collisions see it move)
  place(S, dt) {
    S.site.group.position.copy(S.V.pos); S.site.group.quaternion.copy(S.V.quat); S.site.group.updateMatrixWorld(true);
    S.part.sync(dt); const dp = S.site.byName.decks; if (dp) dp.sync(dt);
  }
  remove(S) { this.show(S, false); }
  show(S, on) {
    S.site.group.visible = on; S.inWorld = on;
    const i = this.world.sites.indexOf(S.site);
    if (on && i < 0) this.world.sites.push(S.site); else if (!on && i >= 0) this.world.sites.splice(i, 1);
    S.site.active = false; this.world.dirty = true;
    if (!on) S.site.hidden = true; else this.nav?.ensure?.(S.site);
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
#ships{position:fixed;inset:0;z-index:7;display:none;color:var(--bone);font:500 12px/1.4 ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  background:radial-gradient(120% 90% at 78% 30%,rgba(255,90,31,.07),transparent 60%),linear-gradient(rgba(232,224,204,.035) 1px,transparent 1px) 0 0/100% 32px,#0a0b0e;touch-action:pan-y;user-select:none}
#ships.open{display:grid;grid-template-rows:auto 1fr}
#ships .hd{display:flex;align-items:center;gap:14px;padding:max(12px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) 12px max(16px,env(safe-area-inset-left));border-bottom:1px solid rgba(232,224,204,.14);position:relative}
#ships .hd::before{content:"";position:absolute;left:0;right:0;top:0;height:4px;background:repeating-linear-gradient(-45deg,var(--hazard) 0 10px,#0a0b0e 10px 20px);opacity:.85}
#ships .ttl{font:700 26px/1 "Bahnschrift","DIN Alternate","Arial Narrow","Roboto Condensed",sans-serif;letter-spacing:.04em;text-transform:uppercase}
#ships .tabs{display:flex;border:1.5px solid rgba(232,224,204,.25)}
#ships .tabs button{border:0;border-right:1.5px solid rgba(232,224,204,.25);background:none;color:var(--dim);font:600 11px ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;padding:9px 12px;cursor:pointer;min-height:38px}
#ships .tabs button:last-child{border-right:0}#ships .tabs button.on{background:var(--bone);color:#0a0b0e}
#ships .cr{margin-left:auto;font:700 18px/1 "Bahnschrift","DIN Alternate","Arial Narrow",sans-serif;letter-spacing:.02em;font-variant-numeric:tabular-nums}#ships .cr small{font:600 9px ui-monospace,monospace;letter-spacing:.16em;color:var(--dim);margin-left:5px}
#ships .x{width:40px;height:40px;border:1.5px solid rgba(232,224,204,.35);background:none;color:var(--bone);font:400 22px/1 sans-serif;cursor:pointer;border-radius:50%;flex:none}
#ships .bd{display:grid;grid-template-columns:minmax(230px,300px) 1fr;min-height:0}
#ships .ls{overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:10px 0 30px;border-right:1px solid rgba(232,224,204,.1)}
#ships .cd{display:grid;grid-template-columns:96px 1fr;gap:2px 12px;align-items:center;width:100%;padding:8px 14px 8px 12px;border:0;border-left:3px solid transparent;background:none;color:inherit;text-align:left;cursor:pointer;font:inherit}
#ships .cd:hover{background:rgba(232,224,204,.04)}#ships .cd.on{border-left-color:var(--hazard);background:linear-gradient(90deg,rgba(255,90,31,.12),transparent)}
#ships .cd img,#ships .cd .ph{grid-row:span 3;width:96px;height:54px;object-fit:cover;background:#121419;display:block}
#ships .cd b{font:700 15px/1.1 "Bahnschrift","DIN Alternate","Arial Narrow",sans-serif;letter-spacing:.03em;text-transform:uppercase}
#ships .cd small{font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim)}
#ships .cd em{font-style:normal;font-size:10.5px;color:var(--bone);font-variant-numeric:tabular-nums}#ships .cd em.own{color:var(--hazard)}
#ships .cd.unk b,#ships .cd.unk img{opacity:.4;filter:grayscale(1) brightness(.4)}
#ships .dt{overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:18px clamp(16px,3vw,36px) 40px;display:grid;grid-template-columns:minmax(0,1.35fr) minmax(220px,1fr);gap:8px 28px;align-content:start}
#ships .hero{grid-column:1/-1;position:relative;height:clamp(170px,38vh,400px);background:#0d0f13;overflow:hidden;border:1px solid rgba(232,224,204,.1)}
#ships .hero.noimg{height:110px}#ships .hero img{width:100%;height:100%;object-fit:cover;display:block}
#ships .hero .nm{position:absolute;left:16px;bottom:12px;font:700 clamp(30px,5vw,58px)/.9 "Bahnschrift","DIN Alternate","Arial Narrow",sans-serif;text-transform:uppercase;letter-spacing:.01em;text-shadow:0 2px 18px #000}
#ships .hero .stg{position:absolute;right:12px;top:12px;white-space:nowrap;font-size:10px;letter-spacing:.16em;text-transform:uppercase;padding:4px 8px;background:var(--hazard);color:#0a0b0e;font-weight:700}
#ships .hero .stg.dim{background:rgba(232,224,204,.85)}
#ships .meta{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin:6px 0 0}
#ships .note{font:400 15px/1.45 "Bahnschrift","DIN Alternate","Arial Narrow",sans-serif;color:rgba(232,224,204,.86);margin:8px 0 0;max-width:46ch}
#ships .bars{display:grid;gap:9px;margin-top:12px}
#ships .bar{display:grid;grid-template-columns:72px 1fr 78px;gap:10px;align-items:center;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim)}
#ships .bar s{height:6px;background:rgba(232,224,204,.1);position:relative;display:block}#ships .bar s i{position:absolute;left:0;top:0;bottom:0;background:var(--bone)}
#ships .bar s i.hi{background:var(--hazard)}#ships .bar span{color:var(--bone);text-align:right;font-variant-numeric:tabular-nums;letter-spacing:.04em}
#ships .spec{display:grid;grid-template-columns:auto 1fr;gap:5px 14px;margin:18px 0 0;font-size:11px}#ships .spec dt{color:var(--dim);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;padding-top:1px}#ships .spec dd{margin:0}
#ships .act{display:flex;flex-direction:column;gap:8px;margin-top:16px}
#ships .act button{min-height:48px;font:700 16px/1 "Bahnschrift","DIN Alternate","Arial Narrow",sans-serif;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;border:1.5px solid rgba(232,224,204,.4);background:none;color:var(--bone);clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%)}
#ships .act button.go{background:var(--hazard);border-color:var(--hazard);color:#0a0b0e}
#ships .act button:disabled{opacity:.35;cursor:default}
#ships .act p{margin:0;font-size:10.5px;color:var(--dim);letter-spacing:.04em}
#ships .act button:focus-visible,#ships .cd:focus-visible,#ships .tabs button:focus-visible,#ships .x:focus-visible{outline:2px solid var(--hazard);outline-offset:2px}
@media (max-width:760px){
  #ships .hd{flex-wrap:wrap;gap:10px}#ships .ttl{font-size:21px}#ships .tabs{order:3;width:100%}#ships .tabs button{flex:1;padding:9px 4px;font-size:10px;letter-spacing:.06em}
  #ships .bd{grid-template-columns:1fr;grid-template-rows:auto 1fr}
  #ships .ls{display:flex;overflow-x:auto;overflow-y:hidden;padding:8px 8px 6px;border-right:0;border-bottom:1px solid rgba(232,224,204,.1);gap:6px;touch-action:pan-x}
  #ships .cd{grid-template-columns:1fr;width:118px;flex:none;padding:6px;border-left:0;border-bottom:3px solid transparent}#ships .cd.on{border-bottom-color:var(--hazard)}
  #ships .cd img,#ships .cd .ph{width:106px;height:60px;grid-row:auto}#ships .cd b{font-size:13px}#ships .cd small{display:none}
  #ships .dt{grid-template-columns:1fr;padding:12px 14px calc(30px + env(safe-area-inset-bottom))}
  #ships .hero{height:clamp(150px,50vw,260px)}#ships .hero.noimg{height:84px}
}
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
    this.econ.credits -= S.spec.price; this.econ.save(); S.owned = true;
    S.V.pos.copy(S.home); S.V.quat.copy(S.homeQ); S.V.vel.set(0, 0, 0); S.V.w.set(0, 0, 0); S.V.fuel = 1; S.V.hull = 1; this.place(S, 0); this.show(S, true);
    this.saveAll(); this.sound?.chime?.(true); this.toast('info', `${S.spec.name} is yours: moored at its berth past the depot`); return true;
  }
  sell(id) {
    const S = this.byId[id]; if (!S || S.sold || this.helm === S || this.dock?.S === S) return false;
    if (S.spec.cat === 'yard') {
      if (!S.owned) return false;
      const v = Math.round(S.spec.price * 0.6); this.econ.bonus(v); this.nav.pop(v); S.owned = false;
      S.V.pos.copy(S.home); S.V.quat.copy(S.homeQ); S.V.vel.set(0, 0, 0); S.V.w.set(0, 0, 0); S.V.fuel = 1; S.V.hull = 1; this.place(S, 0); this.show(S, false);
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
    if (this.dock && this.dock.t >= 1 && !this.dock.S.decks && !this.eva.active) return this.dock.S;
    if (this.eva.state === 'eva') {
      for (const S of this.ships) if (S.decks && S.decks.here === 9) { const l = S.decks.local(this.eva.pilot.pos, _v); if (l.distanceTo(HELM.board) < 2.2) return S; }
    }
    return null;
  }
  // G / Hatch: take the helm, or leave it. Returns true if it handled the press.
  hatch() {
    if (this.fade) return true;
    if (this.helm) { this.leave(); return true; }
    const S = this.canHelm(); if (!S) return false;
    const yard = S.spec.cat === 'yard' && !S.owned;
    if (yard) { this.toast('warn', `${S.spec.name}: buy it first (L)`); return true; }
    this.fadeTo(() => this.take(S)); return true;
  }
  fadeTo(fn) { this.fade = 1; this.fadeEl.style.opacity = 1; setTimeout(() => { fn(); this.fadeEl.style.opacity = 0; setTimeout(() => { this.fade = 0; }, 350); }, this.reduced ? 60 : 380); }
  take(S) {
    this.helm = S; this.v = S.V; this.fromEva = this.eva.state === 'eva';
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
      if (this.fromEva) {
        const p = this.eva.pilot; this.toWorld(S, HELM.board, p.pos); p.vel.copy(S.V.vel); p.quat.copy(S.V.quat);
        this.eva.ropeReset = true;
      } else this.rig.blendFrom(this.camera, 0.01);
      this.saveAll();
    });
  }

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
      return yard ? `<b>${dk.S.spec.name}</b> For sale · ${fmtCr(dk.S.spec.price)} Cr · buy in Ships (L) · thrust to undock` : `<b>${dk.S.spec.name}</b> Docked · ${touch ? 'tap Hatch' : 'press G'} to take the helm · thrust to undock`;
    }
    for (const S of this.ships) {
      if (S.decks) { const m = S.decks.status(this.eva, touch, !!(this.eva.state === 'eva' && this.canHelm() === S)); if (m) return m; }
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
      if (S.owned && !S.sold && !S.inWorld) { if (S.spec.cat === 'yard' && S.V.pos.distanceToSquared(S.home) < 1) this.place(S, 0); this.show(S, true); }   // owned some other way (admin, a save)
      if (S.sold || !S.inWorld) continue;
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
      S.site.hidden = !S.found || S.sold || this.helm === S || this.dock?.S === S;
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
        if (S.sold || !S.inWorld) continue;
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
    // decks
    for (const S of this.ships) if (S.decks && !S.sold) S.decks.update(dt, time, this.camera.position, this.eva);
    if (this.helm) { this.camHelm(dt); this.readout(); if (this.fromEva) { this.toWorld(this.helm, HELM.seat, this.eva.pilot.pos); this.eva.pilot.vel.copy(this.helm.V.vel); } }
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
      const len = S.spec.len, big = len > 300, dist = (big ? len * 0.62 : Math.max(14, len * 1.35)) + V.speed * 0.12, hgt = Math.max(4, len * (big ? 0.2 : 0.32));
      _v.set(0, hgt, dist).applyQuaternion(this.qs).add(V.pos).addScaledVector(V.vel, -0.03);
      cam.position.copy(_v);
      _v2.set(0, 1, 0).applyQuaternion(this.qs); cam.up.copy(_v2);
      _v3.set(0, 0, -len * 0.6).applyQuaternion(this.qs).add(V.pos); cam.lookAt(_v3);
      cam.near = Math.max(0.1, dist * 0.004);
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
    document.body.classList.toggle('shipsopen', open);
    if (open) {
      this.render();
      if (document.pointerLockElement) { if (this.menu) { this.menu.quiet = true; setTimeout(() => { this.menu.quiet = false; }, 300); } document.exitPointerLock?.(); }
    }
  }
  // pictures of every ship, rendered once from the real models (an offscreen renderer, then thrown away)
  thumbs() {
    if (this.thumb) return this.thumb;
    this.thumb = {};
    try {
      const W = 480, H = 270, c = document.createElement('canvas'); c.width = W; c.height = H;
      const r = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'low-power' });
      r.setPixelRatio(1); r.setSize(W, H, false); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
      const sc = new THREE.Scene(); sc.background = new THREE.Color(0x0d0f13);
      sc.add(new THREE.HemisphereLight(0xc8d4e8, 0x2a2420, 1.1));
      const key = new THREE.DirectionalLight(0xfff2dc, 3.2); key.position.set(0.6, 0.7, -0.5); sc.add(key);
      const rim = new THREE.DirectionalLight(0xff8a50, 1.2); rim.position.set(-0.7, 0.2, 0.8); sc.add(rim);
      const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 50000);
      for (const S of this.ships) {
        const d = S.d, mn = new THREE.Vector3(...d.min), mx = new THREE.Vector3(...d.max), ctr = mn.clone().add(mx).multiplyScalar(0.5), L = mx.clone().sub(mn).length();
        const o = S.node.clone(); const g = new THREE.Group(); g.add(o); o.position.copy(S.node.position); o.quaternion.copy(S.node.quaternion); o.scale.copy(S.node.scale);
        sc.add(g); g.updateMatrixWorld(true);
        const dir = new THREE.Vector3(0.78, 0.36, -0.52).normalize();
        cam.position.copy(ctr).addScaledVector(dir, L * 1.02); cam.near = L * 0.01; cam.far = L * 6; cam.lookAt(ctr); cam.updateProjectionMatrix();
        r.render(sc, cam); this.thumb[S.spec.id] = c.toDataURL('image/jpeg', 0.82);
        sc.remove(g);
      }
      r.dispose(); r.forceContextLoss?.();
    } catch (e) { console.warn('ship thumbnails', e); }
    return this.thumb;
  }
  render() {
    const th = this.thumbs();
    const tabs = [['yard', 'Shipyard'], ['derelict', 'Found adrift'], ['own', 'Your fleet']];
    const all = this.list();
    const rows = this.tab === 'own' ? [{ ...SKIFF, ...derived(SKIFF), skiff: true, owned: true }, ...all.filter((s) => s.owned)] : all.filter((s) => s.cat === this.tab);
    if (!rows.some((s) => s.id === this.sel)) this.sel = rows[0]?.id;
    const s = rows.find((x) => x.id === this.sel);
    // bars are against the best in the registry, so they mean something across the fleet
    const pool = [SKIFF, ...SHIPS], dd = (x) => derived(x);
    const top = { acc: Math.max(...pool.map((x) => dd(x).accel)), turn: Math.max(...pool.map((x) => x.turn)), spd: Math.max(...pool.map((x) => x.maxSpd)), dv: Math.max(...pool.map((x) => dd(x).dv)), cargo: Math.log10(1 + Math.max(...pool.map((x) => x.cargo))) };
    const bar = (k, v, f, txt) => `<div class="bar">${k}<s><i class="${f > 0.75 ? 'hi' : ''}" style="width:${Math.max(3, Math.min(100, f * 100)).toFixed(0)}%"></i></s><span>${txt}</span></div>`;
    const unkOf = (x) => x.cat === 'derelict' && !x.found && !x.skiff;
    const price = (x) => x.skiff ? 'Yours' : x.owned ? (x.flying ? 'At the helm' : 'Owned') : x.cat === 'yard' ? fmtCr(x.price) + ' Cr' : unkOf(x) ? 'Not found' : x.home ? 'At the depot' : `${(x.dist / 1000).toFixed(1)} km out`;
    const card = (x) => `<button class="cd ${x.id === this.sel ? 'on' : ''} ${unkOf(x) ? 'unk' : ''}" data-sel="${x.id}">${th[x.id] ? `<img src="${th[x.id]}" alt="">` : '<i class="ph"></i>'}<b>${unkOf(x) ? '???' : x.name}</b><small>${x.cls}</small><em class="${x.owned && !x.skiff ? 'own' : ''}">${price(x)}</em></button>`;
    let det = '<p class="note">Nothing here yet.</p>';
    if (s) {
      const unk = unkOf(s), D = derived(s, s.skiff ? 1 : s.fuel ?? 1);
      let act = '';
      if (s.skiff) act = '<p>Your salvage jet. It goes everywhere with you.</p>';
      else if (s.cat === 'yard') {
        if (!s.owned) act = `<button class="go" data-a="buy" data-id="${s.id}" ${this.econ.credits < s.price ? 'disabled' : ''}>Buy · ${fmtCr(s.price)} Cr</button><p>${this.econ.credits < s.price ? `You need ${fmtCr(s.price - this.econ.credits)} Cr more.` : 'Delivered to a berth just past the depot.'}</p>`;
        else act = `<button class="go" data-a="fly" data-id="${s.id}">Fly her</button><button data-a="sell" data-id="${s.id}">Sell · ${fmtCr(s.sell)} Cr</button><p>Dock at the depot first, then Fly puts your jet on her collar.</p>`;
      } else if (unk) act = '<p>Not found yet. Somewhere out past the wrecks.</p>';
      else if (s.owned) act = `<button class="go" data-a="fly" data-id="${s.id}">Fly her</button><button data-a="sell" data-id="${s.id}" ${s.home ? '' : 'disabled'}>Sell · ${fmtCr(s.sell)} Cr</button>`;
      else act = `<button class="go" data-a="claim" data-id="${s.id}" ${s.home ? '' : 'disabled'}>Claim</button><button data-a="sell" data-id="${s.id}" ${s.home ? '' : 'disabled'}>Sell for salvage · ${fmtCr(s.sell)} Cr</button><p>${s.home ? 'She is at the depot: keep her or sell her.' : `Bring her within ${(CLAIM_R(s) / 1000).toFixed(1)} km of the depot. ${(s.dist / 1000).toFixed(1)} km now.`}</p>`;
      const tag = s.flying ? 'At the helm' : s.docked ? 'Docked' : s.owned && !s.skiff ? 'Owned' : s.cat === 'derelict' && s.found && !s.owned ? 'Found' : s.cat === 'yard' ? 'For sale' : '';
      const spec = unk ? `<dt>Length</dt><dd>${s.len} m</dd><dt>Salvage</dt><dd>~${fmtCr(s.salvage)} Cr</dd>` :
        `<dt>Size</dt><dd>${s.len} × ${s.beam} m</dd><dt>Mass</dt><dd>${fmtMass(s.dry)} dry · ${fmtMass(s.prop)} prop</dd><dt>Crew</dt><dd>${s.crew} · ${s.berths} berths</dd><dt>Drive</dt><dd>${s.drive}</dd><dt>Reactor</dt><dd>${s.reactor}</dd><dt>Hull</dt><dd>${fmtCr(s.hull)} pts · ${s.armor} mm</dd>${s.owned || (s.cat === 'derelict' && s.found) ? `<dt>State</dt><dd>${Math.round((s.cond ?? 1) * 100)}% hull · ${Math.round((s.fuel ?? 1) * 100)}% prop</dd>` : ''}`;
      det = `<div class="hero ${th[s.id] && !unk ? '' : 'noimg'}">${th[s.id] && !unk ? `<img src="${th[s.id]}" alt="">` : ''}<div class="nm">${unk ? 'Unknown hull' : s.name}</div>${tag ? `<span class="stg ${s.cat === 'yard' && !s.owned ? 'dim' : ''}">${tag}</span>` : ''}</div>
        <div><p class="meta">${s.cls} · ${s.maker} · ${s.built}</p>${unk ? '' : `<p class="note">${s.note}</p>`}
        ${unk ? '' : `<div class="bars">${bar('Accel', 0, D.accel / top.acc, (D.accel / G0).toFixed(2) + ' g')}${bar('Turn', 0, s.turn / top.turn, s.turn + '°/s')}${bar('Top spd', 0, s.maxSpd / top.spd, s.maxSpd + ' m/s')}${bar('Range', 0, D.dv / top.dv, D.dv.toFixed(1) + ' km/s')}${bar('Cargo', 0, Math.log10(1 + s.cargo) / top.cargo, fmtMass(s.cargo))}</div>`}</div>
        <div><dl class="spec">${spec}</dl><div class="act">${act}</div></div>`;
    }
    this.panel.innerHTML = `<div class="hd"><span class="ttl">Ships</span><div class="tabs">${tabs.map(([k, n]) => `<button data-tab="${k}" class="${this.tab === k ? 'on' : ''}">${n}</button>`).join('')}</div><span class="cr">${fmtCr(this.econ.credits)}<small>CR</small></span><button class="x" data-a="close" aria-label="Close">×</button></div>
      <div class="bd"><div class="ls">${rows.map(card).join('')}</div><div class="dt">${det}</div></div>`;
    const on = this.panel.querySelector('.cd.on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  onPanel(e) {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tab) { this.tab = b.dataset.tab; this.sel = null; this.render(); return; }
    if (b.dataset.sel) { this.sel = b.dataset.sel; const ls = this.panel.querySelector('.ls'), sx = ls?.scrollLeft, sy = ls?.scrollTop; this.render(); const l2 = this.panel.querySelector('.ls'); if (l2) { l2.scrollLeft = sx; l2.scrollTop = sy; } return; }
    const a = b.dataset.a, id = b.dataset.id;
    if (a === 'close') return this.togglePanel(false);
    if (a === 'buy') this.buy(id); else if (a === 'sell') this.sell(id); else if (a === 'claim') this.claim(id); else if (a === 'fly') this.fly(id);
    if (this.panelOpen) { const ls = this.panel.querySelector('.ls'), sx = ls?.scrollLeft, sy = ls?.scrollTop; this.render(); const l2 = this.panel.querySelector('.ls'); if (l2) { l2.scrollLeft = sx; l2.scrollTop = sy; } }
  }
}
