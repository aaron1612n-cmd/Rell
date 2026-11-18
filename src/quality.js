import * as THREE from 'three';

// Adaptive quality. Watches real frame times and steps a ladder of settings down when the GPU
// can't keep up, and back up when there is headroom. Big costs on desktop GPUs, in order:
// pixel count (high-DPI screens), 4x MSAA on a float target, the sun's shadow map, bloom, heat haze.
//
// It uses GPU timer queries when the browser exposes them (exact GPU ms per frame). Otherwise it
// reads requestAnimationFrame intervals: a step down when frames are slow, and a cautious probe up
// that is rolled back, and not retried for a while, if it costs frames.

const DESK = [
  { pr: 0.6,  msaa: 0, shadow: 1024, bloom: true, haze: false, grain: false, debrisShadow: false, far: 600 },
  { pr: 0.8,  msaa: 0, shadow: 2048, bloom: true, haze: false, grain: false, debrisShadow: false },
  { pr: 1.0,  msaa: 2, shadow: 2048, bloom: true, haze: true,  grain: true,  debrisShadow: false },
  { pr: 1.0,  msaa: 4, shadow: 2048, bloom: true, haze: true,  grain: true,  debrisShadow: true },
  { pr: 1.5,  msaa: 4, shadow: 4096, bloom: true, haze: true,  grain: true,  debrisShadow: true },
  { pr: 2.0,  msaa: 4, shadow: 4096, bloom: true, haze: true,  grain: true,  debrisShadow: true },
];
const PHONE = [
  { pr: 0.75, msaa: 0, shadow: 1024, debrisShadow: false, far: 600 },
  { pr: 1.0,  msaa: 0, shadow: 1024, debrisShadow: false },
  { pr: 1.25, msaa: 0, shadow: 2048, debrisShadow: true },
  { pr: 1.5,  msaa: 0, shadow: 2048, debrisShadow: true },
];

export class Quality {
  constructor({ renderer, look, sun, hazePass, world, coarse, onResize }) {
    Object.assign(this, { renderer, look, sun, hazePass, world, coarse, onResize });
    const dpr = devicePixelRatio || 1;
    // collapse rungs that come out the same on this screen (e.g. 1.5 and 2.0 on a dpr-1 monitor)
    const raw = coarse ? PHONE : DESK, seen = new Set();
    this.levels = raw.map((l) => ({ ...l, pr: Math.min(l.pr, Math.max(dpr, 1)) }))
      .filter((l) => { const k = JSON.stringify(l); if (seen.has(k)) return false; seen.add(k); return true; });
    // start one rung under the top: most PCs settle there, and stepping up is cheaper than a slow start
    let start = Math.max(0, this.levels.length - (coarse ? 1 : 2));
    try { const s = +sessionStorage.getItem('rell.q'); if (s >= 0 && s < this.levels.length && sessionStorage.getItem('rell.q') !== null) start = s; } catch {}
    this.i = -1; this.ban = this.levels.length;  // rungs at or above `ban` failed a probe
    this.samples = []; this.warm = 2.5; this.hold = 0; this.probe = null; this.refresh = 1 / 60;
    this.gpu = this.initTimer();
    this.set(start);
    addEventListener('visibilitychange', () => { this.samples.length = 0; this.warm = 1.5; });
    window.__quality = this;
  }

  get level() { return this.levels[this.i]; }

  set(i) {
    i = THREE.MathUtils.clamp(i, 0, this.levels.length - 1);
    if (i === this.i) return;
    const L = this.levels[i], P = this.i < 0 ? null : this.levels[this.i];
    this.i = i; this.samples.length = 0; this.hold = 1.2;
    try { sessionStorage.setItem('rell.q', String(i)); } catch {}
    const { renderer, look, sun } = this;
    if (!P || P.pr !== L.pr) { renderer.setPixelRatio(L.pr); this.onResize(); }
    if (!P || P.msaa !== L.msaa) for (const rt of [look.composer.renderTarget1, look.composer.renderTarget2]) { rt.samples = L.msaa; rt.dispose(); }
    if (!P || P.shadow !== L.shadow) { sun.shadow.mapSize.set(L.shadow, L.shadow); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    if (look.bloom) look.bloom.enabled = L.bloom !== false;
    if (this.hazePass) this.hazePass.enabled = L.haze !== false;
    look.grade.uniforms.uFull.value = L.grain ? 1 : 0;
    this.world.debrisFar = L.far || 1000;
    if (!P || P.debrisShadow !== L.debrisShadow) for (const s of this.world.sites || []) for (const t of s.inst || []) for (const im of t) im.castShadow = L.debrisShadow;
  }

  // ---- GPU timer (EXT_disjoint_timer_query_webgl2) ----
  initTimer() {
    const gl = this.renderer.getContext(), ext = gl.getExtension && gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return null;
    return { gl, ext, q: [], active: null };
  }
  begin() {
    const t = this.gpu; if (!t || t.active || t.q.length > 3) return;
    const q = t.gl.createQuery(); t.gl.beginQuery(t.ext.TIME_ELAPSED_EXT, q); t.active = q;
  }
  end() {
    const t = this.gpu; if (!t) return;
    if (t.active) { t.gl.endQuery(t.ext.TIME_ELAPSED_EXT); t.q.push(t.active); t.active = null; }
    const gl = t.gl;
    while (t.q.length && gl.getQueryParameter(t.q[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = t.q.shift();
      if (!gl.getParameter(t.ext.GPU_DISJOINT_EXT)) t.last = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(q);
    }
  }

  // call once per frame with the real frame interval (seconds, unclamped)
  tick(dt) {
    if (this.warm > 0) { this.warm -= dt; return; }
    if (dt > 0.25) return;                     // tab switch, shader compile: not representative
    if (this.hold > 0) { this.hold -= dt; return; }
    this.refresh = Math.min(this.refresh * 1.002, Math.max(1 / 240, dt));   // creeps toward the fastest seen interval
    const gpuMs = this.gpu && this.gpu.last;
    this.samples.push(gpuMs ? Math.max(gpuMs / 1000, dt * 0.5) : dt);
    const N = 45; if (this.samples.length < N) return;
    const s = this.samples.slice().sort((a, b) => a - b), med = s[N >> 1], p80 = s[Math.floor(N * 0.8)];
    this.samples.length = 0;
    const target = Math.max(this.refresh, 1 / 60);       // 60 fps is the floor we defend; faster screens are a bonus
    const slow = med > target * 1.3 || p80 > target * 1.7;

    if (this.probe) {                                    // just stepped up: keep it only if it held
      if (slow) { this.ban = this.i; this.fails = (this.fails || 0) + 1; this.banT = 20 * 2 ** this.fails; this.set(this.probe.from); }
      this.probe = null; return;
    }
    if (slow) { this.set(this.i - (med > target * 2.2 ? 2 : 1)); return; }
    if (this.banT > 0) { this.banT -= N * med; if (this.banT <= 0) this.ban = this.levels.length; }
    if (this.i + 1 >= Math.min(this.ban, this.levels.length)) return;
    // headroom: with GPU timing we know exactly; without it only a fast screen can show spare time,
    // so on a 60 Hz screen we just try the next rung and let the probe decide
    const room = gpuMs ? gpuMs / 1000 < target * 0.55 : (this.refresh < 1 / 70 ? med < target * 0.8 : med < target * 1.08);
    if (room) { this.probe = { from: this.i }; this.set(this.i + 1); }
  }
}
