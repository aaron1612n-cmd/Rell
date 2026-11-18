import * as THREE from 'three';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { suitMaterials, buildAstronaut, poseAstronaut, buildArm, poseFirstPerson, SUIT } from './astronaut.js';
import { K } from './gpufx.js';
import { mats } from './assets.js';
import { Hatch } from './hatch.js';

// EVA: open the canopy, float out, fly a jetpack on a tether, work salvage and your own hull by hand,
// then fly back into the seat. States: off (flying) -> out (canopy opens, you rise out) -> eva -> in (back
// into the seat, canopy shuts) -> off. While you're out the ship holds station on its RCS.
//
// Stakes: jetpack fuel and suit oxygen. The tether to the ship's spine is your way home: it has a hard
// length, and the reel (R / button) winches you back along it without fuel. Run out of air and the
// ship reels you in and you wake in the seat.

const CFG = {
  acc: 2.3, boost: 2.2, assist: 1.8, brake: 4, max: 7, maxBoost: 11,
  look: 0.0021, roll: 2.2,
  fuelUse: 0.0095, o2Use: 1 / 300, tether: 40, reach: 3.2, radius: 0.42,
};
const ANCHOR = new THREE.Vector3(0, 0.62, 0.98);           // tether hardpoint on the ship's spine, behind the canopy
const SEAT_IN = new THREE.Vector3(0, 1.05, 0.05);          // where you hang to climb back in
// rough ship hull as spheres (ship space) so you bump it rather than pass through
const HULL = [[0, 0.22, -1.65, 0.5], [0, 0.18, -0.55, 0.62], [0, 0.15, 0.75, 0.75], [1.35, 0, 0.85, 0.55], [-1.35, 0, 0.85, 0.55], [2.1, -0.05, 1.0, 0.32], [-2.1, -0.05, 1.0, 0.32]];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const _x = new THREE.Vector3(1, 0, 0), _y = new THREE.Vector3(0, 1, 0), _z = new THREE.Vector3(0, 0, 1);

// ---- visor: helmet rim, condensation, the wordless suit HUD ------------------------------
const VISOR_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const VISOR_FS = `varying vec2 vUv;
uniform vec2 uAsp; uniform float uOn, uTan, uO2, uFuel, uTeth, uFog, uTime, uBreath, uWarn, uSun, uLook;
float h(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + 1.), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a * n(p); p *= 2.07; a *= .5; } return s; }
// a segmented arc gauge: angle a0..a1 (radians), value v
float gauge(vec2 p, float r, float a0, float a1, float v, out float lit){
  float a = atan(p.y, p.x), d = abs(length(p) - r); if (a < 0.) a += 6.2832;
  float t = (a - a0) / (a1 - a0); lit = 0.;
  if (t < 0. || t > 1.) return 0.;
  float seg = fract(t * 12.), on = step(.15, seg) * step(seg, .85);
  lit = step(t, v);
  return on * smoothstep(.0045, .0015, d);
}
void main(){
  vec2 q = (vUv - .5) * uAsp;                       // aspect-correct, centre 0
  float m = min(uAsp.x, uAsp.y);
  vec2 e = q / (uAsp * .5);                         // -1..1 across the screen
  // the helmet seen from inside, from the real geometry: the shell's visor opening is about +-70 deg wide and
  // runs from 30 deg up to 46 deg down (tools/blender/astronaut.py), so at this FOV only its brow shows,
  // out of focus across the top; the sides only reach in at the top corners. The bubble itself is clear:
  // a faint fresnel tint toward the edges and two soft reflections of the lit interior.
  vec3 dir = normalize(vec3(e.x * uTan * uAsp.x / uAsp.y, e.y * uTan, -1.));
  float yaw = degrees(atan(dir.x, -dir.z)), pit = degrees(asin(dir.y));
  float open = pow(pow(abs(yaw / 72.), 4.) + pow(abs((pit + 7.) / 39.), 4.), .25);   // OPEN_* in astronaut.py
  float frame = smoothstep(.93, 1.16, open);                                    // out of focus: wide soft edge
  vec3 col = vec3(.035, .036, .038) * (.5 + .5 * uSun) * (1. - .5 * frame);
  float a = frame * .97;
  // the shell's rolled lip catches a little light just inside the edge
  float lk = (open - .98) * 14., lip = exp(-lk * lk) * smoothstep(-.2, .4, e.y);
  col += vec3(.16, .155, .145) * lip * (.2 + .35 * uSun); a = max(a, lip * .22);
  float edge = smoothstep(.35, 1., length(e * vec2(.8, 1.)));
  col += vec3(.01, .014, .02) * edge; a = max(a, edge * .08);
  // reflections of the inside of the helmet on the bubble: a wide arc low and a narrow streak that slides as you look
  float ak = (length((e - vec2(0., 1.6)) * vec2(.55, 1.)) - 2.25) * 9., arc = exp(-ak * ak) * smoothstep(1., .2, abs(e.x)) * .05;
  float sk = (e.x * .55 + e.y * .2 - uLook) * 3.2, streak = exp(-sk * sk) * smoothstep(.2, .8, e.y + .2) * .035;
  col += vec3(.55, .6, .68) * (arc + streak); a = max(a, (arc + streak) * .5);
  float rim = open;
  // condensation: creeps in from the bottom and the edges as air runs low, pulses with breathing
  float fogN = fbm(q * 9. + vec2(0., uTime * .03));
  float fogM = smoothstep(.55, 1., rim + (-e.y * .35) + fogN * .5 - (1. - uFog) * 1.2) * (.75 + .25 * uBreath) * smoothstep(0., .25, uFog) * (1. - frame);
  col += vec3(.55, .58, .6) * fogM * .35; a = max(a, fogM * .55);
  // HUD (amber, low): oxygen left, fuel right, tether centre
  vec2 g = q / m;
  float lit, o2 = gauge(g, .44, 3.72, 4.22, uO2, lit);
  float lo = step(uO2, .25);
  vec3 amber = vec3(1., .62, .3), hot = vec3(1.6, .45, .12);
  col += mix(amber, hot, lo) * o2 * (lit * .85 + .06) * (lo > 0. ? .6 + .4 * step(.5, fract(uTime * 2.)) : 1.);
  a = max(a, o2 * (lit * .55 + .1));
  float lit2, fu = gauge(vec2(-g.x, g.y), .44, 3.72, 4.22, uFuel, lit2);
  float lf = step(uFuel, .2);
  col += mix(amber, hot, lf) * fu * (lit2 * .85 + .06);
  a = max(a, fu * (lit2 * .55 + .1));
  // icons at the gauge tips: a bubble (air) and a flame wedge (fuel)
  vec2 bp = g - vec2(cos(4.3) * .44, sin(4.3) * .44);
  float bub = smoothstep(.004, .0015, abs(length(bp) - .013));
  vec2 fp = vec2(-g.x, g.y) - vec2(cos(4.3) * .44, sin(4.3) * .44);
  float fl = smoothstep(.003, .0, max(abs(fp.x) * 1.6 + fp.y - .012, -fp.y - .012));
  col += amber * (bub + fl) * .9; a = max(a, (bub + fl) * .7);
  // tether: a short bar at the bottom centre, ticks fill as you pay out; flashes when it's taut
  vec2 tp = g - vec2(0., -.43);
  float bar = step(abs(tp.y), .0035) * step(abs(tp.x), .07);
  float tl = step(tp.x + .07, uTeth * .14);
  float tw = uWarn * (.5 + .5 * step(.5, fract(uTime * 4.)));
  col += mix(amber * (tl * 1.1 + .15), hot * 1.4, tw) * bar; a = max(a, bar * (.25 + tl * .6));
  gl_FragColor = vec4(col, clamp(a, 0., 1.) * uOn);
}`;

export class Eva {
  constructor(o) {
    Object.assign(this, o);   // scene, camera, world, ship, shipMesh, cockpit, input, fx, rig, coarse, reduced, lockers, damage, env, sunDir, hud, onStow
    this.state = 'off'; this.t = 0; this.phase = 0; this.view = 0;
    this.o2 = 1; this.fuel = 1; this.cargo = 0;
    this.pilot = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion(), roll: 0, radius: CFG.radius, mass: 0.15, contact: null };
    this.thrust = new THREE.Vector3(); this.thrSm = new THREE.Vector3();
    this.camPos = new THREE.Vector3(); this.camQuat = new THREE.Quaternion();
    this.M = suitMaterials(o.env);

    // the suited pilot (third person) in the world
    this.body = buildAstronaut(this.M); this.body.visible = false; this.scene.add(this.body);
    this.body.traverse((m) => { if (m.isMesh) m.layers.set(0); });
    // the cabin as seen from outside while the canopy is open
    this.cabin = this.cockpit.buildEvaCabin(o.env); this.cabin.traverse((m) => m.layers.set(1));
    this.cabinOn = false; this.hiddenMat = new THREE.MeshBasicMaterial({ visible: false });
    this.swap = []; this.shipMesh.userData.body.traverse((m) => {
      if (!m.isMesh) return;
      for (let p = m; p; p = p.parent) if (/^(canopy|flap_)/.test(p.name)) return;   // hinged parts move, never cut
      this.swap.push({ m, orig: m.material });
    });
    // the canopy glass turns see-through while it's up, so you can see the cabin under it
    this.openGlass = new THREE.MeshStandardMaterial({ color: 0x0a1016, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.42, envMap: o.env, side: THREE.DoubleSide, depthWrite: false });

    this.buildRope(); this.buildHands(); this.buildBeam(); this.buildDom();
    this.lockers.onStow = (L) => this.stowed(L);
    this.hatch = new Hatch(this); this.unclip = 0;
  }

  get active() { return this.state !== 'off'; }
  get holdShip() { return this.state !== 'off'; }

  // ---- building ----------------------------------------------------------------------------
  buildRope() {
    const N = this.ropeN = 26;
    this.rope = Array.from({ length: N }, () => ({ p: new THREE.Vector3(), o: new THREE.Vector3() }));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    const uv = new Float32Array(N * 4); for (let i = 0; i < N; i++) uv.set([0, i, 1, i], i * 4);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const idx = []; for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } g.setIndex(idx);
    const c = document.createElement('canvas'); c.width = 4; c.height = 64; const x = c.getContext('2d');
    x.fillStyle = '#bdb5a3'; x.fillRect(0, 0, 4, 64); x.fillStyle = '#ff5a1f'; x.fillRect(0, 0, 4, 10); x.fillStyle = '#5b554b'; x.fillRect(0, 31, 4, 2);
    const tex = new THREE.CanvasTexture(c); tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.repeat.set(1, 0.6);
    this.ropeMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, color: 0x9c968a });
    this.ropeMesh = new THREE.Mesh(g, this.ropeMat); this.ropeMesh.frustumCulled = false; this.ropeMesh.visible = false; this.scene.add(this.ropeMesh);
    this.ropeLen = 2; this.taut = 0;
  }

  buildHands() {
    // first-person overlay: its own scene drawn after the world with depth cleared (hands never clip into walls)
    const s = this.handScene = new THREE.Scene(); s.environment = this.env; s.environmentIntensity = 0.6;
    this.handCam = new THREE.PerspectiveCamera(70, 1, 0.02, 20); s.add(this.handCam);
    this.hSun = new THREE.DirectionalLight(0xffe4c2, 3.6); s.add(this.hSun, this.hSun.target);
    s.add(new THREE.HemisphereLight(0x0c1016, 0x2c4554, 0.7));
    this.hTool = new THREE.PointLight(0xff8a40, 0, 1.2, 2); s.add(this.hTool);
    // the same arms as the third-person suit, in body space: the camera sits at the suit's eye, so the
    // shoulders are where they really are and the IK'd arms run from there to the hands
    const hands = this.hands = new THREE.Group(); hands.position.copy(SUIT.eye).negate(); this.handCam.add(hands);
    this.armR = buildArm(this.M, 1, true); this.armL = buildArm(this.M, -1);
    hands.add(this.armR.root, this.armL.root);
    this.tool = this.armR.tool; this.gloveL = this.armL.glove;
    this.armR.glove.setCurl(0.95);
    hands.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
    this.sway = new THREE.Vector3(); this.swayV = new THREE.Vector3(); this.reachL = 0;
    // visor overlay
    this.visorU = {
      uAsp: { value: new THREE.Vector2(1, 1) }, uOn: { value: 1 }, uO2: { value: 1 }, uFuel: { value: 1 }, uTeth: { value: 0 }, uFog: { value: 0 },
      uTan: { value: 0.75 }, uTime: { value: 0 }, uBreath: { value: 0 }, uWarn: { value: 0 }, uSun: { value: 1 }, uLook: { value: 0 },
    };
    this.visor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ vertexShader: VISOR_VS, fragmentShader: VISOR_FS, uniforms: this.visorU, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    this.visor.renderOrder = 100; this.visor.position.z = -0.05; this.handCam.add(this.visor);
    this.pass = new RenderPass(s, this.handCam); this.pass.clear = false; this.pass.clearDepth = true; this.pass.enabled = false;
  }

  buildBeam() {
    const N = 12, g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    this.beam = new THREE.Line(g, new THREE.LineBasicMaterial({ color: new THREE.Color(5, 2.6, 1.2), transparent: true, depthWrite: false, toneMapped: false }));
    this.beam.frustumCulled = false; this.beam.visible = false; this.scene.add(this.beam);
    this.toolLight = new THREE.PointLight(0xff9a50, 0, 4, 2); this.scene.add(this.toolLight);
  }

  buildDom() {
    const $ = (id) => document.getElementById(id);
    this.el = { ret: $('evaret'), mark: $('evamark'), home: $('evahome'), fade: $('evafade'), btn: $('exitbtn'), use: $('evause') };
  }

  // ---- transitions --------------------------------------------------------------------------
  request() {
    if (this.state === 'off') {
      if (this.ship.vel.length() > 6 || this.ship.hull <= 0) { this.el.btn.classList.remove('deny'); void this.el.btn.offsetWidth; this.el.btn.classList.add('deny'); return; }
      // the view you're in picks how you watch it: cockpit -> your own eyes, chase -> from outside
      const ck = this.cockpit, fp = ck.target === 1;
      this.state = 'out'; this.waitSeat = fp && ck.blend < 1;
      if (!this.waitSeat) this.hatch.startExit(fp);
      this.damage.ensure(this.ship);
      this.hintUsed = true; this.el.btn.classList.remove('ping');
    } else if (this.state === 'eva' && this.canBoard) {
      this.state = 'in'; this.unclip = 0;
      this.hatch.startEntry();
    }
  }

  toggleView() { if (this.state === 'eva') this.view = this.view ? 0 : 1; }

  enterEva() {
    // the hatch animation leaves the pilot floating clear of the nose; drift on a little from there
    const p = this.pilot;
    p.roll = 0; p.vel.copy(this.ship.vel).addScaledVector(_v.set(0, 0.05, -0.18).applyQuaternion(this.ship.quat), 1);
    this.state = 'eva'; this.t = 0;
    this.ropeLen = 2; this.ropeReset = true; this.unclip = 0;
    this.visorU.uOn.value = 1;
    if (this.view === 1) { this.tpInit = true; this.camPos.copy(this.camera.position); }
  }

  fitVisor(cam) { const hgt = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * 0.05; this.visor.scale.set(hgt * cam.aspect * 1.002, hgt * 1.002, 1); this.visorU.uAsp.value.set(cam.aspect, 1); this.visorU.uTan.value = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2); }

  shipPoint(local, out) { return out.copy(local).applyQuaternion(this.ship.quat).add(this.ship.pos); }

  // ---- per frame ------------------------------------------------------------------------------
  update(dt, cmd) {
    this.t += dt;
    const ship = this.ship, ck = this.cockpit;
    this.syncCabin();
    this.lockers.update(dt, ship, ship.pos);
    this.damage.update(dt);

    if (this.state === 'off') {
      if (this.body.visible && !this.rig.bf) this.body.visible = false;
      // refill in the seat; hint at the hatch when parked near something worth taking
      this.o2 = Math.min(1, this.o2 + dt * 0.3); this.fuel = Math.min(1, this.fuel + dt * 0.25);
      const near = this.lockers.nearest(ship.pos), slow = ship.vel.length() < 3;
      const want = slow && ((near && near.d < 70) || this.damage.total > 0.04);
      this.el.btn.classList.toggle('ping', want && !this.reduced);
      this.el.btn.classList.toggle('dim', ship.vel.length() > 6);
      this.setHud(false);
      return;
    }
    document.body.classList.add('eva');
    document.body.classList.toggle('evx', this.state !== 'eva');

    if (this.state === 'out') {
      this.setHud(false);
      if (this.waitSeat) { if (ck.blend >= 1) { this.waitSeat = false; this.hatch.startExit(true); } else return; }
      if (this.hatch.update(dt)) { this.enterEva(); document.body.classList.remove('evx'); }
      return;
    }

    if (this.state === 'in') {
      this.setHud(false);
      this.beam.visible = false; this.toolLight.intensity = 0;
      const done = this.hatch.update(dt);
      if (this.unclip < 1) this.stepRope(dt, { reel: true }); else this.ropeMesh.visible = false;
      if (done) {
        this.ropeMesh.visible = false; this.pass.enabled = false; this.visorU.uOn.value = 1;
        if (this.view === 0) { ck.target = 1; ck.blend = 1; }
        else { ck.target = 0; ck.blend = 0; this.rig.blendFrom(this.camera, 1.5); }
        this.state = 'off'; this.blackout = 0; document.body.classList.remove('eva', 'evx'); this.el.fade.style.opacity = 0;
      }
      return;
    }

    // ---- EVA ----
    this.flyPilot(dt, cmd);
    this.stepRope(dt, cmd);
    this.useTool(dt, cmd);
    this.place(dt, cmd);
    this.setHud(true);
  }

  camFov(f, dt) { this.camera.fov = THREE.MathUtils.damp(this.camera.fov, f, 5, dt); this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld(); }

  syncCabin() {
    const ck = this.cockpit, on = ck.open > 0.001;
    if (on !== this.cabinOn) {
      this.cabinOn = on;
      const sw = (m) => (m === mats.glass ? this.hiddenMat : m === mats.shipHull ? ck.cutMat : m);
      if (on) { this.shipMesh.add(this.cabin); for (const s of this.swap) s.m.material = Array.isArray(s.orig) ? s.orig.map(sw) : sw(s.orig); }
      else { this.shipMesh.remove(this.cabin); for (const s of this.swap) s.m.material = s.orig; }
      for (const g of this.shipMesh.userData.rig.glass || []) { g.material = on ? this.openGlass : mats.glass; g.renderOrder = on ? 2 : 0; }
    }
    if (on) this.cabin.userData.hinge.rotation.x = ck.openAngle;
  }

  flyPilot(dt, cmd) {
    const p = this.pilot, ship = this.ship;
    // look: direct (a person turns their body with small puffs; inertia here only feels like lag)
    const yaw = -cmd.dx * CFG.look - cmd.yawKey * 1.6 * dt, pitch = -cmd.dy * CFG.look + cmd.pitchKey * 1.6 * dt;
    p.roll = THREE.MathUtils.damp(p.roll, -cmd.roll * CFG.roll, 6, dt);
    p.quat.multiply(_q.setFromAxisAngle(_y, yaw)).multiply(_q.setFromAxisAngle(_x, pitch)).multiply(_q.setFromAxisAngle(_z, p.roll * dt)).normalize();

    const fuelOk = this.fuel > 0;
    const th = this.thrust.set(cmd.strafe, cmd.vert, -cmd.fwd);
    if (th.lengthSq() > 1) th.normalize();
    if (!fuelOk) th.set(0, 0, 0);
    const boost = cmd.boost && th.lengthSq() > 0.01 && fuelOk;
    const acc = CFG.acc * (boost ? CFG.boost : 1);
    _q.copy(p.quat); _q2.copy(_q).invert();
    // relative to the ship (it holds station, but this keeps its frame honest)
    const rel = _v.copy(p.vel).sub(ship.vel).applyQuaternion(_q2);
    rel.addScaledVector(th, acc * dt);
    let use = th.length() * (boost ? 2.5 : 1);
    if (cmd.brake && fuelOk) {
      const d = CFG.brake * dt; const l = rel.length(); if (l > 1e-4) { const nl = Math.max(0, l - d); use += Math.min(1, l) * 0.6; rel.multiplyScalar(nl / l); }
    } else if (fuelOk) {
      const d = CFG.assist * dt, ap = (v, i) => (Math.abs(i) < 0.05 ? (v > 0 ? Math.max(0, v - d) : Math.min(0, v + d)) : v);
      const bx = rel.x, by = rel.y, bz = rel.z;
      rel.x = ap(rel.x, cmd.strafe); rel.y = ap(rel.y, cmd.vert); rel.z = ap(rel.z, cmd.fwd);
      use += (Math.abs(bx - rel.x) + Math.abs(by - rel.y) + Math.abs(bz - rel.z)) / Math.max(dt, 1e-4) * 0.08;
    }
    const max = boost ? CFG.maxBoost : CFG.max, sp = rel.length(); if (sp > max) rel.multiplyScalar(Math.max(max / sp, 1 - dt * 2));
    p.vel.copy(rel.applyQuaternion(_q)).add(ship.vel);
    this.fuel = Math.max(0, this.fuel - use * CFG.fuelUse * dt);
    this.o2 = Math.max(0, this.o2 - CFG.o2Use * dt * (boost ? 1.4 : 1));
    this.thrSm.lerp(th, 1 - Math.exp(-10 * dt));
    this.boosting = boost; this.burn = th.length();

    // reel: winch back along the tether, no fuel needed
    const reeling = cmd.reel || this.o2 <= 0.04;
    this.reeling = reeling;
    if (reeling) {
      const r = this.rope, tgt = r[Math.max(1, r.length - 4)].p;
      _v.copy(tgt).sub(p.pos); const d = _v.length();
      const anc = this.shipPoint(ANCHOR, _v3);
      if (p.pos.distanceTo(anc) > 1.8 && d > 1e-3) p.vel.lerp(_v.multiplyScalar(5 / d).add(ship.vel), 1 - Math.exp(-3 * dt));
      else p.vel.lerp(ship.vel, 1 - Math.exp(-4 * dt));
    }

    // integrate with substeps and collide: station + debris (world), ship hull spheres
    const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
    for (let i = 0; i < n; i++) {
      p.pos.addScaledVector(p.vel, h);
      const hit = this.world.collideStatic(p, 0.2);
      if (hit && hit.speed > 2.5) { this.rig.kick(Math.min(0.5, hit.speed / 14)); this.hud.pulse(Math.min(0.2, hit.speed / 40)); }
      for (const d of this.world.debris) { if (d.pos.distanceToSquared(p.pos) < (d.radius + 0.5) ** 2) this.world.collidePair(p, d, 0.3); }
      for (const [x, y, z, r] of HULL) {
        const c = this.shipPoint(_v.set(x, y, z), _v2); _v3.copy(p.pos).sub(c); const dd = _v3.length(), R = r + p.radius;
        if (dd < R && dd > 1e-4) { _v3.divideScalar(dd); p.pos.addScaledVector(_v3, R - dd); const vn = _v.copy(p.vel).sub(ship.vel).dot(_v3); if (vn < 0) p.vel.addScaledVector(_v3, -1.2 * vn); }
      }
    }
    // tether hard limit
    const anc = this.shipPoint(ANCHOR, _v3), off = _v.copy(p.pos).sub(anc), dist = off.length();
    this.tethDist = dist;
    if (dist > CFG.tether) {
      off.divideScalar(dist); p.pos.copy(anc).addScaledVector(off, CFG.tether);
      const vn = _v2.copy(p.vel).sub(this.ship.vel).dot(off); if (vn > 0) { p.vel.addScaledVector(off, -vn * 1.3); if (vn > 1) { this.rig.kick(Math.min(0.4, vn * 0.1)); this.taut = 1; } }
    }
    this.taut = Math.max(0, this.taut - dt * 1.5);

    // boarding window: hang over the seat
    const seat = this.shipPoint(SEAT_IN, _v2);
    this.canBoard = p.pos.distanceTo(seat) < 2.4;

    // out of air: everything fades as the winch drags you home
    if (this.o2 <= 0) { this.blackout = Math.min(1, (this.blackout || 0) + dt * 0.5); if (this.blackout >= 1 && this.canBoard) this.request(); }
    else this.blackout = Math.max(0, (this.blackout || 0) - dt);
    if (this.blackout >= 1 && !this.canBoard) {
      // safety: if the reel is slow (snagged), put you at the seat
      this.snag = (this.snag || 0) + dt; if (this.snag > 6) { p.pos.copy(seat); this.snag = 0; }
    }
    this.el.fade.style.opacity = (this.blackout || 0).toFixed(3);

    // jetpack puffs (world particles), from the two pod nozzles, opposite the thrust
    this.jetFx(dt);
  }

  jetFx(dt) {
    const p = this.pilot, b = this.thrSm, mag = b.length() + (this.reeling ? 0 : 0);
    if (mag < 0.05 || this.fuel <= 0) return;
    this.jetAcc = (this.jetAcc || 0) + dt * 60 * mag * (this.boosting ? 2 : 1) * (this.coarse ? 0.5 : 1);
    const dir = _v.copy(b).normalize().negate().applyQuaternion(p.quat);
    while (this.jetAcc > 1) {
      this.jetAcc--;
      for (const sx of [-1, 1]) {
        const o = _v2.set(sx * 0.27, -0.3, 0.32).applyQuaternion(p.quat).add(p.pos);
        if (this.view === 0) o.addScaledVector(dir, 0.15);
        const v = _v3.copy(dir).multiplyScalar(3 + Math.random() * 2.5 * (this.boosting ? 1.8 : 1)).add(p.vel); v.x += (Math.random() - 0.5) * 0.8; v.y += (Math.random() - 0.5) * 0.8; v.z += (Math.random() - 0.5) * 0.8;
        this.fx.emit(o, v, this.fxT(), 0.18 + Math.random() * 0.15, 0.03, this.boosting ? 0.28 : 0.18, K.RCS, 2.2, 0.01);
      }
    }
  }

  fxT() { return this.getFxT ? this.getFxT() : this.t; }

  stepRope(dt, cmd) {
    const r = this.rope, N = r.length, anc = this.shipPoint(ANCHOR, _v3), p = this.pilot;
    const hip = _v2.set(-0.27, -0.16, 0).applyQuaternion(p.quat).add(p.pos);
    if (this.unclip > 0) hip.lerp(anc, this.unclip * this.unclip);
    const dist = anc.distanceTo(hip);
    if (this.ropeReset) { for (let i = 0; i < N; i++) { r[i].p.lerpVectors(anc, hip, i / (N - 1)); r[i].o.copy(r[i].p); } this.ropeReset = false; }
    // paying out is quick, taking up slack is slow (a spring winch), the reel takes up fast
    const want = Math.min(CFG.tether, dist * 1.06 + 0.8);
    this.ropeLen += (want - this.ropeLen) * (1 - Math.exp(-(want > this.ropeLen ? 6 : this.reeling ? 4 : 0.35) * dt));
    const seg = this.ropeLen / (N - 1);
    // verlet in the ship's frame of motion (zero g), light damping and a lazy drift so slack drifts
    for (let i = 1; i < N - 1; i++) {
      const n = r[i], vx = (n.p.x - n.o.x) * 0.985, vy = (n.p.y - n.o.y) * 0.985, vz = (n.p.z - n.o.z) * 0.985;
      n.o.copy(n.p); n.p.x += vx + this.ship.vel.x * dt * 0.015; n.p.y += vy + Math.sin(this.t * 0.7 + i) * 0.0004; n.p.z += vz;
    }
    r[0].p.copy(anc); r[N - 1].p.copy(hip);
    for (let it = 0; it < 10; it++) {
      for (let i = 0; i < N - 1; i++) {
        const a = r[i], b = r[i + 1]; _v.copy(b.p).sub(a.p); const d = _v.length(); if (d < 1e-5 || d < seg) continue;
        const k = (d - seg) / d * 0.5; const wa = i === 0 ? 0 : 1, wb = i + 1 === N - 1 ? 0 : 1, s = wa + wb; if (!s) continue;
        a.p.addScaledVector(_v, k * 2 * wa / s); b.p.addScaledVector(_v, -k * 2 * wb / s);
      }
      r[0].p.copy(anc); r[N - 1].p.copy(hip);
    }
    // ribbon facing the camera
    const pos = this.ropeMesh.geometry.attributes.position.array, cam = this.camera.position, w = 0.022;
    for (let i = 0; i < N; i++) {
      const a = r[Math.max(0, i - 1)].p, b = r[Math.min(N - 1, i + 1)].p;
      _v.copy(b).sub(a); _v2.copy(r[i].p).sub(cam); const side = _v.cross(_v2).normalize().multiplyScalar(w);
      pos.set([r[i].p.x - side.x, r[i].p.y - side.y, r[i].p.z - side.z, r[i].p.x + side.x, r[i].p.y + side.y, r[i].p.z + side.z], i * 6);
    }
    const uv = this.ropeMesh.geometry.attributes.uv.array; for (let i = 0; i < N; i++) { uv[i * 4 + 1] = uv[i * 4 + 3] = i * seg; }
    this.ropeMesh.geometry.attributes.uv.needsUpdate = true;
    this.ropeMesh.geometry.attributes.position.needsUpdate = true; this.ropeMesh.visible = true;
    this.ropeMat.color.setRGB(0.6 + this.taut * 1.5, 0.58 + this.taut * 0.3, 0.54);
  }

  aimRay(o, d) {
    // the eye and the view direction (third person aims from the helmet along the camera)
    const p = this.pilot;
    this.camera.getWorldDirection(d);
    if (this.view === 0) o.copy(this.camera.position); else o.copy(p.pos).addScaledVector(_y.clone().applyQuaternion(p.quat), 0.42);
  }

  useTool(dt, cmd) {
    const o = new THREE.Vector3(), d = new THREE.Vector3(); this.aimRay(o, d);
    const reach = CFG.reach + (this.view ? 0.6 : 0);
    let T = this.lockers.pick(o, d, reach);
    const W = this.damage.pick(o, d, reach, this.ship); if (W && (!T || W.dist < T.dist)) T = W;
    this.target = T;
    const fire = cmd.fire && T;
    this.firing = !!fire;
    this.beam.visible = false; this.toolLight.intensity = 0;
    this.useT = fire ? (this.useT || 0) + dt : 0;
    if (!fire) { this.reachL = Math.max(0, this.reachL - dt * 3); return; }
    let ev = null;
    if (T.kind === 'weld') { const r = this.damage.work(T, dt); this.ship.hull = Math.min(1, this.ship.hull + r); }
    else ev = this.lockers.work(T, dt);
    if (T.kind === 'core') this.reachL = Math.min(1, this.reachL + dt * 4);
    // beam: tool tip -> target, a jittering arc (not for clamping tags: that's the hand)
    const tip = new THREE.Vector3();
    if (this.view === 0) this.tool.userData.tip.getWorldPosition(tip); else this.body.userData.tool.userData.tip.getWorldPosition(tip);
    const end = T.point;
    if (T.kind !== 'core') {
      const pos = this.beam.geometry.attributes.position.array, N = pos.length / 3;
      for (let i = 0; i < N; i++) {
        const k = i / (N - 1), j = Math.sin(k * Math.PI) * 0.03;
        _v.lerpVectors(tip, end, k).add(_v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(j));
        pos.set([_v.x, _v.y, _v.z], i * 3);
      }
      this.beam.geometry.attributes.position.needsUpdate = true; this.beam.visible = true;
      this.toolLight.position.copy(end).addScaledVector(T.normal, 0.15); this.toolLight.intensity = 3 + Math.random() * 3;
      // sparks off the work
      this.sparkAcc = (this.sparkAcc || 0) + dt * (this.coarse ? 40 : 90);
      while (this.sparkAcc > 1) {
        this.sparkAcc--;
        _v.copy(T.normal).multiplyScalar(0.6 + Math.random() * 2.2).add(_v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2.6)).add(this.ship.vel);
        this.fx.emit(end, _v, this.fxT(), 0.25 + Math.random() * 0.5, 0.012, 0.008, Math.random() < 0.35 ? K.EMBER : K.SPARK, 0.5, 0.03);
      }
      if (Math.random() < dt * 14) this.fx.emit(end, this.ship.vel, this.fxT(), 0.06, 0.12, 0.18, K.FLASH);
    }
    if (ev === 'bolt' || ev === 'pop') {
      for (let i = 0; i < (ev === 'pop' ? 40 : 14); i++) { _v.copy(T.normal).multiplyScalar(1 + Math.random() * 3).add(_v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4)); this.fx.emit(end, _v, this.fxT(), 0.3 + Math.random() * 0.6, 0.015, 0.01, K.SPARK, 0.6, 0.04); }
      this.fx.emit(end, this.ship.vel, this.fxT(), 0.12, 0.2, ev === 'pop' ? 0.9 : 0.4, K.FLASH);
      this.rig.kick(ev === 'pop' ? 0.12 : 0.03);
    }
    if (ev === 'tag') this.hud.pulse(0.05);
  }

  stowed(L) {
    this.cargo += L.value;
    if (this.onStow) this.onStow(L);
    dispatchEvent(new CustomEvent('rell:salvage', { detail: { kind: L.kind, value: L.value, total: this.cargo } }));
  }

  // cameras + the visible pilot
  place(dt, cmd) {
    const p = this.pilot, cam = this.camera;
    const head = _v.copy(SUIT.eye);
    if (this.view === 0) {
      cam.position.copy(p.pos).add(head.applyQuaternion(p.quat)); cam.quaternion.copy(p.quat);
      this.camFov(this.boosting ? 78 : 74, dt);
      this.body.visible = false;
    } else {
      // over the shoulder, a little lag
      const want = _v2.set(0.8, 0.55, 2.35).applyQuaternion(p.quat).add(p.pos);
      if (!this.tpInit) { this.camPos.copy(want); this.tpInit = true; }
      this.camPos.lerp(want, 1 - Math.exp(-8 * dt));
      cam.position.copy(this.camPos); cam.quaternion.slerp(p.quat, 1 - Math.exp(-10 * dt));
      this.camFov(66, dt);
      this.body.visible = true;
    }
    if (this.view === 0) this.tpInit = false;
    if (this.rig.shake > 0.001) { const s = this.rig.shake * 0.05; cam.position.x += (Math.random() - 0.5) * s; cam.position.y += (Math.random() - 0.5) * s; this.rig.shake *= Math.exp(-5.5 * dt); }
    cam.up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    cam.updateMatrixWorld();

    // third-person body
    const b = this.body; b.position.copy(p.pos); b.quaternion.copy(p.quat);
    poseAstronaut(b, this.t, this.thrSm, this.firing ? 1 : 0.2);
    const nz = b.userData.nozzles; for (const n of nz) n.inner.material.color.setRGB(0.05 + this.burn * 3, 0.03 + this.burn * 1.2, 0.02 + this.burn * 0.4);
    b.userData.tool.userData.emitter.material.color.setRGB(this.firing ? 6 : 1.2, this.firing ? 2.4 : 0.4, this.firing ? 0.8 : 0.1);

    // first-person hands: sway with turning and thrust, the left hand reaches to clamp tags
    const hands = this.pass.enabled = this.view === 0;
    if (hands) {
      this.handCam.position.copy(cam.position); this.handCam.quaternion.copy(cam.quaternion);
      this.handCam.fov = cam.fov; this.handCam.aspect = cam.aspect; this.handCam.updateProjectionMatrix(); this.handCam.updateMatrixWorld();
      const tgt = _v.set(THREE.MathUtils.clamp(cmd.dx * 0.0004, -0.03, 0.03), THREE.MathUtils.clamp(-cmd.dy * 0.0004, -0.03, 0.03), 0).addScaledVector(this.thrSm, -0.012);
      this.swayV.addScaledVector(_v2.copy(tgt).sub(this.sway), 90 * dt).multiplyScalar(Math.exp(-12 * dt)); this.sway.addScaledVector(this.swayV, dt);
      const bob = Math.sin(this.t * 1.1) * 0.003;
      const kick = this.firing ? (Math.random() - 0.5) * 0.003 : 0;
      poseFirstPerson(this.armR, this.armL, { narrow: Math.min(1, cam.aspect * 1.3), sway: this.sway, bob, kick, firing: this.firing, reach: this.reachL });
      this.gloveL.setCurl(0.25 + this.reachL * 0.6 + 0.05 * Math.sin(this.t));
      this.tool.userData.emitter.material.color.setRGB(this.firing ? 7 : 1.3 + 0.3 * Math.sin(this.t * 3), this.firing ? 2.8 : 0.42, this.firing ? 0.9 : 0.1);
      this.hTool.position.copy(this.tool.userData.tip.getWorldPosition(_v2)); this.hTool.intensity = this.firing ? 0.8 + Math.random() * 0.6 : 0.04;
      this.hSun.position.copy(cam.position).addScaledVector(this.sunDir, 5); this.hSun.target.position.copy(cam.position);
      // visor fills the view
      this.fitVisor(cam);
      const u = this.visorU; u.uO2.value = this.o2; u.uFuel.value = this.fuel; u.uTeth.value = Math.min(1, (this.tethDist || 0) / CFG.tether);
      u.uTime.value = this.t; u.uFog.value = THREE.MathUtils.clamp((0.35 - this.o2) / 0.35, 0, 1); u.uBreath.value = 0.5 + 0.5 * Math.sin(this.t * (this.o2 < 0.25 ? 5 : 1.6));
      u.uWarn.value = this.taut > 0.1 || (this.tethDist || 0) > CFG.tether * 0.92 ? 1 : 0;
      _v.set(0, 0, -1).applyQuaternion(cam.quaternion); u.uLook.value = Math.atan2(_v.x, -_v.z) * 0.3 % 1;
    }
  }

  // DOM: reticle, waypoint markers, boarding cue
  setHud(on) {
    const el = this.el;
    if (!on) { if (this.hudOn) { el.ret.className = ''; el.mark.style.display = el.home.style.display = 'none'; el.use.className = ''; this.hudOn = false; } return; }
    this.hudOn = true;
    const T = this.target;
    el.ret.className = 'on' + (T ? ' t' : '') + (this.firing ? ' f' : '') + (T && T.kind === 'weld' ? ' w' : '');
    let prog = 0;
    if (T && T.kind === 'bolt') prog = T.L.bolts[T.i].heat; else if (T && T.kind === 'core') prog = T.L.tag; else if (T && T.kind === 'weld') prog = 1 - Math.min(1, T.s.amt * 4);
    el.ret.style.setProperty('--p', (prog * 100).toFixed(1) + '%');
    // first time a target is in reach: show the "use" cue under the reticle until you've used it once
    if (T && !this.usedOnce) el.use.className = 'on';
    if (this.firing) { this.usedOnce = true; el.use.className = ''; }
    // markers: nearest locker (if not already looking at it) and home (the seat) when far
    const near = this.lockers.nearest(this.pilot.pos);
    this.marker(el.mark, near && near.d > 2.5 && near.d < 120 ? near.L.wp : null);
    const seat = this.shipPoint(SEAT_IN, new THREE.Vector3());
    this.marker(el.home, this.pilot.pos.distanceTo(seat) > 3 || this.canBoard ? seat : null, this.canBoard);
    el.btn.classList.toggle('ping', !!this.canBoard && !this.reduced);
  }

  marker(m, p, hot = false) {
    if (!p) { m.style.display = 'none'; return; }
    m.style.display = ''; m.classList.toggle('hot', hot);
    const w = innerWidth, h = innerHeight;
    _v.copy(p).project(this.camera);
    let x = _v.x, y = _v.y; const behind = _v.z > 1;
    if (behind) { x = -x; y = -y; }
    const edge = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.86;
    if (edge) { const s = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.86); x /= s; y /= s; }
    m.classList.toggle('edge', edge);
    m.style.transform = `translate(${((x * 0.5 + 0.5) * w).toFixed(1)}px,${((-y * 0.5 + 0.5) * h).toFixed(1)}px) rotate(${edge ? Math.atan2(-y, x) * 57.3 + 90 : 0}deg)`;
    m.querySelector('b').textContent = Math.round(p.distanceTo(this.pilot.pos));
  }
}
