import { CFG } from './ship.js';

// Credits, upgrades and tutorial state, saved in localStorage. Upgrades are bought while docked.
export const UPG = {
  thrust: { max: 3, cost: [600, 1400, 2800] },   // +15% thrust per level, higher speed caps
  winch: { max: 2, cost: [700, 1800] },          // one more tow line per level, longer reach, steadier pull
  hull: { max: 3, cost: [500, 1200, 2400] },     // armour: each level soaks a third more damage
};
const BASE = { main: CFG.main, reverse: CFG.reverse, strafe: CFG.strafe, vert: CFG.vert, maxAssist: CFG.maxAssist, maxBoost: CFG.maxBoost };
const KEY = 'rell.save';

export class Econ {
  constructor() {
    this.credits = 0; this.up = { thrust: 0, winch: 0, hull: 0 }; this.tut = false; this.delivered = 0;
    this.xp = 0; this.stats = { delivered: 0, jobs: 0, lockers: 0, cores: 0, storms: 0, dist: 0 }; this.career = { active: null, offers: null, seen: 0 };
    try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) { this.credits = s.credits | 0; Object.assign(this.up, s.up || {}); this.tut = !!s.tut; this.delivered = s.delivered | 0; this.xp = s.xp | 0; Object.assign(this.stats, s.stats || {}); Object.assign(this.career, s.career || {}); } } catch {}
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify({ credits: this.credits, up: this.up, tut: this.tut, delivered: this.delivered, xp: this.xp, stats: this.stats, career: this.career })); } catch {} }
  price(k) { const u = UPG[k], l = this.up[k]; return l >= u.max ? null : u.cost[l]; }
  buy(k) { const p = this.price(k); if (p === null || this.credits < p) return false; this.credits -= p; this.up[k]++; this.save(); return true; }
  earn(v) { this.credits += v; this.xp += v; this.delivered++; this.stats.delivered++; this.save(); }
  bonus(v) { this.credits += v; this.xp += v; this.save(); }
  reset() { try { localStorage.removeItem(KEY); } catch {} }

  apply(ship, salvage) {
    const t = 1 + 0.15 * this.up.thrust;
    CFG.main = BASE.main * t; CFG.reverse = BASE.reverse * t; CFG.strafe = BASE.strafe * t; CFG.vert = BASE.vert * t;
    CFG.maxAssist = BASE.maxAssist + 6 * this.up.thrust; CFG.maxBoost = BASE.maxBoost + 12 * this.up.thrust;
    ship.armor = 1 / (1 + 0.33 * this.up.hull);
    if (salvage) { salvage.capacity = 1 + this.up.winch; salvage.range = 42 + 14 * this.up.winch; ship.towMass = 6 + 2.5 * this.up.winch; }
  }
}
