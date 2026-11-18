import * as THREE from 'three';

// Impact scan: if the ship's current velocity will put it into something within a few seconds,
// a holographic hex scan wraps onto the real surface that will be hit (and nothing else), following
// its curves and edges. Prediction is analytic (swept sphere vs the same colliders the physics uses,
// in the target's frame), throttled to ~14 Hz; the true mesh surface is raycast only for the predicted chunk.

const LOOK = 4.0;          // seconds of look-ahead
const MIN_SPEED = 3.0;     // m/s: below this nothing is "on a collision course"
const PERIOD = 0.07;       // seconds between predictions
const CELL = 0.8;          // hex cell size, metres

const _o = new THREE.Vector3(), _v = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();
const _p = new THREE.Vector3(), _a = new THREE.Vector3(), _t = new THREE.Vector3(), _b = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();

// The scan is drawn by re-rendering the hit object's own meshes with an additive overlay material,
// so the grid follows every curve, edge and corner of the real surface. A distance mask around the
// predicted contact keeps it to the region about to be hit.
const VERT = `
  uniform mat4 uFrameInv;
  varying vec3 vW, vF, vNW, vNF;
  void main(){
    vec4 w = modelMatrix * vec4(position, 1.);
    vW = w.xyz;
    vF = (uFrameInv * w).xyz;                      // pattern space: rides the hit object, so it never slides
    vNW = normalize(mat3(modelMatrix) * normal);
    vNF = mat3(uFrameInv) * vNW;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const FRAG = `
  uniform vec3 uC; uniform float uR, uA, uT, uMotion, uGrow, uPat;
  varying vec3 vW, vF, vNW, vNF;
  float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec3 hex(vec2 p){
    const vec2 s = vec2(1., 1.7320508);
    vec4 hC = floor(vec4(p, p - vec2(.5, 1.)) / s.xyxy) + .5;
    vec4 h = vec4(p - hC.xy * s, p - (hC.zw + .5) * s);
    vec4 q = dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hC.xy) : vec4(h.zw, hC.zw + .5);
    vec2 a = abs(q.xy);
    return vec3(.5 - max(dot(a, s * .5), a.x), q.zw);
  }
  void main(){
    float d = distance(vW, uC);
    float R = uR * uGrow;
    if (d > R) discard;
    float rN = d / max(R, 1e-3);
    // triplanar hex grid in the object's frame: edges blend across planes, cells come from the dominant one
    vec3 n = normalize(vNF);
    vec3 w = pow(abs(n), vec3(5.)); w /= w.x + w.y + w.z;
    vec3 P = vF * uPat;
    vec3 hx = hex(P.yz), hy = hex(P.zx), hz = hex(P.xy);
    float e = hx.x * w.x + hy.x * w.y + hz.x * w.z;
    vec2 id = w.x > w.y && w.x > w.z ? hx.yz + 11. : (w.y > w.z ? hy.yz + 37. : hz.yz);
    float aa = fwidth(e) + 1e-4;
    float edge = 1. - smoothstep(aa * .6, aa * 1.6 + .025, e);
    float cell = hash(id);
    // digital dissolve at the rim: whole cells drop out, randomly, toward the edge
    float keep = step(rN, 1. - cell * .38);
    float fade = smoothstep(1., .55, rN);
    float fres = pow(max(0., 1. - abs(dot(normalize(cameraPosition - vW), normalize(vNW)))), 2.);
    float shimmer = mix(.6, .5 + .5 * sin(uT * 4. + cell * 50.), uMotion);
    float fill = (cell > .78 ? .38 * shimmer : .05) * keep * fade;
    float grid = edge * keep * (.55 + .45 * fade) * (.7 + .8 * fres);
    // scan wave ripples out from the contact point across the surface
    float wr = fract(uT * .6) * 1.15;
    float band = exp(-((rN - wr) * 10.) * ((rN - wr) * 10.)) * uMotion * keep;
    // range contours every 1.5 m: they bend over every edge, so the shape reads at a glance
    float cd = d / 1.5; float caa = fwidth(cd) + 1e-4;
    float contour = (1. - smoothstep(caa * .5, caa * 1.5, abs(fract(cd + .5) - .5))) * .22 * fade;
    // lock point: hot core + two thin rings
    float core = exp(-d * d * 1.2) * 1.3;
    float rings = (1. - smoothstep(.0, .06, abs(d - 1.1))) * .9 + (1. - smoothstep(.0, .05, abs(d - 2.0))) * .5;
    float v = fill + grid * .65 + contour + band * (.25 + edge * 1.6) + rings + core;
    vec3 col = vec3(1., .36, .12) * v * 1.4 + vec3(1., .85, .68) * (band * edge * 1.8 + core * .8);
    gl_FragColor = vec4(col * uA, 1.);
  }`;

export class Impact {
  constructor(scene, world, ship, { reduced = false, coarse = false } = {}) {
    this.world = world; this.ship = ship; this.reduced = reduced; this.coarse = coarse;
    this.on = true;
    this.alpha = 0; this.target = 0; this.acc = 0; this.t = 0; this.grow = 0;
    this.hit = null; this.radius = 9;
    this.ray = new THREE.Raycaster(); this.ray.firstHitOnly = true;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      uniforms: {
        uA: { value: 0 }, uT: { value: 0 }, uMotion: { value: reduced ? 0 : 1 }, uGrow: { value: 1 },
        uC: { value: new THREE.Vector3() }, uR: { value: 9 }, uPat: { value: 1 / 0.9 }, uFrameInv: { value: new THREE.Matrix4() },
      },
    });
    this.overlays = new Map();   // target node -> overlay meshes sharing its geometry
    this.active = null;          // { frame, list }
    // drifting debris is instanced, so it gets one carrier object that copies the body's transform
    this.dbFrame = new THREE.Group(); this.dbFrame.matrixAutoUpdate = false; this.dbFrame.visible = false;
    scene.add(this.dbFrame);
    this.dbCache = new Map();    // debris instance list -> overlay group
  }

  // overlay meshes that re-draw a node's surfaces with the scan material (built once per node, then reused)
  overlayFor(node) {
    let list = this.overlays.get(node);
    if (list) return list;
    list = []; const meshes = [];
    node.traverse((o) => { if (o.isMesh && !o.userData.scanOverlay && !o.isInstancedMesh) meshes.push(o); });
    for (const m of meshes) {
      const ov = new THREE.Mesh(m.geometry, this.mat);
      ov.userData.scanOverlay = true; ov.raycast = () => {}; ov.renderOrder = 8; ov.visible = false;
      m.add(ov); list.push(ov);
    }
    this.overlays.set(node, list);
    return list;
  }

  debrisOverlay(body) {
    let g = this.dbCache.get(body.inst);
    if (!g) {
      g = new THREE.Group(); g.visible = false;
      for (const im of body.inst) { const ov = new THREE.Mesh(im.geometry, this.mat); ov.userData.scanOverlay = true; ov.raycast = () => {}; ov.renderOrder = 8; g.add(ov); }
      this.dbFrame.add(g); this.dbCache.set(body.inst, g);
    }
    return g;
  }

  // show the overlay on one target, hide it everywhere else
  activate(h) {
    const key = h.body ? h.body : h.node;
    if (this.active && this.active.key === key) return;
    this.deactivate();
    if (h.body) {
      const g = this.debrisOverlay(h.body); g.visible = true; this.dbFrame.visible = true;
      this.active = { key, frame: this.dbFrame, list: [g], body: h.body };
    } else if (h.node) {
      const list = this.overlayFor(h.node); for (const o of list) o.visible = true;
      this.active = { key, frame: h.node, list };
    }
    // the scan unfolds outward each time it locks onto a new surface
    this.grow = this.reduced ? 1 : 0;
  }

  deactivate() {
    if (!this.active) return;
    for (const o of this.active.list) o.visible = false;
    this.dbFrame.visible = false; this.active = null;
  }

  setEnabled(v) { this.on = v; if (!v) { this.target = 0; this.alpha = 0; this.hit = null; this.deactivate(); } }

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
      bt = t0; best = { t: t0, n: _n.clone(), kind: 'obb', chunk: o.chunk, node: o.node, body: null };
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
    for (const s of world.statics) sph(s.pos, s.w, s.rad, 'ring', null, s.node || world.ringGroup);
    for (const d of world.debris) sph(d.pos, d.vel, d.radius, 'debris', d, null);
    return best;
  }

  // snap the predicted contact to the true mesh surface where we can (cheap: one chunk, first hit only)
  refine(best) {
    const { ship, world } = this;
    const sp = ship.vel.length(); _d.copy(ship.vel).divideScalar(sp);
    let node = null;
    if (best.kind === 'obb') node = best.node || (world.chunks && world.chunks[best.chunk]);
    else if (best.kind === 'ring') node = best.mesh;
    // analytic contact point
    _p.copy(ship.pos).addScaledVector(ship.vel, best.t).addScaledVector(best.n, -ship.radius);
    if (best.kind === 'debris') { _p.copy(best.body.pos).addScaledVector(best.n, best.body.radius); return { p: _p.clone(), n: best.n, node: null }; }
    if (node) {
      this.ray.set(ship.pos, _d); this.ray.near = 0; this.ray.far = sp * best.t + ship.radius * 4;
      const hit = this.ray.intersectObject(node, true)[0];
      if (hit && hit.face) {
        _n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        if (_n.dot(_d) < -0.05) return { p: hit.point.clone(), n: _n.clone(), node };
      }
    }
    return { p: _p.clone(), n: best.n, node };
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
        const r = best ? this.refine(best) : null;
        if (r && (r.node || best.kind === 'debris')) {
          const body = best.kind === 'debris' ? best.body : null;
          const frame = body ? null : r.node;
          if (frame) frame.updateWorldMatrix(true, false);
          // contact stored in the target's own frame so it rides rotating rings and tumbling debris
          const local = body ? r.p.clone().sub(body.pos) : frame.worldToLocal(r.p.clone());
          if (body) local.applyQuaternion(_q.setFromEuler(body.euler).invert()).divideScalar(body.scale);
          this.hit = { tti: best.t, local, node: frame, body, dist: ship.pos.distanceTo(r.p) };
          // generous: covers the whole approach zone, grows a little with range so it reads from afar
          this.radius = THREE.MathUtils.clamp(8 + this.hit.dist * 0.06, 8, 16);
          if (body) this.radius = Math.min(this.radius, body.radius * 1.7 + 2.5);
          this.activate(this.hit);
          this.target = THREE.MathUtils.smoothstep(LOOK - best.t, 0.0, 1.6) * 0.55 + THREE.MathUtils.smoothstep(LOOK - best.t, 1.2, LOOK - 0.4) * 0.45;
        } else this.target = 0;
      }
    } else this.target = 0;

    const k = this.target > this.alpha ? 9 : 5;
    this.alpha += (this.target - this.alpha) * (1 - Math.exp(-k * dt));
    if (this.alpha < 0.004 && this.target === 0) { this.alpha = 0; this.hit = null; this.deactivate(); return; }
    if (!this.hit || !this.active) return;
    this.grow = Math.min(1, this.grow + dt / 0.45);
    const u = this.mat.uniforms, h = this.hit;
    if (h.body) {
      _m.compose(h.body.pos, _q.setFromEuler(h.body.euler), _p.setScalar(h.body.scale));
      this.dbFrame.matrix.copy(_m); this.dbFrame.matrixWorld.copy(_m);
      for (const c of this.dbFrame.children) c.updateMatrixWorld(true);
    } else {
      h.node.updateWorldMatrix(true, false); _m.copy(h.node.matrixWorld);
    }
    u.uPat.value = _m.getMaxScaleOnAxis() / CELL;   // hex size in metres, whatever the frame's scale
    u.uFrameInv.value.copy(_m).invert();
    u.uC.value.copy(h.local).applyMatrix4(_m);
    u.uR.value += (this.radius - u.uR.value) * (1 - Math.exp(-6 * dt));
    u.uGrow.value = 1 - Math.pow(1 - this.grow, 3);
    u.uA.value = this.alpha;
    u.uT.value = time;
  }
}
