import * as THREE from 'three';

// Main-engine exhaust as a ray-marched volume, not sprites or a flat ribbon.
// A unit cylinder (local +Z downstream, z=0 on the nozzle exit plane) is scaled to the plume's bounds in
// the vertex shader; the fragment shader marches the view ray through it and integrates emission from an
// analytic jet: a white-hot core that necks into a train of shock diamonds, a turbulent orange mantle
// that widens and cools downstream, and a ragged cold edge eaten by scrolling 3D noise. Drawn back faces
// only, additive, no depth write, so it works from outside, from the chase cam looking up the jet, and
// with the camera inside it.
//
// NaN safety (some Windows drivers turned earlier NaNs into black blocks): every sqrt/pow/normalize/
// division below has a clamped or epsilon-guarded argument, and the result is clamped before output.

const VS = `
uniform float uLen, uRad;
varying vec3 vPos; varying vec3 vCam;
void main(){
  vec3 p = position * vec3(uRad, uRad, uLen);
  vPos = p;
  vCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
}`;

const FS = `
uniform float uTime, uPower, uBoost, uLen, uRad, uR0, uSeed, uIgn;
uniform vec3 uTint;
varying vec3 vPos; varying vec3 vCam;

float h3(vec3 p){ p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float n3(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = .5, s = 0.; for (int i = 0; i < OCT; i++){ s += a * n3(p); p = p * 2.07 + vec3(3.1, 7.7, 1.3); a *= .5; } return s; }

// blackbody-ish ramp: deep red -> orange -> yellow -> white -> (boost) blue-white
vec3 heat(float t, float b){
  t = clamp(t, 0., 1.6);
  vec3 c = mix(vec3(.35, .03, .01), vec3(1.6, .32, .04), smoothstep(0., .3, t));
  c = mix(c, vec3(2.4, 1.15, .3), smoothstep(.25, .6, t));
  c = mix(c, vec3(3., 2.5, 1.7), smoothstep(.55, .95, t));
  c = mix(c, mix(vec3(3.4, 3.2, 3.), vec3(2.3, 2.9, 4.2), b), smoothstep(.95, 1.5, t));
  return c;
}

void main(){
  vec3 ro = vCam, rd = vPos - vCam;
  float rl = length(rd); rd = rl > 1e-5 ? rd / rl : vec3(0., 0., 1.);
  // ray vs the bounding cylinder r = uRad, z in [0, uLen]
  float a = dot(rd.xy, rd.xy), b = dot(ro.xy, rd.xy), c = dot(ro.xy, ro.xy) - uRad * uRad;
  float t0 = 0., t1 = rl;
  if (a > 1e-7) {
    float disc = b * b - a * c;
    if (disc <= 0.) discard;
    float s = sqrt(max(disc, 0.));
    t0 = (-b - s) / a; t1 = (-b + s) / a;
  } else if (c > 0.) discard;
  if (abs(rd.z) > 1e-6) {
    float za = (0. - ro.z) / rd.z, zb = (uLen - ro.z) / rd.z;
    t0 = max(t0, min(za, zb)); t1 = min(t1, max(za, zb));
  } else if (ro.z < 0. || ro.z > uLen) discard;
  t0 = max(t0, 0.); t1 = min(t1, rl + 1e-3);
  if (t1 <= t0) discard;

  float dt = (t1 - t0) / float(STEPS);
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));   // stable dither hides step banding
  vec3 col = vec3(0.); float tau = 0.;
  float flow = uTime * (9. + 7. * uBoost);
  for (int i = 0; i < STEPS; i++){
    vec3 p = ro + rd * (t0 + (float(i) + jit) * dt);
    float v = clamp(p.z / max(uLen, 1e-3), 0., 1.);
    float r = length(p.xy);
    // ignition: the jet sputters out in surges, each one a ragged lump of hot gas that races downstream
    if (uIgn > .01) {
      float surge = uIgn * (.5 + .5 * sin(p.z * 5. / max(uR0, .1) - uTime * 38.)) * n3(vec3(p.xy * 2., uTime * 7.) + uSeed);
      v = clamp(v + surge * .35, 0., 1.);
    }
    // jet radius: leaves the nozzle at R0, swells (underexpanded in vacuum), ragged by turbulence
    float R = uR0 * (1. + v * (1.7 + .5 * uBoost) + .35 * sqrt(v));
    vec3 q = vec3(p.xy / max(uR0, 1e-3) * .8, p.z * .85 - flow * .55) + uSeed;
    float n = fbm(q);
    float edge = R * (.75 + .5 * n);
    float mantle = 1. - smoothstep(edge * .35, edge, r);
    mantle *= pow(1. - v, 1.25) * smoothstep(0., .05, v);
    mantle *= (.45 + 1.1 * n) * (1. + .5 * uBoost);
    // the core: narrow white-hot spine that necks and bulges through shock cells
    float cells = 4. + 2. * uBoost;
    float ph = v * cells, cell = fract(ph), k = floor(ph);
    float neck = .55 + .45 * abs(cell * 2. - 1.);            // 1 at cell ends, .55 at the waist
    float rc = uR0 * (.62 * neck) * (1. - v * .5);
    float core = 1. - smoothstep(rc * .25, rc, r);
    float diam = smoothstep(.5, .9, 1. - abs(cell - .7) * 3.) * exp(-k * .45);   // bright disk after each waist
    core *= exp(-v * (3.2 - 1.6 * uBoost)) * (1. + diam * (1.4 + 1.6 * uBoost));
    // emission: temperature from core + proximity to the nozzle, density from mantle + core
    float T = core * 1.25 + mantle * (1. - v) * .55 + (1. - smoothstep(0., .18, v)) * mantle * .5;
    float d = mantle * .9 + core * 2.4;
    // cool fringe: a violet-blue sheath hugging the edge where the gas thins out, red at the very ragged rim
    float fr = smoothstep(.45, 1., r / max(edge, 1e-3)) * (1. - smoothstep(.9, 1.5, r / max(edge, 1e-3)));
    float sheath = fr * (1. - v) * (.35 + .65 * n) * pow(1. - v, 1.2) * 1.4;
    // faint streaky shimmer: stretched noise standing in for the heat-hazed air round the jet
    float haze = 0.;
#if HAZE
    haze = (1. - smoothstep(R * 1.1, R * 2.4, r)) * smoothstep(R * .4, R * 1.1, r) * n3(vec3(p.xy * 3. / max(uR0, .1), p.z * .25 / max(uR0, .1) - flow * .3) + uSeed) * (1. - v * .6) * .22;
#endif
    vec3 e = heat(T, uBoost) * d + mix(vec3(.5, .22, .9), vec3(.25, .55, 1.4), uBoost) * (sheath + haze * .6) + vec3(1.1, .5, .2) * haze * .5
           + vec3(2.4, 2., 1.5) * uIgn * (1. - smoothstep(0., .22, v)) * (1. - smoothstep(0., uR0 * 1.8, r));
    d += sheath * .5 + haze * .3;
    col += e * exp(-tau) * dt;
    tau += d * dt * .55;                                     // self-shadowing: far side of a dense jet dims
  }
  col *= uTint * uPower * (3.0 / max(uRad, .2));
  col = clamp(col, 0., 8.);
  float lum = dot(col, vec3(.3, .5, .2));
  gl_FragColor = vec4(col, clamp(lum, 0., 1.));
}`;

const cylGeo = (() => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 20, 1, false);
  g.rotateX(Math.PI / 2); g.translate(0, 0, 0.5);           // axis +Z, z in [0,1]
  return g;
})();

export class Exhaust extends THREE.Mesh {
  constructor({ coarse = false } = {}) {
    const u = { uTime: { value: 0 }, uPower: { value: 0 }, uBoost: { value: 0 }, uLen: { value: 1 }, uRad: { value: 0.5 }, uR0: { value: 0.22 }, uSeed: { value: Math.random() * 20 }, uIgn: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) } };
    super(cylGeo, new THREE.ShaderMaterial({
      uniforms: u, vertexShader: VS, fragmentShader: FS,
      defines: { STEPS: coarse ? 18 : 28, OCT: coarse ? 2 : 3, HAZE: coarse ? 0 : 1 },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    }));
    this.u = u; this.frustumCulled = false; this.renderOrder = 5; this.visible = false;
  }
  // power 0..1, len (m), nozzle radius r0 (m), boost 0..1
  set(power, len, r0, boost) {
    this.visible = power > 0.015 && len > 0.05;
    if (!this.visible) return;
    const u = this.u; u.uPower.value = power; u.uLen.value = len; u.uR0.value = r0; u.uBoost.value = boost;
    u.uRad.value = r0 * (1 + 1.7 + 0.5 * boost + 0.35) * 1.3;   // bounds of the swollen, ragged jet
  }
  tick(t) { this.u.uTime.value = t; }
  // 0..1 ignition flare (decays in the caller); tint rescales the colour of the fire per drive type
  ignite(v) { this.u.uIgn.value = v; }
  tint(r, g, b) { this.u.uTint.value.set(r, g, b); }
}
