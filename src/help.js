// Controls overlay: icons + one-word labels. Shows the layout for the active input (touch vs keyboard/mouse).
import { ICONS } from './input.js';

const svg = (p) => `<svg viewBox="0 0 24 24">${p}</svg>`;
const key = (k, label, wide) => `<div class="row"><kbd${wide ? ' class="w"' : ''}>${k}</kbd><span>${label}</span></div>`;
const tb = (name, label) => `<div class="row"><b class="ic">${svg(ICONS[name])}</b><span>${label}</span></div>`;

const KB = `
  <section><h3>Move</h3><div class="wasd"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></div></section>
  <section><h3>Thrust</h3>${key('Space', 'Up', 1)}${key('C', 'Down')}${key('Shift', 'Boost', 1)}${key('X', 'Brake')}</section>
  <section><h3>Aim</h3>${key('Mouse', 'Look', 1)}${key('Q E', 'Roll')}${key('Z', 'Assist')}${key('I', 'Invert')}${key('V', 'View')}</section>`;

const TOUCH = `
  <section><h3>Left thumb</h3><div class="row"><b class="ic pad">${svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/>')}</b><span>Move</span></div></section>
  <section><h3>Right thumb</h3><div class="row"><b class="ic pad">${svg('<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>')}</b><span>Aim</span></div></section>
  <section><h3>Buttons</h3>${tb('boost', 'Boost')}${tb('up', 'Up')}${tb('brake', 'Brake')}${tb('down', 'Down')}${tb('assist', 'Assist')}${tb('view', 'View')}</section>`;

export class Help {
  constructor(input) {
    this.input = input;
    this.el = document.getElementById('help');
    this.btn = document.getElementById('helpbtn');
    this.open = false;
    this.btn.innerHTML = svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17v.01"/>');
    this.btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); this.toggle(); });
    this.el.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.toggle(false); });
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyH' || e.code === 'F1' || (e.code === 'Slash' && e.shiftKey)) { e.preventDefault(); this.toggle(); }
      else if (e.code === 'Escape' && this.open) this.toggle(false);
    });
  }

  toggle(force) {
    this.open = force ?? !this.open;
    if (this.open) {
      this.el.innerHTML = `<div class="card">${this.input.touchMode ? TOUCH : KB}</div>`;
      if (document.pointerLockElement) document.exitPointerLock();
    }
    this.el.classList.toggle('show', this.open);
    this.btn.classList.toggle('on', this.open);
  }
}
