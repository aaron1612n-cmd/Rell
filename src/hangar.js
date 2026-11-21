import { UPG } from './economy.js';
import { SYS } from './systems.js';

// The hangar: open it while docked at the depot (U, or the Hangar button). Seven upgrades bought with credits,
// each with a few levels, plus paid repairs for broken systems. Everything is saved the moment you buy it.
const svg = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
export const UP_ICONS = {
  thrust: '<path d="M6 17l6-6 6 6M6 11l6-6 6 6"/>',
  tanks: '<rect x="7" y="4" width="10" height="17" rx="4"/><path d="M10 2h4M7 11h10"/>',
  hull: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/>',
  winch: '<path d="M12 3v9"/><path d="M12 12a4 4 0 1 0 4 4"/><circle cx="12" cy="3" r="1"/>',
  cutter: '<path d="M4 20l7-7M13 11l2-2M15 4l1.5 3.5L20 9l-3.5 1.5L15 14l-1.5-3.5L10 9l3.5-1.5z"/>',
  scanner: '<circle cx="12" cy="12" r="2"/><path d="M7 7a7 7 0 000 10M17 7a7 7 0 010 10M4 4a11 11 0 000 16M20 4a11 11 0 010 16"/>',
  jammer: '<path d="M12 12v9M8 21h8"/><path d="M8.5 8.5a5 5 0 017 0M6 6a8.5 8.5 0 0112 0M10.6 10.6a2 2 0 012.8 0"/><path d="M4 4l16 16"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 00-5.2 5.2L4 17l3 3 5.3-5.3a4 4 0 005.2-5.2l-2.6 2.6-2.4-.6-.6-2.4z"/>',
};

export class Hangar {
  constructor({ econ, systems, onBuy, sound }) {
    Object.assign(this, { econ, systems, onBuy, sound });
    this.docked = false; this.open = false;
    // the chip that opens it (shown only while docked)
    const chip = this.chip = document.createElement('button'); chip.id = 'hangarbtn';
    chip.innerHTML = `${svg(UP_ICONS.wrench)}<span>Hangar</span><kbd>U</kbd>`;
    document.body.appendChild(chip);
    chip.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); this.toggle(true); });
    // the panel
    const el = this.el = document.createElement('div'); el.id = 'hangar';
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === el) this.toggle(false); });
    document.body.appendChild(el);
    // capture phase so Esc closes the hangar before the pause menu sees it
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyU' && this.docked) { this.toggle(!this.open); return; }
      if (!this.open) return;
      if (e.code === 'Escape') { e.stopImmediatePropagation(); this.toggle(false); return; }
      const i = +e.code.replace('Digit', '') - 1;
      if (e.code.startsWith('Digit') && i >= 0 && i < 7) { e.stopImmediatePropagation(); this.buy(Object.keys(UPG)[i]); }
      if (e.code === 'KeyR') { e.stopImmediatePropagation(); this.repair(); }
    }, true);
  }

  setDocked(v) {
    if (v === this.docked) return;
    this.docked = v; this.chip.classList.toggle('show', v);
    if (!v) this.toggle(false);
  }

  toggle(v) {
    if (v && !this.docked) return;
    if (v === this.open) return;
    this.open = v; this.el.classList.toggle('show', v); document.body.classList.toggle('hangar', v);
    if (v) { this.draw(); if (document.pointerLockElement) document.exitPointerLock(); }
    this.onToggle?.(v);
  }

  buy(k) {
    const row = this.el.querySelector(`[data-k="${k}"]`);
    if (this.econ.buy(k)) { this.onBuy?.(k); this.sound?.chime(false); this.draw(); this.el.querySelector(`[data-k="${k}"]`)?.classList.add('ok'); }
    else if (row) { row.classList.remove('no'); void row.offsetWidth; row.classList.add('no'); }
  }

  repair() {
    const c = this.systems.cost(); if (!c) return;
    if (this.econ.spend(c)) { this.systems.repairAll(); this.sound?.chime(false); this.draw(); }
    else { const r = this.el.querySelector('.fix'); if (r) { r.classList.remove('no'); void r.offsetWidth; r.classList.add('no'); } }
  }

  draw() {
    const E = this.econ, cr = E.credits;
    const rows = Object.keys(UPG).map((k, i) => {
      const u = UPG[k], lvl = E.up[k] || 0, p = E.price(k);
      const state = p === null ? 'max' : p > cr ? 'cant' : '';
      return `<button class="up ${state}" data-k="${k}">${svg(UP_ICONS[k])}<div><b>${u.name}</b><span>${u.say}</span><em>${Array.from({ length: u.max }, (_, j) => `<i class="${j < lvl ? 'on' : ''}"></i>`).join('')}</em></div><strong>${p === null ? 'Max' : p.toLocaleString('en-US')}</strong><kbd>${i + 1}</kbd></button>`;
    }).join('');
    const broken = this.systems.list(), cost = this.systems.cost();
    const fix = broken.length
      ? `<button class="fix ${cost > cr ? 'cant' : ''}">${svg(UP_ICONS.wrench)}<div><b>Repair ${broken.map((k) => SYS[k].name).join(', ')}</b><span>Or weld it yourself outside for free</span></div><strong>${cost}</strong><kbd>R</kbd></button>`
      : `<p class="ok">${svg(UP_ICONS.wrench)}All systems working</p>`;
    this.el.innerHTML = `<div class="card"><header><div><span class="mono">Depot hangar</span><h2>Upgrades</h2></div><div class="cr"><span class="mono">Credits</span><b>${cr.toLocaleString('en-US')}</b></div><button class="x" aria-label="Close">${svg('<path d="M6 6l12 12M18 6L6 18"/>')}</button></header><div class="list">${rows}</div>${fix}<footer class="mono">Progress saves automatically</footer></div>`;
    for (const b of this.el.querySelectorAll('.up')) b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.buy(b.dataset.k); });
    this.el.querySelector('.fix')?.addEventListener('pointerdown', (e) => { e.preventDefault(); this.repair(); });
    this.el.querySelector('.x').addEventListener('pointerdown', (e) => { e.preventDefault(); this.toggle(false); });
  }
}
