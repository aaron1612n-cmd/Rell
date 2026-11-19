// Career: ranks, saved stats and the depot job board. Three jobs are offered at the dock; take one and the
// tracker top-left follows it. Rewards pay on top of the salvage itself, scaled by rank.
const svg = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
export const JOB_ICONS = {
  haul: '<path d="M4 9l8-4 8 4v8l-8 4-8-4z"/><path d="M4 9l8 4 8-4M12 13v8"/>',
  earn: '<circle cx="12" cy="12" r="8"/><path d="M12 7v10M9.5 9.5c0-1 1-1.6 2.5-1.6s2.5.6 2.5 1.6-1 1.4-2.5 1.8-2.5.8-2.5 1.8 1 1.6 2.5 1.6 2.5-.6 2.5-1.6"/>',
  locker: '<rect x="6" y="3" width="12" height="18" rx="1.5"/><path d="M12 3v18M9.5 12h.01M14.5 12h.01"/>',
  core: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  clean: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  quick: '<circle cx="12" cy="13" r="7.5"/><path d="M12 13V8.5M9.5 3h5"/>',
  storm: '<path d="M4 15l5-5 3 3 5-6M4 20l5-5M12 20l4-4M20 20l-3-3"/>',
  meteor: '<path d="M20 4L8 16"/><circle cx="7" cy="17" r="3"/><path d="M14 4l-8 8M20 10l-8 8"/>',
  flare: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
};
// kind: what counts. base: credits per unit of goal at Rookie.
const KINDS = {
  haul: { icon: 'haul', goals: [2, 3, 4], per: 260 },
  earn: { icon: 'earn', goals: [900, 1600, 2600], per: 0.36 },
  locker: { icon: 'locker', goals: [1, 2, 3], per: 320 },
  core: { icon: 'core', goals: [1], per: 1500 },
  clean: { icon: 'clean', goals: [1, 2], per: 520 },
  quick: { icon: 'quick', goals: [1], per: 700, limit: 260 },
  storm: { icon: 'storm', goals: [1], per: 600 },
};
const RANKS = [['Rookie', 0], ['Hand', 500], ['Hauler', 1500], ['Salvager', 3500], ['Foreman', 7000], ['Captain', 13000]];
const R = Math.random;

export class Career {
  constructor(econ) {
    this.econ = econ; this.c = econ.career;
    this.toast = () => {}; this.onChange = () => {};
    const hud = document.getElementById('hud');
    // tracker chip
    this.chip = document.createElement('div'); this.chip.id = 'job'; hud.appendChild(this.chip);
    // job board (shown while docked)
    this.board = document.createElement('div'); this.board.id = 'jobs'; document.body.appendChild(this.board);
    this.board.addEventListener('pointerdown', (e) => e.stopPropagation());
    addEventListener('keydown', (e) => { if (!this.board.classList.contains('show') || e.repeat) return; const i = ['Digit4', 'Digit5', 'Digit6'].indexOf(e.code); if (i >= 0) this.accept(i); });
    if (!this.c.offers) this.roll();
    this.refreshChip(); this.drawBoard(); this.lastTxt = '';
  }

  rank() {
    const xp = this.econ.xp; let i = 0; while (i + 1 < RANKS.length && xp >= RANKS[i + 1][1]) i++;
    const lo = RANKS[i][1], hi = RANKS[i + 1]?.[1];
    return { i, name: RANKS[i][0], xp, next: hi, frac: hi ? (xp - lo) / (hi - lo) : 1 };
  }
  mult() { return 1 + 0.18 * this.rank().i; }

  roll() {
    const keys = Object.keys(KINDS), out = [];
    while (out.length < 3) {
      const k = keys[(R() * keys.length) | 0]; if (out.some((o) => o.kind === k)) continue;
      const K = KINDS[k], g = K.goals[(R() * K.goals.length) | 0];
      out.push({ kind: k, goal: g, reward: Math.round(g * K.per * this.mult() / 10) * 10, prog: 0, t: 0 });
    }
    this.c.offers = out; this.econ.save();
  }

  accept(i) {
    const o = this.c.offers?.[i]; if (!o) return;
    this.c.active = { ...o, prog: 0, t: 0, earned: 0 }; this.c.offers[i] = null;
    this.econ.save(); this.refreshChip(); this.drawBoard(); this.toast('job');
  }
  abandon() { this.c.active = null; this.econ.save(); this.refreshChip(); this.drawBoard(); }

  // --- events from the game ---------------------------------------------------------------------
  onDeliver(it, v) {
    const a = this.c.active;
    if (it.kind === 'core') this.econ.stats.cores++;
    if (!a) return;
    if (a.kind === 'haul') this.add(1);
    else if (a.kind === 'earn') this.add(v);
    else if (a.kind === 'core' && it.kind === 'core') this.add(1);
    else if (a.kind === 'clean' && it.integrity >= 0.88) this.add(1);
    else if (a.kind === 'quick' && a.t <= KINDS.quick.limit) this.add(1);
  }
  onLocker(v) {
    this.econ.stats.lockers++;
    const a = this.c.active; if (!a) return;
    if (a.kind === 'locker') this.add(1); else if (a.kind === 'earn') this.add(v);
  }
  onStorm(clean) {
    this.econ.stats.storms++;
    const a = this.c.active; if (a && a.kind === 'storm' && clean) this.add(1);
    this.econ.save();
  }
  add(n) {
    const a = this.c.active; a.prog = Math.min(a.goal, a.prog + n); this.econ.save();
    if (a.prog >= a.goal) this.complete(); else this.refreshChip();
  }
  complete() {
    const a = this.c.active, before = this.rank().i;
    this.econ.bonus(a.reward); this.econ.stats.jobs++; this.c.active = null; this.roll();
    this.econ.save(); this.refreshChip(); this.drawBoard();
    this.toast('done', a.reward);
    if (this.rank().i > before) setTimeout(() => this.toast('rank', this.rank().name), 1800);
  }

  update(dt, ship, docked) {
    const a = this.c.active;
    if (a && a.kind === 'quick') { a.t += dt; if (a.t > KINDS.quick.limit + 20 && a.prog < a.goal) { this.abandon(); this.toast('fail'); } else this.refreshChip(); }
    this.econ.stats.dist += ship.vel.length() * dt;
    if (docked !== this.docked) { this.docked = docked; this.board.classList.toggle('show', docked); if (docked) this.drawBoard(); }
  }

  // --- UI ---------------------------------------------------------------------------------------
  refreshChip() {
    const a = this.c.active, el = this.chip;
    const txt = a ? a.kind + a.prog + '/' + a.goal + (a.kind === 'quick' ? Math.max(0, (KINDS.quick.limit - a.t) / 10 | 0) : '') : '';
    if (txt === this.lastTxt) return; this.lastTxt = txt;
    el.classList.toggle('on', !!a);
    if (!a) { el.innerHTML = ''; return; }
    const pct = (a.prog / a.goal * 100).toFixed(0);
    const left = a.kind === 'quick' ? `<span class="mono">${Math.max(0, Math.ceil(KINDS.quick.limit - a.t))}s</span>` : '';
    el.innerHTML = `${svg(JOB_ICONS[KINDS[a.kind].icon])}<div><b>${a.kind === 'earn' ? a.prog + ' / ' + a.goal : a.prog + ' / ' + a.goal}</b><s><i style="width:${pct}%"></i></s></div>${left}<em class="mono">+${a.reward}</em>`;
  }

  drawBoard() {
    const a = this.c.active;
    const card = (o, i) => !o ? `<div class="jc empty"></div>` : `<button class="jc" data-i="${i}">${svg(JOB_ICONS[KINDS[o.kind].icon])}<b>${o.kind === 'earn' ? o.goal : '×' + o.goal}</b><em>+${o.reward}</em><kbd>${i + 4}</kbd></button>`;
    this.board.innerHTML = (a ? `<div class="jc live">${svg(JOB_ICONS[KINDS[a.kind].icon])}<b>${a.prog}/${a.goal}</b><em>+${a.reward}</em><u data-x></u></div>` : '') + this.c.offers.map(card).join('');
    for (const b of this.board.querySelectorAll('button')) b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.accept(+b.dataset.i); });
    const x = this.board.querySelector('[data-x]'); if (x) x.addEventListener('pointerdown', (e) => { e.preventDefault(); this.abandon(); });
  }
}
