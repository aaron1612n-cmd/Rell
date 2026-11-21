import * as THREE from 'three';
import { suitMaterials, buildAstronaut, poseBody, restPose } from './astronaut.js';
import { UPG } from './economy.js';
import { SYS } from './systems.js';
import { UP_ICONS } from './hangar.js';
import { SHIPS, derived, fmtCr, G0 } from './fleetData.js';
import { ILSE, HOLO, COUNTER, BED } from './base.js';

// Ilse Marrow, the yard foreman, behind the counter in the base. Float up to her and talk (G / Hatch): she does
// your Skiff's upgrades and repairs, sells ships out of the yard catalogue (shipped in by container), files salvage
// claims on derelicts you've brought home, and runs your fleet (fly, recall, sell).
//
// The counter screen is a yard ticket: bone paper, ink type, one rust stamp. It docks right on desktop and as a
// bottom sheet on phones so Ilse stays in view. Real clicks and taps (input.js keeps native touch on #ticket).

const svg = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const SAY = {
  hello: ['Back in one piece. What do you need?', 'Hull still holding? Good. What can I do?', 'You smell like a reactor. Shopping?'],
  skiff: 'Your jet. I can tune it, if the credits are there.',
  yard: 'Everything here ships in a sealed can. The hangar makes room.',
  derelict: 'Bring a wreck within reach of the yard and I\'ll file the claim. Or I\'ll buy the scrap rights.',
  fleet: 'Your berths. Take one out, call one home, or let one go.',
  bought: ['Done. It\'ll feel different out there.', 'Fitted. Try not to break it.', 'That\'s a good one.'],
  broke: 'You\'re short. Come back with more salvage.',
  order: 'Order\'s in. Watch the window.',
  claim: 'Filed. The tug will bring her in.',
  sold: 'Sold. The credits are on your card.',
  max: 'That\'s as far as it goes.',
  fixed: 'Patched. She\'s whole again.',
};
const pick = (a) => (Array.isArray(a) ? a[(Math.random() * a.length) | 0] : a);

export class Merchant {
  constructor({ base, yard, fleet, econ, systems, sound, env, input, menu, onBuy, onFly, onSleep, tutorial }) {
    Object.assign(this, { base, yard, fleet, econ, systems, sound, input, menu, onBuy, onFly, onSleep, tutorial });
    this.open = false; this.tab = 'skiff'; this.sel = null; this.say = ''; this.talkT = 0;
    this.buildNpc(env); this.buildHolo(); this.buildDom();
  }

  // ---- the NPC: a working suit in yard colours, feet hooked in the counter's loops ----
  buildNpc(env) {
    const M = suitMaterials(env);
    M.suit.color.set(0x8a6a52); M.hard.color.set(0x9a9a92); M.glove.color.set(0x6a6460);
    M.visor.color.set(0x4a3a2a); M.visor.envMapIntensity = 1.2; M.visor.metalness = 0.7;
    const a = this.npc = buildAstronaut(M); a.name = 'ilse';
    a.userData.tool.visible = false;
    for (const n of a.userData.nozzles) n.throat.visible = false;
    this.P = restPose(); this.P.empty = true;
    a.rotation.y = Math.PI; a.position.copy(ILSE);
    this.base.inner.add(a);
    // settle her feet into the loops: pose once, find the lowest boot, drop the body onto the floor
    poseBody(a, this.P); a.updateMatrixWorld(true);
    this.base.inner.updateWorldMatrix(true, true); const box = new THREE.Box3().setFromObject(a), low = this.base.inner.worldToLocal(box.min.clone()); a.position.y += (-5.86 - low.y);
    this.home = a.position.clone();
    // a tablet she holds and taps
    const tab = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.015, 0.3), new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.4, metalness: 0.5 }));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.26), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.9, 1.1), toneMapped: false }));
    scr.rotation.x = -Math.PI / 2; scr.position.y = 0.009; tab.add(scr);
    a.userData.armL.glove.group.add(tab); tab.position.set(0.02, -0.12, -0.02); tab.rotation.set(0.3, 0, 1.2);
    this.tablet = tab;
  }

  // the selected ship as a turning hologram over the projector on the counter
  buildHolo() {
    const g = this.holo = new THREE.Group(); g.position.copy(HOLO); this.base.inner.add(g);
    this.holoMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.0, 1.4), wireframe: true, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.36, 1.0, 20, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.45, 0.6), transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }));
    cone.position.y = -0.55; g.add(cone);
    this.holoShip = null; this.holoId = null;
  }
  showHolo(id) {
    if (id === this.holoId) return; this.holoId = id;
    if (this.holoShip) { this.holo.remove(this.holoShip); this.holoShip = null; }
    const S = id && this.fleet.byId[id]; if (!S) return;
    const c = S.node.clone(true); c.traverse((o) => { if (o.isMesh) { o.material = this.holoMat; o.castShadow = o.receiveShadow = false; } if (o.isSprite) o.visible = false; });
    const d = S.d, sz = Math.max(d.max[0] - d.min[0], d.max[1] - d.min[1], d.max[2] - d.min[2]);
    const w = new THREE.Group(); w.add(c); w.scale.setScalar(1.3 / sz);
    c.position.set(-(d.min[0] + d.max[0]) / 2, -(d.min[1] + d.max[1]) / 2, -(d.min[2] + d.max[2]) / 2).add(_v.copy(c.position));
    this.holo.add(w); this.holoShip = w;
  }

  // ---- per frame ----
  update(dt, time, eva) {
    const a = this.npc, P = this.P, b = this.base;
    this.near = b.here === 1 && eva.state === 'eva' && b.local(eva.pilot.pos, _v).distanceTo(COUNTER) < 3.4;
    this.nearBed = b.here === 3 && eva.state === 'eva' && b.local(eva.pilot.pos, _v).distanceTo(BED) < 2.6;
    b.nearCounter = this.near; b.nearBed = this.nearBed;
    if (!b.near) { this.holo.visible = false; return; }
    this.holo.visible = !!this.holoShip;
    if (this.holoShip) { this.holoShip.rotation.y += dt * 0.5; this.holoMat.opacity = 0.26 + 0.08 * Math.sin(time * 7) * Math.sin(time * 2.3); }
    // she looks at you when you're in the room, gestures while talking, taps the tablet otherwise
    P.t = time; P.breath = Math.sin(time * 1.6);
    let yaw = 0, pitch = 0;
    if (eva.state === 'eva' && b.here === 1) {
      a.updateMatrixWorld(true); const head = a.userData.head.getWorldPosition(_v2);
      const to = _v.copy(eva.pilot.pos).sub(head); a.getWorldQuaternion(_q).invert(); to.applyQuaternion(_q);
      yaw = THREE.MathUtils.clamp(Math.atan2(-to.x, -to.z), -0.9, 0.9); pitch = THREE.MathUtils.clamp(Math.atan2(to.y, Math.hypot(to.x, to.z)), -0.4, 0.5);
    }
    P.head.x = THREE.MathUtils.damp(P.head.x, pitch, 4, dt); P.head.y = THREE.MathUtils.damp(P.head.y, yaw, 4, dt);
    this.talkT = Math.max(0, this.talkT - dt);
    const talk = Math.min(1, this.talkT), g = Math.sin(time * 3.1) * Math.sin(time * 1.7);
    P.armR.set(0.08 * talk + 0.02 * g * talk, 0.14 * talk + 0.05 * g * talk, -0.12 * talk);
    P.armL.set(0.06, 0.12 + 0.01 * Math.sin(time * 0.9), -0.1);   // the tablet hand, raised a little
    P.lean.set(0.06 * Math.sin(time * 0.4), yaw * 0.25, 0.02 * Math.sin(time * 0.3));
    a.position.y = this.home.y + 0.015 * Math.sin(time * 0.8);
    poseBody(a, P);
  }

  // ---- the counter screen ----
  buildDom() {
    const css = document.createElement('style'); css.textContent = `
#ticket{--paper:#e6dfcc;--ink:#1d1f22;--soft:#5d5a52;--rule:rgba(29,31,34,.18);--stamp:#b5461c;--hot:#e8561a;
position:fixed;z-index:7;top:max(14px,env(safe-area-inset-top));right:max(14px,env(safe-area-inset-right));bottom:max(14px,env(safe-area-inset-bottom));width:min(430px,calc(100vw - 28px));
display:none;flex-direction:column;background:var(--paper);color:var(--ink);font:500 12px/1.4 ui-monospace,Menlo,Consolas,monospace;
box-shadow:0 18px 50px rgba(0,0,0,.55);clip-path:polygon(0 0,100% 0,100% 100%,0 100%);transform:translateX(24px);opacity:0;transition:transform .28s cubic-bezier(.2,.8,.2,1),opacity .2s}
#ticket.show{display:flex}#ticket.in{transform:none;opacity:1}
#ticket::before{content:'';position:absolute;left:-6px;top:0;bottom:0;width:12px;background:radial-gradient(circle at 6px 9px,transparent 4px,var(--paper) 4.5px) 0 0/12px 18px repeat-y}
#ticket::after{content:'';position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(0,0,0,.018) 0 1px,transparent 1px 3px);mix-blend-mode:multiply}
#ticket .hd{display:grid;grid-template-columns:1fr auto;gap:4px 12px;padding:16px 18px 10px 22px;border-bottom:2px solid var(--ink)}
#ticket .hd small{grid-column:1/-1;font-size:9px;letter-spacing:.24em;text-transform:uppercase;color:var(--soft)}
#ticket .hd h2{margin:0;font:800 19px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase}
#ticket .hd .cr{text-align:right;font-variant-numeric:tabular-nums}#ticket .hd .cr b{display:block;font-size:17px}#ticket .hd .cr span{font-size:9px;letter-spacing:.2em;color:var(--soft)}
#ticket .say{position:relative;margin:12px 18px 6px 22px;padding:9px 12px 9px 14px;border-left:3px solid var(--stamp);font-size:12.5px;font-style:italic;color:#2a2b2d;min-height:2.8em}
#ticket .tabs{display:flex;gap:0;margin:6px 18px 0 22px;border-bottom:1px solid var(--ink)}
#ticket .tabs button{flex:1;min-height:40px;font:700 10.5px ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--soft);background:none;border:0;border-bottom:3px solid transparent;margin-bottom:-1px;cursor:pointer;padding:6px 2px}
#ticket .tabs button.on{color:var(--ink);border-bottom-color:var(--hot)}
#ticket .tabs button kbd{display:none}
#ticket .body{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:4px 18px 10px 22px}
#ticket .ln{display:grid;grid-template-columns:28px 1fr auto;gap:2px 10px;align-items:center;width:100%;text-align:left;background:none;border:0;border-bottom:1px dashed var(--rule);padding:10px 4px;color:inherit;font:inherit;cursor:pointer;min-height:52px}
#ticket .ln:hover,#ticket .ln.sel{background:rgba(29,31,34,.06)}
#ticket .ln svg{width:22px;height:22px;stroke:var(--ink);fill:none;stroke-width:1.7;stroke-linejoin:round;stroke-linecap:round}
#ticket .ln b{font-size:13px;letter-spacing:.06em;text-transform:uppercase}#ticket .ln em{display:block;font-style:normal;font-size:10.5px;color:var(--soft);margin-top:2px}
#ticket .ln .pr{font:800 13px ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
#ticket .ln .pr small{display:block;font-size:9px;font-weight:600;letter-spacing:.16em;color:var(--soft);text-transform:uppercase}
#ticket .ln.cant .pr{color:#9a948a;text-decoration:line-through}#ticket .ln.max .pr{color:var(--stamp)}
#ticket .pip{display:inline-flex;gap:3px;margin-left:8px;vertical-align:2px}#ticket .pip i{width:9px;height:5px;border:1.2px solid var(--ink)}#ticket .pip i.on{background:var(--ink)}
#ticket .ln.no{animation:tkno .35s}@keyframes tkno{25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
#ticket .det{margin:8px 0 4px;padding:12px;border:1.5px solid var(--ink);position:relative}
#ticket .det h3{margin:0 0 2px;font:800 15px ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase}#ticket .det p{margin:4px 0 8px;color:#3a3a38;font-size:11.5px}
#ticket .det dl{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 10px;margin:0 0 10px}#ticket .det dt{font-size:8.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--soft)}#ticket .det dd{margin:0;font-weight:700;font-variant-numeric:tabular-nums}
#ticket .acts{display:flex;gap:8px;flex-wrap:wrap}
#ticket .go{flex:1;min-height:44px;font:800 12px ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--paper);background:var(--ink);border:0;cursor:pointer;padding:10px 12px}
#ticket .go.hot{background:var(--hot);color:#1a0c05}#ticket .go.alt{background:none;color:var(--ink);border:1.5px solid var(--ink)}#ticket .go:disabled{opacity:.35;cursor:default}
#ticket .stamp{position:absolute;right:10px;top:10px;transform:rotate(-8deg);border:2px solid var(--stamp);color:var(--stamp);font:800 10px ui-monospace,Menlo,monospace;letter-spacing:.18em;padding:3px 6px;text-transform:uppercase;opacity:.85}
#ticket .note{color:var(--soft);font-size:10.5px;padding:10px 4px}
#ticket .ft{display:flex;align-items:center;gap:10px;padding:10px 18px 14px 22px;border-top:2px solid var(--ink)}
#ticket .ft .bye{min-height:42px;padding:0 16px;font:700 11px ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;background:none;border:1.5px solid var(--ink);color:var(--ink);cursor:pointer}
#ticket .ft span{flex:1;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--soft)}
body.touch #ticket .ft span{display:none}
@media (max-width:700px),(max-height:520px) and (pointer:coarse){
#ticket{top:auto;left:max(8px,env(safe-area-inset-left));right:max(8px,env(safe-area-inset-right));bottom:max(8px,env(safe-area-inset-bottom));width:auto;height:min(64vh,560px);transform:translateY(30px)}
#ticket::before{display:none}
#ticket .hd{padding:12px 14px 8px}#ticket .say{margin:8px 14px 4px;font-size:12px;min-height:0}#ticket .tabs,#ticket .body{margin-left:14px;margin-right:14px;padding-left:0;padding-right:0}#ticket .body{padding:2px 0 8px}
#ticket .ft{padding:8px 14px 10px}#ticket .det dl{grid-template-columns:repeat(3,1fr)}
}
@media (max-height:520px) and (pointer:coarse){#ticket{left:auto;width:min(420px,58vw);height:auto;top:max(8px,env(safe-area-inset-top))}#ticket .say{display:none}}
body.ticket #hud,body.ticket #btns,body.ticket #evabtns,body.ticket #stn,body.ticket #tut,body.ticket #board{opacity:0!important;pointer-events:none!important}
@media (prefers-reduced-motion:reduce){#ticket{transition:none}}
`; document.head.appendChild(css);
    const el = this.el = document.createElement('div'); el.id = 'ticket'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Yard counter');
    document.body.appendChild(el);
    el.addEventListener('click', (e) => this.onClick(e));
    addEventListener('keydown', (e) => {
      if (!this.open || e.repeat) return;
      const c = e.code;
      if (c === 'Escape' || c === 'KeyG') { e.preventDefault(); e.stopImmediatePropagation(); this.toggle(false); return; }
      const tabs = ['skiff', 'yard', 'derelict', 'fleet'];
      if (c === 'Tab' || c === 'ArrowRight' || c === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); const i = tabs.indexOf(this.tab), d = c === 'ArrowLeft' || e.shiftKey ? -1 : 1; this.setTab(tabs[(i + d + 4) % 4]); return; }
      if (c.startsWith('Digit')) { const i = +c.slice(5) - 1, rows = [...el.querySelectorAll('.ln')]; if (rows[i]) { e.preventDefault(); e.stopImmediatePropagation(); rows[i].click(); } return; }
      if (c === 'Enter') { const go = el.querySelector('.go.hot:not(:disabled)'); if (go) { e.preventDefault(); e.stopImmediatePropagation(); go.click(); } }
      // swallow flight keys while the ticket is up
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'KeyR', 'KeyF', 'KeyC', 'KeyX', 'KeyV', 'KeyU', 'KeyL', 'KeyJ', 'KeyN', 'KeyZ', 'KeyB'].includes(c)) e.stopImmediatePropagation();
    }, true);
  }

  toggle(v) {
    if (v === this.open) return;
    if (v && this.base.busy()) return;
    this.open = v; document.body.classList.toggle('ticket', v);
    if (v) {
      this.say = pick(SAY.hello); this.talkT = 2.2; this.sel = null; this.tab = 'skiff';
      this.el.classList.add('show'); requestAnimationFrame(() => this.el.classList.add('in'));
      if (document.pointerLockElement) { if (this.menu) { this.menu.quiet = true; setTimeout(() => { this.menu.quiet = false; }, 300); } document.exitPointerLock(); }
      this.render(); this.sound?.step?.();
      if (this.tutorial) this.tutorial.hangarSeen = true;
    } else {
      this.el.classList.remove('in'); setTimeout(() => { if (!this.open) this.el.classList.remove('show'); }, 220);
      this.showHolo(null);
    }
  }
  setTab(t) { this.tab = t; this.sel = null; this.say = SAY[t]; this.talkT = 1.4; this.render(); }
  line(s) { this.say = pick(s); this.talkT = 1.8; }

  render() {
    const E = this.econ, cr = E.credits, tabs = [['skiff', 'Skiff'], ['yard', 'Ships'], ['derelict', 'Salvage'], ['fleet', 'Fleet']];
    let body = '';
    if (this.tab === 'skiff') body = this.rowsSkiff(cr);
    else if (this.tab === 'yard') body = this.rowsYard(cr);
    else if (this.tab === 'derelict') body = this.rowsDerelict();
    else body = this.rowsFleet();
    this.el.innerHTML = `<div class="hd"><small>Rell Yard · counter 1</small><h2>Ilse Marrow</h2><div class="cr"><span>CREDITS</span><b>${fmtCr(cr)}</b></div></div>
      <div class="say">${this.say}</div>
      <div class="tabs" role="tablist">${tabs.map(([k, n]) => `<button data-tab="${k}" class="${this.tab === k ? 'on' : ''}" role="tab" aria-selected="${this.tab === k}">${n}</button>`).join('')}</div>
      <div class="body">${body}</div>
      <div class="ft"><button class="bye" data-a="bye">Done</button><span>1–9 pick · Tab switch · Esc leave</span></div>`;
    const sel = this.el.querySelector('.det') || this.el.querySelector('.ln.sel'); if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  rowsSkiff(cr) {
    const E = this.econ;
    const rows = Object.keys(UPG).map((k) => {
      const u = UPG[k], lvl = E.up[k] || 0, p = E.price(k), st = p === null ? 'max' : p > cr ? 'cant' : '';
      return `<button class="ln ${st}" data-a="up" data-k="${k}">${svg(UP_ICONS[k])}<div><b>${u.name}</b><span class="pip">${Array.from({ length: u.max }, (_, j) => `<i class="${j < lvl ? 'on' : ''}"></i>`).join('')}</span><em>${u.say}</em></div><div class="pr">${p === null ? 'MAX' : fmtCr(p)}${p === null ? '' : '<small>cr</small>'}</div></button>`;
    }).join('');
    const broken = this.systems.list(), cost = this.systems.cost();
    const fix = broken.length
      ? `<button class="ln ${cost > cr ? 'cant' : ''}" data-a="fix">${svg(UP_ICONS.wrench)}<div><b>Repair</b><em>${broken.map((k) => SYS[k].name).join(', ')}</em></div><div class="pr">${fmtCr(cost)}<small>cr</small></div></button>`
      : '';
    return fix + rows;
  }
  stats(s) {
    const d = derived(s);
    const st = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
    return `<dl>${st('Length', `${s.len} m`)}${st('Accel', `${(d.accel / G0).toFixed(2)} g`)}${st('Top', `${s.maxSpd} m/s`)}${st('Turn', `${s.turn}°/s`)}${st('Cargo', `${fmtCr(s.cargo)} t`)}${st('Crew', `${s.crew}`)}</dl>`;
  }
  rowsYard(cr) {
    const ships = this.fleet.list().filter((s) => s.cat === 'yard');
    return ships.map((s) => {
      const own = s.owned, can = !own && cr >= s.price, sel = this.sel === s.id;
      const row = `<button class="ln ${sel ? 'sel' : ''} ${!own && !can ? 'cant' : ''}" data-a="pick" data-id="${s.id}">${svg('<path d="M12 3l3 7v7l-3 3-3-3v-7z"/><path d="M9 13l-4 3v2l4-1M15 13l4 3v2l-4-1"/>')}<div><b>${s.name}</b><em>${s.cls} · ${s.len} m</em></div><div class="pr">${own ? 'OWNED' : fmtCr(s.price)}${own ? '' : '<small>cr</small>'}</div></button>`;
      if (!sel) return row;
      const busy = this.base.busy();
      return row + `<div class="det">${own ? '<span class="stamp">Yours</span>' : ''}<h3>${s.name}</h3><p>${s.note}</p>${this.stats(s)}<div class="acts">${own ? '<span class="note">Berthed on the yard. Fly it from the Fleet tab.</span>' : `<button class="go hot" data-a="order" data-id="${s.id}" ${can && !busy ? '' : 'disabled'}>${busy ? 'Yard busy' : can ? `Order · ${fmtCr(s.price)}` : `Need ${fmtCr(s.price - cr)} more`}</button>`}</div></div>`;
    }).join('');
  }
  rowsDerelict() {
    const ds = this.fleet.list().filter((s) => s.cat === 'derelict' && !s.sold);
    if (!ds.length) return '<p class="note">Nothing on the books.</p>';
    return ds.map((s) => {
      const sel = this.sel === s.id;
      if (!s.found) return `<button class="ln cant" data-a="pick" data-id="${s.id}">${svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v5M12 16h.01"/>')}<div><b>Unknown</b><em>${s.cls} · ~${s.len} m · drifting</em></div><div class="pr">~${fmtCr(s.salvage)}<small>scrap</small></div></button>`;
      const where = s.owned ? 'Registered to you' : s.home ? 'In reach of the yard' : `${(s.dist / 1000).toFixed(1)} km out · fly it home`;
      const row = `<button class="ln ${sel ? 'sel' : ''}" data-a="pick" data-id="${s.id}">${svg('<path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="5"/><path d="M9.5 9.5l5 5"/>')}<div><b>${s.name}</b><em>${where}</em></div><div class="pr">${s.owned ? 'YOURS' : fmtCr(this.yard.sellValue(this.fleet.byId[s.id]))}${s.owned ? '' : '<small>scrap</small>'}</div></button>`;
      if (!sel) return row;
      const S = this.fleet.byId[s.id], canC = this.yard.canClaim(s.id), canS = this.yard.canSell(s.id);
      const acts = s.owned ? '<span class="note">Yours now. See the Fleet tab.</span>'
        : `<button class="go hot" data-a="claim" data-id="${s.id}" ${canC ? '' : 'disabled'}>${s.walk ? 'Register' : 'Claim · berth it'}</button><button class="go alt" data-a="sell" data-id="${s.id}" ${canS ? '' : 'disabled'}>Sell scrap · ${fmtCr(this.yard.sellValue(S))}</button>`;
      return row + `<div class="det"><h3>${s.name}</h3><p>${s.note}</p>${this.stats(s)}<div class="acts">${acts}</div>${!s.home && !s.owned ? '<p class="note">Take the helm and bring it within 1.4 km of the yard first.</p>' : ''}</div>`;
    }).join('');
  }
  rowsFleet() {
    const own = this.fleet.list().filter((s) => s.owned);
    if (!own.length) return '<p class="note">Just the Skiff for now. Ships tab when you\'re ready.</p>';
    return own.map((s) => {
      const r = this.yard.rec(s.id), sel = this.sel === s.id;
      const where = s.flying ? 'At the helm' : r?.parked ? 'In its berth' : s.home ? 'Out near the yard' : `${(s.dist / 1000).toFixed(1)} km out`;
      const row = `<button class="ln ${sel ? 'sel' : ''}" data-a="pick" data-id="${s.id}">${svg('<path d="M12 3l3 7v7l-3 3-3-3v-7z"/><path d="M9 13l-4 3v2l4-1M15 13l4 3v2l-4-1"/>')}<div><b>${s.name}</b><em>${where} · ${Math.round(s.cond * 100)}% hull</em></div><div class="pr">${fmtCr(this.yard.sellValue(this.fleet.byId[s.id]))}<small>resale</small></div></button>`;
      if (!sel) return row;
      const acts = `<button class="go hot" data-a="fly" data-id="${s.id}" ${s.home && !this.base.busy() ? '' : 'disabled'}>Fly it</button>${r && !r.parked ? `<button class="go alt" data-a="recall" data-id="${s.id}" ${this.yard.canRecall(s.id) ? '' : 'disabled'}>Tow home</button>` : ''}<button class="go alt" data-a="sell" data-id="${s.id}" ${this.yard.canSell(s.id) ? '' : 'disabled'}>Sell · ${fmtCr(this.yard.sellValue(this.fleet.byId[s.id]))}</button>`;
      return row + `<div class="det"><h3>${s.name}</h3><p>${s.note}</p>${this.stats(s)}<div class="acts">${acts}</div></div>`;
    }).join('');
  }

  onClick(e) {
    const b = e.target.closest('button'); if (!b || !this.el.contains(b)) return;
    e.stopPropagation();
    if (b.dataset.tab) return this.setTab(b.dataset.tab);
    const a = b.dataset.a, id = b.dataset.id, k = b.dataset.k;
    const no = () => { b.classList.remove('no'); void b.offsetWidth; b.classList.add('no'); };
    if (a === 'bye') return this.toggle(false);
    if (a === 'up') {
      const p = this.econ.price(k);
      if (p === null) { this.line(SAY.max); no(); }
      else if (this.econ.buy(k)) { this.onBuy?.(k); this.sound?.chime?.(false); this.line(SAY.bought); }
      else { this.line(SAY.broke); no(); this.sound?.tonePing?.(180, 0.2, 0.12, 'square'); }
      return this.render();
    }
    if (a === 'fix') {
      const c = this.systems.cost();
      if (this.econ.spend(c)) { this.systems.repairAll(); this.sound?.chime?.(false); this.line(SAY.fixed); } else { this.line(SAY.broke); no(); }
      return this.render();
    }
    if (a === 'pick') { this.sel = this.sel === id ? null : id; this.showHolo(this.sel); this.sound?.step?.(); return this.render(); }
    if (a === 'order') { if (this.yard.order(id)) { this.line(SAY.order); this.toggle(false); } else { this.line(SAY.broke); this.render(); } return; }
    if (a === 'claim') { if (this.yard.claim(id)) { this.line(SAY.claim); this.toggle(false); } return; }
    if (a === 'sell') { if (this.yard.sell(id)) { this.line(SAY.sold); if (this.base.busy()) this.toggle(false); else { this.sel = null; this.showHolo(null); this.render(); } } return; }
    if (a === 'recall') { if (this.yard.recall(id)) this.toggle(false); return; }
    if (a === 'fly') { this.toggle(false); this.onFly?.(id); }
  }
}
