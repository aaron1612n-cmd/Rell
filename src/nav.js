import * as THREE from 'three';

// Wordless navigation + economy HUD:
//  - one marker per site (icon + range), pinned to the screen edge with an arrow when off-screen
//  - corner brackets on salvage near you; the one the tow line would take is orange, with its value
//  - credits and free tow slots top centre; upgrade tiles appear while docked at the depot
const svg = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
export const NAV_ICONS = {
  depot: '<path d="M17 5H6v14h11"/><path d="M10 9h7M10 15h7"/><circle cx="20" cy="12" r="1.2"/>',
  wreck: '<path d="M12 3l8 8-3.5 3.5M12 21l-8-8 3.5-3.5"/><path d="M10 11l2 2 2-2"/>',
  relay: '<path d="M12 3l7 4v6l-7 4-7-4V7z"/><path d="M12 17v4M9 21h6"/><circle cx="12" cy="10" r="1.2"/>',
  field: '<circle cx="7" cy="8" r="1.6"/><circle cx="16" cy="6" r="1.2"/><circle cx="13" cy="14" r="2"/><circle cx="6" cy="17" r="1.1"/><circle cx="19" cy="17" r="1.4"/>',
  thrust: '<path d="M6 17l6-6 6 6M6 11l6-6 6 6"/>',
  winch: '<path d="M12 3v9"/><path d="M12 12a4 4 0 1 0 4 4"/><circle cx="12" cy="3" r="1"/>',
  hull: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/>',
  grab: '<path d="M4 20L14 10"/><path d="M14 10l2-6 4 4-6 2"/><circle cx="4" cy="20" r="1.2"/>',
};
const _p = new THREE.Vector3(), _v = new THREE.Vector3(), _f = new THREE.Vector3();

function fmt(d) { return d >= 1000 ? [(d / 1000).toFixed(d >= 10000 ? 0 : 1), 'km'] : [String(Math.round(d / 10) * 10), 'm']; }

export class Nav {
  constructor({ world, salvage, econ, ship, input }) {
    Object.assign(this, { world, salvage, econ, ship, input });
    const root = this.root = document.createElement('div'); root.id = 'nav'; document.getElementById('hud').appendChild(root);
    this.marks = world.sites.map((s) => {
      const el = document.createElement('div'); el.className = 'mk'; el.dataset.kind = s.kind;
      el.innerHTML = `<i class="ar"></i>${svg(NAV_ICONS[s.kind])}<b></b><u></u><em></em>`;
      root.appendChild(el);
      return { s, el, b: el.querySelector('b'), u: el.querySelector('u'), em: el.querySelector('em'), last: '', cls: '' };
    });
    this.brs = []; for (let i = 0; i < 8; i++) {
      const el = document.createElement('div'); el.className = 'br';
      el.innerHTML = '<svg viewBox="0 0 40 40" preserveAspectRatio="none"><path d="M1 12V1h11M28 1h11v11M39 28v11H28M12 39H1V28"/></svg><b></b><s><i></i></s>';
      root.appendChild(el); this.brs.push({ el, b: el.querySelector('b'), bar: el.querySelector('s i'), last: '', on: false });
    }
    // credits + tow slots
    const top = document.createElement('div'); top.id = 'cr';
    top.innerHTML = `<span class="mono">Cr</span><b>0</b><div id="tow"></div><div id="pop"></div>`;
    document.getElementById('hud').appendChild(top);
    this.crEl = top.querySelector('b'); this.towEl = top.querySelector('#tow'); this.popEl = top.querySelector('#pop');
    this.shown = -1; this.crShown = econ.credits; this.lastTow = '';
    this.docked = false; this.onBuy = null;
  }

  setDocked(v) {
    if (v === this.docked) return;
    this.docked = v; this.onDock?.(v);
  }

  pop(v) {
    const e = document.createElement('i'); e.textContent = '+' + v; this.popEl.appendChild(e);
    setTimeout(() => e.remove(), 1600);
  }

  update(dt, camera, w, h, time) {
    const ship = this.ship, sal = this.salvage;
    // credits count up instead of jumping
    const c = this.econ.credits;
    if (this.crShown !== c) { this.crShown += Math.sign(c - this.crShown) * Math.max(1, Math.ceil(Math.abs(c - this.crShown) * Math.min(1, dt * 5))); if (Math.abs(this.crShown - c) < 1) this.crShown = c; }
    if (this.shown !== this.crShown) { this.crEl.textContent = this.crShown.toLocaleString('en-US'); this.shown = this.crShown; }
    const tw = `${sal.ropes.length}/${sal.capacity}`;
    if (tw !== this.lastTow) {
      this.towEl.innerHTML = Array.from({ length: sal.capacity }, (_, i) => `<i class="${i < sal.ropes.length ? 'on' : ''}"></i>`).join('');
      this.lastTow = tw;
    }

    const towing = sal.ropes.some((r) => r.item.state === 'towed');
    // right edge keeps clear of the hull gauge so pinned markers never sit on it
    const MX = Math.min(84, w * 0.12), MXR = Math.min(118, w * 0.12 + 40), MY = 64, cx = w / 2, cy = h / 2;
    for (const m of this.marks) {
      const s = m.s; const d = Math.max(0, s.pos.distanceTo(ship.pos) - (s.kind === 'depot' ? 0 : s.radius * 0.4));
      const inside = s.kind !== 'depot' && s.pos.distanceTo(ship.pos) < s.radius * 0.9 && s.state !== 'unstable';
      const hide = inside || (s.kind === 'depot' && this.docked) || (s.state === 'collapsed' && !s.debris.length);
      let cls = s.kind;
      if (s.kind === 'depot' && towing) cls += ' hot';
      if (s.state === 'unstable') cls += ' warn';
      if (s.state === 'collapsed') cls += ' dead';
      if (hide) cls += ' gone';
      // target point: depot points at the catch mouth
      _v.copy(s.kind === 'depot' ? s.mouth : s.pos);
      _p.copy(_v).project(camera);
      const behind = _p.z > 1;
      let x = (_p.x * 0.5 + 0.5) * w, y = (-_p.y * 0.5 + 0.5) * h;
      if (behind) { x = w - x; y = h - y; }
      const MB = Math.max(MY, Math.min(150, h * 0.2)), off = behind || x < MX || x > w - MXR || y < MY || y > h - MB;
      let ang = 0;
      if (off) {
        let dx = x - cx, dy = y - cy; if (behind && Math.abs(dx) + Math.abs(dy) < 1) dy = 1;
        const k = Math.min((dx > 0 ? w - MXR - cx : cx - MX) / Math.abs(dx || 1e-3), (dy > 0 ? h - MB - cy : cy - MY) / Math.abs(dy || 1e-3));
        x = cx + dx * k; y = cy + dy * k; ang = Math.atan2(dy, dx); cls += ' off';
      }
      if (cls !== m.cls) { m.el.className = 'mk ' + cls; m.cls = cls; }
      m.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
      if (off) m.el.style.setProperty('--a', ang + 'rad');
      const [num, unit] = fmt(d);
      const txt = num + unit + (s.state === 'unstable' ? Math.ceil(s.timer) : '');
      if (txt !== m.last) { m.b.textContent = num; m.u.textContent = unit; m.em.textContent = s.state === 'unstable' ? Math.ceil(s.timer) : ''; m.last = txt; }
    }

    // salvage brackets: nearest few within reach of the eye, in front of the camera
    camera.getWorldDirection(_f);
    const list = [];
    for (const it of sal.items) {
      if (it.state === 'gone' || it.state === 'captured' || it.hidden) continue;
      const d = it.body.pos.distanceTo(ship.pos); if (d > 320) continue;
      _v.copy(it.body.pos).sub(camera.position); if (_v.dot(_f) < 0) continue;
      list.push([d, it]);
    }
    list.sort((a, b) => a[0] - b[0]);
    const hot = sal.candidate;
    if (hot && !list.some((x) => x[1] === hot)) list.unshift([0, hot]);
    for (let i = 0; i < this.brs.length; i++) {
      const B = this.brs[i], e = list[i];
      if (!e) { if (B.on) { B.el.style.display = 'none'; B.on = false; } continue; }
      const it = e[1];
      _p.copy(it.body.pos).project(camera);
      if (_p.z > 1) { if (B.on) { B.el.style.display = 'none'; B.on = false; } continue; }
      if (!B.on) { B.el.style.display = ''; B.on = true; }
      const dist = camera.position.distanceTo(it.body.pos);
      const px = THREE.MathUtils.clamp(it.body.radius / (dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * h, 14, 220);
      const x = (_p.x * 0.5 + 0.5) * w, y = (-_p.y * 0.5 + 0.5) * h;
      const towed = sal.ropes.find((r) => r.item === it);
      const cls = 'br' + (it === hot ? ' hot' : '') + (towed ? ' tow' : '') + (it.state === 'welded' ? ' weld' : '') + (it.kind === 'core' ? ' core' : '');
      if (B.el.className !== cls) B.el.className = cls;
      B.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
      B.el.style.width = B.el.style.height = (px * 2).toFixed(0) + 'px';
      B.el.style.margin = `${(-px).toFixed(0)}px 0 0 ${(-px).toFixed(0)}px`;
      const val = Math.round(it.value * it.integrity / 10) * 10;
      const lbl = it === hot || towed ? String(val) : '';
      if (lbl !== B.last) { B.b.textContent = lbl; B.last = lbl; }
      const bar = it.state === 'welded' && towed ? Math.min(1, it.strain) : it.integrity;
      B.bar.style.width = (bar * 100).toFixed(0) + '%';
      B.bar.parentNode.style.opacity = (it.state === 'welded' && towed) || it.integrity < 0.99 ? 1 : 0;
    }
  }
}
