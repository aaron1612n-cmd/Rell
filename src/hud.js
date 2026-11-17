import * as THREE from 'three';

const _p = new THREE.Vector3(), _f = new THREE.Vector3();

export class Hud {
  constructor() {
    this.spd = document.getElementById('spd');
    this.assist = document.getElementById('assist');
    this.hull = document.getElementById('hull');
    this.reticle = document.getElementById('reticle');
    this.pro = document.getElementById('pro');
    this.flash = document.getElementById('flash');
    this.hint = document.getElementById('hint');
    this.segs = [];
    for (let i = 0; i < 10; i++) { const s = document.createElement('i'); this.hull.appendChild(s); this.segs.push(s); }
    this.lastSpd = -1; this.lastHull = -1; this.lastAssist = null; this.flashA = 0;
  }

  setAssist(on) { if (this.lastAssist !== on) { this.assist.classList.toggle('on', on); this.lastAssist = on; } }

  pulse(a) { this.flashA = Math.min(0.5, this.flashA + a); }

  update(dt, ship, camera, w, h) {
    const sp = Math.round(ship.vel.length());
    if (sp !== this.lastSpd) { this.spd.textContent = String(sp).padStart(3, '0'); this.lastSpd = sp; }
    const n = Math.ceil(ship.hull * 10 - 1e-6);
    if (n !== this.lastHull) { this.segs.forEach((s, i) => s.classList.toggle('off', i >= n)); this.hull.classList.toggle('low', n <= 3); this.lastHull = n; }
    this.setAssist(ship.assist);

    // nose reticle + prograde marker, projected from world space
    const place = (el, world) => {
      _p.copy(world).project(camera);
      if (_p.z > 1) { el.style.display = 'none'; return; }
      el.style.display = '';
      el.style.transform = `translate(${(_p.x * 0.5 + 0.5) * w}px,${(-_p.y * 0.5 + 0.5) * h}px)`;
    };
    place(this.reticle, _f.copy(ship.forward()).multiplyScalar(90).add(ship.pos));
    if (ship.vel.length() > 1.2) place(this.pro, _f.copy(ship.vel).normalize().multiplyScalar(90).add(ship.pos)); else this.pro.style.display = 'none';

    if (this.flashA > 0.002) { this.flash.style.opacity = this.flashA.toFixed(3); this.flashA *= Math.exp(-7 * dt); } else if (this.flash.style.opacity !== '0') this.flash.style.opacity = '0';
  }

  hideHint() { this.hint.style.opacity = 0; }
}
