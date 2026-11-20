import * as THREE from 'three';
import { CFG } from './ship.js';
import { UPG } from './economy.js';
import { SYS } from './systems.js';
import { buildDrone } from './drones.js';

// Override console: the crew's admin panel. ` (backquote) opens it on desktop, the pause menu has an
// Admin button on phones. The game keeps running underneath so every switch shows its effect live.
// Everything here hooks the live systems through window.__game-style refs passed in from main.js.
const KEY = 'rell.admin';
const PERSIST = ['god', 'fuel', 'o2', 'noclip', 'thrust', 'speed', 'turn', 'tow', 'stats', 'drones', 'events'];
const DEF = { god: false, fuel: false, o2: false, noclip: false, thrust: 1, speed: 1, turn: 1, tow: 0, stats: false, drones: 'auto', events: true,
  time: 1, frozen: false, free: false, orbit: false, camSpeed: 40, orbitDist: 26, letter: false, colliders: false, wire: false };
const TABS = [['pilot', 'Pilot'], ['warp', 'Warp'], ['spawn', 'Spawn'], ['world', 'World'], ['cam', 'Camera'], ['cash', 'Cash'], ['story', 'Career'], ['debug', 'Debug'], ['saves', 'Saves']];
const SLOT = (i) => `rell.admin.slot${i}`;
const fmtN = (v) => Math.round(v).toLocaleString('en-US');
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _up = new THREE.Vector3(0, 1, 0);

const CSS = `
#adm{--plate:#0a0c0f;--line:rgba(232,224,204,.14);position:fixed;z-index:8;top:0;right:0;bottom:0;width:min(452px,100vw);display:none;grid-template-columns:84px 1fr;grid-template-rows:auto 1fr;
  background:var(--plate);background-image:linear-gradient(rgba(232,224,204,.025) 1px,transparent 1px);background-size:100% 28px;color:var(--bone);
  border-left:1px solid rgba(232,224,204,.2);box-shadow:-30px 0 60px rgba(0,0,0,.45);font:500 12px/1.35 ui-monospace,"SF Mono",Menlo,Consolas,monospace;touch-action:pan-y;user-select:none;-webkit-user-select:none}
#adm.show{display:grid;animation:admIn .26s cubic-bezier(.2,.8,.2,1)}
#adm::before{content:"";position:absolute;left:-7px;top:0;bottom:0;width:6px;background:repeating-linear-gradient(-45deg,var(--hazard) 0 9px,#07090d 9px 18px);background-size:100% 400px}
#adm.show::before{animation:admTape .9s cubic-bezier(.3,.7,.2,1)}
@keyframes admIn{from{transform:translateX(104%)}to{transform:none}}
@keyframes admTape{from{background-position:0 -400px}to{background-position:0 0}}
#adm header{grid-column:1/3;display:flex;align-items:center;gap:12px;padding:calc(max(10px,env(safe-area-inset-top)) + 4px) 12px 10px 14px;border-bottom:1px solid var(--line)}
#adm header h2{margin:0;font:700 26px/1 "Bahnschrift","DIN Alternate","Arial Narrow","Roboto Condensed",sans-serif;letter-spacing:.12em;text-transform:uppercase}
#adm header small{display:block;color:var(--dim);font-size:10px;letter-spacing:.14em;text-transform:uppercase;margin-top:3px}
#adm header .x{margin-left:auto;width:40px;height:40px;border:1.5px solid rgba(232,224,204,.35);background:none;color:var(--bone);font:600 18px/1 ui-monospace,Menlo,monospace;cursor:pointer;padding:0}
#adm nav{display:flex;flex-direction:column;border-right:1px solid var(--line);overflow-y:auto;padding:6px 0}
#adm nav button{display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:9px 10px;background:none;border:0;border-left:3px solid transparent;color:var(--dim);cursor:pointer;text-align:left;font:inherit}
#adm nav button i{font-style:normal;font-size:9px;letter-spacing:.1em}
#adm nav button b{font:700 13px/1.1 "Bahnschrift","DIN Alternate","Arial Narrow","Roboto Condensed",sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--bone)}
#adm nav button.on{border-left-color:var(--hazard);background:rgba(255,90,31,.08)}#adm nav button.on i{color:var(--hazard)}
#adm .body{overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:4px 14px calc(28px + env(safe-area-inset-bottom)) 14px}
#adm h4{margin:18px 0 8px;font:600 10px ui-monospace,Menlo,monospace;letter-spacing:.2em;text-transform:uppercase;color:var(--hazard);display:flex;gap:8px;align-items:center}
#adm h4::after{content:"";flex:1;height:1px;background:var(--line)}
#adm .atg{display:grid;grid-template-columns:1fr auto;align-items:center;gap:2px 12px;width:100%;padding:9px 0;background:none;border:0;border-bottom:1px dashed var(--line);color:var(--bone);text-align:left;cursor:pointer;font:inherit}
#adm .atg b{font:700 15px/1.1 "Bahnschrift","DIN Alternate","Arial Narrow","Roboto Condensed",sans-serif;letter-spacing:.06em;text-transform:uppercase}
#adm .atg em{grid-column:1;font-style:normal;color:var(--dim);font-size:10.5px}
#adm .atg u{grid-row:1/3;grid-column:2;text-decoration:none;min-width:44px;padding:5px 0;text-align:center;border:1.5px solid rgba(232,224,204,.3);font-size:10px;letter-spacing:.14em;color:var(--dim)}
#adm .atg.on u{background:var(--hazard);border-color:var(--hazard);color:#07090d;font-weight:700}
#adm .agrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:6px;margin:6px 0}
#adm .agrid.two{grid-template-columns:1fr 1fr}
#adm .abt{min-height:38px;padding:7px 8px;background:rgba(7,9,13,.6);border:1.5px solid rgba(232,224,204,.28);color:var(--bone);font:600 10.5px/1.2 ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;text-align:center}
#adm .abt:hover{border-color:rgba(232,224,204,.6)}#adm .abt:active,#adm .abt.hit{background:var(--bone);color:#07090d}
#adm .abt.hot{border-color:var(--hazard);color:var(--hazard)}#adm .abt.on{background:var(--hazard);border-color:var(--hazard);color:#07090d}
#adm .abt:disabled{opacity:.3;cursor:default}
#adm .arg{display:grid;grid-template-columns:1fr auto;gap:4px 10px;align-items:center;padding:8px 0;border-bottom:1px dashed var(--line)}
#adm .arg b{font:700 14px/1.1 "Bahnschrift","DIN Alternate","Arial Narrow","Roboto Condensed",sans-serif;letter-spacing:.06em;text-transform:uppercase}
#adm .arg span{color:var(--hazard);font-variant-numeric:tabular-nums}
#adm input[type=range]{grid-column:1/3;-webkit-appearance:none;appearance:none;width:100%;height:28px;background:none;margin:0;touch-action:pan-x}
#adm input[type=range]::-webkit-slider-runnable-track{height:2px;background:rgba(232,224,204,.35)}
#adm input[type=range]::-moz-range-track{height:2px;background:rgba(232,224,204,.35)}
#adm input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:24px;margin-top:-11px;background:var(--hazard);border:0}
#adm input[type=range]::-moz-range-thumb{width:12px;height:24px;background:var(--hazard);border:0;border-radius:0}
#adm .aseg{display:flex;gap:0;margin:6px 0;border:1.5px solid rgba(232,224,204,.28)}
#adm .aseg button{flex:1;padding:9px 4px;background:none;border:0;border-right:1px solid rgba(232,224,204,.2);color:var(--dim);font:600 10.5px ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;cursor:pointer}
#adm .aseg button:last-child{border-right:0}#adm .aseg button.on{background:var(--bone);color:#07090d}
#adm .akv{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;padding:6px 0;font-variant-numeric:tabular-nums}#adm .akv dt{color:var(--dim)}#adm .akv dd{margin:0;text-align:right}
#adm .abig{font:700 34px/1 "Bahnschrift","DIN Alternate","Arial Narrow","Roboto Condensed",sans-serif;letter-spacing:.02em;font-variant-numeric:tabular-nums;margin:6px 0 2px}
#adm .abig small{font:500 11px ui-monospace,Menlo,monospace;color:var(--dim);margin-left:6px;letter-spacing:.1em}
#adm .aup{display:grid;grid-template-columns:1fr auto 40px 40px;gap:8px;align-items:center;padding:6px 0;border-bottom:1px dashed var(--line)}
#adm .aup b{font:700 14px/1.1 "Bahnschrift","DIN Alternate","Arial Narrow","Roboto Condensed",sans-serif;letter-spacing:.06em;text-transform:uppercase}
#adm .aup s{text-decoration:none;display:flex;gap:3px}#adm .aup s i{width:9px;height:9px;border:1.5px solid rgba(232,224,204,.4)}#adm .aup s i.f{background:var(--hazard);border-color:var(--hazard)}
#adm .aup .abt{min-height:34px;padding:0;font-size:15px}
#adm .ali{display:grid;grid-template-columns:1fr auto;gap:2px 8px;align-items:center;padding:8px 0;border-bottom:1px dashed var(--line)}
#adm .ali b{font:700 14px/1.1 "Bahnschrift","DIN Alternate","Arial Narrow","Roboto Condensed",sans-serif;letter-spacing:.06em;text-transform:uppercase}
#adm .ali em{font-style:normal;color:var(--dim);font-size:10px;grid-column:1}
#adm .ali div{grid-row:1/3;grid-column:2;display:flex;gap:5px}#adm .ali .abt{min-height:34px;min-width:58px}
#adm p.n{color:var(--dim);font-size:10.5px;margin:4px 0}
#adm textarea{width:100%;min-height:70px;background:#050608;color:var(--bone);border:1.5px solid rgba(232,224,204,.25);font:11px ui-monospace,Menlo,monospace;padding:8px;box-sizing:border-box;user-select:text;-webkit-user-select:text}
#admstat{position:fixed;z-index:6;left:max(16px,env(safe-area-inset-left));top:calc(max(12px,env(safe-area-inset-top)) + 196px);padding:5px 10px;background:rgba(7,9,13,.72);border-left:3px solid var(--hazard);color:var(--bone);font:500 10.5px/1.45 ui-monospace,Menlo,monospace;letter-spacing:.04em;white-space:pre;pointer-events:none;display:none;font-variant-numeric:tabular-nums}
#admstat.on{display:block}
.admbar{position:fixed;left:0;right:0;height:11vh;background:#000;z-index:5;pointer-events:none;transform:scaleY(0);transition:transform .5s cubic-bezier(.3,.7,.2,1)}
.admbar.t{top:0;transform-origin:top}.admbar.b{bottom:0;transform-origin:bottom}body.letter .admbar{transform:none}
#admfree{position:fixed;z-index:6;left:50%;bottom:calc(max(14px,env(safe-area-inset-bottom)) + 6px);transform:translateX(-50%);padding:5px 12px;background:rgba(7,9,13,.7);border:1px solid var(--hazard);color:var(--hazard);font:600 10px ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;pointer-events:auto;cursor:pointer;display:none}
body.admfree #admfree{display:block}
body.admfree #hud,body.admfree #nav,body.admfree #toast{opacity:.25}
@media (max-width:700px){
  #adm{top:auto;left:0;width:auto;height:min(80vh,640px);grid-template-columns:1fr;grid-template-rows:auto auto 1fr;border-left:0;border-top:1px solid rgba(232,224,204,.2);box-shadow:0 -30px 60px rgba(0,0,0,.5)}
  #adm::before{left:0;right:0;top:-6px;bottom:auto;width:auto;height:6px;background:repeating-linear-gradient(45deg,var(--hazard) 0 9px,#07090d 9px 18px);background-size:400px 100%}
  #adm.show{animation:admUp .28s cubic-bezier(.2,.8,.2,1)}
  @keyframes admUp{from{transform:translateY(104%)}to{transform:none}}
  @keyframes admTape{from{background-position:-400px 0}to{background-position:0 0}}
  #adm header{grid-column:1;padding:12px 12px 8px 14px}#adm header h2{font-size:22px}
  #adm nav{flex-direction:row;overflow-x:auto;overflow-y:hidden;border-right:0;border-bottom:1px solid var(--line);padding:0 8px;scrollbar-width:none;touch-action:pan-x}
  #adm nav::-webkit-scrollbar{display:none}
  #adm nav button{flex:0 0 auto;border-left:0;border-bottom:3px solid transparent;padding:8px 10px 7px}
  #adm nav button.on{border-bottom-color:var(--hazard)}
  #adm .agrid{grid-template-columns:repeat(auto-fill,minmax(100px,1fr))}
  #admstat{top:auto;bottom:calc(max(10px,env(safe-area-inset-bottom)) + 150px);left:max(12px,env(safe-area-inset-left));transform:none;font-size:9.5px}
}
@media (prefers-reduced-motion:reduce){#adm.show,#adm.show::before{animation:none}.admbar{transition:none}}
`;

export class Admin {
  constructor(g) {
    this.g = g;   // live game refs from main.js
    this.s = { ...DEF };
    try { Object.assign(this.s, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
    this.open = false; this.tab = 'pilot'; this.acts = []; this.stepOnce = false; this.shot = false;
    this.marks = []; try { this.marks = JSON.parse(localStorage.getItem(KEY + '.marks') || '[]'); } catch {}
    this.cam = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, a: 0 };
    this.fps = { n: 0, t: 0, v: 0, ms: 0 };
    this.base = { maxFree: CFG.maxFree, keyTurn: CFG.keyTurn, lookGain: CFG.lookGain, maxAng: CFG.maxAng, rollAccel: CFG.rollAccel, sun: g.events.sunBase, sunCol: g.sun.color.clone(), exposure: g.renderer.toneMappingExposure,
      spins: new Map(g.world.sites.filter((S) => S.spin).map((S) => [S, S.spin])) };
    this.light = { sun: 1, exposure: 1, spin: 1 };
    this.hook(); this.buildDom();
    g.renderer.info.autoReset = false;
    this.applyStats();
  }

  save() { const o = {}; for (const k of PERSIST) o[k] = this.s[k]; try { localStorage.setItem(KEY, JSON.stringify(o)); } catch {} }
  set(k, v) { this.s[k] = v; this.save(); this.onSet(k); }
  copy(t) {
    const ok = () => this.say('Copied'), fallback = () => { const ta = this.bodyEl.querySelector('textarea'); if (ta) { ta.value = t; ta.select(); this.say('Copy it from the box'); } else console.log(t); };
    try { navigator.clipboard.writeText(t).then(ok, fallback); } catch { fallback(); }
  }
  say(t, kind = 'info') { this.g.toast(kind, t); }

  // ---- wrap the live systems so the switches reach them ----------------------------------------
  hook() {
    const g = this.g, { world, econ, systems, fleet, drones, ship, eva } = g;
    const ap = econ.apply.bind(econ);
    econ.apply = (sh, sal) => {
      ap(sh, sal); const s = this.s, b = this.base;
      CFG.main *= s.thrust; CFG.reverse *= s.thrust; CFG.strafe *= s.thrust; CFG.vert *= s.thrust;
      CFG.maxAssist *= s.speed; CFG.maxBoost *= s.speed; CFG.maxFree = b.maxFree * s.speed;
      CFG.keyTurn = b.keyTurn * s.turn; CFG.lookGain = b.lookGain * s.turn; CFG.maxAng = b.maxAng * s.turn; CFG.rollAccel = b.rollAccel * s.turn;
      if (s.god) sh.armor = 0;
      if (s.tow && sal) sal.capacity = s.tow;
    };
    const me = (b) => this.s.noclip && (b === ship || b === eva.pilot);
    const cs = world.collideStatic.bind(world), hc = world.hullContacts.bind(world), cp = world.collidePair.bind(world);
    world.collideStatic = (b, e) => (me(b) ? null : cs(b, e));
    world.hullContacts = (b, e) => (me(b) ? null : hc(b, e));
    world.collidePair = (a, b, e) => (me(a) || me(b) ? null : cp(a, b, e));
    const fc = fleet.collide.bind(fleet);
    fleet.collide = (S, dt) => (this.s.noclip && fleet.helm === S ? undefined : fc(S, dt));
    const br = systems.break.bind(systems);
    systems.break = (k, side) => (this.s.god && !this.forceBreak ? undefined : br(k, side));
    const du = drones.update.bind(drones);
    drones.update = (dt, t) => { if (this.s.drones === 'off') drones.enabled = false; else if (this.s.drones === 'on') drones.enabled = true; du(dt, t); };
    g.events.enabled = this.s.events;
    g.applyUpgrades();
  }

  // ---- DOM -----------------------------------------------------------------------------------------
  buildDom() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const el = this.el = document.createElement('div'); el.id = 'adm';
    el.innerHTML = `<header><div><h2>Override</h2><small>Crew console · <span class="kb">\` key</span></small></div><button class="x" aria-label="Close">✕</button></header>
      <nav>${TABS.map(([k, n], i) => `<button data-tab="${k}"><i>${String(i + 1).padStart(2, '0')}</i><b>${n}</b></button>`).join('')}</nav><div class="body"></div>`;
    document.body.appendChild(el);
    this.bodyEl = el.querySelector('.body');
    // keep the game's own handlers off the panel: no flight input, no touch-cancel (taps must become clicks)
    for (const t of ['pointerdown', 'pointerup', 'mousedown', 'wheel']) el.addEventListener(t, (e) => e.stopPropagation());
    for (const t of ['touchstart', 'touchmove', 'touchend']) el.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
    el.addEventListener('keydown', (e) => { if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') e.stopPropagation(); });
    el.querySelector('.x').addEventListener('click', () => this.toggle(false));
    el.querySelector('nav').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { this.tab = b.dataset.tab; this.render(true); } });
    this.bodyEl.addEventListener('click', (e) => this.onClick(e));
    this.bodyEl.addEventListener('input', (e) => { const i = e.target.dataset.r; if (i === undefined) return; const a = this.acts[+i]; a.set(+e.target.value); const o = e.target.parentNode.querySelector('span'); if (o) o.textContent = a.fmt(+e.target.value); });
    this.bodyEl.addEventListener('change', (e) => { const i = e.target.dataset.f; if (i !== undefined) this.acts[+i](e.target.files?.[0]); });
    addEventListener('keydown', (e) => {
      if (e.code === 'Backquote' && !e.repeat && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName || '')) { e.preventDefault(); this.toggle(); }
      else if (e.code === 'Escape' && this.open) { e.stopImmediatePropagation(); this.toggle(false); }
    }, true);
    // overlays: stats readout, letterbox bars, free-cam chip
    this.stat = document.createElement('div'); this.stat.id = 'admstat'; document.body.appendChild(this.stat);
    for (const c of ['t', 'b']) { const b = document.createElement('div'); b.className = 'admbar ' + c; document.body.appendChild(b); }
    this.freeEl = document.createElement('div'); this.freeEl.id = 'admfree'; this.freeEl.textContent = 'Free cam · tap to exit'; document.body.appendChild(this.freeEl);
    this.freeEl.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); this.set('free', false); this.set('orbit', false); });
  }

  toggle(v) {
    this.open = v ?? !this.open;
    if (this.open) {
      const m = this.g.menu; if (m.open) m.toggle(false);
      // release the mouse without the pause menu treating it as an Esc press
      if (document.pointerLockElement) { m.quiet = true; document.exitPointerLock(); setTimeout(() => { m.quiet = false; }, 250); }
      this.render(true);
    }
    this.el.classList.toggle('show', this.open);
    document.body.classList.toggle('adm', this.open);
  }

  // ---- tab content: a small declarative list per tab ------------------------------------------------
  tog(k, label, note) { return { t: 'tog', k, label, note }; }
  btn(label, fn, cls = '') { return { t: 'btn', label, fn, cls }; }
  rng(label, min, max, step, get, set, fmt) { return { t: 'rng', label, min, max, step, get, set, fmt }; }

  items() {
    const g = this.g, s = this.s, { ship, econ, fleet, eva, salvage, world, drones, events, story, career, tutorial, systems, settings } = g;
    const x = (n) => (+n).toFixed(n < 10 ? 1 : 0) + '×';
    switch (this.tab) {
      case 'pilot': return [
        { t: 'h', text: 'Cheats' },
        this.tog('god', 'God mode', 'No damage, nothing breaks, full hull, fuel, air'),
        this.tog('fuel', 'Endless fuel', 'Boost, suit jets and fleet tanks never drain'),
        this.tog('o2', 'Endless air', 'Suit oxygen stays full outside'),
        this.tog('noclip', 'Ghost hull', 'Fly through stations, wrecks and debris'),
        { t: 'h', text: 'Handling' },
        this.rng('Thrust', 0.5, 10, 0.5, () => s.thrust, (v) => this.set('thrust', v), x),
        this.rng('Top speed', 0.5, 10, 0.5, () => s.speed, (v) => this.set('speed', v), x),
        this.rng('Turn rate', 0.3, 4, 0.1, () => s.turn, (v) => this.set('turn', v), x),
        this.rng('Tow lines', 0, 8, 1, () => s.tow, (v) => this.set('tow', v), (v) => (v ? v + '' : 'upgrades')),
        { t: 'seg', label: 'Flight assist', opts: [['damped', 'Damped'], ['hold', 'Cruise'], ['drift', 'Drift']], get: () => ship.mode, set: (v) => ship.setMode(v) },
        { t: 'h', text: 'Ship' },
        { t: 'grid', items: [
          this.btn('Full repair', () => { ship.hull = 1; systems.repairAll(); g.damage.clear(); if (fleet.v) fleet.v.hull = 1; this.say('Repaired'); }),
          this.btn('Refuel', () => { ship.fuel = 1; eva.fuel = 1; eva.o2 = 1; if (fleet.v) fleet.v.fuel = 1; this.say('Tanks full'); }),
          this.btn('All stop', () => { this.body().vel.set(0, 0, 0); (this.body().angVel || this.body().w)?.set(0, 0, 0); }),
          this.btn('Flip 180°', () => { const b = this.body(); b.quat.multiply(_q.setFromAxisAngle(_up, Math.PI)); }),
          this.btn('Kick +150', () => { const b = this.body(); b.vel.addScaledVector(_v.set(0, 0, -1).applyQuaternion(b.quat), 150); }),
          this.btn('Spin out', () => { const b = this.body(); (b.angVel || b.w).set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(9); }),
          this.btn('Tow home', () => { g.respawn(); this.say('At the depot'); }),
          this.btn('Autopilot', () => g.setAuto(true)),
        ] },
        { t: 'h', text: 'Break a system' },
        { t: 'grid', items: Object.keys(SYS).map((k) => this.btn(SYS[k].name, () => { this.forceBreak = true; systems.break(k); this.forceBreak = false; }, 'hot')) },
      ];
      case 'warp': {
        const sites = world.sites.filter((S) => S.kind !== 'ship');
        const pos = this.body().pos;
        return [
          { t: 'kv', live: 'where' },
          { t: 'h', text: 'Places' },
          ...sites.map((S) => ({ t: 'li', label: S.hidden ? S.id + ' (hidden)' : S.id, note: `${(S.pos.distanceTo(pos) / 1000).toFixed(2)} km`, btns: [['Go', () => this.warpSite(S)]] })),
          { t: 'h', text: 'Ships' },
          ...fleet.ships.filter((S) => !S.sold).map((S) => ({ t: 'li', label: S.spec.name, note: `${S.spec.cls} · ${S.spec.len} m · ${(S.V.pos.distanceTo(pos) / 1000).toFixed(2)} km${S.owned ? ' · yours' : ''}`,
            btns: [['Go', () => this.warpShip(S)], ['Fetch', () => this.summon(S)], ['Board', () => this.board(S)]] })),
          { t: 'h', text: 'Bookmarks' },
          ...[0, 1, 2].map((i) => ({ t: 'li', label: `Mark ${i + 1}`, note: this.marks[i] ? this.marks[i].map((n) => n.toFixed(0)).join(', ') : 'empty',
            btns: [['Save', () => { this.marks[i] = this.body().pos.toArray(); try { localStorage.setItem(KEY + '.marks', JSON.stringify(this.marks)); } catch {} }], ['Go', () => this.marks[i] && this.moveTo(_w.fromArray(this.marks[i]))]] })),
          { t: 'grid', items: [
            this.btn('Jump 1 km ahead', () => { const b = this.body(); this.moveTo(_w.copy(b.pos).addScaledVector(_v.set(0, 0, -1).applyQuaternion(b.quat), 1000)); }),
            this.btn('Random spot', () => this.moveTo(_w.set((Math.random() - 0.5) * 6000, (Math.random() - 0.5) * 800, (Math.random() - 0.5) * 6000))),
          ] },
        ];
      }
      case 'spawn': return [
        { t: 'h', text: 'Cargo' },
        { t: 'grid', items: [
          this.btn('Crate', () => this.spawnLoot('crate', 1)), this.btn('Canister', () => this.spawnLoot('canister', 1)),
          this.btn('Crate rain ×12', () => this.spawnLoot('crate', 12)), this.btn('Canisters ×20', () => this.spawnLoot('canister', 20)),
        ] },
        { t: 'h', text: 'Rival drones' },
        { t: 'seg', label: 'Drones', opts: [['auto', 'Normal'], ['on', 'Always'], ['off', 'None']], get: () => s.drones, set: (v) => this.set('drones', v) },
        { t: 'grid', items: [
          this.btn('Drone here', () => this.spawnDrone()), this.btn('Stun all', () => { for (const d of drones.list) if (d.mode !== 'dead') drones.stun(d, 12); }),
          this.btn('Wreck all', () => { for (const d of drones.list) if (d.mode !== 'dead') drones.destroy(d, new THREE.Vector3()); }, 'hot'),
        ] },
        { t: 'h', text: 'Hazards' },
        this.tog('events', 'Random storms', 'Meteor showers and solar flares on their own'),
        { t: 'grid', items: [
          this.btn('Meteor storm', () => { if (events.state !== 'idle') events.finish(); events.start('meteor'); }, 'hot'),
          this.btn('Solar flare', () => { if (events.state !== 'idle') events.finish(); events.start('flare'); }, 'hot'),
          this.btn('End storm', () => { if (events.state !== 'idle') events.finish(); }),
          this.btn('Blast ahead', () => { const b = this.body(); g.blast(_w.copy(b.pos).addScaledVector(_v.set(0, 0, -1).applyQuaternion(b.quat), 70)); }, 'hot'),
          this.btn('Collapse wreck', () => this.collapse(), 'hot'),
        ] },
      ];
      case 'world': return [
        { t: 'h', text: 'Time' },
        this.rng('Time scale', 0.05, 4, 0.05, () => s.time, (v) => { s.time = v; }, (v) => (+v).toFixed(2) + '×'),
        { t: 'grid', items: [
          this.btn('Slow-mo', () => { s.time = 0.25; this.render(); }), this.btn('Normal', () => { s.time = 1; this.render(); }), this.btn('Fast ×3', () => { s.time = 3; this.render(); }),
          this.btn(s.frozen ? 'Unfreeze' : 'Freeze', () => { s.frozen = !s.frozen; this.render(); }, s.frozen ? 'on' : ''),
          this.btn('Step frame', () => { s.frozen = true; this.stepOnce = true; this.render(); }),
        ] },
        { t: 'h', text: 'Light' },
        this.rng('Sunlight', 0, 3, 0.05, () => this.light.sun, (v) => { this.light.sun = v; this.applyLight(); }, (v) => Math.round(v * 100) + '%'),
        this.rng('Exposure', 0.2, 3, 0.05, () => this.light.exposure, (v) => { this.light.exposure = v; this.applyLight(); }, (v) => (+v).toFixed(2)),
        { t: 'grid', items: [
          this.btn('Default', () => this.preset(1, 1, null)), this.btn('Eclipse', () => this.preset(0.04, 1.9, null)),
          this.btn('Dusk', () => this.preset(0.9, 1.1, 0xff8a4a)), this.btn('Cold', () => this.preset(1.2, 0.95, 0x9fc4ff)), this.btn('Blinding', () => this.preset(2.6, 0.8, null)),
        ] },
        { t: 'h', text: 'Scenery' },
        { t: 'tgx', label: 'Planet', note: 'The world below', get: () => world.planet.visible, set: (v) => { world.planet.visible = v; } },
        { t: 'tgx', label: 'Star field', note: 'Sky and Milky Way', get: () => world.sky.visible, set: (v) => { world.sky.visible = v; } },
        { t: 'tgx', label: 'Space dust', note: 'Speed streaks around you', get: () => !this.noDust, set: (v) => { this.noDust = !v; } },
        this.rng('Station spin', 0, 12, 0.5, () => this.light.spin, (v) => { this.light.spin = v; for (const [S, b0] of this.base.spins) if (S.state !== 'collapsed') S.spin = b0 * v; }, x),
        this.rng('Debris draw', 200, 4000, 100, () => world.debrisFar, (v) => { world.debrisFar = v; }, (v) => v + ' m'),
        { t: 'grid', items: [
          this.btn('Freeze debris', () => { for (const d of world.allDebris) { d.vel.set(0, 0, 0); d.spin.set(0, 0, 0); } }),
          this.btn('Scatter debris', () => { for (const d of world.allDebris) { d.vel.add(_v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(30)); d.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4); } }, 'hot'),
        ] },
      ];
      case 'cam': return [
        { t: 'h', text: 'Camera' },
        this.tog('free', 'Free camera', 'Fly the camera; the ship holds still. WASD / sticks, Shift fast'),
        this.tog('orbit', 'Orbit shot', 'Slow circle around you'),
        this.rng('Free cam speed', 5, 400, 5, () => s.camSpeed, (v) => { s.camSpeed = v; }, (v) => v + ' m/s'),
        this.rng('Orbit distance', 6, 400, 2, () => s.orbitDist, (v) => { s.orbitDist = v; }, (v) => v + ' m'),
        this.rng('Field of view', -10, 40, 1, () => settings.get('fov'), (v) => settings.set('fov', v), (v) => (v > 0 ? '+' : '') + v + '°'),
        this.rng('Shake', 0, 2, 0.05, () => settings.get('shake'), (v) => settings.set('shake', v), (v) => Math.round(v * 100) + '%'),
        { t: 'h', text: 'Photo' },
        { t: 'tgx', label: 'Hide HUD', note: 'Same as the O key', get: () => document.body.classList.contains('photo'), set: (v) => document.body.classList.toggle('photo', v) },
        this.tog('letter', 'Letterbox', 'Cinema bars'),
        { t: 'grid', items: [
          this.btn('Screenshot', () => { this.shot = true; }),
          this.btn('Cinematic', () => { this.set('orbit', true); this.set('letter', true); document.body.classList.add('photo'); s.time = 0.5; this.toggle(false); }),
          this.btn('Reset camera', () => { this.set('free', false); this.set('orbit', false); this.set('letter', false); document.body.classList.remove('photo'); settings.set('fov', 0); s.time = 1; this.render(); }),
        ] },
      ];
      case 'cash': {
        const r = career.rank();
        return [
          { t: 'big', live: 'cr' },
          { t: 'grid', items: [
            ...[1000, 10000, 100000, 1000000].map((v) => this.btn('+' + (v >= 1e6 ? '1M' : v / 1000 + 'k'), () => { econ.credits += v; econ.save(); g.nav.pop(v); })),
            this.btn('Zero', () => { econ.credits = 0; econ.save(); }, 'hot'),
          ] },
          { t: 'h', text: 'Upgrades' },
          ...Object.keys(UPG).map((k) => ({ t: 'up', k, name: UPG[k].name, lvl: econ.up[k], max: UPG[k].max })),
          { t: 'grid', items: [
            this.btn('Max all', () => { for (const k of Object.keys(UPG)) econ.up[k] = UPG[k].max; econ.save(); g.applyUpgrades(); this.say('All upgrades'); }),
            this.btn('Strip all', () => { for (const k of Object.keys(UPG)) econ.up[k] = 0; econ.save(); g.applyUpgrades(); }, 'hot'),
          ] },
          { t: 'h', text: `Rank · ${r.name}` },
          { t: 'grid', items: [
            this.btn('+1,000 XP', () => { econ.xp += 1000; econ.save(); career.refreshChip(); }),
            this.btn('Max rank', () => { econ.xp = Math.max(econ.xp, 13000); econ.save(); career.refreshChip(); }),
            this.btn('Rank zero', () => { econ.xp = 0; econ.save(); }, 'hot'),
          ] },
        ];
      }
      case 'story': return [
        { t: 'h', text: 'Tutorial' },
        { t: 'grid', items: [
          this.btn('Skip it', () => { if (tutorial.on) tutorial.finish(); econ.tut = true; econ.save(); }),
          this.btn('Replay', () => { this.toggle(false); g.replayTutorial(); }),
        ] },
        { t: 'h', text: `Story · ${story.done ? 'finished' : 'chapter ' + (econ.story.step + 1)}` },
        { t: 'grid', items: [
          this.btn('Finish chapter', () => { if (!story.done) story.complete(); }, story.done ? '' : ''),
          this.btn('Jump to ending', () => { let n = 0; while (!story.done && n++ < 20) story.complete(); }),
          this.btn('Show the Vesper', () => { if (story.site) story.site.hidden = false; }),
          this.btn('Restart story', () => { Object.assign(econ.story, { step: 0, prog: 0, done: false, seen: -1 }); econ.save(); if (story.site) story.site.hidden = true; this.say('Story reset'); }, 'hot'),
        ] },
        { t: 'h', text: 'Jobs' },
        { t: 'grid', items: [
          this.btn('Finish job', () => { if (career.c.active) career.complete(); else this.say('No job running', 'warn'); }),
          this.btn('New offers', () => { career.roll(); career.drawBoard(); }),
          this.btn('Drop job', () => { if (career.c.active) career.abandon(); }),
        ] },
        { t: 'h', text: 'Fleet' },
        { t: 'grid', items: [
          this.btn('Find all ships', () => { for (const S of fleet.ships) S.found = true; fleet.saveAll(); this.say('All ships found'); }),
          this.btn('Own all ships', () => { for (const S of fleet.ships) if (!S.sold) { S.found = true; S.owned = true; } fleet.saveAll(); this.say('Fleet is yours'); }),
          this.btn('Fix + fuel fleet', () => { for (const S of fleet.ships) { S.V.hull = 1; S.V.fuel = 1; } fleet.saveAll(); }),
        ] },
      ];
      case 'debug': return [
        { t: 'h', text: 'Overlays' },
        this.tog('stats', 'Stats readout', 'FPS, frame time, draw calls, position'),
        this.tog('colliders', 'Show colliders', 'Every live box and sphere the physics uses'),
        this.tog('wire', 'Wireframe', 'Every surface as lines'),
        { t: 'h', text: 'Render' },
        ...(g.look.bloom ? [{ t: 'tgx', label: 'Bloom', note: 'Glow on lights and exhaust', get: () => g.look.bloom.enabled, set: (v) => { g.look.bloom.enabled = v; } }] : []),
        { t: 'tgx', label: 'Film grade', note: 'Vignette, grain, lens ghosts', get: () => g.look.grade.enabled, set: (v) => { g.look.grade.enabled = v; } },
        { t: 'tgx', label: 'Shadows', note: 'Sun shadow map', get: () => g.sun.castShadow, set: (v) => { g.sun.castShadow = v; } },
        { t: 'seg', label: 'Quality', opts: [['auto', 'Auto'], ['low', 'Low'], ['high', 'High']], get: () => settings.get('quality'), set: (v) => settings.set('quality', v) },
        { t: 'kv', live: 'dbg' },
        { t: 'grid', items: [
          this.btn('Copy position', () => { const p = this.body().pos; this.copy(p.toArray().map((n) => n.toFixed(1)).join(', ')); }),
          this.btn('Log state', () => { console.log('[admin]', { ship: { pos: ship.pos.toArray(), vel: ship.vel.toArray(), hull: ship.hull, fuel: ship.fuel, mode: ship.mode }, econ, fleet: fleet.list(), admin: this.s }); this.say('Logged to console'); }),
        ] },
      ];
      case 'saves': return [
        { t: 'h', text: 'Slots' },
        ...[1, 2, 3].map((i) => { const m = this.slotMeta(i); return { t: 'li', label: `Slot ${i}`, note: m || 'empty', btns: [['Save', () => this.saveSlot(i)], ['Load', () => this.loadSlot(i), !m]] }; }),
        { t: 'h', text: 'Move a save' },
        { t: 'grid', items: [
          this.btn('Download', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(this.snapshot())], { type: 'application/json' })); a.download = 'low-orbit-save.json'; a.click(); }),
          this.btn('Copy text', () => { this.copy(JSON.stringify(this.snapshot())); }),
          { t: 'file', label: 'Load file', fn: (f) => f && f.text().then((t) => this.restore(t)) },
        ] },
        { t: 'paste' },
        { t: 'h', text: 'Danger' },
        { t: 'grid', items: [this.btn(this.armed ? 'Tap again' : 'Wipe everything', () => { if (!this.armed) { this.armed = true; this.render(); setTimeout(() => { this.armed = false; }, 3000); return; } this.restore('{}'); }, 'hot')] },
      ];
    }
    return [];
  }

  render(top) {
    const sc = this.bodyEl.scrollTop;
    this.acts = [];
    const A = (fn) => this.acts.push(fn) - 1;
    const bt = (b) => {
      if (b.t === 'file') return `<label class="abt" style="display:grid;place-items:center">${b.label}<input type="file" accept=".json,application/json" data-f="${A(b.fn)}" hidden></label>`;
      return `<button class="abt ${b.cls}" data-a="${A(b.fn)}">${b.label}</button>`;
    };
    const html = this.items().map((it) => {
      switch (it.t) {
        case 'h': return `<h4>${it.text}</h4>`;
        case 'tog': return `<button class="atg ${this.s[it.k] ? 'on' : ''}" data-a="${A(() => this.set(it.k, !this.s[it.k]))}"><b>${it.label}</b><em>${it.note}</em><u>${this.s[it.k] ? 'ON' : 'OFF'}</u></button>`;
        case 'tgx': { const on = !!it.get(); return `<button class="atg ${on ? 'on' : ''}" data-a="${A(() => it.set(!it.get()))}"><b>${it.label}</b><em>${it.note}</em><u>${on ? 'ON' : 'OFF'}</u></button>`; }
        case 'btn': return `<div class="agrid">${bt(it)}</div>`;
        case 'grid': return `<div class="agrid">${it.items.map(bt).join('')}</div>`;
        case 'rng': { const v = it.get(); return `<div class="arg"><b>${it.label}</b><span>${it.fmt(v)}</span><input type="range" min="${it.min}" max="${it.max}" step="${it.step}" value="${v}" data-r="${A({ set: it.set, fmt: it.fmt })}"></div>`; }
        case 'seg': { const cur = it.get(); return `<h4>${it.label}</h4><div class="aseg">${it.opts.map(([v, n]) => `<button class="${cur === v ? 'on' : ''}" data-a="${A(() => it.set(v))}">${n}</button>`).join('')}</div>`; }
        case 'li': return `<div class="ali"><b>${it.label}</b><em>${it.note}</em><div>${it.btns.map(([n, fn, dis]) => `<button class="abt" data-a="${A(fn)}" ${dis ? 'disabled' : ''}>${n}</button>`).join('')}</div></div>`;
        case 'up': return `<div class="aup"><b>${it.name}</b><s>${Array.from({ length: it.max }, (_, i) => `<i class="${i < it.lvl ? 'f' : ''}"></i>`).join('')}</s><button class="abt" data-a="${A(() => this.upg(it.k, -1))}">−</button><button class="abt" data-a="${A(() => this.upg(it.k, 1))}">+</button></div>`;
        case 'kv': return `<dl class="akv" data-live="${it.live}"></dl>`;
        case 'big': return `<div class="abig" data-live="${it.live}"></div>`;
        case 'paste': return `<textarea placeholder="Paste a save here, then Load text"></textarea><div class="agrid">${bt(this.btn('Load text', () => this.restore(this.bodyEl.querySelector('textarea').value)))}</div>`;
      }
      return '';
    }).join('');
    this.bodyEl.innerHTML = html;
    this.bodyEl.scrollTop = top ? 0 : sc;
    for (const b of this.el.querySelectorAll('nav button')) b.classList.toggle('on', b.dataset.tab === this.tab);
    this.live(true);
  }

  onClick(e) {
    const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
    const fn = this.acts[+b.dataset.a];
    try { fn(); } catch (err) { console.error(err); this.say('That failed', 'warn'); }
    b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 140);
    if (this.open) this.render();
  }

  // live readouts in the open tab
  live(force) {
    if (!this.open) return;
    if (!force && (this.liveT = (this.liveT || 0) + 1) % 10) return;
    const g = this.g, b = this.body();
    for (const el of this.bodyEl.querySelectorAll('[data-live]')) {
      const k = el.dataset.live;
      if (k === 'cr') el.innerHTML = `${fmtN(g.econ.credits)}<small>credits</small>`;
      else if (k === 'where') { const n = g.world.nearest(b.pos); el.innerHTML = `<dt>Position</dt><dd>${b.pos.toArray().map((v) => v.toFixed(0)).join(' · ')}</dd><dt>Speed</dt><dd>${b.vel.length().toFixed(1)} m/s</dd><dt>Nearest</dt><dd>${n ? n.id : '-'}</dd><dt>Body</dt><dd>${g.fleet.helm ? g.fleet.helm.spec.name : g.eva.state === 'eva' ? 'Suit' : 'Jet'}</dd>`; }
      else if (k === 'dbg') { const i = g.renderer.info, q = g.quality; el.innerHTML = `<dt>FPS</dt><dd>${this.fps.v.toFixed(0)} · ${this.fps.ms.toFixed(1)} ms</dd><dt>Draw calls</dt><dd>${fmtN(this.lastCalls || 0)}</dd><dt>Triangles</dt><dd>${fmtN(this.lastTris || 0)}</dd><dt>Programs</dt><dd>${i.programs?.length ?? '-'}</dd><dt>Quality rung</dt><dd>${q.i + 1} / ${q.levels.length}</dd><dt>Colliders live</dt><dd>${g.world.obbs.length} boxes · ${g.world.statics.length} spheres</dd>`; }
    }
  }

  // ---- actions ---------------------------------------------------------------------------------------
  // what you are flying right now: the jet, the suit, or a fleet ship at the helm
  body() { const g = this.g; return g.fleet.helm ? g.fleet.v : g.eva.state === 'eva' ? g.eva.pilot : g.ship; }

  moveTo(p, look) {
    const g = this.g, { ship, eva, fleet, salvage, world } = g;
    salvage.releaseAll(); g.setAuto(false);
    const face = (q) => { if (look) q.setFromRotationMatrix(_m.lookAt(p, look, _up)); };
    if (fleet.helm) { const V = fleet.v; V.pos.copy(p); V.vel.set(0, 0, 0); V.w?.set(0, 0, 0); face(V.quat); fleet.place(fleet.helm, 0); }
    else if (eva.state === 'eva') {
      // the suit is on a tether: carry the jet along so the line doesn't yank
      _v.copy(p).sub(eva.pilot.pos); ship.pos.add(_v); eva.pilot.pos.copy(p); eva.pilot.vel.set(0, 0, 0); ship.vel.set(0, 0, 0); eva.ropeReset = true;
    } else { fleet.release(false); ship.pos.copy(p); ship.vel.set(0, 0, 0); ship.angVel.set(0, 0, 0); face(ship.quat); }
    world.refreshActive(p, true);
    if (this.s.free) this.cam.pos.copy(p).add(_v.set(0, 6, 18));
  }
  warpSite(S) {
    const from = _w.copy(this.g.depot.dockPt).sub(S.pos); if (from.lengthSq() < 1) from.set(0, 0, 1);
    const p = from.setLength(S.radius + 90).add(S.pos).clone(); this.moveTo(p, S.pos);
  }
  warpShip(S) {
    const b = this.body(); const dir = _w.copy(b.pos).sub(S.V.pos); if (dir.lengthSq() < 1) dir.set(0, 0, 1);
    const p = dir.setLength(S.R + 60).add(S.V.pos).clone(); this.moveTo(p, S.V.pos);
  }
  summon(S) {
    const g = this.g, b = this.body();
    if (g.fleet.helm === S) return this.say('You are flying it', 'warn');
    S.V.pos.copy(b.pos).addScaledVector(_v.set(0, 0, -1).applyQuaternion(b.quat), S.R + 25); S.V.vel.copy(b.vel); S.V.w?.set(0, 0, 0);
    g.fleet.place(S, 0); g.world.dirty = true; g.world.refreshActive(b.pos, true); g.fleet.saveAll(); this.say(`${S.spec.name} fetched`);
  }
  // put the jet on that ship's collar (or in the Ironwake's bay), owned and ready to fly
  board(S) {
    const g = this.g;
    if (g.fleet.helm) g.fleet.leave();
    if (g.eva.active) return this.say('Get back in the jet first', 'warn');
    S.found = true; S.owned = true; g.fleet.saveAll(); g.salvage.releaseAll();
    g.fleet.release(false); g.fleet.attach(S, true);
    g.fleet.dockPose(S, g.ship.pos, g.ship.quat); g.ship.vel.copy(S.V.vel); g.world.refreshActive(g.ship.pos, true);
    this.say(S.decks ? `In the ${S.spec.name} bay` : `On the ${S.spec.name}: G takes the helm`);
  }
  spawnLoot(type, n) {
    const g = this.g, b = this.body(), site = g.world.nearest(b.pos);
    const inv = _m.copy(site.group.matrixWorld).invert();
    for (let i = 0; i < n; i++) {
      const p = _w.copy(b.pos).addScaledVector(_v.set(0, 0, -1).applyQuaternion(b.quat), 22 + i * 3).add(_v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(n > 1 ? 24 : 0));
      const it = g.salvage.spawn(site, { type, at: p.applyMatrix4(inv).toArray() });
      if (it) it.body.vel.copy(b.vel);
    }
    g.world.dirty = true;
  }
  spawnDrone() {
    const g = this.g, d0 = g.drones, b = this.body();
    const mesh = buildDrone(); g.scene.add(mesh);
    const pos = _w.copy(b.pos).addScaledVector(_v.set(0, 0, -1).applyQuaternion(b.quat), 60).clone();
    const d = { mesh, pos, vel: new THREE.Vector3(), mode: 'idle', t: 1, item: null, home: null, spawn: pos.clone(), acc: 0, stun: 0, cutT: 0, spin: new THREE.Vector3(), id: d0.list.length, grip: 0 };
    d0.list.push(d); mesh.position.copy(pos);
    if (this.s.drones === 'auto' && !d0.enabled) this.set('drones', 'on');
    this.say('Drone inbound', 'drone');
  }
  collapse() {
    const b = this.body(); let best = null, bd = 1e9;
    for (const S of this.g.world.sites) { if (S.kind !== 'wreck' || S.state !== 'ok') continue; const d = S.pos.distanceTo(b.pos); if (d < bd) { bd = d; best = S; } }
    if (!best) return this.say('Nothing left standing', 'warn');
    best.destabilise(8); this.say(`${best.id} breaking up`, 'warn');
  }
  upg(k, d) { const e = this.g.econ; e.up[k] = THREE.MathUtils.clamp(e.up[k] + d, 0, UPG[k].max); e.save(); this.g.applyUpgrades(); }

  preset(sun, exp, col) { this.light.sun = sun; this.light.exposure = exp; this.light.col = col; this.applyLight(); }
  applyLight() {
    const g = this.g; g.events.sunBase = this.base.sun * this.light.sun; g.renderer.toneMappingExposure = this.base.exposure * this.light.exposure;
    if (this.light.col) g.sun.color.set(this.light.col); else g.sun.color.copy(this.base.sunCol);
  }

  // ---- saves: every rell.* key except the console's own ------------------------------------------------
  keys() { const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('rell.') && !k.startsWith('rell.admin')) out.push(k); } return out; }
  snapshot() { this.g.saveShip(); this.g.fleet.saveAll(); const o = {}; for (const k of this.keys()) o[k] = localStorage.getItem(k); return { v: 1, at: Date.now(), data: o }; }
  slotMeta(i) { try { const s = JSON.parse(localStorage.getItem(SLOT(i)) || 'null'); if (!s) return ''; const e = JSON.parse(s.data['rell.save'] || '{}'); return `${new Date(s.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${fmtN(e.credits || 0)} Cr`; } catch { return ''; } }
  saveSlot(i) { try { localStorage.setItem(SLOT(i), JSON.stringify(this.snapshot())); this.say(`Saved to slot ${i}`); } catch { this.say('Save failed', 'warn'); } }
  loadSlot(i) { const s = localStorage.getItem(SLOT(i)); if (s) this.restore(s); }
  restore(text) {
    let s; try { s = JSON.parse(text || '{}'); } catch { return this.say('Not a save', 'warn'); }
    const data = s.data || {};
    // stop the game writing its live state back over the one we load on the way out
    const g = this.g; g.econ.save = () => {}; g.fleet.saveAll = () => {};
    for (const k of this.keys()) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(data)) if (k.startsWith('rell.') && !k.startsWith('rell.admin')) localStorage.setItem(k, v);
    location.reload();
  }

  // ---- per-frame -------------------------------------------------------------------------------------
  // the game's input this frame: in free cam the flight controls drive the camera, the ship gets nothing
  input(raw) {
    this.raw = raw;
    if (!this.s.free && !this.s.orbit) return raw;
    return { ...raw, fwd: 0, strafe: 0, vert: 0, roll: 0, boost: false, brake: true, fire: false, reel: false, yawKey: 0, pitchKey: 0, dx: 0, dy: 0 };
  }
  get frozen() { return this.s.frozen && !this.stepOnce; }
  get scale() { return this.s.time; }

  onSet(k) {
    const g = this.g;
    if (['thrust', 'speed', 'turn', 'tow', 'god'].includes(k)) g.applyUpgrades();
    if (k === 'events') g.events.enabled = this.s.events;
    if (k === 'stats') this.applyStats();
    if (k === 'letter') document.body.classList.toggle('letter', this.s.letter);
    if (k === 'wire') this.applyWire();
    if (k === 'colliders' && !this.s.colliders && this.col) this.col.visible = false;
    if (k === 'free' || k === 'orbit') {
      const on = this.s.free || this.s.orbit;
      if (on && !this.camOn) {
        const c = g.camera; this.cam.pos.copy(c.position); _e.setFromQuaternion(c.quaternion, 'YXZ'); this.cam.yaw = _e.y; this.cam.pitch = _e.x;
        this.cam.a = Math.atan2(c.position.z - this.body().pos.z, c.position.x - this.body().pos.x);
        this.ckWas = g.cockpit.target; if (g.cockpit.target) g.cockpit.toggle();
      }
      if (!on && this.camOn && this.ckWas && !g.cockpit.target) g.cockpit.toggle();
      this.camOn = on; document.body.classList.toggle('admfree', on);
    }
  }
  applyStats() { this.stat.classList.toggle('on', this.s.stats); }
  applyWire() {
    const on = this.s.wire; this.wireSet = this.wireSet || new Set();
    if (on) this.g.scene.traverse((o) => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) if ('wireframe' in m && !m.wireframe) { m.wireframe = true; this.wireSet.add(m); } });
    else { for (const m of this.wireSet) m.wireframe = false; this.wireSet.clear(); }
  }

  // after the game updated everything, before the frame is drawn
  update(rawDt) {
    const g = this.g, s = this.s, { ship, eva, fleet } = g;
    this.stepOnce = false;
    if (s.god || s.fuel) { ship.fuel = 1; eva.fuel = 1; if (fleet.v) fleet.v.fuel = 1; }
    if (s.god || s.o2) eva.o2 = 1;
    if (s.god) { ship.hull = 1; ship.armor = 0; if (fleet.v) fleet.v.hull = 1; if (g.systems.any()) g.systems.repairAll(); }
    if (this.noDust) g.world.dust.lines.visible = false;
    if (s.wire && (this.wireT = (this.wireT || 0) + rawDt) > 2) { this.wireT = 0; this.applyWire(); }   // new meshes (salvage, drones) join in
    if (this.camOn) this.flyCam(Math.min(rawDt, 0.05));
    if (s.colliders) this.drawColliders();
    this.live(false);
  }

  flyCam(dt) {
    const c = this.g.camera, r = this.raw || {}, C = this.cam;
    if (this.s.orbit) {
      const f = this.body().pos, d = this.s.orbitDist; C.a += dt * 0.22;
      c.position.set(f.x + Math.cos(C.a) * d, f.y + d * 0.32, f.z + Math.sin(C.a) * d); c.lookAt(f);
    } else {
      C.yaw -= (r.dx || 0) * 0.0024 + (r.yawKey || 0) * dt * 1.6; C.pitch = THREE.MathUtils.clamp(C.pitch - (r.dy || 0) * 0.0024 + (r.pitchKey || 0) * dt * 1.6, -1.55, 1.55);
      c.quaternion.setFromEuler(_e.set(C.pitch, C.yaw, 0, 'YXZ'));
      _v.set(r.strafe || 0, r.vert || 0, -(r.fwd || 0)).applyQuaternion(c.quaternion);
      C.pos.addScaledVector(_v, this.s.camSpeed * (r.boost ? 5 : 1) * dt); c.position.copy(C.pos);
    }
    c.updateMatrixWorld(); this.g.eva.pass.enabled = false;
  }

  drawColliders() {
    const g = this.g, w = g.world;
    if (!this.col) {
      const geo = new THREE.BufferGeometry(); this.colPos = new Float32Array(240000 * 3); geo.setAttribute('position', new THREE.BufferAttribute(this.colPos, 3));
      this.col = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xff5a1f, transparent: true, opacity: 0.85, depthTest: false, toneMapped: false }));
      this.col.frustumCulled = false; this.col.renderOrder = 999; this.col.layers.enableAll(); g.scene.add(this.col);
    }
    this.col.visible = true;
    const P = this.colPos, max = P.length / 3; let n = 0;
    const push = (a, b) => { if (n + 2 > max) return; P[n * 3] = a.x; P[n * 3 + 1] = a.y; P[n * 3 + 2] = a.z; n++; P[n * 3] = b.x; P[n * 3 + 1] = b.y; P[n * 3 + 2] = b.z; n++; };
    const cr = [], c0 = new THREE.Vector3(), c1 = new THREE.Vector3();
    for (const o of w.obbs) {
      for (let i = 0; i < 8; i++) cr[i] = (cr[i] || new THREE.Vector3()).set(i & 1 ? o.h.x : -o.h.x, i & 2 ? o.h.y : -o.h.y, i & 4 ? o.h.z : -o.h.z).applyQuaternion(o.q).add(o.c);
      for (const [a, b] of EDGES) push(cr[a], cr[b]);
    }
    const ring = (p, r) => { for (let ax = 0; ax < 3; ax++) for (let i = 0; i < 16; i++) { const a0 = i / 16 * 6.283, a1 = (i + 1) / 16 * 6.283; circ(c0, ax, a0, r).add(p); circ(c1, ax, a1, r).add(p); push(c0, c1); } };
    for (const sp of w.statics) ring(sp.pos, sp.rad);
    for (const d of w.debris) ring(d.pos, d.radius);
    for (const it of g.salvage.items) if (it.state !== 'gone' && it.body.pos.distanceTo(this.body().pos) < 600) ring(it.body.pos, it.body.radius);
    ring(g.ship.pos, g.ship.radius); if (g.eva.state === 'eva') ring(g.eva.pilot.pos, g.eva.pilot.radius);
    this.col.geometry.setDrawRange(0, n); this.col.geometry.attributes.position.needsUpdate = true;
  }

  // after the frame is on screen: frame stats and screenshots (the drawing buffer is still intact here)
  afterRender(rawDt) {
    const g = this.g, f = this.fps, i = g.renderer.info;
    this.lastCalls = i.render.calls; this.lastTris = i.render.triangles; i.reset();
    f.n++; f.t += rawDt; if (f.t > 0.5) { f.v = f.n / f.t; f.ms = f.t / f.n * 1000; f.n = 0; f.t = 0; }
    if (this.s.stats && (this.statT = (this.statT || 0) + 1) % 6 === 0) {
      const b = this.body(), n = g.world.nearest(b.pos);
      this.stat.textContent = `${f.v.toFixed(0)} fps  ${f.ms.toFixed(1)} ms  ${fmtN(this.lastCalls)} calls  ${(this.lastTris / 1e6).toFixed(2)}M tris\n` +
        `pos ${b.pos.x.toFixed(0)} ${b.pos.y.toFixed(0)} ${b.pos.z.toFixed(0)}  ${b.vel.length().toFixed(1)} m/s  near ${n ? n.id : '-'}` + (this.s.time !== 1 || this.s.frozen ? `  time ${this.s.frozen ? 'frozen' : this.s.time.toFixed(2) + '×'}` : '');
    }
    if (this.shot) {
      this.shot = false;
      try { const a = document.createElement('a'); a.href = g.renderer.domElement.toDataURL('image/png'); a.download = `low-orbit-${Date.now()}.png`; a.click(); this.say('Screenshot saved'); } catch { this.say('Screenshot failed', 'warn'); }
    }
  }
}
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
function circ(out, ax, a, r) { const x = Math.cos(a) * r, y = Math.sin(a) * r; return ax === 0 ? out.set(0, x, y) : ax === 1 ? out.set(x, 0, y) : out.set(x, y, 0); }
