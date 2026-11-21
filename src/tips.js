// First-time tips: one short line the first time something new happens (a system breaks, a drone goes for your
// cargo, you dock with the hangar unvisited...). Each shows once per save, and only after the guided tutorial.
const TIPS = {
  'mode-damped': ['Damped', 'Thrusters kill any drift you are not steering. Z to change.'],
  'mode-hold': ['Hold', 'Cruise control: W and S set the speed, the ship keeps it while you turn.'],
  'mode-drift': ['Drift', 'No damping. You keep sliding until you burn against it, and top speed is higher.'],
  broken: ['Damage', 'A part is broken. Go outside (G) and hold the cutter on the sparking scorch to weld it.'],
  hangar: ['Yard', 'Docked. Get out and float to Ilse at the counter: upgrades, repairs, ships.'],
  drone: ['Drone', 'A rival drone is after your cargo. Ram it hard, outrun it, or jam it (J, Ilse sells one).'],
  latched: ['Latched', 'It has your load. Ram it hard or jam it before it cuts your line.'],
  o2: ['Oxygen', 'Suit air is low. Get back in the ship (G at the seat) or reel in (R).'],
  seam: ['Seams', 'Big wrecks come apart at their seams. Cut every seam on a section to free it for towing.'],
  reactor: ['Reactor', 'Cut the two clamps. Never the frosted coolant line: that starts a meltdown.'],
  meltdown: ['Meltdown', 'The reactor will blow. Get well clear, or haul it to the depot before it does.'],
  cutter: ['Cutter', 'Your tool, not a weapon. Hold it on bolts and seams to cut, on scorch marks to weld. The label under the crosshair says what it will do.'],
  story: ['Contract', 'Story contracts are shown at the depot. They pay well and lead somewhere.'],
};

export class Tips {
  constructor({ econ, settings, isBusy }) {
    Object.assign(this, { econ, settings, isBusy });
    this.el = document.createElement('div'); this.el.id = 'tip'; document.body.appendChild(this.el);
    this.q = []; this.t = 0;
    // tap to dismiss (phones: it sits over the view)
    this.el.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.t = Math.min(this.t, 0.01); });
  }

  show(key, force = false) {
    const T = TIPS[key]; if (!T) return;
    if (!force && (this.econ.tips[key] || !this.econ.tut || !this.settings.get('hints'))) return;
    if (this.q.includes(key) || this.cur === key) return;
    this.econ.tips[key] = 1; this.econ.save(true);
    this.q.push(key);
  }

  update(dt) {
    if (this.t > 0) { this.t -= dt; if (this.t <= 0) { this.el.classList.remove('show'); this.cur = null; } return; }
    if (!this.q.length || this.isBusy?.()) return;
    const key = this.cur = this.q.shift(), [h, p] = TIPS[key];
    this.el.innerHTML = `<b>${h}</b><span>${p}</span>`; this.el.classList.add('show'); this.t = 6.5;
  }
}
