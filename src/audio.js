// Procedural sound, no files: everything is synthesised with WebAudio from noise and a few oscillators.
// Layers: engine (rumble + roar on boost), RCS hiss, deep ambience, tow-line strain, plus one-shots for
// impacts, collapses, chimes and warnings. In EVA the ship goes quiet and the suit's air takes over.
export class Sound {
  constructor(volume = 0.7) {
    this.vol = volume; this.ctx = null; this.paused = false; this.t = 0;
    const go = () => { this.init(); removeEventListener('pointerdown', go); removeEventListener('keydown', go); };
    addEventListener('pointerdown', go); addEventListener('keydown', go);
    document.addEventListener('visibilitychange', () => { if (this.ctx) document.hidden ? this.ctx.suspend() : this.ctx.resume(); });
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.vol;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 5;
    this.master.connect(comp); comp.connect(c.destination);
    // noise sources
    const n = c.sampleRate * 2, wb = c.createBuffer(1, n, c.sampleRate), bb = c.createBuffer(1, n, c.sampleRate);
    const w = wb.getChannelData(0), b = bb.getChannelData(0); let last = 0;
    for (let i = 0; i < n; i++) { const r = Math.random() * 2 - 1; w[i] = r; last = (last + 0.02 * r) / 1.02; b[i] = last * 3.5; }
    this.wb = wb;
    const src = (buf) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
    const chain = (s, type, f, q, g) => { const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const gn = c.createGain(); gn.gain.value = g; s.connect(fl); fl.connect(gn); gn.connect(this.master); return { fl, gn }; };
    this.eng = chain(src(bb), 'lowpass', 140, 0.7, 0);            // rumble
    this.roar = chain(src(wb), 'bandpass', 700, 0.5, 0);           // boost roar
    this.hiss = chain(src(wb), 'highpass', 3200, 0.4, 0);          // RCS
    this.air = chain(src(wb), 'bandpass', 1400, 1.2, 0);           // suit air
    this.amb = chain(src(bb), 'lowpass', 70, 0.5, 0.18);           // the quiet of space
    // tow strain: a groaning saw
    this.saw = c.createOscillator(); this.saw.type = 'sawtooth'; this.saw.frequency.value = 62;
    const sg = this.sawG = c.createGain(); sg.gain.value = 0; const sf = c.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 400;
    this.saw.connect(sf); sf.connect(sg); sg.connect(this.master); this.saw.start();
    // engine tone follows the throttle
    this.tone = c.createOscillator(); this.tone.type = 'sawtooth'; this.tone.frequency.value = 44;
    this.toneG = c.createGain(); this.toneG.gain.value = 0; const tf = c.createBiquadFilter(); tf.type = 'lowpass'; tf.frequency.value = 220;
    this.tone.connect(tf); tf.connect(this.toneG); this.toneG.connect(this.master); this.tone.start();
  }

  setVolume(v) { this.vol = v; if (this.master) this.master.gain.setTargetAtTime(this.paused ? 0 : v, this.ctx.currentTime, 0.05); }
  setPaused(p) { this.paused = p; this.setVolume(this.vol); }

  // per-frame: s = { main, boost, rcs, strain, eva, o2low }
  update(dt, s) {
    const c = this.ctx; if (!c || c.state !== 'running') return;
    const now = c.currentTime, k = 0.06, set = (p, v) => p.setTargetAtTime(v, now, k);
    const out = s.eva ? 0.0 : 1;
    set(this.eng.gn.gain, out * (0.15 + 0.55 * s.main + 0.2 * s.boost)); set(this.eng.fl.frequency, 110 + 260 * s.main + 220 * s.boost);
    set(this.roar.gn.gain, out * s.boost * 0.22 + out * s.main * 0.03); set(this.roar.fl.frequency, 500 + 700 * s.main);
    set(this.toneG.gain, out * (0.03 + 0.1 * s.main)); set(this.tone.frequency, 38 + 34 * s.main + 20 * s.boost);
    set(this.hiss.gn.gain, Math.min(0.3, s.rcs * 0.05) * (s.eva ? 0.8 : 0.5));
    set(this.air.gn.gain, s.eva ? 0.025 + (s.o2low ? 0.04 : 0) : 0);
    set(this.air.fl.frequency, 1100 + 300 * Math.sin(now * 1.3));
    set(this.sawG.gain, out * Math.min(0.12, s.strain * 0.14)); set(this.saw.frequency, 58 + 50 * s.strain + 6 * Math.sin(now * 9));
    set(this.amb.gn.gain, s.eva ? 0.3 : 0.16);
  }

  env(g, a, d, peak) { const n = this.ctx.currentTime; g.gain.setValueAtTime(0.0001, n); g.gain.exponentialRampToValueAtTime(peak, n + a); g.gain.exponentialRampToValueAtTime(0.0001, n + a + d); }
  noise(dur, type, f, peak) {
    const c = this.ctx; if (!c || c.state !== 'running') return;
    const s = c.createBufferSource(); s.buffer = this.wb; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; const g = c.createGain();
    s.connect(fl); fl.connect(g); g.connect(this.master); this.env(g, 0.005, dur, peak); s.start(); s.stop(c.currentTime + dur + 0.1);
  }
  tonePing(freq, dur, peak, type = 'sine', slide = 0) {
    const c = this.ctx; if (!c || c.state !== 'running') return;
    const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = freq; if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), c.currentTime + dur);
    o.connect(g); g.connect(this.master); this.env(g, 0.006, dur, peak); o.start(); o.stop(c.currentTime + dur + 0.1);
  }

  hit(speed) { const p = Math.min(1, speed / 25); this.noise(0.25 + 0.3 * p, 'lowpass', 600 + 1400 * p, 0.35 + 0.5 * p); this.tonePing(90, 0.4, 0.5 * p + 0.15, 'sine', 0.4); }
  boom() { this.noise(2.4, 'lowpass', 300, 0.9); this.tonePing(60, 2, 0.8, 'sine', 0.3); }
  snap() { this.noise(0.12, 'highpass', 2000, 0.4); this.tonePing(220, 0.25, 0.2, 'triangle', 0.5); }
  hook() { this.tonePing(540, 0.12, 0.12, 'triangle'); this.tonePing(810, 0.1, 0.08, 'triangle'); }
  chime(rank) { const b = rank ? 440 : 660; [1, 1.25, 1.5, rank ? 2 : 1.875].forEach((m, i) => setTimeout(() => this.tonePing(b * m, 0.55, 0.14, 'sine'), i * 90)); }
  step() { this.tonePing(880, 0.1, 0.08, 'sine'); }
  warn() { for (let i = 0; i < 3; i++) setTimeout(() => this.tonePing(780, 0.16, 0.12, 'square'), i * 320); }
  deliver() { this.chime(false); }
}
