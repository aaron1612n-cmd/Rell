import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Main engine assembly, built procedurally so its metal can heat up with thrust.
// Local frame: exhaust along +Z, origin on the pod's aft face.
//  static: aft bulkhead + bolt ring, thrust-frame struts, turbopump, feed lines, gimbal ring
//  bell (gimballed about the ring): injector dome, combustion chamber, regen-tube bell section,
//    manifold + hatband rings, radiatively cooled extension with temper-colour bands, exit lip,
//    and a separate inner surface that glows from the throat down.
//  two linear actuators re-solved every frame so they follow the gimbal.

const PIVOT = 0.16;          // gimbal ring distance aft of the bulkhead
const CH0 = -0.04, CH1 = 0.13, THROAT = 0.22, L = 0.66; // bell-local stations (from pivot)
const RC = 0.125, RT = 0.082, RE = 0.355;               // chamber, throat, exit radii
const TUBES_T = 0.42;        // fraction of bell length that is regen-tube section
export const EXIT_Z = PIVOT + THROAT + L;               // exit plane from bulkhead

const srgb = (h) => new THREE.Color(h);                 // THREE.Color(hex) converts sRGB -> linear
const hash = (x) => { const s = Math.sin(x * 127.1) * 43758.5453; return s - Math.floor(s); };

// radius profile of the whole chamber+bell, z in bell-local space
function radiusAt(z) {
  if (z <= CH1) return RC;
  if (z <= THROAT) { const t = (z - CH1) / (THROAT - CH1); return RC + (RT - RC) * (0.5 - 0.5 * Math.cos(t * Math.PI)); }
  const t = (z - THROAT) / L;
  return RT + (RE - RT) * (1 - Math.pow(1 - t, 2.1));
}

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
  const SEG = coarse ? 48 : 96, NT = coarse ? 16 : 32;
  const C = {
    copper: srgb(0xb07048), copperD: srgb(0x6e3f28), ext: srgb(0x5a5a62), steel: srgb(0x4a5058), steelD: srgb(0x2a2e34), steelL: srgb(0x7a828c),
    straw: srgb(0xc9a960), bronze: srgb(0x9a6038), purple: srgb(0x5e4678), blue: srgb(0x3c5a8c), haz: srgb(0xff5a1f), black: srgb(0x15171b),
  };

  // ---- bell outer: regen tubes, then smooth extension with temper colours ----
  const zs = [];
  for (let i = 0; i <= 10; i++) zs.push(CH0 + (THROAT - CH0) * (i / 10));
  for (let i = 1; i <= (coarse ? 22 : 34); i++) zs.push(THROAT + L * Math.pow(i / (coarse ? 22 : 34), 1.15));
  const tmp = new THREE.Color();
  const outer = lathe(zs, SEG, (z, th, j, i) => {
    const t = Math.max(0, (z - THROAT) / L);
    let r = radiusAt(z) + 0.006;
    const inTubes = z > CH0 + 0.02 && t < TUBES_T;
    // round tubes: |sin| gives a bump per tube with crisp valleys between them
    if (inTubes) r += 0.0075 * Math.pow(Math.abs(Math.sin(th * NT / 2)), 0.6) * (1 - 0.4 * t);
    const w = 0.92 + 0.16 * hash(i * 13.7 + j * 3.1);
    if (inTubes) tmp.copy(C.copper).lerp(C.copperD, 0.35 * (1 - Math.abs(Math.sin(th * NT / 2))) + 0.25 * hash(i + j * 91));
    else {
      // temper bands just aft of the hatband: straw -> bronze -> purple -> blue -> dark niobium
      const u = (t - TUBES_T) / 0.2;
      if (u < 0.25) tmp.copy(C.straw).lerp(C.bronze, u / 0.25);
      else if (u < 0.5) tmp.copy(C.bronze).lerp(C.purple, (u - 0.25) / 0.25);
      else if (u < 0.8) tmp.copy(C.purple).lerp(C.blue, (u - 0.5) / 0.3);
      else tmp.copy(C.blue).lerp(C.ext, Math.min(1, (u - 0.8) / 0.6));
      if (t < TUBES_T) tmp.copy(C.copper);
    }
    tmp.multiplyScalar(w);
    // where the metal glows when hot: dull at the tubes, brightest at the top of the extension, cooler toward the lip
    const glow = inTubes ? 0.12 : Math.max(0, 1 - Math.max(0, t - TUBES_T) * 1.25) * 0.95 + 0.05;
    return { r, color: [tmp.r, tmp.g, tmp.b], aGlow: z < THROAT ? 0.05 : glow };
  });

  // ---- bell inner (rendered back-face, unlit glow shader) ----
  const izs = []; for (let i = 0; i <= 30; i++) izs.push(CH1 + (THROAT + L - CH1) * Math.pow(i / 30, 1.1));
  const inner = lathe(izs, coarse ? 32 : 48, (z) => ({ r: Math.max(0.01, radiusAt(z) - 0.004), aT: Math.max(0, (z - THROAT) / L) }));
  // close the chamber top with a small injector plate inside
  // ---- bell hardware (gimballed) ----
  const hw = [
    torus(radiusAt(THROAT + L * 0.1) + 0.02, 0.022, THROAT + L * 0.1, SEG, C.steel, 0.05),   // fuel manifold
    torus(radiusAt(THROAT + L * TUBES_T) + 0.012, 0.016, THROAT + L * TUBES_T, SEG, C.steelL, 0.3), // hatband / joint ring
    torus(RE + 0.006, 0.011, THROAT + L, SEG, C.steelD, 0.6),                                 // exit lip
    cyl(0.07, RC + 0.02, 0.07, 24, C.steel, [0, 0, CH0 - 0.02]),                            // injector dome
    cyl(RC + 0.022, RC + 0.022, 0.03, 24, C.steelL, [0, 0, CH1 - 0.02]),                      // chamber flange
  ];
  // flange bolts around the manifold
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2, r = RC + 0.03; hw.push(cyl(0.008, 0.008, 0.035, 6, C.steelD, [Math.cos(a) * r, Math.sin(a) * r, CH1 - 0.02])); }
  // manifold feed stubs down into the tubes
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.26, z0 = THROAT + L * 0.1, r = radiusAt(z0) + 0.035; hw.push(cyl(0.012, 0.012, 0.05, 6, C.steelD, [Math.cos(a) * r, Math.sin(a) * r, z0 - 0.03])); }
  // stiffener brackets between hatband and lip
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2, z0 = THROAT + L * (TUBES_T + 0.02), z1 = THROAT + L * 0.62;
    hw.push(tube([[Math.cos(a) * (radiusAt(z0) + 0.012), Math.sin(a) * (radiusAt(z0) + 0.012), z0], [Math.cos(a) * (radiusAt((z0 + z1) / 2) + 0.016), Math.sin(a) * (radiusAt((z0 + z1) / 2) + 0.016), (z0 + z1) / 2], [Math.cos(a) * (radiusAt(z1) + 0.01), Math.sin(a) * (radiusAt(z1) + 0.01), z1]], 0.006, C.steelD, 4));
  }
  const bellHw = mergeGeometries(hw.map((g) => g.index ? g.toNonIndexed() : g));

  // ---- static frame (not gimballed) ----
  const st = [
    cyl(0.39, 0.39, 0.045, 32, C.steelD, [0, 0, 0.022]),                 // aft bulkhead
    cyl(0.3, 0.3, 0.02, 32, C.steel, [0, 0, 0.05]),                      // raised plate
    torus(PIVOT > 0 ? 0.165 : 0.16, 0.022, PIVOT, 28, C.steelL),         // gimbal ring
    box([0.06, 0.05, 0.06], [0.165, 0, PIVOT], C.steel), box([0.06, 0.05, 0.06], [-0.165, 0, PIVOT], C.steel), // trunnions
    box([0.05, 0.06, 0.06], [0, 0.165, PIVOT], C.steel), box([0.05, 0.06, 0.06], [0, -0.165, PIVOT], C.steel),
  ];
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; st.push(cyl(0.011, 0.011, 0.02, 6, C.steelL, [Math.cos(a) * 0.345, Math.sin(a) * 0.345, 0.05])); }
  // thrust-frame struts: bulkhead to gimbal ring
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4, b = (i / 4) * Math.PI * 2;
    st.push(tube([[Math.cos(a) * 0.27, Math.sin(a) * 0.27, 0.06], [Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0.1], [Math.cos(b + 0.4) * 0.18, Math.sin(b + 0.4) * 0.18, PIVOT]], 0.016, C.steel, 6));
  }
  // turbopump on the lower inboard side, with its exhaust duct and feed lines
  st.push(cyl(0.055, 0.055, 0.16, 16, C.steelL, [0.2, -0.17, 0.11], 'x'));
  st.push(cyl(0.065, 0.065, 0.03, 16, C.haz, [0.27, -0.17, 0.11], 'x'));
  st.push(cyl(0.04, 0.03, 0.08, 12, C.steelD, [0.12, -0.17, 0.11], 'x'));
  st.push(tube([[0.2, -0.17, 0.16], [0.24, -0.2, 0.28], [0.27, -0.22, 0.42]], 0.02, C.steelD, 8));
  st.push(tube([[0.12, -0.13, 0.12], [0.06, -0.1, 0.15], [0.0, -0.08, PIVOT - 0.02]], 0.017, C.copperD, 8));
  st.push(tube([[-0.22, 0.12, 0.06], [-0.16, 0.12, 0.12], [-0.06, 0.06, PIVOT - 0.02]], 0.017, C.copperD, 8));
  st.push(tube([[0.24, 0.1, 0.06], [0.2, 0.08, 0.12], [0.08, 0.04, PIVOT - 0.02]], 0.013, C.steelD, 8));
  st.push(box([0.09, 0.06, 0.05], [-0.22, 0.12, 0.07], C.steel));
  st.push(box([0.07, 0.05, 0.05], [0.24, 0.1, 0.07], C.steel));
  // hazard tabs on the bulkhead rim (one accent)
  for (const a of [0.6, 2.2, 3.7, 5.3]) st.push(box([0.05, 0.05, 0.02], [Math.cos(a) * 0.37, Math.sin(a) * 0.37, 0.05], C.haz));
  const frame = mergeGeometries(st.map((g) => g.index ? g.toNonIndexed() : g));

  // actuator parts: unit-length along +Z, scaled per frame
  const actBody = cyl(0.026, 0.026, 1, 10, C.steelL, [0, 0, 0.5]);
  const actRod = cyl(0.012, 0.012, 1, 8, C.steelD, [0, 0, 0.5]);

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
    bell: metal(0.4, 0.6, THREE.DoubleSide),   // double-sided: the regen tubes show inside the bell too
    hw: metal(0.45, 0.6),
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
  cache = { outer, inner, bellHw, frame, actBody, actRod, mats, heatU };
  return cache;
}

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _z = new THREE.Vector3(0, 0, 1), _d = new THREE.Vector3(), _e = new THREE.Euler();
// actuator anchors: [bulkhead point, bell point (bell-local)]
const ACT = [Math.PI / 2, 0].map((a) => [new THREE.Vector3(Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.05), new THREE.Vector3(Math.cos(a) * (radiusAt(THROAT + L * 0.1) + 0.04), Math.sin(a) * (radiusAt(THROAT + L * 0.1) + 0.04), THROAT + L * 0.1)]);

export class Engine extends THREE.Group {
  constructor(coarse = false, side = 1) {
    super();
    const c = build(coarse);
    this.c = c;
    const frame = new THREE.Mesh(c.frame, c.mats.hw); frame.castShadow = frame.receiveShadow = true;
    this.bell = new THREE.Group(); this.bell.position.z = PIVOT;
    const outer = new THREE.Mesh(c.outer, c.mats.bell); outer.castShadow = outer.receiveShadow = true;
    const hw = new THREE.Mesh(c.bellHw, c.mats.hw); hw.castShadow = true;
    const inner = new THREE.Mesh(c.inner, c.mats.inner);
    this.bell.add(outer, hw, inner);
    // mirror the actuator layout for the port engine so they sit outboard
    this.acts = ACT.map(([a, b]) => {
      const A = a.clone(), B = b.clone(); if (side < 0) { A.x *= -1; B.x *= -1; }
      const body = new THREE.Mesh(c.actBody, c.mats.hw), rod = new THREE.Mesh(c.actRod, c.mats.hw);
      body.castShadow = true; this.add(body, rod);
      return { A, B, body, rod };
    });
    this.add(frame, this.bell);
    this.exit = new THREE.Object3D(); this.exit.position.z = THROAT + L - 0.02; this.bell.add(this.exit);
    this.gx = 0; this.gy = 0;
  }
  // gimbal angles in radians (x: pitch, y: yaw)
  gimbal(x, y) {
    this.bell.rotation.set(x, y, 0); this.bell.updateMatrix();
    for (const a of this.acts) {
      _p.copy(a.B).applyMatrix4(this.bell.matrix);
      _d.subVectors(_p, a.A); const len = _d.length(); _d.divideScalar(len);
      _q.setFromUnitVectors(_z, _d);
      a.body.position.copy(a.A); a.body.quaternion.copy(_q); a.body.scale.set(1, 1, len * 0.58);
      a.rod.position.copy(a.A); a.rod.quaternion.copy(_q); a.rod.scale.set(1, 1, len);
    }
  }
  static uniforms(coarse) { const c = build(coarse); return { heat: c.heatU, inner: c.mats.inner.uniforms }; }
}
