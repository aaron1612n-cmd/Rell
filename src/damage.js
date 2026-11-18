import * as THREE from 'three';

// Hull damage you can see and fix. Every real hit leaves a scorch on the ship where it landed (found by
// raycasting the hull from the impact point), holding the hull it cost. On EVA, hold the tool on a scorch
// to weld it shut: the glowing cracks cool, a bright bead runs round the edge, and the hull comes back.

const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const FS = `varying vec2 vUv; uniform float uAmt, uWeld, uTime, uSeed, uHot;
float h(vec2 p){ p = fract(p * vec2(123.34, 456.21) + uSeed); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + 1.), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a * n(p); p *= 2.1; a *= .5; } return s; }
void main(){
  vec2 p = vUv * 2. - 1.; float r = length(p), a = atan(p.y, abs(p.x) < 1e-5 ? 1e-5 : p.x);
  float edge = .55 + .35 * fbm(vec2(a * 2., uSeed * 7.));
  float scorch = smoothstep(edge, edge * .35, r);
  // radial cracks
  float k = abs(sin(a * 5. + fbm(p * 3.) * 4.)); float crack = smoothstep(.08, .0, k * (.4 + r)) * smoothstep(edge * .9, .1, r);
  float hole = smoothstep(.22, .12, r + fbm(p * 6.) * .1);
  float live = clamp(uAmt * 4., 0., 1.);
  float flick = .75 + .25 * sin(uTime * 9. + uSeed * 20.) * sin(uTime * 3.1);
  vec3 col = vec3(.02, .018, .016);
  vec3 hot = vec3(4., 1.2, .3) * (crack * .9 + hole * .7) * live * flick * uHot;
  // weld bead: a bright ring that closes as it heals, then a dull bead
  float healed = 1. - live;
  float bead = smoothstep(.06, .0, abs(r - edge * .62)) * (.3 + .7 * n(vec2(a * 18., 1.)));
  vec3 beadCol = mix(vec3(.5, .48, .44) * .6, vec3(5., 3.2, 1.6), uWeld);
  col = mix(col, vec3(.08, .075, .07), healed * .6);
  float alpha = scorch * (.55 + .45 * live) + bead * healed;
  gl_FragColor = vec4(col + hot + beadCol * bead * healed, clamp(alpha, 0., 1.));
}`;

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _z = new THREE.Vector3(0, 0, 1);

export class HullDamage {
  constructor(shipMesh, shipModel) {
    this.root = shipMesh; this.model = shipModel; this.spots = [];
    this.rc = new THREE.Raycaster(); this.rc.layers.enableAll(); this.t = 0;
    this.targets = []; shipMesh.traverse((o) => { if (o.isMesh && o.geometry.attributes.position.count > 1000) this.targets.push(o); });
  }

  // world-space hit on the ship -> a spot on the real hull. amt = hull fraction lost.
  add(point, ship, amt) {
    this.root.updateMatrixWorld(true);
    const dir = _v.copy(ship.pos).sub(point).normalize();
    this.rc.set(point.clone().addScaledVector(dir, -1.5), dir); this.rc.far = 6;
    const h = this.rc.intersectObjects(this.targets, false)[0];
    let p, n;
    if (h && h.face) { p = h.point.clone(); n = h.face.normal.clone().transformDirection(h.object.matrixWorld); }
    else { p = point.clone(); n = dir.clone().negate(); }
    // to ship-local
    _q.copy(ship.quat).invert();
    p.sub(ship.pos).applyQuaternion(_q); n.applyQuaternion(_q);
    const near = this.spots.find((s) => s.p.distanceTo(p) < 0.6 && s.amt > 0);
    if (near) { near.amt += amt; near.u.uAmt.value = near.amt; this.size(near); return near; }
    if (this.spots.length >= 10) { const s = this.spots.shift(); this.root.remove(s.m); }
    const u = { uAmt: { value: amt }, uWeld: { value: 0 }, uTime: { value: 0 }, uSeed: { value: Math.random() }, uHot: { value: 1 } };
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: u, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    m.position.copy(p).addScaledVector(n, 0.012); m.quaternion.setFromUnitVectors(_z, n); m.rotateZ(Math.random() * 6);
    m.layers.set(1); m.renderOrder = 3;
    this.root.add(m);
    const s = { p, n, amt, m, u, weld: 0, age: 0 }; this.size(s); this.spots.push(s); return s;
  }

  size(s) { s.m.scale.setScalar(0.35 + Math.min(0.5, s.amt * 2.5)); }

  // make sure the hull you've lost is visible somewhere (older damage, or hits before this system)
  ensure(ship) {
    const lost = 1 - ship.hull, shown = this.spots.reduce((a, s) => a + s.amt, 0);
    let left = lost - shown;
    while (left > 0.02) {
      const a = Math.random() * Math.PI * 2, z = -1.6 + Math.random() * 3;
      const local = _v.set(Math.cos(a) * 3, Math.sin(a) * 1.5 + 0.2, z);
      const world = local.clone().applyQuaternion(ship.quat).add(ship.pos);
      const amt = Math.min(left, 0.15); this.add(world, ship, amt); left -= amt;
    }
  }

  // world-space position / normal of a spot
  world(s, ship, outP, outN) {
    outP.copy(s.p).applyQuaternion(ship.quat).add(ship.pos); if (outN) outN.copy(s.n).applyQuaternion(ship.quat); return outP;
  }

  pick(o, d, far, ship) {
    let best = null;
    for (const s of this.spots) {
      if (s.amt <= 0) continue;
      const c = this.world(s, ship, new THREE.Vector3());
      const t = _v.copy(c).sub(o).dot(d); if (t < 0 || t > far) continue;
      const miss = _v.copy(o).addScaledVector(d, t).distanceTo(c);
      if (miss > 0.35 + s.m.scale.x * 0.3) continue;
      if (!best || t < best.dist) best = { kind: 'weld', s, dist: t, point: c, normal: s.n.clone().applyQuaternion(ship.quat) };
    }
    return best;
  }

  // weld for dt; returns hull restored
  work(T, dt) {
    const s = T.s, r = Math.min(s.amt, dt * 0.09);
    s.amt -= r; s.weld = 1; s.u.uAmt.value = s.amt;
    return r;
  }

  update(dt) {
    this.t += dt;
    for (const s of this.spots) {
      s.u.uTime.value = this.t; s.weld = Math.max(0, s.weld - dt * 2); s.u.uWeld.value = s.weld;
      s.age += dt; s.u.uHot.value = 0.35 + 0.65 * Math.exp(-s.age / 30);
    }
  }

  clear() { for (const s of this.spots) this.root.remove(s.m); this.spots.length = 0; }

  get total() { return this.spots.reduce((a, s) => a + Math.max(0, s.amt), 0); }
}
