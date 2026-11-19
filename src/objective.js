// Current objective: one plain-language line top centre telling the player what to do next.
// Hidden during the guided tutorial (it carries its own instructions) and when hints are off.
const JOB_SAY = {
  haul: (a) => `Deliver ${a.goal} wreck${a.goal > 1 ? 's' : ''} to the depot`,
  earn: (a) => `Earn ${a.goal} credits from salvage`,
  locker: (a) => `Cut open ${a.goal} locker${a.goal > 1 ? 's' : ''}`,
  core: () => 'Tear out a station core and deliver it',
  clean: (a) => `Deliver ${a.goal} undamaged wreck${a.goal > 1 ? 's' : ''}`,
  quick: () => 'Deliver a wreck fast',
  storm: () => 'Ride out a meteor shower or flare unhurt',
};

export class Objective {
  constructor({ ship, salvage, world, nav, eva, career, input, tutorial, settings }) {
    Object.assign(this, { ship, salvage, world, nav, eva, career, input, tutorial, settings });
    this.el = document.createElement('div'); this.el.id = 'obj';
    this.el.innerHTML = '<span class="mono">Objective</span><b></b><u></u>';
    document.getElementById('hud').appendChild(this.el);
    this.b = this.el.querySelector('b'); this.u = this.el.querySelector('u'); this.last = ''; this.t = 0;
  }

  say() {
    const touch = this.input.touchMode, k = (key, tap) => touch ? tap : key;
    if (this.eva.state === 'eva') return [`Cut lockers for credits · ${k('G', 'Hatch')} at the ship to return`, ''];
    if (this.eva.state !== 'off') return null;
    if (this.nav.docked) return ['Docked: pick a job, buy upgrades, then fly out', ''];
    const depot = this.world.site.depot, d = depot ? this.ship.pos.distanceTo(depot.mouth) : 0;
    const dist = d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m';
    if (this.salvage.ropes.length) return ['Tow it to the depot to sell it', dist];
    const a = this.career.c.active;
    if (a && JOB_SAY[a.kind]) return [JOB_SAY[a.kind](a), a.prog + '/' + a.goal];
    return [`Find wreckage, aim at it, ${k('press F', 'tap Grab')} to tow`, 'then sell it at the depot'];
  }

  update(dt) {
    this.t -= dt; if (this.t > 0) return; this.t = 0.25;
    const s = this.settings.get('hints') && !this.tutorial.on && this.tutorial.econ.tut ? this.say() : null;
    const key = s ? s.join('|') : '';
    if (key === this.last) return; this.last = key;
    this.el.classList.toggle('on', !!s);
    if (s) { this.b.textContent = s[0]; this.u.textContent = s[1]; }
  }
}
