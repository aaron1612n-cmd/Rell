import * as THREE from 'three';

// Deep scan (C): a sweep that rolls out from the ship and shows what the wrecks are hiding. Caches (flight
// recorders and sealed cargo) are tucked away unseen near each wreck; the sweep reveals every one it passes
// and from then on they are ordinary salvage: hook and haul. Wordless: a ring, a ping, then glowing marks.
const R_MAX = 260, DUR = 2.6, COOL = 6;
const SPEC = { meridian: 2, halves: 2, freighter: 2, field: 3 };
let seed = 77; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

function glow() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(g && c);
}

export class DeepScan {
  constructor({ scene, world, salvage, ship, sound, fx, getFxT }) {
    Object.assign(this, { scene, world, salvage, ship, sound, fx, getFxT });
    this.t = -1; this.cool = 0; this.caches = []; this.tex = glow();
    for (const site of world.sites) {
      const n = SPEC[site.id]; if (!n) continue;
      for (let i = 0; i < n; i++) {
        // somewhere in the shadow of the wreck: a ring of positions round its middle
        const a = rnd() * 6.28, d = site.kind === 'field' ? 40 + rnd() * 150 : 22 + rnd() * 48, y = (rnd() - 0.5) * 30;
        const black = i === 0;
        const it = salvage.spawn(site, { type: 'crate', at: [Math.cos(a) * d, y, Math.sin(a) * d] });
        if (!it) continue;
        it.hidden = true; it.cache = black ? 'box' : 'cargo'; it.value = black ? 560 : 380; it.obj.visible = false;
        it.body.vel.set(0, 0, 0); it.body.angVel.multiplyScalar(0.2);
        const col = black ? new THREE.Color(1.6, 0.35, 0.12) : new THREE.Color(0.3, 1.2, 1.5);
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color: col, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
        s.scale.setScalar(5); it.obj.add(s); it.beacon = s;
        this.caches.push(it);
      }
    }
    this.shell = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: { uA: { value: 0 } },
      vertexShader: 'varying vec3 vN, vV; void main(){ vN = normalize(normalMatrix * normal); vec4 m = modelViewMatrix * vec4(position, 1.); vV = normalize(-m.xyz); gl_Position = projectionMatrix * m; }',
      fragmentShader: 'varying vec3 vN, vV; uniform float uA; void main(){ float f = pow(1. - abs(dot(normalize(vN), normalize(vV))), 2.5); gl_FragColor = vec4(vec3(.25, .9, 1.2) * f * uA, f * uA); }',
    }));
    this.shell.visible = false; this.shell.frustumCulled = false; this.shell.renderOrder = 5; scene.add(this.shell);
    this.origin = new THREE.Vector3();
  }

  get ready() { return this.t < 0 && this.cool <= 0; }
  get left() { return this.caches.filter((c) => c.hidden).length; }

  fire() {
    if (!this.ready) return false;
    this.t = 0; this.origin.copy(this.ship.pos); this.shell.visible = true;
    this.sound?.tonePing(300, 1.2, 0.18, 'sine', 3); return true;
  }

  update(dt, time) {
    this.cool = Math.max(0, this.cool - dt);
    for (const it of this.caches) {
      if (it.hidden || !it.beacon) continue;
      const free = it.state === 'free' || it.state === 'carried';
      it.beacon.material.opacity = free ? 0.45 + 0.35 * Math.sin(time * 3 + it.body.pos.x) : 0;
    }
    if (this.t < 0) return;
    this.t += dt;
    const k = this.t / DUR, r = R_MAX * (1 - Math.pow(1 - Math.min(1, k), 2));
    this.shell.position.copy(this.origin); this.shell.scale.setScalar(Math.max(0.1, r));
    this.shell.material.uniforms.uA.value = Math.max(0, 1 - k) * 1.1;
    for (const it of this.caches) {
      if (!it.hidden || it.state === 'gone') continue;
      if (it.body.pos.distanceTo(this.origin) <= r) {
        it.hidden = false; it.obj.visible = true;
        this.sound?.tonePing(it.cache === 'box' ? 980 : 720, 0.35, 0.12, 'triangle');
        window.dispatchEvent(new CustomEvent('rell:revealed', { detail: { kind: it.cache } }));
      }
    }
    if (k >= 1) { this.t = -1; this.shell.visible = false; this.cool = COOL; }
  }
}
