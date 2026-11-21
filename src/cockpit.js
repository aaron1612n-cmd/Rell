import * as THREE from 'three';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { addHullDetail } from './hullDetail.js';
import { loadModel, mats } from './assets.js';
import { rigShip } from './shipRig.js';
import { Instruments, RECT, ATLAS, HUD_FIELD } from './instruments.js';
import cockpitUrl from './assets/cockpit.glb?url';
import data from './assets/cockpit.json';

// First-person cockpit. It lives in its own scene, drawn after the world with a cleared depth buffer,
// so a near plane of 1 cm never costs the world its depth precision. The scene is posed in world space
// (root = ship pose) and has its own copy of the light rig, so the sun rakes through the canopy, the
// frame throws real shadows over the panel, and the screens light the cabin.
//
// Parts: the authored interior (tools/blender/cockpit.py), the exterior ship with everything inside the
// canopy cut away (so you see your own nose, wings and pods), canopy glass (reflections, dust, scratches),
// a collimated HUD, live displays (src/instruments.js), throttle, side stick, G meter and a hanging tag.

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4();
const DEG = 180 / Math.PI;
export const EYE = new THREE.Vector3(...data.eye);
export const PITCH = -5 / DEG;                 // seat looks a touch down, so the panel sits in view
const PLANET_C = new THREE.Vector3(300, -5500, -800), PLANET_R = 5200;

function frame(name) {
  const p = data.parts[name], m = new THREE.Matrix4().fromArray(p.m);
  const o = new THREE.Object3D(); m.decompose(o.position, o.quaternion, o.scale); o.userData = p; return o;
}

// canopy section at z: half-width, height, base y (piecewise linear, as lofted in Blender)
function interp(tab, z) {
  for (let i = 0; i < tab.length - 1; i++) {
    const a = tab[i], b = tab[i + 1];
    if (z >= a[0] && z <= b[0]) { const t = (z - a[0]) / (b[0] - a[0]); return a.slice(1).map((v, j) => v + (b[j + 1] - v) * t); }
  }
  return (z < tab[0][0] ? tab[0] : tab[tab.length - 1]).slice(1);
}
export function canopyAt(z) { const [cw, ch] = interp(data.canopy, z); return [cw, ch, interp(data.profile, z)[1] - 0.08]; }

// GLSL: is an object-space point inside the canopy volume? The frame cuts below build on it.
const glslTable = (name, tab, col) => `float ${name}(float z){\n` + tab.slice(0, -1).map((a, i) => {
  const b = tab[i + 1]; return `  if (z <= ${b[0].toFixed(4)}) return mix(${a[col].toFixed(4)}, ${b[col].toFixed(4)}, clamp((z - ${a[0].toFixed(4)}) / ${(b[0] - a[0]).toFixed(4)}, 0., 1.));`;
}).join('\n') + `\n  return ${tab[tab.length - 1][col].toFixed(4)};\n}`;
const CUT_GLSL = `${glslTable('cpW', data.canopy, 1)}\n${glslTable('cpH', data.canopy, 2)}\n${glslTable('cpY', data.profile, 2)}
bool inCanopy(vec3 p){
  if (p.z < ${data.canopy[0][0].toFixed(3)} - .02 || p.z > ${data.canopy[data.canopy.length - 1][0].toFixed(3)} + .04) return false;
  float cw = cpW(p.z) * 1.03 + .006, ch = cpH(p.z), y0 = cpY(p.z) - .08;
  float ax = abs(p.x), top;
  if (ax > cw) return false;
  if (ax < .35 * cw) top = y0 + ch; else if (ax < .8 * cw) top = mix(y0 + ch, y0 + .7 * ch, (ax - .35 * cw) / (.45 * cw)); else top = mix(y0 + .7 * ch, y0, (ax - .8 * cw) / (.2 * cw));
  return p.y > y0 - .014 && p.y < top + (ax < .05 ? .12 : .035);
}`;

// The canopy opens: it hinges up at its aft edge. The inner frame (two bows, the spine, the grab handle)
// is part of the interior mesh, so the same mesh is drawn twice: once fixed with the band along the canopy
// shell cut away, once on the hinge with everything but that band cut away.
export const HINGE = (() => { const z = data.canopy[data.canopy.length - 1][0], [, ch, y0] = canopyAt(z); return new THREE.Vector3(0, y0 + ch + 0.01, z); })();
export const OPEN_ANGLE = 62 / DEG;
// how the canopy moves (0 shut .. 1 open): the seal cracks a few degrees and catches, then the gas struts
// swing it up and it settles with a little overshoot. Run backwards that's a slow lowering, a pause on the
// seal and a firm last few degrees: the latch.
export function canopyCurve(k) {
  if (k < 0.16) { const a = Math.min(1, k / 0.08); return 0.05 * a * a * (3 - 2 * a); }
  const s = (k - 0.16) / 0.84, e = s * s * (3 - 2 * s);
  return 0.05 + 0.95 * e + 0.05 * Math.sin(Math.PI * s) * s * s;
}
const FRAME_GLSL = `${CUT_GLSL}
float segD(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return length(pa - ba * h); }
bool inFrame(vec3 p){
  if (p.z < ${data.canopy[0][0].toFixed(3)} - .05 || p.z > ${data.canopy[data.canopy.length - 1][0].toFixed(3)} + .05) return false;
  float cw = cpW(p.z), ch = cpH(p.z), y0 = cpY(p.z) - .08;
  if (p.y < y0 + .045) return false;
  vec2 q = vec2(abs(p.x), p.y);
  vec2 A = vec2(cw, y0), B = vec2(.8 * cw, y0 + .7 * ch), C = vec2(.35 * cw, y0 + ch), D = vec2(0., y0 + ch);
  return min(segD(q, A, B), min(segD(q, B, C), segD(q, C, D))) < .085;
}`;
export function frameCut(mat, geoToShip, open, hinge) {
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    base(sh, r);
    sh.uniforms.uCutF = { value: geoToShip }; sh.uniforms.uOpen = open;
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', `uniform mat4 uCutF; uniform float uOpen;\n${FRAME_GLSL}\nvoid main() {\n  { bool f = inFrame((uCutF * vec4(vOP, 1.)).xyz); if (${hinge ? '!f' : 'uOpen > .001 && f'}) discard; }`);
  };
  mat.customProgramCacheKey = () => 'hulldetail-frame' + (hinge ? 'H' : 'F');
  return mat;
}

// ---- canopy glass -----------------------------------------------------------------------
const GLASS_VS = `varying vec3 vW; varying vec3 vN; varying vec2 vUv;
void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv; gl_Position = projectionMatrix * viewMatrix * w; }`;
const GLASS_FS = `varying vec3 vW; varying vec3 vN; varying vec2 vUv;
uniform vec3 uSun, uSunCol, uPlanetC; uniform float uSunVis, uPlanetR, uScrGain, uDust;
uniform sampler2D uAtlas; uniform mat4 uFaceInv; uniform vec4 uScrPos[3]; uniform vec4 uScrUv[3]; uniform vec2 uDim;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + 1.), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.03 + 7.1; a *= .5; } return s; }
// one scratch per cell: an anti-aliased line segment; returns mask, writes its angle
float scratch(vec2 p, float dens, float bias, out float ang){
  vec2 c = floor(p), f = fract(p) - .5; float r = h21(c);
  ang = (h21(c + 3.7) - .5) * 3.1416 * (1. - bias) + bias * (h21(c + 9.1) - .5) * .9;
  if (r > dens) return 0.;
  vec2 d = vec2(cos(ang), sin(ang)); vec2 o = (vec2(h21(c + 1.3), h21(c + 5.9)) - .5) * .3;
  vec2 q = f - o; float along = dot(q, d), across = abs(dot(q, vec2(-d.y, d.x)));
  float len = .22 + .26 * h21(c + 2.2), w = length(fwidth(p)) * .55;
  return (1. - smoothstep(w * .5, w * 1.6, across)) * (1. - smoothstep(len * .8, len, abs(along))) * (.35 + .65 * h21(c + 4.4));
}
void main(){
  vec3 V = normalize(cameraPosition - vW);           // toward the eye
  vec3 N = normalize(vN); if (dot(N, V) < 0.) N = -N;
  float cosT = clamp(dot(N, V), 0., 1.);
  float F = .04 + .96 * pow(1. - cosT, 5.);
  vec3 L = uSun, R = reflect(-V, N), viewDir = -V;

  // reflection: black sky, the planet, the sun's glint
  vec3 env = vec3(.004, .006, .009);
  vec3 toP = uPlanetC - vW; float dP = length(toP); vec3 pc = toP / dP;
  float cosA = sqrt(max(0., 1. - uPlanetR * uPlanetR / (dP * dP)));
  float onP = smoothstep(cosA - .004, cosA + .004, dot(R, pc));
  vec3 hitN = normalize(R * (dP * dot(R, pc)) - toP);
  env = mix(env, vec3(.05, .08, .1) * (.2 + .9 * max(dot(-hitN, L), 0.)) + vec3(.1, .14, .18) * pow(max(0., 1. - abs(dot(R, pc) - cosA) * 30.), 8.), onP);
  float sR = max(dot(R, L), 0.);
  env += uSunCol * uSunVis * (pow(sR, 4000.) * 60. + pow(sR, 120.) * .25);

  // the lit screens, mirrored in the glass: trace the reflected ray to the instrument panel plane
  vec3 ro = (uFaceInv * vec4(vW, 1.)).xyz, rd = mat3(uFaceInv) * R; vec3 scr = vec3(0.);
  if (rd.z < -1e-4 && ro.z > 0.) {
    vec2 hp = (ro + rd * (-ro.z / rd.z)).xy;
    for (int i = 0; i < 3; i++) {
      vec2 l = (hp - uScrPos[i].xy) / uScrPos[i].zw + .5;
      if (l.x > 0. && l.x < 1. && l.y > 0. && l.y < 1.) scr += texture2D(uAtlas, uScrUv[i].xy + l * uScrUv[i].zw).rgb;
    }
  }
  vec3 refl = env * F + scr * uScrGain * (F + .03);

  // grime: specks and smudges, scratches. Lit by the sun from outside: they flare when you look toward it.
  vec2 p = vUv * uDim;
  float specks = 0.; { vec2 q = p * 90.; vec2 c = floor(q); vec2 o = vec2(h21(c), h21(c + 2.)) * .8 + .1; specks = smoothstep(.09, .0, length(fract(q) - o)) * step(.55, h21(c + 7.)); }
  float smudge = smoothstep(.52, .85, fbm(p * 2.2 + 3.)) * .6 + smoothstep(.6, .9, fbm(p * 7. - 1.)) * .3;
  float edge = 1. - smoothstep(0., .07, min(vUv.x, 1. - vUv.x));                // grime collects along the sills
  float dust = (specks * .5 + smudge * .5 + edge * .35) * uDust;
  float fwd = max(dot(viewDir, L), 0.);
  float scatter = uSunVis * (.025 + 1.1 * pow(fwd, 6.) + 4. * pow(fwd, 40.));
  vec3 grimeCol = uSunCol * scatter * dust * .16 + vec3(.03, .045, .06) * dust * .05;

  float a1, a2; float s1 = scratch(p * 9., .5, .6, a1), s2 = scratch(p * 23. + 11., .4, .3, a2);
  vec3 dpx = dFdx(vW), dpy = dFdy(vW); vec2 dux = dFdx(p), duy = dFdy(p);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
  vec3 Tu = r1 * dux.x + r2 * duy.x, Tv = r1 * dux.y + r2 * duy.y;
  vec3 H = normalize(L + V);
  vec3 T1 = normalize(Tu * cos(a1) + Tv * sin(a1) + 1e-6), T2 = normalize(Tu * cos(a2) + Tv * sin(a2) + 1e-6);
  float q1 = dot(H, T1) / .1, q2 = dot(H, T2) / .1, g1 = exp(-q1 * q1), g2 = exp(-q2 * q2);
  float glint = (s1 * g1 + s2 * g2 * .7) * uSunVis * (.12 + 2.2 * pow(fwd, 4.)) + (s1 + s2) * .002;
  vec3 scratchCol = uSunCol * glint * .6;

  vec3 col = refl + grimeCol + scratchCol;
  float a = clamp(F * .9 + .035 + dust * .06 + edge * .08, 0., .7);
  gl_FragColor = vec4(col, a);
}`;

export function canopyGeometry() {
  const Z0 = data.canopy[0][0], Z1 = data.canopy[data.canopy.length - 1][0];
  const nz = 48, per = 4, pos = [], uv = [], idx = [];
  const ring = (z) => {
    const [cw, ch, y0] = canopyAt(z), s = 0.985;
    const P = [[cw, y0], [cw * .8, y0 + ch * .7], [cw * .35, y0 + ch], [-cw * .35, y0 + ch], [-cw * .8, y0 + ch * .7], [-cw, y0]].map(([x, y]) => [x * s, y0 + (y - y0) * s]);
    const out = [];
    for (let i = 0; i < P.length - 1; i++) for (let k = 0; k < per; k++) { const t = k / per; out.push([P[i][0] + (P[i + 1][0] - P[i][0]) * t, P[i][1] + (P[i + 1][1] - P[i][1]) * t]); }
    out.push(P[P.length - 1]);
    return out;
  };
  let girth = 0;
  for (let j = 0; j <= nz; j++) {
    const z = Z0 + (Z1 - Z0) * j / nz, r = ring(z);
    let acc = [0]; for (let i = 1; i < r.length; i++) acc.push(acc[i - 1] + Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]));
    girth = Math.max(girth, acc[acc.length - 1]);
    r.forEach(([x, y], i) => { pos.push(x, y, z); uv.push(acc[i] / acc[acc.length - 1], j / nz); });
  }
  const n = ring(0).length;
  for (let j = 0; j < nz; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i, b = a + 1, c = a + n, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  g.userData.dim = [girth, Z1 - Z0];
  return g;
}

// outer canopy frame for the hinged canopy seen from outside: sill rails, front and aft arches, two bows
export function canopyFrame() {
  const Z0 = data.canopy[0][0], Z1 = data.canopy[data.canopy.length - 1][0];
  const mat = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.42, metalness: 0.7 });
  const haz = new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.55, metalness: 0.2 });
  const g = new THREE.Group();
  const arch = (z, s = 1) => { const [cw, ch, y0] = canopyAt(z); return [[cw, y0], [cw * .8, y0 + ch * .7], [cw * .35, y0 + ch], [-cw * .35, y0 + ch], [-cw * .8, y0 + ch * .7], [-cw, y0]].map(([x, y]) => new THREE.Vector3(x * s, y0 + (y - y0) * s + 0.004, z)); };
  const tube = (pts, r, m = mat, closed = false) => { const c = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', 0.1); const t = new THREE.Mesh(new THREE.TubeGeometry(c, pts.length * 8, r, 6, closed), m); g.add(t); return t; };
  for (const sx of [-1, 1]) {
    const pts = []; for (let i = 0; i <= 16; i++) { const z = Z0 + (Z1 - Z0) * i / 16, [cw, , y0] = canopyAt(z); pts.push(new THREE.Vector3(sx * cw * 0.99, y0 + 0.006, z)); }
    tube(pts, 0.016);
  }
  tube(arch(Z1 - 0.012), 0.02); tube(arch(Z0 + 0.03), 0.014);
  for (const z of [-0.62, 0.0]) tube(arch(z, 1.004), 0.012);
  // hinge knuckles and a hazard-striped lift strut stub at the aft arch
  for (const sx of [-0.12, 0.12]) { const k = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.07, 10), mat); k.rotation.z = Math.PI / 2; k.position.set(sx, HINGE.y - 0.01, HINGE.z); g.add(k); }
  const lip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.03), haz); const [, , fy] = canopyAt(Z0 + 0.1); lip.position.set(0, fy + 0.012, Z0 + 0.1); g.add(lip);
  return g;
}

// ---- HUD combiner -----------------------------------------------------------------------
const HUD_FS = `varying vec3 vW; varying vec3 vN; varying vec2 vUv;
uniform sampler2D uAtlas; uniform mat3 uShipInv; uniform vec4 uField; uniform vec4 uRect; uniform float uGain; uniform vec3 uSun; uniform float uSunVis;
void main(){
  vec3 d = uShipInv * normalize(vW - cameraPosition);
  float ax = degrees(atan(d.x, -d.z)), ay = degrees(atan(d.y, -d.z));
  vec2 t = vec2((ax - uField.x) / (uField.y - uField.x), (ay - uField.z) / (uField.w - uField.z));
  float sym = 0.;
  if (t.x > 0. && t.x < 1. && t.y > 0. && t.y < 1.) sym = texture2D(uAtlas, vec2(uRect.x + t.x * uRect.z, uRect.y + (1. - t.y) * uRect.w)).r;
  vec3 V = normalize(cameraPosition - vW), N = normalize(vN); if (dot(N, V) < 0.) N = -N;
  float F = .04 + .96 * pow(max(0., 1. - abs(dot(N, V))), 5.);
  float e = min(min(vUv.x, 1. - vUv.x), min(vUv.y, 1. - vUv.y));
  float rim = smoothstep(.012, .0, e) * .35;
  vec3 col = vec3(1., .62, .3) * sym * uGain + vec3(.12, .14, .1) * F + rim * vec3(.25, .3, .28) * (.2 + uSunVis * pow(max(dot(reflect(-V, N), uSun), 0.), 8.) * 2.);
  gl_FragColor = vec4(col, .05 + F * .4 + rim * .5);
}`;

export class Cockpit {
  constructor({ renderer, camera, shipModel, env, sunDir, world, coarse, reduced }) {
    this.renderer = renderer; this.camera = camera; this.world = world; this.coarse = coarse; this.reduced = reduced;
    this.sunDir = sunDir;
    this.scene = new THREE.Scene();
    this.scene.environment = env; this.scene.environmentIntensity = 0.45;
    this.cam = new THREE.PerspectiveCamera(66, 1, 0.01, 40);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.pass = new RenderPass(this.scene, this.cam); this.pass.clear = false; this.pass.clearDepth = true; this.pass.enabled = false;
    renderer.localClippingEnabled = false;

    // view state: 0 chase, 1 cockpit; blend animates the move between them
    this.mode = 0; this.blend = 0; this.target = 0;
    this.head = new THREE.Vector3(); this.headV = new THREE.Vector3(); this.headRot = new THREE.Vector3();
    this.prevVel = new THREE.Vector3(); this.accL = new THREE.Vector3(); this.g = 0; this.gPeak = 0; this.gSm = 0;
    this.sunVis = 1; this.caution = 0; this.hit = 0; this.t = 0; this.drawAcc = 1;
    this.inst = new Instruments(coarse ? 0.5 : 1);
    this.contacts = []; this.rcsSm = { x: 0, y: 0, r: 0 };
    this.stickSm = new THREE.Vector2(); this.thrSm = 0;
    this.buildLights();
    this.buildExterior(shipModel);
  }

  buildLights() {
    const s = this.scene;
    this.sun = new THREE.DirectionalLight(0xffe4c2, 4.2);
    this.sun.castShadow = true;
    const S = this.coarse ? 1024 : 2048; this.sun.shadow.mapSize.set(S, S);
    Object.assign(this.sun.shadow.camera, { left: -2.6, right: 2.6, top: 2.6, bottom: -2.6, near: 0.1, far: 12 });
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.006; this.sun.shadow.radius = 3;
    s.add(this.sun, this.sun.target);
    s.add(new THREE.HemisphereLight(0x0c1016, 0x2c4554, 0.55));
    this.rim = new THREE.DirectionalLight(0x8fb4d6, 0.9); s.add(this.rim, this.rim.target);
  }

  buildExterior(model) {
    // the exterior hull, minus the canopy and glass: the hull has its own cockpit well, so nothing is cut
    const ext = model.clone(); ext.updateMatrixWorld(true);
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    const can = ext.getObjectByName('canopy'); if (can) can.visible = false;   // this view draws its own canopy
    ext.traverse((o) => {
      if (!o.isMesh) return;
      for (let p = o; p; p = p.parent) if (/^(canopy|flap_)/.test(p.name)) { o.castShadow = o.receiveShadow = true; return; }
      const swap = (m) => (m === mats.glass ? hidden : m);
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
      o.castShadow = o.receiveShadow = true;
    });
    this.root.add(ext);
    this.extRig = rigShip(ext, { struts: false });   // the vanes move in this view too
  }

  async load() {
    const mat = addHullDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.66, metalness: 0.28 }), { scale: 4.5, grime: 0.5, scratch: 0.22, bump: 0.45 });
    const g = await loadModel(cockpitUrl, mat);
    const byName = { cockpit: g.getObjectByName('cockpit'), throttle: g.getObjectByName('throttle'), stick: g.getObjectByName('stick') };
    const interior = byName.cockpit;
    g.updateMatrixWorld(true);
    this.openU = { value: 0 }; this.open = 0; this.openTarget = 0;
    // the interior node is a group of meshes, each with its own quantization matrix: one material pair per mesh
    const mk = () => addHullDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.66, metalness: 0.28 }), { scale: 4.5, grime: 0.5, scratch: 0.22, bump: 0.45 });
    this.hingeMats = new Map();
    interior.traverse((o) => {
      if (!o.isMesh) return;
      const geoToShip = o.matrixWorld.clone();
      o.material = frameCut(mk(), geoToShip, this.openU, false);
      this.hingeMats.set(o.name || o.uuid, frameCut(mk(), geoToShip, this.openU, true));
    });
    this.interior = interior;
    this.root.add(interior);
    // the hinge: pivot at the canopy's aft top edge; children are posed in ship space under `off`
    this.hinge = new THREE.Group(); this.hinge.position.copy(HINGE); this.root.add(this.hinge);
    const off = this.hingeOff = new THREE.Group(); off.position.copy(HINGE).negate(); this.hinge.add(off);
    const band = this.bandClone(); band.visible = false; off.add(band); this.band = band;

    // moving parts, hung on the frames authored with the model
    const thr = frame('throttle'); this.root.add(thr); this.throttle = byName.throttle; thr.add(this.throttle);
    const stk = frame('stick'); this.root.add(stk); this.stick = byName.stick; stk.add(this.stick);

    // screens: one emissive atlas, a glossy cover glass
    const tex = this.inst.tex;
    const scrMat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.9, 1.9, 1.9), envMap: this.scene.environment, combine: THREE.AddOperation, reflectivity: 0.06 });
    const plane = (name, rect, mat = scrMat) => {
      const f = frame(name), [w, h] = f.userData.size;
      const geo = new THREE.PlaneGeometry(w, h), uv = geo.attributes.uv, r = Instruments.uv(rect);
      for (let i = 0; i < uv.count; i++) uv.setXY(i, r.u0 + uv.getX(i) * r.du, r.v0 + uv.getY(i) * r.dv);
      const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; f.add(m); this.root.add(f); return f;
    };
    this.screens = [['mfdC', 'C'], ['mfdL', 'L'], ['mfdR', 'R']].map(([n, r]) => plane(n, r));
    plane('annun', 'ANN', new THREE.MeshBasicMaterial({ map: tex, toneMapped: true, color: new THREE.Color(1.6, 1.6, 1.6) }));
    const gMat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffd9b0, emissiveMap: tex, emissiveIntensity: 0.18, roughness: 0.5 });
    const gm = plane('gmeter', 'G', gMat);
    this.needle = new THREE.Group(); gm.add(this.needle); this.needle.position.z = 0.003;
    const nm = new THREE.MeshStandardMaterial({ color: 0xff5a1f, emissive: 0xff5a1f, emissiveIntensity: 0.35, roughness: 0.4 });
    const nd = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.0022, 0.0012), nm); nd.position.x = 0.011; nd.castShadow = true; this.needle.add(nd);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.003, 12), new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.5 }));
    cap.rotation.x = Math.PI / 2; gm.add(cap); cap.position.z = 0.004;
    // cover glass over the G meter
    const gg = new THREE.Mesh(new THREE.CircleGeometry(0.034, 24), new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.18 }));
    gg.position.z = 0.007; gm.add(gg);

    // screen light: a soft panel of amber over the cabin; phones get a point light
    const face = frame('face');
    if (!this.coarse) {
      RectAreaLightUniformsLib.init();
      this.scrLight = new THREE.RectAreaLight(0xffa860, 0, 0.62, 0.17);
      this.scrLight.position.copy(face.position).add(_v.set(0, 0, 0.02).applyQuaternion(face.quaternion));
      this.root.add(this.scrLight); this.scrLight.lookAt(this.root.localToWorld(EYE.clone().add(_v.set(0, -0.08, 0))));
    } else {
      this.scrLight = new THREE.PointLight(0xffa860, 0, 0.9, 2);
      this.scrLight.position.set(0, 0.45, 0.05); this.root.add(this.scrLight);
    }
    this.scrBase = this.coarse ? 0.35 : 3.2;
    // map light: a warm spot from the aft bow onto the panel
    const ml = frame('maplight');
    this.mapLight = new THREE.SpotLight(0xffd2a0, 0.5, 1.4, 0.75, 0.9, 2);
    this.mapLight.position.copy(ml.position); this.root.add(this.mapLight);
    this.mapLight.target.position.copy(face.position); this.root.add(this.mapLight.target);
    // master caution: red wash from the warning strip
    const an = frame('annun');
    this.cautionLight = new THREE.PointLight(0xff3a14, 0, 0.9, 2);
    this.cautionLight.position.copy(an.position).add(_v.set(0, 0.02, 0.08)); this.root.add(this.cautionLight);

    // canopy glass
    const cg = canopyGeometry(), sc = data.parts;
    const faceInv = new THREE.Matrix4();
    const scrPos = [], scrUv = [];
    for (const [n, r] of [['mfdC', 'C'], ['mfdL', 'L'], ['mfdR', 'R']]) {
      const f = frame(n); const lp = f.position.clone();
      // screen centre in face-plane coordinates
      const fm = new THREE.Matrix4().compose(face.position, face.quaternion, face.scale).invert();
      lp.applyMatrix4(fm); const [w, h] = f.userData.size; scrPos.push(new THREE.Vector4(lp.x, lp.y, w, h));
      const u = Instruments.uv(r); scrUv.push(new THREE.Vector4(u.u0, u.v0, u.du, u.dv));
    }
    this.faceLocal = new THREE.Matrix4().compose(face.position, face.quaternion, face.scale);
    this.glassU = {
      uSun: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color(1, 0.89, 0.76).multiplyScalar(2.2) }, uSunVis: { value: 1 },
      uPlanetC: { value: PLANET_C }, uPlanetR: { value: PLANET_R }, uScrGain: { value: 1.3 }, uDust: { value: 1 },
      uAtlas: { value: tex }, uFaceInv: { value: faceInv }, uScrPos: { value: scrPos }, uScrUv: { value: scrUv },
      uDim: { value: new THREE.Vector2(...cg.userData.dim) },
    };
    const glass = new THREE.Mesh(cg, new THREE.ShaderMaterial({
      vertexShader: GLASS_VS, fragmentShader: GLASS_FS, uniforms: this.glassU, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    }));
    glass.renderOrder = 10; this.hingeOff.add(glass);

    // HUD combiner glass
    const hf = frame('hud'), [hw, hh] = hf.userData.size, hr = Instruments.uv('HUD');
    this.hudU = {
      uAtlas: { value: tex }, uShipInv: { value: new THREE.Matrix3() }, uField: { value: new THREE.Vector4(HUD_FIELD.x0, HUD_FIELD.x1, HUD_FIELD.y0, HUD_FIELD.y1) },
      uRect: { value: new THREE.Vector4(hr.u0, hr.v0, hr.du, hr.dv) }, uGain: { value: 6 }, uSun: this.glassU.uSun, uSunVis: this.glassU.uSunVis,
    };
    const hud = new THREE.Mesh(new THREE.PlaneGeometry(hw, hh), new THREE.ShaderMaterial({
      vertexShader: GLASS_VS, fragmentShader: HUD_FS, uniforms: this.hudU, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    }));
    hud.renderOrder = 9; hf.add(hud); this.root.add(hf);

    this.buildTag();
  }

  // A copy of the cabin for the outside world: when the canopy is open (EVA) the main scene draws the
  // interior, the hinged frame and glass, so you can look back into your own seat.
  buildEvaCabin(envMap) {
    const g = new THREE.Group();
    g.add(this.interior.clone());
    for (const n of ['throttle', 'stick']) { const f = frame(n); f.add((n === 'throttle' ? this.throttle : this.stick).clone()); g.add(f); }
    this.root.children.filter((o) => o.userData && o.userData.size && o.children.some((c) => c.isMesh && c.material.map === this.inst.tex)).forEach((f) => g.add(f.clone()));
    const hinge = new THREE.Group(); hinge.position.copy(HINGE); g.add(hinge);
    const off = new THREE.Group(); off.position.copy(HINGE).negate(); hinge.add(off);
    off.add(this.bandClone());
    g.userData.hinge = hinge;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  bandClone() {
    const b = this.interior.clone(), src = []; this.interior.traverse((o) => { if (o.isMesh) src.push(o); });
    let i = 0; b.traverse((o) => { if (o.isMesh) { o.material = this.hingeMats.get(src[i].name || src[i].uuid); i++; } });
    return b;
  }

  // open/close the canopy (EVA). Returns true once it has reached the target.
  setCanopy(open) { this.openTarget = open ? 1 : 0; }

  // a salvage tag on a short chain, hung from the forward bow. Zero g: it floats, and only thrust moves it.
  buildTag() {
    const a = frame('tag'); this.root.add(a); this.tagAnchor = a.position.clone();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 0.35, metalness: 0.85 });
    this.chain = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 1, 5), mat); this.chain.castShadow = true; this.root.add(this.chain);
    const tag = this.tag = new THREE.Group(); this.root.add(tag);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.034, 0.0025), new THREE.MeshStandardMaterial({ color: 0xcfc6b0, roughness: 0.55, metalness: 0.2 }));
    plate.position.y = -0.019; plate.castShadow = true; tag.add(plate);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.0225, 0.007, 0.0028), new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.6 }));
    band.position.y = -0.028; tag.add(band);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.004, 0.0009, 5, 12), mat); tag.add(ring);
    this.tagL = 0.05;
    this.tagP = new THREE.Vector3(0.012, -this.tagL, 0.01).setLength(this.tagL); this.tagV = new THREE.Vector3(0.004, 0, -0.003);
  }

  toggle() {
    this.target = this.target ? 0 : 1;
    if (this.reduced) this.blend = this.target;
  }

  setSize(w, h) { this.aspect = w / h; }

  alert(level) { this.hit = Math.min(1, this.hit + level); }

  // sun blocked by station or debris? one ray, cheap
  sunBlocked(pos) {
    const d = this.sunDir, w = this.world;
    for (const o of w.obbs) {
      _v.copy(pos).sub(o.c).applyQuaternion(o.qi); _v2.copy(d).applyQuaternion(o.qi);
      let t0 = 0, t1 = 1e4, ok = true;
      for (const ax of ['x', 'y', 'z']) {
        const oo = _v[ax], dd = _v2[ax], hh = o.h[ax];
        if (Math.abs(dd) < 1e-6) { if (oo < -hh || oo > hh) { ok = false; break; } continue; }
        let a = (-hh - oo) / dd, b = (hh - oo) / dd; if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) { ok = false; break; }
      }
      if (ok) return true;
    }
    for (const s of w.statics.concat(w.debris)) {
      const r = s.rad ?? s.radius; _v.copy(s.pos).sub(pos); const t = _v.dot(d);
      if (t > 0 && _v.lengthSq() - t * t < r * r * 0.8) return true;
    }
    return false;
  }

  update(dt, ship, rig) {
    this.t += dt;
    // ---- canopy hinge ------------------------------------------------------------------------
    if (this.hinge) {
      const sp = this.reduced ? 3 : 0.6;
      this.open = THREE.MathUtils.clamp(this.open + Math.sign(this.openTarget - this.open) * dt * sp, 0, 1);
      if (Math.abs(this.openTarget - this.open) < dt * sp) this.open = this.openTarget;
      this.openAngle = canopyCurve(this.open) * OPEN_ANGLE;
      this.hinge.rotation.x = this.openAngle;
      const k = this.open;
      this.openU.value = k; this.band.visible = k > 0.001;
      if (this.chain) this.chain.visible = this.tag.visible = k < 0.001;
    }
    // ---- view blend --------------------------------------------------------------------
    const goingIn = this.target > this.blend;
    if (!this.reduced) this.blend = THREE.MathUtils.clamp(this.blend + (this.target ? 1 : -1) * dt / 0.55, 0, 1);
    const inside = this.blend >= 0.999 || (this.target === 1 && this.reduced);
    this.mode = inside ? 1 : 0;
    this.pass.enabled = inside;
    this.camera.layers[inside ? 'disable' : 'enable'](1);
    document.body.classList.toggle('cockpit', this.target === 1);
    if (this.blend <= 0 && !this.target) { this.inst.power.C = 0; return false; }

    this.root.position.copy(ship.pos); this.root.quaternion.copy(ship.quat); this.root.updateMatrixWorld(true);

    // ---- body motion: acceleration in the ship frame drives a damped head spring -------------
    const sdt = Math.max(dt, 1e-3);
    _v.copy(ship.vel).sub(this.prevVel).divideScalar(sdt); this.prevVel.copy(ship.vel);
    _qi.copy(ship.quat).invert();
    _v.applyQuaternion(_qi);
    if (_v.lengthSq() > 4e4) _v.setLength(200);      // a respawn or a teleport is not a g-load
    this.accL.lerp(_v, 1 - Math.exp(-14 * dt));
    this.g = this.accL.length() / 9.81; this.gSm += (this.g - this.gSm) * (1 - Math.exp(-6 * dt));
    this.gPeak = Math.max(this.gPeak - dt * 0.6, this.gSm);
    const motion = this.reduced ? 0 : 1;
    // spring: k 70, c 11, pushed opposite the acceleration (forward thrust presses you back)
    this.headV.addScaledVector(this.head, -70 * dt).addScaledVector(this.headV, -11 * dt).addScaledVector(this.accL, -0.012 * dt * motion);
    this.head.addScaledVector(this.headV, dt);
    this.head.clampLength(0, 0.045);
    // head lags rotation a little; rolls with side load
    const w = ship.angVel;
    _v.set(-w.x * 0.018, -w.y * 0.022, -w.z * 0.01 + this.accL.x * 0.0009).multiplyScalar(motion);
    this.headRot.lerp(_v, 1 - Math.exp(-8 * dt));
    // engine rumble + impact shake
    const main = ship.fx.main, boost = ship.fx.boost ? 1 : 0;
    const rum = motion * (main * 0.0005 + boost * 0.0013 + (rig.shake || 0) * 0.012);
    _v2.set((Math.random() - 0.5) * rum, (Math.random() - 0.5) * rum, (Math.random() - 0.5) * rum * 0.5);

    // ---- pose the eye ---------------------------------------------------------------------
    const eye = _v.copy(EYE).add(this.head).add(_v2);
    eye.applyMatrix4(this.root.matrixWorld);
    const portrait = this.aspect < 0.8;
    _e.set((portrait ? PITCH * 0.3 : PITCH) + this.headRot.x + _v2.y * 3, this.headRot.y, this.headRot.z + _v2.x * 4, 'YXZ'); _q.setFromEuler(_e);
    const camQ = _q.premultiply(ship.quat);
    const fovIn = (portrait ? 80 : 72) + (this.reduced ? 0 : (boost ? 4 : 0) + ship.boostT * 3);
    if (inside) {
      this.camera.position.copy(eye); this.camera.quaternion.copy(camQ);
      this.fovSm = THREE.MathUtils.damp(this.fovSm ?? fovIn, fovIn, 6, dt); this.camera.fov = this.fovSm;
    } else {
      // swoop: from the chase rig's pose into the seat (or back out), eased
      const k = this.blend, e = goingIn ? k * k * (3 - 2 * k) : 1 - Math.pow(1 - k, 3);
      this.camera.position.lerp(eye, e); this.camera.quaternion.slerp(camQ, e);
      this.camera.fov += (fovIn - this.camera.fov) * e; this.fovSm = this.camera.fov;
    }
    this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
    this.cam.position.copy(this.camera.position); this.cam.quaternion.copy(this.camera.quaternion);
    this.cam.fov = this.camera.fov; this.cam.aspect = this.camera.aspect; this.cam.updateProjectionMatrix(); this.cam.updateMatrixWorld();
    if (!inside) return true;

    // ---- light ---------------------------------------------------------------------------------
    const blocked = this.sunBlocked(ship.pos);
    this.sunVis += ((blocked ? 0 : 1) - this.sunVis) * (1 - Math.exp(-5 * dt));
    this.sun.intensity = 4.2 * this.sunVis;
    this.sun.position.copy(ship.pos).addScaledVector(this.sunDir, 5); this.sun.target.position.copy(ship.pos);
    this.rim.position.copy(ship.pos).addScaledVector(this.sunDir, -5).add(_v.set(0, -2, 0)); this.rim.target.position.copy(ship.pos);
    this.glassU.uSun.value.copy(this.sunDir); this.glassU.uSunVis.value = this.sunVis;
    _m.multiplyMatrices(this.root.matrixWorld, this.faceLocal); this.glassU.uFaceInv.value.copy(_m).invert();
    this.hudU.uShipInv.value.setFromMatrix4(_m.makeRotationFromQuaternion(_qi));
    // caution: hits flash the strip and wash the cabin red; low hull keeps it blinking
    this.hit = Math.max(0, this.hit - dt * 0.6);
    const lowHull = ship.hull <= 0.3, blink = (this.t * 3 % 1) < 0.5;
    this.caution = this.hit > 0.05 || lowHull;
    this.cautionLight.intensity = (this.hit > 0.05 ? this.hit * 2.2 : 0) + (lowHull && blink ? 0.5 : 0);
    const p = this.inst.power.C;
    this.scrLight.intensity = this.scrBase * p * (0.92 + 0.08 * Math.sin(this.t * 1.3));

    // ---- controls --------------------------------------------------------------------------------
    const thrT = ship.th.fwd >= 0 ? 0.32 - 0.62 * Math.min(1, ship.th.fwd) - (ship.fx.boost ? 0.12 : 0) : 0.32 + 0.22 * -ship.th.fwd;
    this.thrSm = THREE.MathUtils.damp(this.thrSm, thrT, 12, dt); this.throttle.rotation.x = this.thrSm;
    this.stickSm.x = THREE.MathUtils.damp(this.stickSm.x, THREE.MathUtils.clamp(w.x * 0.18, -0.3, 0.3), 14, dt);
    this.stickSm.y = THREE.MathUtils.damp(this.stickSm.y, THREE.MathUtils.clamp((w.z + w.y * 0.6) * 0.16, -0.3, 0.3), 14, dt);
    this.stick.rotation.set(this.stickSm.x, 0, this.stickSm.y);
    const ga = Math.PI * 0.75 + Math.PI * 1.5 * Math.min(1, this.gSm / 10);
    this.needle.rotation.z = -ga;

    this.stepTag(dt);
    // ---- displays ----------------------------------------------------------------------------------
    this.drawAcc += dt;
    if (this.drawAcc >= (this.coarse ? 1 / 15 : 1 / 30)) { this.drawInstruments(this.drawAcc, ship); this.drawAcc = 0; }
    return true;
  }

  stepTag(dt) {
    // point on a string in the ship frame; only the ship's acceleration (and a little cabin air) acts on it
    const n = Math.min(4, Math.ceil(dt / 0.008)), h = dt / n, L = this.tagL;
    for (let i = 0; i < n; i++) {
      this.tagV.addScaledVector(this.accL, -h * (this.reduced ? 0.3 : 1)).multiplyScalar(Math.exp(-0.5 * h));
      // lazy cabin draft so it never sits dead still
      this.tagV.x += Math.sin(this.t * 0.37) * 0.0006 * h * 60; this.tagV.z += Math.cos(this.t * 0.23) * 0.0005 * h * 60;
      this.tagP.addScaledVector(this.tagV, h);
      if (this.tagP.y > -0.012) { this.tagP.y = -0.012; this.tagV.y = Math.min(0, this.tagV.y) * -0.3; }   // the bow above stops it
      if (this.tagP.length() > L) { this.tagP.setLength(L); const vn = this.tagV.dot(_v.copy(this.tagP).normalize()); if (vn > 0) this.tagV.addScaledVector(_v, -vn * 1.6); }
    }
    const a = this.tagAnchor, end = _v.copy(a).add(this.tagP);
    this.chain.position.copy(a).add(end).multiplyScalar(0.5);
    this.chain.scale.set(1, this.tagP.length(), 1);
    this.chain.quaternion.setFromUnitVectors(_v2.set(0, 1, 0), _v2.copy(this.tagP).normalize().negate());
    this.tag.position.copy(end); this.tag.quaternion.copy(this.chain.quaternion);
  }

  drawInstruments(dt, ship) {
    const qi = _qi.copy(ship.quat).invert(), w = this.world;
    const vl = _v.copy(ship.vel).applyQuaternion(qi).clone();
    const f = _v2.set(0, 0, -1).applyQuaternion(ship.quat);
    const heading = Math.atan2(f.x, -f.z) * DEG;
    const up = new THREE.Vector3().copy(ship.pos).sub(PLANET_C).normalize().applyQuaternion(qi);
    const pitch = Math.asin(THREE.MathUtils.clamp(-up.z, -1, 1)) * DEG, roll = Math.atan2(up.x, up.y);
    // contacts within scope range, in the ship frame
    const C = this.contacts; C.length = 0; let nearest = 1e9; const RANGE = 120;
    const add = (pos, r, kind) => {
      const l = new THREE.Vector3().copy(pos).sub(ship.pos); const d = l.length();
      nearest = Math.min(nearest, d - r - ship.radius);
      if (d > RANGE * 1.8) return; l.applyQuaternion(qi); C.push({ x: l.x, y: l.y, z: l.z, d, r, kind });
    };
    for (const o of w.obbs) {
      _v.copy(ship.pos).sub(o.c).applyQuaternion(o.qi).clamp(_v2.copy(o.h).negate(), o.h).applyQuaternion(o.q).add(o.c);
      const d = _v.distanceTo(ship.pos) - ship.radius; nearest = Math.min(nearest, d);
      const l = new THREE.Vector3().copy(o.c).sub(ship.pos); if (l.length() < RANGE * 1.8) { l.applyQuaternion(qi); C.push({ x: l.x, y: l.y, z: l.z, d: l.length(), r: Math.max(o.h.x, o.h.y, o.h.z), kind: 0 }); }
    }
    for (const d of w.debris) add(d.pos, d.radius, 1);
    for (let i = 0; i < w.statics.length; i += 2) add(w.statics[i].pos, w.statics[i].rad, 2);
    const rs = this.rcsSm, k = 1 - Math.exp(-10 * dt);
    rs.x += (ship.th.strafe - rs.x) * k; rs.y += (ship.th.vert - rs.y) * k; rs.r += (THREE.MathUtils.clamp(-ship.angVel.z / 1.5, -1, 1) - rs.r) * k;
    const fpmBack = vl.z > 0, fz = fpmBack ? vl.z : -vl.z;
    this.inst.draw({
      on: true, t: this.t, speed: ship.vel.length(), vl, heading, pitch, roll,
      fpm: { x: Math.atan2(fpmBack ? -vl.x : vl.x, fz) * DEG, y: Math.atan2(fpmBack ? -vl.y : vl.y, fz) * DEG, back: fpmBack },
      contacts: C, range: RANGE, nearest: Math.max(0, nearest),
      main: ship.fx.main, boost: ship.fx.boost ? 1 : 0, brake: !!ship.braking, th: ship.th, heat: this.heat ?? 0,
      hull: ship.hull, rcs: rs, assist: ship.assist, mode: ship.mode, caution: this.caution, gPeak: this.gPeak,
    }, dt);
  }
}
