import * as THREE from 'three';
import { K } from './gpufx.js';
import { addHullDetail } from './hullDetail.js';

// Story contracts: a short chain of jobs from the depot foreman that walks you through every system and ends at
// a derelict nobody has seen in years. One contract is live at a time; progress is saved. Finishing one pays out,
// plays a short transmission, and hands you the next. The last asks you to cut the Vesper's flight recorder free
// and bring it home.
const STEPS = [
  { id: 'haul', title: 'First haul', goal: 2, reward: 400, say: 'Deliver 2 pieces of salvage to the depot',
    intro: 'New hands start small. Bring me two pieces of anything and you get paid twice.' },
  { id: 'section', title: 'Cold iron', goal: 1, reward: 900, say: 'Cut the freighter\'s bridge or engine block free and deliver it',
    intro: 'The freighter out past the field is coming apart. Go outside, cut the struts on a big section, then haul it in. It\'s heavy: Hold mode (Z) helps.' },
  { id: 'core', title: 'Hot rocks', goal: 1, reward: 1200, say: 'Unclamp a reactor core and deliver it',
    intro: 'Its reactor still runs warm. Cut the two clamps, never the frosted coolant line, and bring the core to me.' },
  { id: 'drones', title: 'Pest control', goal: 3, reward: 800, say: 'Wreck or jam 3 rival drones',
    intro: 'Somebody\'s drones are stripping the yard. Ram them, or buy a jammer and stun them. Three will do.' },
  { id: 'signal', title: 'Ghost signal', goal: 1, reward: 500, say: 'Deep-scan (C) inside the debris field',
    intro: 'Strange one. There\'s a ping on an old distress band out in the debris field. Sweep it with your scanner.' },
  { id: 'vesper', title: 'The Vesper', goal: 1, reward: 3000, say: 'Cut the Vesper\'s flight recorder free and bring it home',
    intro: 'It\'s the Vesper. She vanished eleven years ago with her crew. Her recorder is orange, bolted to the hull. Bring it to me.' },
];
const DONE_SAY = [
  'Good. You\'ll do.',
  'That\'s a lot of steel. Nice work.',
  'Clean cut. I\'ve seen people lose a ship doing that.',
  'Quieter out there already.',
  'Got it. It isn\'t coming from the field at all.',
  '',
];
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Story {
  constructor({ econ, world, salvage, scene, fx, getFxT, toast, sound, nav }) {
    Object.assign(this, { econ, world, salvage, scene, fx, getFxT, toast, sound, nav });
    this.s = econ.story; this.t = 0;
    this.site = world.site.vesper;
    this.buildDom();
    if (this.site) { this.site.hidden = this.s.step < 5; this.buildRecorder(); }
    if (this.s.seen !== this.s.step && this.cur) setTimeout(() => this.comms(this.cur.intro), 4000);
  }

  get cur() { return STEPS[this.s.step] || null; }
  get done() { return this.s.step >= STEPS.length; }

  buildDom() {
    // the transmission card (contact name + a line or two), and the ending
    this.el = document.createElement('div'); this.el.id = 'comms'; document.body.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.el.classList.remove('show'); });
    this.end = document.createElement('div'); this.end.id = 'ending'; document.body.appendChild(this.end);
  }

  comms(text, title) {
    const c = this.cur;
    this.s.seen = this.s.step; this.econ.save(true);
    this.el.innerHTML = `<span class="mono">Ilse Marrow · depot foreman</span>${title || c ? `<b>${title || c.title}</b>` : ''}<p>${text}</p>`;
    this.el.classList.add('show'); this.t = 9;
    this.sound?.tonePing(660, 0.2, 0.08, 'triangle'); setTimeout(() => this.sound?.tonePing(880, 0.25, 0.08, 'triangle'), 160);
  }

  // ---- progress -------------------------------------------------------------------------------
  add(id, n = 1) {
    const c = this.cur; if (!c || c.id !== id) return;
    this.s.prog = Math.min(c.goal, (this.s.prog || 0) + n); this.econ.save(true);
    if (this.s.prog >= c.goal) this.complete();
  }

  complete() {
    const c = this.cur, i = this.s.step;
    this.econ.bonus(c.reward); this.nav?.pop(c.reward);
    this.s.step++; this.s.prog = 0; this.econ.save();
    this.toast('done', c.reward);
    if (c.id === 'signal' && this.site) { this.site.hidden = false; }
    if (this.done) { this.ending(); return; }
    setTimeout(() => this.comms(`${DONE_SAY[i]} ${this.cur.intro}`.trim()), 1600);
  }

  onDeliver(it) {
    if (it.storyRec) { this.add('vesper'); return; }
    this.add('haul');
    if (it.section) this.add('section');
    if (it.kind === 'core') this.add('core');
  }
  onSection() {}
  onCoreFree() {}
  onDrone() { this.add('drones'); }
  onJam(n) { if (n > 0) this.add('drones', n); }
  onSweep(origin, r) {
    const f = this.world.site.field; if (!this.cur || this.cur.id !== 'signal' || this.swept) return;
    if (origin.distanceTo(f.pos) < f.radius + 60 && r > 120) { this.swept = true; setTimeout(() => { this.swept = false; this.add('signal'); this.toast('info', 'Signal traced: the Vesper'); }, 600); }
  }

  // what the objective line should say for the live contract
  objective() {
    const c = this.cur; if (!c) return null;
    let sub = c.goal > 1 ? `${this.s.prog || 0}/${c.goal}` : 'Story contract';
    if (c.id === 'vesper' && this.rec) {
      const st = this.rec.state;
      if (st === 'bolted') sub = `Bolts ${this.rec.bolts.filter((b) => b.cut).length}/4`;
      else if (st === 'free') sub = 'Tow it to the depot';
    }
    return [c.say, sub, c.title];
  }
  // where the contract wants you (for the EVA waypoint and markers)
  target(from) {
    const c = this.cur; if (!c) return null;
    if (c.id === 'vesper' && this.rec && this.rec.state === 'bolted') return this.rec.g.getWorldPosition(_w);
    return null;
  }

  // ---- the Vesper's flight recorder: an orange box bolted in a recess on the hub, four bolts --------------
  buildRecorder() {
    const site = this.site, hub = site.byName.hub || site.parts[0]; if (!hub) return;
    hub.sync(0);
    const o = hub.obbs.reduce((m, x) => (x.h.lengthSq() > m.h.lengthSq() ? x : m), hub.obbs[0]);
    // the face of the hub box that points most "up" in the site frame
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(site.group.quaternion);
    let best = null; for (let a = 0; a < 3; a++) for (const s of [-1, 1]) { const n = new THREE.Vector3().setComponent(a, s).applyQuaternion(o.q); const d = n.dot(up); if (!best || d > best.d) best = { n, a, s, d }; }
    const p = o.c.clone().addScaledVector(best.n, o.h.getComponent(best.a) + 0.02);
    // raycast down onto the real mesh so the box sits on the hull
    const rc = new THREE.Raycaster(p.clone().addScaledVector(best.n, 6), best.n.clone().negate(), 0, 20); const meshes = []; hub.node.traverse((m) => { if (m.isMesh) meshes.push(m); });
    const h = rc.intersectObjects(meshes, false)[0]; if (h) p.copy(h.point);
    const g = this.buildBox(); g.position.copy(p); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), best.n);
    this.scene.add(g); g.updateMatrixWorld(true); hub.node.attach(g);
    const bolts = [[-0.62, -0.38], [0.62, -0.38], [0.62, 0.38], [-0.62, 0.38]].map(([x, z]) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 6), new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 0.3, metalness: 0.95 })); m.position.set(x, 0.1, z); g.add(m);
      return { m, local: new THREE.Vector3(x, 0.12, z), heat: 0, cut: false };
    });
    this.rec = { g, bolts, state: this.s.step > 5 ? 'gone' : 'bolted', item: null };
    if (this.s.step > 5) g.visible = false;
  }

  buildBox() {
    const g = new THREE.Group();
    const orange = addHullDetail(new THREE.MeshStandardMaterial({ color: 0xd2541c, roughness: 0.5, metalness: 0.3 }), { scale: 3, grime: 1.2, scratch: 0.9, bump: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1f2226, roughness: 0.5, metalness: 0.7 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.62, 0.7), orange); body.position.y = 0.42; g.add(body);
    for (const x of [-0.6, 0.6]) { const cap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.78), dark); cap.position.set(x, 0.42, 0); g.add(cap); }
    for (const z of [-0.2, 0, 0.2]) { const rib = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.05, 0.04), dark); rib.position.set(0, 0.74, z); g.add(rib); }
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.03, 6, 14, Math.PI), dark); handle.position.set(0, 0.74, 0); g.add(handle);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 1.0), dark); base.position.y = 0.05; g.add(base);
    const lampM = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.9, 0.25), toneMapped: false });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), lampM); lamp.position.set(0.4, 0.76, 0.3); g.add(lamp);
    g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    g.userData = { lamp, body };
    return g;
  }

  // EVA picker: the recorder's bolts
  pick(o, d, far) {
    const R = this.rec; if (!R || R.state !== 'bolted' || this.s.step !== 5) return null;
    let best = null;
    for (const b of R.bolts) {
      if (b.cut) continue;
      const wp = R.g.localToWorld(b.local.clone());
      const t = _v.copy(wp).sub(o).dot(d); if (t < 0 || t > far + 0.5) continue;
      if (_v.copy(o).addScaledVector(d, t).distanceTo(wp) > 0.4) continue;
      if (best && best.dist < t) continue;
      best = { kind: 'bolt', dist: t, point: wp, normal: _w.set(0, 1, 0).applyQuaternion(R.g.getWorldQuaternion(_q)).clone(), work: (dt) => this.work(b, dt), prog: () => b.heat };
    }
    return best;
  }

  work(b, dt) {
    b.heat = Math.min(1, b.heat + dt / 0.9);
    if (b.heat < 1 || b.cut) return null;
    b.cut = true; b.m.visible = false;
    if (this.rec.bolts.every((x) => x.cut)) { this.release(); return 'pop'; }
    return 'bolt';
  }

  // all bolts cut: the box becomes tow salvage
  release() {
    const R = this.rec; R.state = 'free';
    R.g.updateMatrixWorld(true); const p = R.g.localToWorld(new THREE.Vector3(0, 0.6, 0));
    const it = this.salvage.spawn(this.site, { type: 'crate', at: [0, 0, 0] });
    this.scene.remove(it.obj);
    const box = this.buildBox(); box.children.forEach((c) => { c.position.y -= 0.42; });
    it.obj = box; this.scene.add(box);
    it.body.pos.copy(p); it.body.quat.copy(R.g.getWorldQuaternion(_q)); it.body.vel.set(0, 0, 0); it.body.angVel.set(0.05, 0.1, 0.02); it.body.updateSpheres();
    it.value = 0; it.story = true; it.storyRec = true; it.label = 'Flight recorder';
    R.g.visible = false; R.item = it;
    this.toast('info', 'Recorder free: tow it home');
  }

  update(dt, time) {
    if (this.t > 0) { this.t -= dt; if (this.t <= 0) this.el.classList.remove('show'); }
    const R = this.rec; if (!R) return;
    if (R.state === 'bolted') R.g.userData.lamp.visible = Math.sin(time * 3) > 0;
    if (R.item && R.item.obj) R.item.obj.userData.lamp.visible = Math.sin(time * 3) > 0;
    for (const b of R.bolts) if (!b.cut) { b.heat = Math.max(0, b.heat - dt * 0.3); b.m.material.emissive.setRGB(b.heat * 3, b.heat, b.heat * 0.25); }
    // the recorder lost (a drone can't take it; it can drift) or destroyed: put a fresh one back on the hull
    if (R.item && (R.item.state === 'gone') && this.s.step === 5) { R.item = null; R.state = 'bolted'; R.g.visible = true; for (const b of R.bolts) { b.cut = false; b.heat = 0; b.m.visible = true; } }
  }

  ending() {
    this.end.innerHTML = `<div class="c"><span class="mono">Flight recorder · the Vesper</span><h1>Last entry</h1>
      <p>Eleven years old. The crew logged the same signal you followed, then turned toward the planet's night side.</p>
      <p>The final line is a set of coordinates. They point at the depot.</p>
      <p class="sig">Ilse: "I'll take it from here. Get some rest."</p>
      <button>Keep salvaging</button></div>`;
    this.end.classList.add('show'); if (document.pointerLockElement) document.exitPointerLock();
    this.end.querySelector('button').addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); this.end.classList.remove('show'); });
  }
}
