import { CFG } from './ship.js';

// Credits, upgrades and tutorial state, saved in localStorage. Upgrades are bought while docked.
// name / say are shown in the hangar (hangar.js)
export const UPG = {
  thrust: { max: 3, cost: [600, 1400, 2800], name: 'Engines', say: '+15% thrust and top speed' },
  tanks: { max: 3, cost: [450, 1100, 2300], name: 'Tanks', say: '+35% boost fuel, +40% suit oxygen' },
  hull: { max: 3, cost: [500, 1200, 2400], name: 'Hull', say: 'Armour soaks a third more damage' },
  winch: { max: 2, cost: [700, 1800], name: 'Tow', say: 'One more tow line, longer reach' },
  cutter: { max: 2, cost: [550, 1400], name: 'Cutter', say: 'Cut and weld 40% faster' },
  scanner: { max: 2, cost: [500, 1300], name: 'Scanner', say: 'Wider sweep, shorter cooldown' },
  jammer: { max: 2, cost: [800, 1700], name: 'Jammer', say: 'Stuns rival drones (J). Lv2: longer, wider' },
};
const BASE = { main: CFG.main, reverse: CFG.reverse, strafe: CFG.strafe, vert: CFG.vert, maxAssist: CFG.maxAssist, maxBoost: CFG.maxBoost };
const KEY = 'rell.save';

export class Econ {
  constructor() {
    this.credits = 0; this.up = { thrust: 0, tanks: 0, hull: 0, winch: 0, cutter: 0, scanner: 0, jammer: 0 }; this.tut = false; this.delivered = 0;
    this.sys = {}; this.story = { step: 0, prog: 0, done: false, seen: -1 }; this.ship = null; this.onSave = null;
    this.tips = {}; this.xp = 0; this.stats = { delivered: 0, jobs: 0, lockers: 0, cores: 0, storms: 0, dist: 0, drones: 0, sections: 0 }; this.career = { active: null, offers: null, seen: 0 };
    try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) { this.credits = s.credits | 0; Object.assign(this.up, s.up || {}); this.tut = !!s.tut; this.delivered = s.delivered | 0; this.xp = s.xp | 0; Object.assign(this.stats, s.stats || {}); Object.assign(this.career, s.career || {}); Object.assign(this.sys, s.sys || {}); Object.assign(this.story, s.story || {}); this.ship = s.ship || null; this.tips = s.tips || {}; } } catch {}
  }
  save(quiet) {
    try { localStorage.setItem(KEY, JSON.stringify({ credits: this.credits, up: this.up, tut: this.tut, delivered: this.delivered, xp: this.xp, stats: this.stats, career: this.career, sys: this.sys, story: this.story, ship: this.ship, tips: this.tips })); } catch {}
    if (!quiet) this.onSave?.();
  }
  spend(v) { if (this.credits < v) return false; this.credits -= v; this.save(); return true; }
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
    ship.tank = 1 + 0.35 * this.up.tanks; ship.o2Cap = 1 + 0.4 * this.up.tanks;
    ship.cutMul = 1 + 0.4 * this.up.cutter;
    if (salvage) { salvage.capacity = 1 + this.up.winch; salvage.range = 42 + 14 * this.up.winch; ship.towMass = 6 + 2.5 * this.up.winch; }
  }
}
