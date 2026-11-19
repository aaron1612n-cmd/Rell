import * as THREE from 'three';
import { ICONS } from './input.js';
import { NAV_ICONS } from './nav.js';
import { JOB_ICONS } from './career.js';

// Wordless first run: ghost rings in space teach thrust, aim, boost, brake, grab and deliver.
// One word per step, a key (or touch icon) floats by the target. Skippable; replay from the help card.
const svg = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
const TOUCH_IC = {
  stick: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/>',
  look: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
};
const STEPS = [
  { word: 'Thrust', key: 'W', touch: TOUCH_IC.stick, rings: [[22, 22, 95]] },
  { word: 'Aim', key: 'Mouse', touch: TOUCH_IC.look, rings: [[95, 30, 112]] },
  { word: 'Boost', key: 'Shift', touch: ICONS.boost, rings: [[118, 40, 232], [128, 45, 382]] },
  { word: 'Brake', key: 'X', touch: ICONS.brake, zone: [134, 45, 468], r: 15 },
  { word: 'Grab', key: 'F', touch: NAV_ICONS.grab, item: [138, 46, 494] },
  { word: 'Deliver', icon: NAV_ICONS.depot },
  // depot, then outside: dock, take a job, suit up, cut a locker, come home
  { word: 'Dock', icon: NAV_ICONS.depot, dock: true },
  { word: 'Job', icon: JOB_ICONS.haul, job: true },
  { word: 'Suit', key: 'G', touch: ICONS.exit, suit: true },
  { word: 'Cut', key: 'Click', touch: ICONS.tool, cut: true },
  { word: 'Return', key: 'G', touch: ICONS.exit, back: true },
];

export class Tutorial {
  constructor({ scene, ship, salvage, world, econ, input, reduced, eva, lockers, career, nav }) {
    Object.assign(this, { scene, ship, salvage, world, econ, input, reduced, eva, lockers, career, nav });
    this.el = document.createElement('div'); this.el.id = 'tut';
    this.el.innerHTML = '<div class="g"><span class="k"></span><span class="w"></span><span class="pp"></span></div><button class="skip">Skip</button>';
    document.body.appendChild(this.el);
    this.g = this.el.querySelector('.g'); this.k = this.el.querySelector('.k'); this.w = this.el.querySelector('.w'); this.pp = this.el.querySelector('.pp');
    this.el.querySelector('.skip').addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); this.finish(); });
    this.rings = new THREE.Group(); scene.add(this.rings);
    this.mat = new THREE.MeshBasicMaterial({ color: 0xe8e0cc, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.hotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.55, 0.2), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.on = false; this.step = -1; this.t = 0;
  }

  start() {
    this.on = true; this.el.classList.add('show'); this.done = false;
    this.rings.clear();
    // ring meshes for every ring step, laid out as a path so the next one is always in view
    const pts = [this.ship.pos.clone()];
    this.ringMeshes = [];
    for (const st of STEPS) for (const r of st.rings || []) {
      const p = new THREE.Vector3(...r), prev = pts[pts.length - 1];
      const g = new THREE.Group(); g.position.copy(p); g.lookAt(prev); pts.push(p);
      const tor = new THREE.Mesh(new THREE.TorusGeometry(6.5, 0.14, 8, 64), this.mat);
      const ticks = new THREE.Group();
      for (let i = 0; i < 8; i++) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.3, 0.22), this.mat); const a = i / 8 * Math.PI * 2; t.position.set(Math.cos(a) * 7.4, Math.sin(a) * 7.4, 0); t.rotation.z = a + Math.PI / 2; ticks.add(t); }
      g.add(tor, ticks); g.userData = { tor, ticks }; this.rings.add(g); this.ringMeshes.push(g);
      g.userData.st = st;
    }
    const zone = STEPS.find((s) => s.zone);
    // stop zone: a soft fresnel bubble with a ring round its waist
    this.zoneMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uA: { value: 0.3 } },
      vertexShader: 'varying vec3 vN, vV; void main(){ vec4 w = modelMatrix * vec4(position,1.); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: 'uniform float uA; varying vec3 vN, vV; void main(){ float f = pow(max(0., 1. - abs(dot(vN, vV))), 2.5); gl_FragColor = vec4(vec3(.91,.88,.8) * f * uA, 1.); }',
    });
    this.zone = new THREE.Mesh(new THREE.SphereGeometry(zone.r, 48, 24), this.zoneMat);
    this.zone.add(new THREE.Mesh(new THREE.TorusGeometry(zone.r, 0.1, 6, 96), this.mat)); this.zone.children[0].rotation.x = Math.PI / 2;
    this.zone.position.set(...zone.zone); this.rings.add(this.zone);
    // the canister to grab
    const gi = STEPS.find((s) => s.item);
    if (!this.item || this.item.state === 'gone' || this.item.state === 'captured') this.item = this.salvage.spawn(this.world.site.meridian, { type: 'canister', at: gi.item });
    else { this.item.body.pos.set(...gi.item); this.item.body.vel.set(0, 0, 0); this.item.body.updateSpheres(); if (this.item.state === 'towed') this.salvage.releaseAll(); this.item.state = 'free'; }
    this.item.tutorial = true;
    this.go(0);
  }

  go(i) {
    this.step = i; this.t = 0; this.ringIdx = 0;
    const st = STEPS[i]; if (!st) return this.finish(true);
    const touch = this.input.touchMode;
    this.k.innerHTML = st.icon ? svg(st.icon) : touch ? svg(st.touch) : `<kbd>${st.key}</kbd>`;
    this.w.textContent = st.word;
    // progress pips: where you are in the whole run
    this.pp.innerHTML = STEPS.map((_, n) => `<i class="${n < i ? 'd' : n === i ? 'c' : ''}"></i>`).join('');
    this.base = this.econ.stats.lockers; this.jobBase = this.econ.stats.jobs;
    this.g.classList.remove('pop'); void this.g.offsetWidth; this.g.classList.add('pop');
  }

  // called when salvage reaches the depot
  delivered() { if (this.on && STEPS[this.step]?.word === 'Deliver') this.go(this.step + 1); }

  finish(won = false) {
    this.on = false; this.el.classList.remove('show'); this.rings.clear();
    if (!this.econ.tut) { this.econ.tut = true; this.econ.save(); }
    this.done = won;
  }

  lockerPos() { const n = this.lockers.nearest(this.ship.pos); return n ? n.L.wp : this.world.site.meridian.pos; }

  target() {
    const st = STEPS[this.step];
    if (st.dock) return this.world.site.depot.dockPt;
    if (st.job) return this._v || (this._v = new THREE.Vector3());
    if (st.suit || st.cut) return this.eva.active && this.eva.state === 'eva' ? this.lockerPos() : this.lockerPos();
    if (st.back) return this._v || (this._v = new THREE.Vector3());
    if (st.rings) return this.activeRing().position;
    if (st.zone) return this.zone.position;
    if (st.item) return this.item.body.pos;
    return this.world.site.depot.mouth;
  }

  activeRing() { const st = STEPS[this.step]; return this.ringMeshes.filter((g) => g.userData.st === st)[this.ringIdx]; }

  update(dt, time, camera, w, h) {
    if (!this.on) return;
    this.t += dt;
    const st = STEPS[this.step], ship = this.ship;
    // advance
    if (st.rings) {
      const g = this.activeRing();
      if (g && g.position.distanceTo(ship.pos) < 8) { g.visible = false; this.ringIdx++; if (this.ringIdx >= st.rings.length) this.go(this.step + 1); }
    } else if (st.zone) {
      if (this.zone.position.distanceTo(ship.pos) < st.r && ship.vel.length() < 2.5) { this.zone.visible = false; this.go(this.step + 1); }
    } else if (st.item) {
      if (this.salvage.ropes.some((r) => r.item === this.item)) this.go(this.step + 1);
    } else if (st.dock) { if (this.nav.docked) this.go(this.step + 1); }
    else if (st.job) { if (this.career.c.active || this.career.econ.stats.jobs > this.jobBase) this.go(this.step + 1); }
    else if (st.suit) {
      // wrecks are far from the depot: skip the outside lesson only if no locker is left anywhere
      if (this.eva.state === 'eva') this.go(this.step + 1); else if (!this.lockers.nearest(ship.pos)) this.go(this.step + 3);
    } else if (st.cut) { if (this.econ.stats.lockers > this.base) this.go(this.step + 1); else if (this.eva.state === 'off') this.go(this.step - 1); }
    else if (st.back) { if (this.eva.state === 'off') this.finish(true); }
    if (!this.on) return;
    // rings: the current one glows hazard, later ones are faint ghosts
    const cur = STEPS[this.step].rings ? this.activeRing() : null;
    for (const g of this.ringMeshes) {
      if (!g.visible) continue;
      const hot = g === cur;
      g.userData.tor.material = hot ? this.hotMat : this.mat;
      for (const t of g.userData.ticks.children) t.material = g.userData.tor.material;
      g.userData.ticks.rotation.z = this.reduced ? 0 : time * (hot ? 0.8 : 0.15);
      const s = hot && !this.reduced ? 1 + 0.04 * Math.sin(time * 5) : 1; g.scale.setScalar(s);
    }
    this.zoneMat.uniforms.uA.value = STEPS[this.step].zone ? 0.55 + 0.2 * Math.sin(time * 4) : 0.15;
    // glyph follows the target, clamped on screen
    const st2 = STEPS[this.step];
    let p;
    if (st2.job) { p = null; } else if (st2.back) { p = this.eva.state === 'eva' ? this.eva.shipPoint(this._seat || (this._seat = new THREE.Vector3(0, 0.5, 0)), new THREE.Vector3()).project(camera) : null; } else p = this.target().clone().project(camera);
    if (!p) { this.g.style.transform = `translate(${(w / 2).toFixed(0)}px,${(this.input.touchMode ? 300 : h - 345).toFixed(0)}px)`; return; }
    let x = (p.x * 0.5 + 0.5) * w + Math.min(90, w * 0.12), y = (-p.y * 0.5 + 0.5) * h - 20;
    if (p.z > 1 || x < 80 || x > w - 80 || y < 90 || y > h - 120) { x = w / 2; y = h * 0.68; }
    this.g.style.transform = `translate(${x.toFixed(0)}px,${y.toFixed(0)}px)`;
  }
}
