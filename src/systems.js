import * as THREE from 'three';
import { K } from './gpufx.js';

// Ship systems that break. A hard hit (or a reactor blast) can knock out the system nearest where it landed:
// the engines lose half their thrust and the boost, the thrusters turn and brake sluggishly, the winch can't
// throw a line, the scanner goes dark. Each broken system leaves a sparking scorch on the hull right where the
// part is: go outside and weld it shut (free), or pay the hangar to fix it while docked.
// Broken systems are saved with the rest of the game and come back on reload.

export const SYS = {
  engines: { name: 'Engines', fx: 'half thrust, no boost', at: [[0.98, 0.18, 1.25], [1.7, 0.35, 1.25]], cost: 260 },
  rcs: { name: 'Thrusters', fx: 'slow turning and braking', at: [[2.2, 0.12, 0.95], [2.9, 0.45, 0.95]], cost: 200 },
  winch: { name: 'Tow winch', fx: 'no tow line', at: [[0, -0.32, 1.85], [0, -1.3, 2.3]], cost: 180 },
  scanner: { name: 'Scanner', fx: 'no deep scan', at: [[0, 0.3, -1.45], [0, 1.2, -2.0]], cost: 150 },
};
const KEYS = Object.keys(SYS);
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _l = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Systems {
  constructor({ ship, damage, econ, fx, getFxT }) {
    Object.assign(this, { ship, damage, econ, fx, getFxT });
    this.broken = {}; for (const k of KEYS) this.broken[k] = !!econ.sys[k];
    this.spots = {}; this.onBreak = null; this.onFix = null; this.acc = 0;
    damage.onFixed = (s) => { if (s.sys) this.repair(s.sys, true); };
    // HUD: broken systems listed above the hull gauge
    const el = this.el = document.createElement('div'); el.id = 'sys'; document.getElementById('hud').appendChild(el);
    this.apply(); this.draw();
  }

  // re-create the scorch for every system that was broken when the game was saved (needs the ship placed)
  restore() { for (const k of KEYS) if (this.broken[k] && !this.spots[k]) this.mark(k); }

  any() { return KEYS.some((k) => this.broken[k]); }
  list() { return KEYS.filter((k) => this.broken[k]); }

  // a hit at world point p for `dmg` hull: maybe break the system nearest it
  hit(p, dmg) {
    if (dmg < 0.035) return null;
    _q.copy(this.ship.quat).invert(); _l.copy(p).sub(this.ship.pos).applyQuaternion(_q);
    let best = null, bd = 1e9;
    for (const k of KEYS) {
      const a = SYS[k].at[0];
      // engines and thrusters come in pairs: mirror to the side that was hit
      const d = _v.set(Math.abs(a[0]) > 0 ? Math.sign(_l.x || 1) * Math.abs(a[0]) : 0, a[1], a[2]).distanceTo(_l);
      if (d < bd) { bd = d; best = k; }
    }
    const chance = Math.min(0.95, dmg * 6) * (bd < 1.6 ? 1 : 0.45);
    if (Math.random() > chance) return null;
    return this.break(best, Math.sign(_l.x || 1));
  }

  break(k, side = 1) {
    if (!k || this.broken[k]) return null;
    this.broken[k] = true; this.econ.sys[k] = true; this.econ.save(true);
    this.mark(k, side); this.apply(); this.draw();
    this.onBreak?.(k);
    return k;
  }

  // the scorch you weld: placed by raycasting the real hull from just outside the part
  mark(k, side = 1) {
    const [to, from] = SYS[k].at, s = side < 0 ? -1 : 1;
    _v.set(from[0] * s, from[1], from[2]).applyQuaternion(this.ship.quat).add(this.ship.pos);
    const spot = this.damage.add(_v, this.ship, 0.06, new THREE.Vector3(to[0] * s, to[1], to[2]));
    spot.sys = k; spot.fix = 0; spot.need = 3.2; spot.amt0 = spot.amt; this.damage.size(spot); spot.m.scale.multiplyScalar(1.35);
    this.spots[k] = spot;
  }

  repair(k, welded = false) {
    if (!this.broken[k]) return;
    this.broken[k] = false; this.econ.sys[k] = false; this.econ.save(!welded);
    const s = this.spots[k]; if (s) { s.amt = 0; s.u.uAmt.value = 0; s.sys = null; }
    delete this.spots[k];
    this.apply(); this.draw(); this.onFix?.(k, welded);
  }
  repairAll() { for (const k of KEYS) this.repair(k); }
  cost() { return KEYS.reduce((a, k) => a + (this.broken[k] ? SYS[k].cost : 0), 0); }

  apply() {
    const e = this.ship.eff, b = this.broken;
    e.main = b.engines ? 0.45 : 1; e.boost = !b.engines; e.rcs = b.rcs ? 0.45 : 1;
    this.ship.winchOk = !b.winch; this.ship.scanOk = !b.scanner;
  }

  draw() {
    const l = this.list();
    this.el.classList.toggle('on', l.length > 0);
    this.el.innerHTML = l.map((k) => `<p><i></i><b>${SYS[k].name}</b><span>${SYS[k].fx}</span></p>`).join('');
  }

  // broken parts spit sparks and the odd puff of smoke, so you can see the damage from the chase camera
  update(dt) {
    if (!this.any()) return;
    this.acc += dt * 9;
    while (this.acc > 1) {
      this.acc--;
      for (const k of KEYS) {
        const s = this.spots[k]; if (!s || Math.random() > 0.5) continue;
        this.damage.world(s, this.ship, _v, _n);
        const n = _n.multiplyScalar(1.5 + Math.random() * 3).add(this.ship.vel).add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2));
        this.fx.emit(_v, n, this.getFxT(), 0.2 + Math.random() * 0.4, 0.03, 0.02, Math.random() < 0.4 ? K.EMBER : K.SPARK, 0.6, 0.04);
        if (Math.random() < 0.08) this.fx.emit(_v, this.ship.vel, this.getFxT(), 0.08, 0.15, 0.25, K.FLASH);
      }
    }
  }
}
