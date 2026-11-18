// Unified input: keyboard + mouse (pointer lock / drag) + touch (floating stick, look zone, buttons).
export const ICONS = {
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  boost: '<path d="M6 17l6-6 6 6M6 11l6-6 6 6"/>',
  brake: '<path d="M4 4l5 5M20 4l-5 5M4 20l5-5M20 20l-5-5M9 6.5V9H6.5M15 6.5V9h2.5M9 17.5V15H6.5M15 17.5V15h2.5"/><circle cx="12" cy="12" r="1.6"/>',
  assist: '<path d="M12 4l8 8-8 8-8-8z"/>',
  view: '<path d="M3 18h18M5 18c0-5 3-9 7-9s7 4 7 9M12 9v4M8.5 13h7"/>',
  grab: '<path d="M4 20L14 10"/><path d="M14 10l2-6 4 4-6 2"/><circle cx="4" cy="20" r="1.2"/>',
  impact: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><circle cx="12" cy="12" r="1.6"/>',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.lookDX = 0; this.lookDY = 0;
    this.stick = { x: 0, y: 0 };
    this.t = { up: false, down: false, boost: false, brake: false };
    this.invertY = false;
    this.onToggleAssist = () => {};
    this.onToggleImpact = () => {};
    this.onGrab = () => {};
    this.touchMode = matchMedia('(pointer: coarse)').matches;
    this.dragging = false;
    this.locked = false;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyZ' || e.code === 'KeyT') this.onToggleAssist();
      if (e.code === 'KeyB') this.onToggleImpact();
      if (e.code === 'KeyF' || e.code === 'KeyR') this.onGrab();
      if (e.code === 'KeyI') this.invertY = !this.invertY;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    // Stop double-tap zoom, pinch zoom and iOS gesture zoom from fighting the controls.
    // Pointer events still fire when touch default is cancelled, so the stick, look and buttons keep working.
    for (const t of ['touchstart', 'touchmove', 'touchend']) {
      addEventListener(t, (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
    }
    for (const g of ['gesturestart', 'gesturechange', 'gestureend']) {
      addEventListener(g, (e) => e.preventDefault(), { passive: false });
    }
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      // Esc releases the mouse: bring the "click to aim" hint back so PC players know how to re-grab it.
      if (!this.locked && !this.touchUI) document.getElementById('hint').style.opacity = '';
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      if (!this.locked && canvas.requestPointerLock) {
        try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch {}
      }
      this.dragging = true;
    });
    addEventListener('pointerup', () => { this.dragging = false; });
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      if (this.locked || this.dragging) { this.lookDX += e.movementX || 0; this.lookDY += e.movementY || 0; }
    });
    addEventListener('touchstart', () => this.enableTouch(), { once: true, passive: true });
    if (this.touchMode) this.enableTouch();
  }

  enableTouch() {
    if (this.touchUI) return;
    this.touchMode = true;
    this.touchUI = true;
    document.body.classList.add('touch');
    const zl = document.getElementById('zl'), zr = document.getElementById('zr');
    const base = zl.querySelector('.knob-base'), knob = zl.querySelector('.knob');
    const R = 56;
    let sid = null, ox = 0, oy = 0;
    zl.addEventListener('pointerdown', (e) => {
      if (sid !== null) return;
      sid = e.pointerId; zl.setPointerCapture(sid); ox = e.clientX; oy = e.clientY;
      base.style.left = knob.style.left = ox + 'px'; base.style.top = knob.style.top = oy + 'px';
      zl.classList.add('on');
    });
    zl.addEventListener('pointermove', (e) => {
      if (e.pointerId !== sid) return;
      let dx = e.clientX - ox, dy = e.clientY - oy; const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      this.stick.x = dx / R; this.stick.y = -dy / R;
      knob.style.left = ox + dx + 'px'; knob.style.top = oy + dy + 'px';
    });
    const endStick = (e) => { if (e.pointerId !== sid) return; sid = null; this.stick.x = this.stick.y = 0; zl.classList.remove('on'); };
    zl.addEventListener('pointerup', endStick); zl.addEventListener('pointercancel', endStick);

    let lid = null, lx = 0, ly = 0;
    zr.addEventListener('pointerdown', (e) => { if (lid !== null) return; lid = e.pointerId; zr.setPointerCapture(lid); lx = e.clientX; ly = e.clientY; });
    zr.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lid) return;
      this.lookDX += (e.clientX - lx) * 1.7; this.lookDY += (e.clientY - ly) * 1.7; lx = e.clientX; ly = e.clientY;
    });
    const endLook = (e) => { if (e.pointerId === lid) lid = null; };
    zr.addEventListener('pointerup', endLook); zr.addEventListener('pointercancel', endLook);

    const btns = document.getElementById('btns');
    const mk = (name, hold, fn = () => this.onToggleAssist()) => {
      const b = document.createElement('div'); b.className = 'btn';
      b.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;
      const set = (v) => { b.classList.toggle('down', v); if (hold) this.t[name] = v; };
      b.addEventListener('pointerdown', (e) => { e.stopPropagation(); b.setPointerCapture(e.pointerId); set(true); if (!hold) { fn(); setTimeout(() => set(false), 120); } });
      const up = (e) => { e.stopPropagation(); if (hold) set(false); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
      btns.appendChild(b);
    };
    mk('boost', true); mk('up', true); mk('brake', true); mk('down', true); mk('assist', false); mk('grab', false, () => this.onGrab());
  }

  k(...c) { return c.some((x) => this.keys.has(x)); }

  // Returns the command for this frame and clears accumulated look deltas.
  consume() {
    const k = this.k.bind(this);
    const cmd = {
      fwd: (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0) + this.stick.y,
      strafe: (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0) + this.stick.x,
      vert: (k('Space') ? 1 : 0) - (k('KeyC', 'ControlLeft') ? 1 : 0) + (this.t.up ? 1 : 0) - (this.t.down ? 1 : 0),
      roll: (k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0),
      boost: k('ShiftLeft', 'ShiftRight') || this.t.boost,
      brake: k('KeyX') || this.t.brake,
      yawKey: (k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0),
      pitchKey: (k('ArrowUp') ? 1 : 0) - (k('ArrowDown') ? 1 : 0),
      dx: this.lookDX, dy: this.lookDY * (this.invertY ? -1 : 1),
    };
    for (const a of ['fwd', 'strafe', 'vert']) cmd[a] = Math.max(-1, Math.min(1, cmd[a]));
    this.lookDX = this.lookDY = 0;
    return cmd;
  }
}
