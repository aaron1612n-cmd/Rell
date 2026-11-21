import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Main engine: a sci-fi "turbine rocket", built procedurally so its metal can heat up with thrust.
// Local frame: exhaust along +Z, origin on the pod's aft face.
//  static: aft bulkhead, a bypass shroud with a spinning fan in the annulus and fixed guide vanes,
//    gimbal ring + trunnions, two actuators re-solved every frame so they follow the gimbal.
//  core (gimballed about the ring): slotted casing with two counter-rotating, glowing turbine rotors
//    inside, a turbine stator ring, a spinning exhaust plug, and an iris nozzle whose petals close at
//    idle and flare open on boost. Fan and rotors spool up and down with lag (Engine.update).

const PIVOT = 0.16;          // gimbal ring distance aft of the bulkhead
const CS0 = -0.07, CS1 = 0.26, RCAS = 0.2;          // core casing (bell-local, from pivot)
const PET_Z = 0.34, PET_R = 0.236, PET_L = 0.3;     // iris petal hinge ring and petal length
const NPET = 16;
export const EXIT_Z = PIVOT + PET_Z + PET_L;        // exit plane from bulkhead (petals straight)
const L = PET_Z + PET_L - CS1;                      // inner glow length

const srgb = (h) => new THREE.Color(h);                 // THREE.Color(hex) converts sRGB -> linear
const hash = (x) => { const s = Math.sin(x * 127.1) * 43758.5453; return s - Math.floor(s); };

// Indexed lathe around Z with per-vertex hook; seam shares vertices so normals are smooth all round.
function lathe(zs, segs, fn) {
  const pos = [], idx = [], extra = {};
  const rings = zs.length;
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
    const th = (i / segs) * Math.PI * 2, z = zs[j];
    const { r, ...rest } = fn(z, th, j, i);
    pos.push(Math.cos(th) * r, Math.sin(th) * r, z);
    for (const k in rest) (extra[k] ||= []).push(...(Array.isArray(rest[k]) ? rest[k] : [rest[k]]));
  }
  for (let j = 0; j < rings - 1; j++) for (let i = 0; i < segs; i++) {
    const a = j * segs + i, b = j * segs + (i + 1) % segs, c = a + segs, d = b + segs;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  for (const k in extra) g.setAttribute(k, new THREE.Float32BufferAttribute(extra[k], extra[k].length / (rings * segs)));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function ringZ(z, segs) { const a = []; for (let i = 0; i <= segs; i++) a.push(z[0] + (z[1] - z[0]) * (i / segs)); return a; }
const colorize = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (!g.attributes.aGlow) g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n), 1)); return g; };
const strip = (g) => { g = g.index ? g : g; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'aGlow'].includes(k)) g.deleteAttribute(k); return g; };
function torus(R, r, z, segs, c, glow = 0) {
  const g = strip(new THREE.TorusGeometry(R, r, 8, segs)); g.translate(0, 0, z); colorize(g, c);
  g.attributes.aGlow.array.fill(glow); return g;
}
function cyl(r1, r2, h, segs, c, at, axis = 'z') {
  const g = strip(new THREE.CylinderGeometry(r2, r1, h, segs));
  if (axis === 'z') g.rotateX(Math.PI / 2); else if (axis === 'x') g.rotateZ(-Math.PI / 2);
  g.translate(at[0], at[1], at[2]); return colorize(g, c);
}
function box(s, at, c) { const g = strip(new THREE.BoxGeometry(...s)); g.translate(...at); return colorize(g, c); }
function tube(points, r, c, segs = 6) {
  const g = strip(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), 20, r, segs)); return colorize(g, c);
}

let cache = null;
function build(coarse) {
  if (cache) return cache;
  const SEG = coarse ? 32 : 64;
  const C = {
    ext: srgb(0x5a5a62), steel: srgb(0x4a5058), steelD: srgb(0x2a2e34), steelL: srgb(0x7a828c), dark: srgb(0x16181c),
    straw: srgb(0xc9a960), bronze: srgb(0x9a6038), purple: srgb(0x5e4678), blue: srgb(0x3c5a8c), haz: srgb(0xff5a1f), bone: srgb(0xb9b09c),
  };
  const glowy = (g, f) => { const p = g.attributes.position, a = g.attributes.aGlow.array; for (let i = 0; i < p.count; i++) a[i] = f(p.getX(i), p.getY(i), p.getZ(i)); return g; };
  const merge = (arr) => mergeGeometries(arr.map((g) => g.index ? g.toNonIndexed() : g));
  const around = (n, fn) => { const o = []; for (let i = 0; i < n; i++) o.push(fn((i / n) * Math.PI * 2, i)); return o; };
  const rotZ = (g, a) => g.applyMatrix4(new THREE.Matrix4().makeRotationZ(a));

  // ---- static: bulkhead, bypass shroud, guide vanes, gimbal ring ----
  const st = [
    cyl(0.39, 0.39, 0.045, 32, C.steelD, [0, 0, 0.022]),                 // aft bulkhead
    cyl(0.205, 0.205, 0.05, 32, C.steel, [0, 0, 0.06]),                  // core mount boss
    torus(0.165, 0.022, PIVOT, 28, C.steelL),                              // gimbal ring
    box([0.06, 0.05, 0.06], [0.165, 0, PIVOT], C.steel), box([0.06, 0.05, 0.06], [-0.165, 0, PIVOT], C.steel),
    box([0.05, 0.06, 0.06], [0, 0.165, PIVOT], C.steel), box([0.05, 0.06, 0.06], [0, -0.165, PIVOT], C.steel),
    torus(0.385, 0.018, 0.2, SEG, C.steelL),                               // shroud lip
    torus(0.392, 0.012, 0.08, SEG, C.haz),                                 // hazard band
  ];
  // shroud: open tube, dark inside
  const shroud = strip(new THREE.CylinderGeometry(0.39, 0.39, 0.2, SEG, 1, true)); shroud.rotateX(Math.PI / 2); shroud.translate(0, 0, 0.1); colorize(shroud, C.bone);
  st.push(shroud);
  // fixed guide vanes behind the fan (stators), slightly cambered
  st.push(...around(coarse ? 7 : 11, (a) => { const g = box([0.008, 0.16, 0.05], [0, 0.3, 0.16], C.steelD); g.rotateZ(0); g.applyMatrix4(new THREE.Matrix4().makeRotationY(0.25)); return rotZ(g, a); }));
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; st.push(cyl(0.009, 0.009, 0.02, 6, C.steelL, [Math.cos(a) * 0.375, Math.sin(a) * 0.375, 0.2])); }
  const frame = merge(st);
  // inside of the shroud and the fan floor: dark so the blades read against it
  const duct = strip(new THREE.CylinderGeometry(0.384, 0.384, 0.19, SEG, 1, true)); duct.rotateX(Math.PI / 2); duct.translate(0, 0, 0.1); colorize(duct, C.dark);

  // ---- fan (spins, about Z) ----
  const NF = coarse ? 11 : 17;
  const fan = [cyl(0.215, 0.215, 0.05, 28, C.steelL, [0, 0, 0.1]), torus(0.218, 0.008, 0.125, 28, C.haz)];
  fan.push(...around(NF, (a) => {
    // blade: thin plate from hub to tip, pitched hard and twisted
    const g = strip(new THREE.BoxGeometry(0.006, 0.15, 0.055, 1, 4, 1)); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i), tw = 0.75 - 1.6 * (y + 0.075), x = p.getX(i), z = p.getZ(i); p.setXYZ(i, x * Math.cos(tw) - z * Math.sin(tw), y, x * Math.sin(tw) + z * Math.cos(tw)); }
    g.computeVertexNormals(); g.translate(0, 0.295, 0.1); colorize(g, C.steelL); return rotZ(g, a);
  }));
  const fanG = merge(fan);

  // ---- core (gimballed) ----
  // casing: staves with slots between them, end rings
  const NS = coarse ? 8 : 10, cas = [];
  cas.push(...around(NS, (a) => { const w = 2 * Math.PI * RCAS / NS * 0.58; const g = box([w, 0.022, CS1 - CS0], [0, RCAS, (CS0 + CS1) / 2], C.steel); return rotZ(g, a + Math.PI / NS); }));
  cas.push(torus(RCAS + 0.004, 0.02, CS0, SEG, C.steelL), torus(RCAS + 0.004, 0.016, CS1, SEG, C.steelL), torus(RCAS + 0.006, 0.01, (CS0 + CS1) / 2, SEG, C.steelD));
  // transition cone to the petal ring, petal hinge ring with bolts
  const tr = strip(new THREE.CylinderGeometry(PET_R, RCAS + 0.01, PET_Z - CS1 + 0.01, SEG, 1, true)); tr.rotateX(Math.PI / 2); tr.translate(0, 0, (CS1 + PET_Z) / 2); colorize(tr, C.steel);
  glowy(tr, () => 0.15); cas.push(tr);
  cas.push(torus(PET_R + 0.004, 0.014, PET_Z, SEG, C.steelL, 0.2));
  for (let i = 0; i < NPET; i++) { const a = (i / NPET) * Math.PI * 2; cas.push(cyl(0.008, 0.008, 0.028, 6, C.steelD, [Math.cos(a) * (PET_R + 0.016), Math.sin(a) * (PET_R + 0.016), PET_Z])); }
  // turbine stator ring just ahead of the plug: fixed vanes, glow at the roots
  cas.push(...around(coarse ? 9 : 13, (a) => { const g = box([0.007, RCAS - 0.11, 0.04], [0, (RCAS + 0.11) / 2, CS1 + 0.02], C.steelD); g.applyMatrix4(new THREE.Matrix4().makeRotationY(-0.4)); glowy(g, () => 0.55); return rotZ(g, a); }));
  // actuator lugs on the casing
  for (const a of [Math.PI / 2, 0, Math.PI]) cas.push(box([0.04, 0.035, 0.05], [Math.cos(a) * (RCAS + 0.02), Math.sin(a) * (RCAS + 0.02), 0.2], C.steelD));
  const casing = merge(cas);

  // rotors: a glowing drum (separate, unlit) with dark blade rows sweeping over it
  const drum = strip(new THREE.CylinderGeometry(0.13, 0.13, CS1 - CS0 - 0.02, 24)); drum.rotateX(Math.PI / 2); drum.translate(0, 0, (CS0 + CS1) / 2);
  const rotor = (zs, n, pitch) => merge(zs.flatMap((z) => around(n, (a) => {
    const g = box([0.006, 0.058, 0.04], [0, 0.159, z], C.dark); g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0.159, z).multiply(new THREE.Matrix4().makeRotationY(pitch)).multiply(new THREE.Matrix4().makeTranslation(0, -0.159, -z)));
    return rotZ(g, a);
  })));
  const NB = coarse ? 12 : 19;
  const rotorA = rotor([CS0 + 0.05, CS0 + 0.19], NB, 0.55), rotorB = rotor([CS0 + 0.12, CS0 + 0.26], NB - 2, -0.55);

  // exhaust plug: spins with the core; helical hazard stripes so you can see it turn; tip glows
  const plugZ0 = CS1 - 0.03, plugZ1 = PET_Z + PET_L - 0.02;
  const pz = []; for (let i = 0; i <= 14; i++) pz.push(plugZ0 + (plugZ1 - plugZ0) * (i / 14));
  const tmp = new THREE.Color();
  const plug = lathe(pz, 32, (z, th) => {
    const t = (z - plugZ0) / (plugZ1 - plugZ0), r = Math.max(0.004, 0.105 * Math.sqrt(Math.max(0, 1 - t * t * 0.96)) * (1 - 0.15 * t));
    const stripe = Math.sin(th * 3 + t * 9) > 0.55 && t < 0.7;
    tmp.copy(stripe ? C.haz : C.steelL).lerp(C.purple, Math.max(0, t - 0.55) * 1.6);
    return { r, color: [tmp.r, tmp.g, tmp.b], aGlow: Math.min(1, Math.max(0, (t - 0.45) * 1.9)) };
  });

  // one iris petal (hinged at its root, pointing aft along +Z); temper colours toward the tip
  const pet = strip(new THREE.BoxGeometry(1, 0.007, 1, 1, 1, 6)); pet.translate(0, 0, 0.5);
  { const p = pet.attributes.position; const w0 = 2 * Math.PI * PET_R / NPET * 1.08, w1 = w0 * 0.72;
    for (let i = 0; i < p.count; i++) { const z = p.getZ(i); p.setX(i, p.getX(i) * (w0 + (w1 - w0) * z)); p.setZ(i, z * PET_L); p.setY(i, p.getY(i) - 0.02 * z * z); } }
  pet.computeVertexNormals(); colorize(pet, C.ext);
  { const p = pet.attributes.position, c = pet.attributes.color, g = pet.attributes.aGlow;
    for (let i = 0; i < p.count; i++) { const t = p.getZ(i) / PET_L;
      // heat tint: steel, a straw band, then bronze fading to blued steel at the lip
      if (t < 0.35) tmp.copy(C.steel).lerp(C.straw, t / 0.35 * 0.6); else if (t < 0.65) tmp.copy(C.steel).lerp(C.straw, 0.6).lerp(C.bronze, (t - 0.35) / 0.3);
      else tmp.copy(C.bronze).lerp(C.steel, 0.3).lerp(C.blue, (t - 0.65) / 0.35 * 0.7);
      c.setXYZ(i, tmp.r, tmp.g, tmp.b); g.setX(i, 0.3 + 0.7 * (1 - Math.abs(t - 0.35) * 1.3)); } }

  // inner glow: unlit sleeve inside the petals, hottest at the turbine
  const izs = []; for (let i = 0; i <= 20; i++) izs.push(CS1 + (PET_Z + PET_L - CS1) * (i / 20));
  const inner = lathe(izs, 40, (z) => ({ r: 0.17 - 0.02 * (z - CS1) / L, aT: Math.max(0, (z - CS1) / L) }));

  // actuator parts: unit-length along +Z, scaled per frame
  const actBody = cyl(0.022, 0.022, 1, 10, C.steelL, [0, 0, 0.5]);
  const actRod = cyl(0.01, 0.01, 1, 8, C.steelD, [0, 0, 0.5]);
  // ---- materials ----
  const heatU = { uHeat: { value: 0 }, uBoost: { value: 0 } };
  const metal = (rough, metalness, side = THREE.FrontSide) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness, side });
    m.onBeforeCompile = (s) => {
      s.uniforms.uHeat = heatU.uHeat; s.uniforms.uBoost = heatU.uBoost;
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGlow; varying float vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uHeat, uBoost; varying float vGlow;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float hx = uHeat * vGlow;
          vec3 bb = mix(vec3(0.), vec3(.55,.04,.01), smoothstep(.0,.3,hx));
          bb = mix(bb, vec3(2.2,.55,.08), smoothstep(.3,.7,hx));
          bb = mix(bb, vec3(4.2,2.6,1.2), smoothstep(.7,1.15,hx));
          totalEmissiveRadiance += bb;
          diffuseColor.rgb *= 1. - .6*smoothstep(.2,.9,hx);`);
    };
    m.customProgramCacheKey = () => 'engine-heat-' + rough + metalness + side;
    return m;
  };
  const mats = {
    bell: metal(0.4, 0.6, THREE.DoubleSide),   // petals and shroud: seen from both sides
    hw: metal(0.45, 0.6),
    duct: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.2, side: THREE.BackSide }),
    // the turbine core light: an unlit drum whose colour follows power (set per frame, never NaN)
    core: new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false }),
    inner: new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uPower: { value: 0 }, uTime: { value: 0 }, ...heatU },
      vertexShader: `attribute float aT; varying float vT; varying vec2 vA;
        void main(){ vT=aT; vA=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform float uPower,uTime,uHeat,uBoost; varying float vT; varying vec2 vA;
        float h(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){
          float ang = atan(vA.y, abs(vA.x) < 1e-5 ? 1e-5 : vA.x);
          float n = vn(vec2(ang*5., vT*7. - uTime*16.)) * .6 + vn(vec2(ang*11., vT*15. - uTime*27.)) * .4;
          float hot = uPower * pow(max(1.-vT, 0.), 1.6) * (.75 + .5*n);
          vec3 c = mix(vec3(1.4,.3,.05), vec3(4.6,2.6,1.1), smoothstep(.15,.65,hot));
          c = mix(c, mix(vec3(6.,5.2,4.2), vec3(4.2,4.8,6.4), uBoost), smoothstep(.6,1.,hot));
          vec3 col = c * hot * 1.9;
          col += vec3(.55,.06,.01) * uHeat * (1.-vT) * .7;       // residual heat after shutdown
          gl_FragColor = vec4(col, 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  };
  cache = { frame, duct, fanG, casing, drum, rotorA, rotorB, plug, pet, inner, actBody, actRod, mats, heatU };
  return cache;
}

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _z = new THREE.Vector3(0, 0, 1), _d = new THREE.Vector3();
// actuator anchors: [shroud lip point, casing lug (bell-local)]
const ACT = [Math.PI / 2, 0].map((a) => [new THREE.Vector3(Math.cos(a) * 0.35, Math.sin(a) * 0.35, 0.19), new THREE.Vector3(Math.cos(a) * (RCAS + 0.03), Math.sin(a) * (RCAS + 0.03), 0.2)]);
const _cA = new THREE.Color(), _cB = new THREE.Color();

export class Engine extends THREE.Group {
  constructor(coarse = false, side = 1) {
    super();
    const c = build(coarse);
    this.c = c; this.side = side;
    const mesh = (g, m, shadow = true) => { const o = new THREE.Mesh(g, m); o.castShadow = shadow; o.receiveShadow = true; return o; };
    this.add(mesh(c.frame, c.mats.hw), mesh(c.duct, c.mats.duct, false));
    this.fan = mesh(c.fanG, c.mats.hw); this.add(this.fan);
    this.bell = new THREE.Group(); this.bell.position.z = PIVOT;
    this.bell.add(mesh(c.casing, c.mats.hw), new THREE.Mesh(c.drum, c.mats.core), new THREE.Mesh(c.inner, c.mats.inner));
    this.rotA = mesh(c.rotorA, c.mats.hw, false); this.rotB = mesh(c.rotorB, c.mats.hw, false);
    this.plug = mesh(c.plug, c.mats.hw); this.bell.add(this.rotA, this.rotB, this.plug);
    // iris petals: each on its own hinge around the ring
    this.petals = [];
    for (let i = 0; i < NPET; i++) {
      const a = (i / NPET) * Math.PI * 2, h = new THREE.Group();
      h.position.set(Math.cos(a) * PET_R, Math.sin(a) * PET_R, PET_Z); h.rotation.order = 'ZXY'; h.rotation.z = a - Math.PI / 2;   // local +y points outward; x tilts the petal in/out
      const p = mesh(c.pet, c.mats.bell); if (i % 2) p.position.y = 0.006;   // alternate petals overlap
      h.add(p); this.bell.add(h); this.petals.push(p);
    }
    // mirror the actuator layout for the port engine so they sit outboard
    this.acts = ACT.map(([a, b]) => {
      const A = a.clone(), B = b.clone(); if (side < 0) { A.x *= -1; B.x *= -1; }
      const body = new THREE.Mesh(c.actBody, c.mats.hw), rod = new THREE.Mesh(c.actRod, c.mats.hw);
      body.castShadow = true; this.add(body, rod);
      return { A, B, body, rod };
    });
    this.add(this.bell);
    this.exit = new THREE.Object3D(); this.exit.position.z = PET_Z + PET_L - 0.02; this.bell.add(this.exit);
    this.rpm = 0; this.iris = -0.3; this.lit = 0; this.stutter = 0;
    this.update(0, 0, 0, 0);
  }
  // gimbal angles in radians (x: pitch, y: yaw)
  gimbal(x, y) {
    this.bell.rotation.set(x, y, 0); this.bell.updateMatrix();
    for (const a of this.acts) {
      _p.copy(a.B).applyMatrix4(this.bell.matrix);
      _d.subVectors(_p, a.A); const len = Math.max(0.01, _d.length()); _d.divideScalar(len);
      _q.setFromUnitVectors(_z, _d);
      a.body.position.copy(a.A); a.body.quaternion.copy(_q); a.body.scale.set(1, 1, len * 0.58);
      a.rod.position.copy(a.A); a.rod.quaternion.copy(_q); a.rod.scale.set(1, 1, len);
    }
  }
  // per frame: main 0..1 throttle, boost 0..1 (smoothed), heat 0..1. Spools the fan and rotors with lag,
  // works the iris, and stutters the core light for a moment when the engine lights from cold.
  update(dt, main, boost, heat) {
    const on = main > 0.05;
    if (on && !this.lit) this.stutter = 0.45;
    this.lit = on;
    const target = on ? 0.3 + 0.55 * main + 0.45 * boost : (heat > 0.05 ? 0.06 : 0);   // windmills while hot
    this.rpm += (target - this.rpm) * Math.min(1, dt * (target > this.rpm ? 1.4 : 0.45));
    const r = this.rpm * this.side;
    this.fan.rotation.z += r * 19 * dt;
    this.rotA.rotation.z += r * 27 * dt; this.rotB.rotation.z -= r * 23 * dt; this.plug.rotation.z += r * 6 * dt;
    // iris: clamped shut when cold, converging at cruise, flared on boost
    const want = on ? -0.12 + 0.3 * boost : -0.3;
    this.iris += (want - this.iris) * Math.min(1, dt * 5);
    for (const p of this.petals) p.parent.rotation.x = -this.iris;
    this.stutter = Math.max(0, this.stutter - dt);
    const st = this.stutter > 0 ? (Math.sin(this.stutter * 90) > 0 ? 1.3 : 0.25) : 1;
    // core glow (shared material: both engines run together)
    const k = Math.max(this.rpm * 1.4 - 0.08, heat * 0.4) * st;
    _cA.setRGB(1.6, 0.42, 0.08); _cB.setRGB(2.4, 2.2, 2.6);
    this.c.mats.core.color.copy(_cA).lerp(_cB, boost * 0.7).multiplyScalar(Math.max(0, k) * 1.6);
    return st;
  }
  static uniforms(coarse) { const c = build(coarse); return { heat: c.heatU, inner: c.mats.inner.uniforms }; }
}
