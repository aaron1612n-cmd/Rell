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
    const X = this.ext || {}, sys = X.systems, br = X.breakup, dr = X.drones, st = X.story, ship = this.ship;
    if (this.eva.state === 'eva') {
      if (this.eva.o2 < 0.25 && !this.eva.safe) return ['Low oxygen: get back to your seat', k('G at the seat, or hold R to reel in', 'tap Hatch at the seat, or Reel')];
      if (sys && sys.any()) return ['Weld the sparking scorch on your hull', sys.list().map((x) => X.SYS[x].name).join(', ') + ' broken'];
      if (br && br.melting) return ['Reactor meltdown: get back in and get clear', Math.ceil(br.reactor.melt) + 's'];
      const so = st && st.cur && st.cur.id === 'vesper' && st.rec && st.rec.state === 'bolted' && this.eva.pilot.pos.distanceTo(st.rec.g.getWorldPosition(this._v || (this._v = this.eva.pilot.pos.clone()))) < 60;
      if (so) return ['Cut the 4 bolts on the orange flight recorder', `${st.rec.bolts.filter((b) => b.cut).length}/4`];
      if (br && this.eva.pilot.pos.distanceTo(br.site.pos) < 180) return ['Cut the striped collars to free a section', 'reactor: cut the two clamps, never the frosted line'];
      const B = this.base;
      if (B && B.here >= 0) {
        if (B.nearCounter) return [`Talk to Ilse · ${k('G', 'Hatch')}`, 'upgrades · ships · claims'];
        if (B.nearBed) return [`Sleep · ${k('G', 'Hatch')}`, 'tops up suit, jet and hull'];
        if (B.here === 0) return ['Float through the back door to Ilse', `${k('G', 'Hatch')} at the jet to fly`];
        return ['Ilse is at the counter · bunk is up the shaft', `${k('G', 'Hatch')} at the jet to fly`];
      }
      return [`Cut lockers for credits · ${k('G', 'Hatch')} at the ship to return`, ''];
    }
    if (this.eva.state !== 'off') return null;
    if (this.nav.docked) return [`Docked: get out (${k('G', 'Hatch')}) and see Ilse`, 'upgrades · ships · claims'];
    if (br && br.melting) return ['Reactor meltdown: get clear or deliver it fast', Math.ceil(br.reactor.melt) + 's'];
    if (dr && dr.chasing && dr.chasing.mode === 'latch') return ['A drone is on your cargo: ram it or jam it', k('J to jam', 'tap Jam')];
    if (sys && sys.any()) return [`${sys.list().map((x) => X.SYS[x].name).join(', ')} broken: go outside (${k('G', 'Hatch')}) and weld it`, 'or pay Ilse for repairs at the yard'];
    const depot = this.world.site.depot, d = depot ? ship.pos.distanceTo(depot.mouth) : 0;
    const dist = d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m';
    if (dr && dr.chasing) return ['A drone is chasing your tow: outrun, ram or jam it', dist + ' to the depot'];
    if (this.salvage.ropes.length) return ['Tow it to the depot to sell it', dist];
    const a = this.career.c.active;
    if (a && JOB_SAY[a.kind]) return [JOB_SAY[a.kind](a), a.prog + '/' + a.goal];
    const so = st && st.objective(); if (so) return [so[0], so[1]];
    return [`Find wreckage, aim at it, ${k('press F', 'tap Grab')} to tow`, 'then sell it at the depot'];
  }

  update(dt) {
    this.t -= dt; if (this.t > 0) return; this.t = 0.2;
    const s = this.settings.get('hints') && !this.tutorial.on && this.tutorial.econ.tut ? this.say() : null;
    const key = s ? s.join('|') : '';
    if (key === this.last) return; this.last = key;
    this.el.classList.toggle('on', !!s);
    if (s) { this.b.textContent = s[0]; this.u.textContent = s[1]; }
  }
}
