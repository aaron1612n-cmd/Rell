// Player settings (saved) and the pause menu: sensitivity, invert, field of view, shake, graphics tier,
// plus the career page, tutorial replay and save reset. Opening the menu freezes the simulation.
const KEY = 'rell.settings';
const DEF = { volume: 0.7, sens: 1, invert: false, fov: 0, shake: 1, quality: 'auto', hints: true };
const svg = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
const IC = {
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  redo: '<path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4h4"/>',
  key: '<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="7" cy="17" r="2"/>',
  trash: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>',
};

export class Settings {
  constructor() {
    this.v = { ...DEF };
    try { Object.assign(this.v, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
    this.onChange = () => {};
  }
  get(k) { return this.v[k]; }
  set(k, x) { this.v[k] = x; try { localStorage.setItem(KEY, JSON.stringify(this.v)); } catch {} this.onChange(k, x); }
}

export class Menu {
  constructor({ settings, career, econ, onTutorial, onReset, help }) {
    Object.assign(this, { settings, career, econ, onTutorial, onReset, help });
    this.open = false; this.onToggle = () => {};
    this.btn = document.createElement('button'); this.btn.id = 'menubtn'; this.btn.setAttribute('aria-label', 'Menu');
    this.btn.innerHTML = svg(IC.gear); document.getElementById('hud').appendChild(this.btn);
    this.el = document.createElement('div'); this.el.id = 'menu'; document.body.appendChild(this.el);
    this.btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); this.toggle(); });
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'Escape' || e.code === 'KeyP') { if (this.help?.open) return; this.toggle(); }
    });
    // pointer lock released by Esc: the browser swallows the keydown, so pause on the lock change instead
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && this.lockWas && !this.open && !this.help?.open && !this.quiet) this.toggle(true); this.lockWas = !!document.pointerLockElement; });
  }

  row(label, control) { return `<div class="mrow"><span>${label}</span>${control}</div>`; }
  slider(k, min, max, step, fmt) { const v = this.settings.get(k); return `<input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v}"><b>${fmt(v)}</b>`; }
  toggleBtn(k) { return `<button class="tg${this.settings.get(k) ? ' on' : ''}" data-t="${k}"><i></i></button>`; }

  render() {
    const s = this.settings, c = this.career, st = c.econ.stats;
    const r = c.rank();
    const q = ['auto', 'low', 'high'].map((m) => `<button class="seg${s.get('quality') === m ? ' on' : ''}" data-q="${m}">${m}</button>`).join('');
    this.el.innerHTML = `<div class="mcard">
      <header><b>${r.name}</b><div class="xp"><i style="width:${(r.frac * 100).toFixed(0)}%"></i></div><span class="mono">${r.next ? r.xp + ' / ' + r.next : 'max'}</span></header>
      <div class="mgrid">
        <section><h3>Flight</h3>
          ${this.row('Aim', this.slider('sens', 0.3, 2.5, 0.05, (v) => (+v).toFixed(1) + '×'))}
          ${this.row('Invert', this.toggleBtn('invert'))}
          ${this.row('View', this.slider('fov', -10, 24, 1, (v) => (v > 0 ? '+' : '') + v + '°'))}
          ${this.row('Shake', this.slider('shake', 0, 1, 0.05, (v) => Math.round(v * 100) + '%'))}
        </section>
        <section><h3>Graphics</h3>
          <div class="segs">${q}</div>
          ${this.row('Sound', this.slider('volume', 0, 1, 0.05, (v) => Math.round(v * 100) + '%'))}
          ${this.row('Hints', this.toggleBtn('hints'))}
        </section>
        <section><h3>Career</h3>
          <div class="stats">
            <div><b>${st.delivered}</b><span class="mono">Hauled</span></div>
            <div><b>${st.jobs}</b><span class="mono">Jobs</span></div>
            <div><b>${st.lockers}</b><span class="mono">Lockers</span></div>
            <div><b>${st.cores}</b><span class="mono">Cores</span></div>
            <div><b>${st.storms}</b><span class="mono">Storms</span></div>
            <div><b>${(st.dist / 1000).toFixed(1)}</b><span class="mono">km</span></div>
          </div>
        </section>
      </div>
      <footer>
        <button class="big go" data-a="resume">${svg(IC.play)}<span>Resume</span></button>
        <button class="big" data-a="tut">${svg(IC.redo)}<span>Tutorial</span></button>
        <button class="big" data-a="admin">${svg(IC.key)}<span>Admin</span></button>
        <button class="big warn" data-a="reset">${svg(IC.trash)}<span>${this.armed ? 'Sure?' : 'Reset'}</span></button>
      </footer></div>`;
    for (const i of this.el.querySelectorAll('input[type=range]')) {
      i.addEventListener('input', () => { const v = +i.value; this.settings.set(i.dataset.k, v); i.nextElementSibling.textContent = i.dataset.k === 'sens' ? v.toFixed(1) + '×' : i.dataset.k === 'fov' ? (v > 0 ? '+' : '') + v + '°' : Math.round(v * 100) + '%'; });
    }
    for (const b of this.el.querySelectorAll('[data-t]')) b.addEventListener('click', () => { this.settings.set(b.dataset.t, !this.settings.get(b.dataset.t)); b.classList.toggle('on'); });
    for (const b of this.el.querySelectorAll('[data-q]')) b.addEventListener('click', () => { this.settings.set('quality', b.dataset.q); for (const o of this.el.querySelectorAll('[data-q]')) o.classList.toggle('on', o === b); });
    for (const b of this.el.querySelectorAll('[data-a]')) b.addEventListener('click', () => {
      const a = b.dataset.a;
      if (a === 'resume') this.toggle(false);
      else if (a === 'admin') { this.toggle(false); this.onAdmin?.(); }
      else if (a === 'tut') { this.toggle(false); this.onTutorial(); }
      else if (a === 'reset') { if (!this.armed) { this.armed = true; this.render(); setTimeout(() => { this.armed = false; }, 3000); } else { this.armed = false; this.onReset(); this.toggle(false); } }
    });
  }

  toggle(force) {
    this.open = force ?? !this.open;
    if (this.open) { this.render(); if (document.pointerLockElement) { this.quiet = true; document.exitPointerLock(); setTimeout(() => { this.quiet = false; }, 200); } }
    this.el.classList.toggle('show', this.open); this.btn.classList.toggle('on', this.open);
    document.body.classList.toggle('paused', this.open);
    this.onToggle(this.open);
  }
}
