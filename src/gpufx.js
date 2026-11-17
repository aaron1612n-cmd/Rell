import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

// GPU particle pool. The CPU only writes a particle once, when it is born (spawn point, velocity,
// birth time, life, size in/out, drag, stretch, kind); the vertex shader integrates its motion with
// drag and builds a camera-facing quad stretched along its screen-space velocity. Nothing is
// simulated per frame on the CPU, so thousands of particles cost one draw call and a small upload.

export const K = { PLASMA: 0, BOOST: 1, SPARK: 2, FLASH: 3, RING: 4, RING_B: 5, RCS: 6, CHIP: 7, EMBER: 8, SMOKE: 9, HAZE: 10, CORE: 11 };

const NOISE = `
float h(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }`;

const VS = `
uniform float uTime;
attribute vec3 aP0, aV; attribute vec4 aT, aX;
varying vec2 vUv; varying float vA, vSeed, vKind, vStr;
void main(){
  float age = uTime - aT.x, a = age / aT.y;
  vUv = position.xy; vKind = aX.w; vSeed = aX.z; vA = a;
  if (a < 0. || a >= 1.) { gl_Position = vec4(2.,2.,2.,1.); return; }
  float k = aX.x, ek = exp(-k*age);
  vec3 p = aP0 + aV * (k > 1e-3 ? (1.-ek)/k : age);
  vec3 vel = aV * ek;
  float s = mix(aT.z, aT.w, 1. - (1.-a)*(1.-a));
  vec4 mv = viewMatrix * vec4(p, 1.);
  vec3 vv = (viewMatrix * vec4(vel, 0.)).xyz;
  vec2 dir = vv.xy - mv.xy * (vv.z / mv.z);
  float L = length(dir);
  float sp = vSeed * 6.2832 + age * (vSeed - .5) * 3.;
  vec2 ax = (aX.y > 0. && L > 1e-3) ? dir / L : vec2(cos(sp), sin(sp));
  float st = min(aX.y * L, s * 14.);
  vStr = st / (s + st);
  vec2 side = vec2(-ax.y, ax.x);
  mv.xy += ax * position.x * (s + st) + side * position.y * s;
  gl_Position = projectionMatrix * mv;
}`;

const FS = `
uniform float uGlow; varying vec2 vUv; varying float vA, vSeed, vKind, vStr;
${NOISE}
vec3 ramp4(vec3 a, vec3 b, vec3 c, vec3 d, float t){
  vec3 r = mix(a, b, smoothstep(0., .16, t)); r = mix(r, c, smoothstep(.16, .5, t)); return mix(r, d, smoothstep(.5, 1., t)); }
void main(){
  float r = length(vUv); if (r > 1.) discard;
  int k = int(vKind + .5); float a = vA;
  float n = vn(vUv * 2.3 + vSeed * 31. + a * 2.5) * .65 + vn(vUv * 5.1 - vSeed * 17. - a * 4.) * .35;
  float soft = 1. - smoothstep(0., 1., r);
  vec3 c; float m;
  if (k == 0) {        // plasma: white-hot -> orange -> deep red, wispy
    c = ramp4(vec3(3.2,2.6,1.8), vec3(3.2,1.25,.3), vec3(1.3,.24,.04), vec3(.2,.03,.02), a);
    m = .03 * pow(soft, 1.5) * (.35 + 1.1*n) * pow(1.-a, 1.2) * smoothstep(0., .04, a);
  } else if (k == 1) { // boost plasma: blue-white core going through hazard orange
    c = ramp4(vec3(2.6,3.0,4.2), vec3(3.4,1.6,.6), vec3(1.6,.32,.06), vec3(.22,.04,.03), a);
    m = .03 * pow(soft, 1.5) * (.35 + 1.1*n) * pow(1.-a, 1.1) * smoothstep(0., .04, a);
  } else if (k == 2 || k == 8) { // sparks / embers: hot streak
    float y = vUv.y, x = vUv.x;
    m = exp(-y*y*7.) * (1. - smoothstep(.2, 1., abs(x))) * (k == 8 ? (.7+.3*sin(a*40.+vSeed*20.)) : 1.);
    c = k == 2 ? ramp4(vec3(5.,4.,2.6), vec3(4.,1.9,.6), vec3(2.,.45,.08), vec3(.4,.06,.02), a)
               : ramp4(vec3(3.,1.5,.4), vec3(2.,.6,.1), vec3(1.,.2,.04), vec3(.2,.03,.01), a);
    m *= 1. - a*a;
  } else if (k == 3) { // ignition flash
    c = vec3(3.,2.3,1.5); m = pow(soft, 3.) * pow(1.-a, 2.);
  } else if (k == 4 || k == 5) { // expanding shock ring
    float d = (r - .78) / .1; m = exp(-d*d) * (.55 + .7*n) * pow(1.-a, 1.6);
    c = k == 4 ? vec3(1.5,.85,.4) : vec3(1.1,1.4,2.);
  } else if (k == 6) { // rcs gas
    c = mix(vec3(2.,2.3,2.8), vec3(.4,.6,1.1), smoothstep(0., .6, a));
    m = .35 * pow(soft, 1.6) * (.45 + .9*n) * pow(1.-a, 1.4);
  } else if (k == 7) { // hull chip: dull
    c = vec3(.5,.45,.38); m = pow(soft, 4.) * (1.-a);
  } else {             // tight hot core puff
    c = vec3(5.,4.4,3.6); m = .25 * pow(soft, 2.5) * pow(1.-a, 2.);
  }
  vec3 col = c * m;
  // phones have no bloom: add a wide faint halo so hot things still read as glowing
  col += uGlow * c * m * .6 * pow(soft, .5);
  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SMOKE_FS = `
uniform vec3 uLight; varying vec2 vUv; varying float vA, vSeed, vKind, vStr;
${NOISE}
void main(){
  float r = length(vUv); if (r > 1.) discard;
  float n = vn(vUv*1.8 + vSeed*23. + vA*1.2)*.6 + vn(vUv*4.2 - vSeed*9.)*.4;
  float m = pow(1. - smoothstep(0., 1., r + (n-.5)*.5), 1.4);
  float al = m * .14 * pow(1.-vA, 1.3) * smoothstep(0., .08, vA);
  // fresh smoke is lit from inside by the plume, then cools to sunlit grey
  vec3 c = mix(vec3(.7,.35,.18), uLight, smoothstep(0., .25, vA)) * (.7 + .5*n);
  gl_FragColor = vec4(c, al);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const HAZE_FS = `
varying vec2 vUv; varying float vA, vSeed, vKind, vStr;
${NOISE}
void main(){
  float r = length(vUv); if (r > 1.) discard;
  float t = vA * 3. + vSeed * 10.;
  vec2 o = vec2(vn(vUv*3. + vec2(t, 0.)), vn(vUv*3. + vec2(0., t) + 5.)) - .5;
  float m = pow(1. - smoothstep(0., 1., r), 2.) * sin(3.1416 * vA);
  gl_FragColor = vec4(o * m, 0., 0.);
}`;

export class GpuParticles {
  constructor(max, mode = 'add', opts = {}) {
    this.max = max; this.head = 0; this.lo = Infinity; this.hi = -1; this.wrapped = false;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.aP0 = mk(3); this.aV = mk(3); this.aT = mk(4); this.aX = mk(4);
    this.aT.array.fill(-1e6);                   // all dead: born long ago
    for (let i = 0; i < max; i++) this.aT.array[i * 4 + 1] = 1;
    g.setAttribute('aP0', this.aP0); g.setAttribute('aV', this.aV); g.setAttribute('aT', this.aT); g.setAttribute('aX', this.aX);
    g.instanceCount = max;
    this.uniforms = { uTime: { value: 0 }, uGlow: { value: opts.glow || 0 }, uLight: { value: new THREE.Color(0.32, 0.31, 0.3) } };
    const blend = mode === 'smoke' ? { blending: THREE.NormalBlending } : mode === 'haze'
      ? { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation }
      : { blending: THREE.AdditiveBlending };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VS, fragmentShader: mode === 'smoke' ? SMOKE_FS : mode === 'haze' ? HAZE_FS : FS,
      transparent: true, depthWrite: false, depthTest: mode !== 'haze', ...blend,
    }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = mode === 'smoke' ? 4 : 6;
  }

  // p, v: Vector3 (world); t0: birth time on the shared fx clock
  emit(p, v, t0, life, s0, s1, kind, drag = 0, stretch = 0) {
    const i = this.head; this.head++; if (this.head >= this.max) { this.head = 0; this.wrapped = true; }
    this.aP0.array[i * 3] = p.x; this.aP0.array[i * 3 + 1] = p.y; this.aP0.array[i * 3 + 2] = p.z;
    this.aV.array[i * 3] = v.x; this.aV.array[i * 3 + 1] = v.y; this.aV.array[i * 3 + 2] = v.z;
    this.aT.array.set([t0, life, s0, s1], i * 4);
    this.aX.array.set([drag, stretch, Math.random(), kind], i * 4);
    if (i < this.lo) this.lo = i; if (i > this.hi) this.hi = i;
  }

  update(time) {
    this.uniforms.uTime.value = time;
    if (this.hi < 0) return;
    let lo = this.lo, hi = this.hi;
    if (this.wrapped) { lo = 0; hi = this.max - 1; }
    for (const a of [this.aP0, this.aV, this.aT, this.aX]) {
      a.clearUpdateRanges(); a.addUpdateRange(lo * a.itemSize, (hi - lo + 1) * a.itemSize); a.needsUpdate = true;
    }
    this.lo = Infinity; this.hi = -1; this.wrapped = false;
  }
}

// Screen-space heat shimmer: haze particles write signed UV offsets into a half-res target,
// then the frame is resampled through it. Desktop only.
export class HeatHazePass extends Pass {
  constructor(hazeScene, camera, strength = 0.008) {
    super();
    this.hazeScene = hazeScene; this.camera = camera;
    this.rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tHaze: { value: this.rt.texture }, uStrength: { value: strength } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }',
      fragmentShader: `uniform sampler2D tDiffuse, tHaze; uniform float uStrength; varying vec2 vUv;
        void main(){ vec2 o = texture2D(tHaze, vUv).rg * uStrength; gl_FragColor = texture2D(tDiffuse, vUv + o); }`,
      depthTest: false, depthWrite: false,
    }));
    this._c = new THREE.Color();
  }
  setSize(w, h) { this.rt.setSize(Math.max(2, w >> 1), Math.max(2, h >> 1)); }
  render(renderer, writeBuffer, readBuffer) {
    renderer.getClearColor(this._c); const ca = renderer.getClearAlpha(), bg = this.hazeScene.background;
    renderer.setRenderTarget(this.rt); renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false);
    renderer.render(this.hazeScene, this.camera);
    renderer.setClearColor(this._c, ca);
    this.quad.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}
