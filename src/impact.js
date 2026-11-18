import * as THREE from 'three';

// Impact scan: if the ship's current velocity will put it into something within a few seconds,
// a holographic hex-grid patch fades onto the exact surface that will be hit, and nothing else.
// Prediction is analytic (swept sphere vs the same colliders the physics uses, in the target's frame),
// throttled to ~14 Hz; the true mesh surface is raycast only for the one chunk that was predicted.

const LOOK = 4.0;          // seconds of look-ahead
const MIN_SPEED = 3.0;     // m/s: below this nothing is "on a collision course"
const PERIOD = 0.07;       // seconds between predictions

const _o = new THREE.Vector3(), _v = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();
const _p = new THREE.Vector3(), _a = new THREE.Vector3(), _t = new THREE.Vector3(), _b = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();

const VERT = `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const FRAG = `
  varying vec2 vP; uniform float uA, uT, uMotion, uSeed;
  float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  // distance to hex cell edge + cell id
  vec3 hex(vec2 p){
    const vec2 s = vec2(1., 1.7320508);
    vec4 hC = floor(vec4(p, p - vec2(.5, 1.)) / s.xyxy) + .5;
    vec4 h = vec4(p - hC.xy * s, p - (hC.zw + .5) * s);
    vec4 q = dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hC.xy) : vec4(h.zw, hC.zw + .5);
    vec2 a = abs(q.xy);
    return vec3(.5 - max(dot(a, s * .5), a.x), q.zw);
  }
  void main(){
    float k = mix(1., smoothstep(0., .8, uA), uMotion);            // brackets converge as the scan locks on
    vec2 p = vP;                                                  // -0.5..0.5
    float r = length(p) * 2.;
    // hex field, strongest at the centre, never past the disc
    vec3 hx = hex(p * 11.);
    float edge = smoothstep(.055, .0, hx.x);
    float cell = hash(hx.yz + uSeed);
    float shimmer = mix(.5, .5 + .5 * sin(uT * 3. + cell * 40.), uMotion);
    float fieldMask = smoothstep(1., .35, r);
    float fill = ((cell > .7 ? .5 * shimmer : .07) + .07) * fieldMask;
    float grid = edge * .95 * smoothstep(1., .15, r);
    // scanline sweep + fine static lines
    float sweep = mix(.4, fract(uT * .9), uMotion);
    float band = exp(-pow((p.y + .5 - sweep) * 9., 2.)) * mix(.0, 1., uMotion);
    float lines = .5 + .5 * sin(p.y * 360.);
    float scan = (.06 + band * .55) * lines * fieldMask;
    // corner brackets
    vec2 c = abs(p) - .5 * (.78 + .22 * (1. - k) * 2.);
    float arm = .16;
    float bx = step(abs(c.x), .012) * step(-arm, c.y) * step(c.y, 0.);
    float by = step(abs(c.y), .012) * step(-arm, c.x) * step(c.x, 0.);
    float br = max(bx, by);
    // thin ring at the rim of the field
    float ring = smoothstep(.02, .0, abs(r - .86)) * .35;
    // centre tick
    float tick = (step(abs(p.x), .004) * step(abs(p.y), .03) + step(abs(p.y), .004) * step(abs(p.x), .03)) * .8;
    float v = fill + grid + scan + ring + tick;
    vec3 col = vec3(1., .36, .12) * (v * 1.5) + vec3(1., .86, .7) * (br * 1.1 + band * grid * 1.2);
    float a = uA * min(1., (v + br) * 1.7);
    gl_FragColor = vec4(col * uA, clamp(a, 0., 1.));
  }`;

export class Impact {
  constructor(scene, world, ship, { reduced = false, coarse = false } = {}) {
    this.world = world; this.ship = ship; this.reduced = reduced;
    this.on = true;
    this.alpha = 0; this.target = 0; this.acc = 0; this.t = 0;
    this.hit = null; this.size = 5;
    this.ray = new THREE.Raycaster(); this.ray.firstHitOnly = true;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      uniforms: { uA: { value: 0 }, uT: { value: 0 }, uMotion: { value: reduced ? 0 : 1 }, uSeed: { value: 3.7 } },
    });
    this.mat = mat;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.visible = false; this.mesh.renderOrder = 8; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.coarse = coarse;
  }

  setEnabled(v) { this.on = v; if (!v) { this.target = 0; this.hit = null; } }

  // earliest sweep of the ship sphere into any collider within LOOK seconds, or null
  predict() {
    const { ship, world } = this; const R = ship.radius; const vel = ship.vel;
    let best = null, bt = LOOK;
    // oriented boxes (static)
    for (const o of world.obbs) {
      _o.copy(ship.pos).sub(o.c).applyQuaternion(o.qi); _v.copy(vel).applyQuaternion(o.qi);
      let t0 = 0, t1 = bt, ax = -1, sg = 0, inside = true;
      for (let i = 0; i < 3; i++) {
        const oi = _o.getComponent(i), vi = _v.getComponent(i), h = o.h.getComponent(i) + R;
        if (Math.abs(vi) < 1e-6) { if (Math.abs(oi) > h) { inside = false; t1 = -1; break; } continue; }
        let ta = (-h - oi) / vi, tb = (h - oi) / vi, s = -1;
        if (ta > tb) { const x = ta; ta = tb; tb = x; s = 1; }
        if (ta > t0) { t0 = ta; ax = i; sg = s; }
        if (tb < t1) t1 = tb;
        if (t0 > t1) { t1 = -1; break; }
      }
      if (t1 < 0 || ax < 0 || t0 >= bt || t0 < 0.001) continue;
      _n.set(0, 0, 0).setComponent(ax, sg).applyQuaternion(o.q);
      if (_n.dot(vel) >= -MIN_SPEED * 0.5) continue;
      bt = t0; best = { t: t0, n: _n.clone(), kind: 'obb', chunk: o.chunk, body: null };
    }
    // spheres: rotating ring segments, then drifting debris (solved in the target's frame)
    const sph = (pos, vl, rad, kind, body, mesh) => {
      _o.copy(ship.pos).sub(pos); _v.copy(vel).sub(vl);
      const Rt = rad + R, a = _v.lengthSq(); if (a < MIN_SPEED * MIN_SPEED * 0.25) return;
      const b = _o.dot(_v), c = _o.lengthSq() - Rt * Rt; if (c < 0) return;
      const disc = b * b - a * c; if (b >= 0 || disc < 0) return;
      const t = (-b - Math.sqrt(disc)) / a; if (t < 0 || t >= bt) return;
      bt = t; _n.copy(_o).addScaledVector(_v, t).normalize();
      best = { t, n: _n.clone(), kind, body, mesh, rad };
    };
    for (const s of world.statics) sph(s.pos, s.w, s.rad, 'ring', null, world.ringGroup);
    for (const d of world.debris) sph(d.pos, d.vel, d.radius, 'debris', d, null);
    return best;
  }

  // snap the predicted contact to the true mesh surface where we can (cheap: one chunk, first hit only)
  refine(best) {
    const { ship, world } = this;
    const sp = ship.vel.length(); _d.copy(ship.vel).divideScalar(sp);
    let node = null;
    if (best.kind === 'obb') node = world.chunks && world.chunks[best.chunk];
    else if (best.kind === 'ring') node = best.mesh;
    // analytic contact point
    _p.copy(ship.pos).addScaledVector(ship.vel, best.t).addScaledVector(best.n, -ship.radius);
    if (best.kind === 'debris') { _p.copy(best.body.pos).addScaledVector(best.n, best.body.radius); return { p: _p.clone(), n: best.n }; }
    if (node) {
      this.ray.set(ship.pos, _d); this.ray.near = 0; this.ray.far = sp * best.t + ship.radius * 4;
      const hit = this.ray.intersectObject(node, true)[0];
      if (hit && hit.face) {
        _n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        if (_n.dot(_d) < -0.05) return { p: hit.point.clone(), n: _n.clone() };
      }
    }
    return { p: _p.clone(), n: best.n };
  }

  update(dt, time) {
    this.t = time;
    const ship = this.ship;
    if (this.on && ship.hull > 0) {
      this.acc += dt;
      if (this.acc >= PERIOD) {
        this.acc = 0;
        const sp = ship.vel.length();
        const best = sp > MIN_SPEED ? this.predict() : null;
        if (best) {
          const r = this.refine(best);
          const first = !this.hit || this.alpha < 0.02;
          this.hit = { tti: best.t, p: r.p, n: r.n, body: best.kind === 'debris' ? best.body : null, rad: best.kind === 'debris' ? best.body.radius : 0, dist: ship.pos.distanceTo(r.p) };
          this.size = THREE.MathUtils.clamp(3.6 + this.hit.dist * 0.035, 3.6, 9);
          if (this.hit.body) this.size = Math.min(this.size, Math.max(2.6, this.hit.rad * 1.8));
          // brightens as impact nears: dim far, full inside ~2.2 s
          this.target = THREE.MathUtils.smoothstep(LOOK - best.t, 0.0, 1.6) * 0.55 + THREE.MathUtils.smoothstep(LOOK - best.t, 1.2, LOOK - 0.4) * 0.45;
          if (first) this.place(1);
        } else this.target = 0;
      }
    } else this.target = 0;

    const k = this.target > this.alpha ? 9 : 5;
    this.alpha += (this.target - this.alpha) * (1 - Math.exp(-k * dt));
    if (this.alpha < 0.004 && this.target === 0) { this.alpha = 0; this.mesh.visible = false; return; }
    if (this.hit) this.place(1 - Math.exp(-20 * dt));
    this.mesh.visible = !!this.hit;
    this.mat.uniforms.uA.value = this.alpha;
    this.mat.uniforms.uT.value = time;
  }

  place(k) {
    const h = this.hit; if (!h) return;
    if (h.body) h.p.copy(h.body.pos).addScaledVector(h.n, h.body.radius);   // ride the drifting body
    _p.copy(h.p).addScaledVector(h.n, 0.06);
    if (k >= 1) this.mesh.position.copy(_p); else this.mesh.position.lerp(_p, k);
    // basis: z = surface normal, x = stable tangent
    _t.set(0, 1, 0); if (Math.abs(h.n.y) > 0.92) _t.set(1, 0, 0);
    _t.crossVectors(_t, h.n).normalize(); _b.crossVectors(h.n, _t);
    _m.makeBasis(_t, _b, h.n); _q.setFromRotationMatrix(_m);
    if (k >= 1) this.mesh.quaternion.copy(_q); else this.mesh.quaternion.slerp(_q, k);
    this.mesh.scale.setScalar(this.size);
  }
}
