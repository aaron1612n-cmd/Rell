import * as THREE from 'three';

// Soft volumetric-looking exhaust: no solid geometry. Two camera-aware quads per plume:
//  - a ribbon that pivots about the exhaust axis to always face the camera, shaded as a noise-driven gas jet
//  - a round halo at the nozzle that takes over when the plume points at the lens (chase cam)
// Everything is additive, alpha fades to zero before any quad edge, so no hard outline shows from any angle.
const NOISE = `
float h(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<OCT;i++){ s+=a*vn(p); p=p*2.03+vec2(7.1,3.7); a*=.5; } return s; }
`;

const RIBBON_VS = `
uniform float uLen, uWidth; varying vec2 vUv; varying float vFace;
void main(){
  vUv = vec2(position.x, position.y);
  vec3 ax = normalize((modelViewMatrix*vec4(0.,0.,1.,0.)).xyz);
  vec3 o = (modelViewMatrix*vec4(0.,0.,0.,1.)).xyz;
  vec3 vd = normalize(o);
  vFace = abs(dot(ax, vd));
  vec3 side = normalize(cross(ax, vd) + 1e-5);
  float w = uWidth*(0.7+0.9*position.y);
  vec3 p = o + ax*uLen*position.y + side*position.x*w;
  gl_Position = projectionMatrix*vec4(p,1.);
}`;

const RIBBON_FS = `
uniform float uTime, uPower, uBoost, uSeed; uniform vec3 uHot, uMid, uCool; varying vec2 vUv; varying float vFace;
${NOISE}
void main(){
  float v=vUv.y, u=vUv.x;
  float n = fbm(vec2(u*1.6+uSeed, v*3.2 - uTime*5.5));
  float n2 = vn(vec2(u*3.+uSeed*2., v*6. - uTime*9.));
  float turb = (n-.5)*.9 + (n2-.5)*.25;
  float r = abs(u) + turb*(.15+.6*v);                 // ragged edge, more so downstream
  float R = mix(.5,.32,v);                              // gas column narrows as it cools and fades
  float body = (1.-smoothstep(R*.15, R, r));
  float fadeV = pow(1.-v, 1.4) * smoothstep(0.,.06,v);
  float core = (1.-smoothstep(0., R*.55, r)) * pow(1.-v, 2.2);
  // shock diamonds on boost: a train of bright lozenges on the axis, fading downstream
  float dz = v / .55, seg = fract(dz * 5.), di = floor(dz * 5.);
  float dw = .26 * (1. - abs(seg * 2. - 1.)) * (1. - di * .14);
  float dia = (1. - smoothstep(dw * .55, dw, abs(u))) * step(dz, 1.) * (1. - dz * .6) * uBoost;
  dia *= .75 + .25 * sin(uTime * 40. + di * 2.);
  float d = body*fadeV*(.9+.7*n)*1.05 + dia*1.6;
  float heat = clamp(core*1.6 + dia*.8 + (1.-v)*.25, 0., 1.);
  vec3 col = mix(uCool, uMid, smoothstep(.0,.35,heat));
  col = mix(col, uHot, smoothstep(.35,.9,heat));
  col = mix(col, vec3(1.6,1.75,2.1), clamp(dia, 0., 1.));
  float a = (d + core*.55) * uPower;
  a *= 1. - vFace*vFace*.85;                            // hand over to the halo when looking down the jet
  gl_FragColor = vec4(col*a, a);
}`;

const HALO_VS = `
uniform float uSize, uOff; varying vec2 vUv; varying float vFace;
void main(){
  vUv = position.xy;
  vec3 ax = normalize((modelViewMatrix*vec4(0.,0.,1.,0.)).xyz);
  vec3 o = (modelViewMatrix*vec4(0.,0.,0.,1.)).xyz;
  vFace = abs(dot(ax, normalize(o)));
  vec3 c = o + ax*uOff;
  gl_Position = projectionMatrix*vec4(c + vec3(position.xy*uSize, 0.), 1.);
}`;

const HALO_FS = `
uniform float uTime, uPower, uSeed; uniform vec3 uHot, uMid; varying vec2 vUv; varying float vFace;
${NOISE}
void main(){
  float r = length(vUv);
  float n = fbm(vUv*2.2 + vec2(uSeed, -uTime*4.));
  float rr = r + (n-.5)*.35;
  float g = pow((1.-smoothstep(0.,1.,rr)), 2.);
  float c = pow((1.-smoothstep(0.,.5,rr)), 2.);
  float a = (g*(.18 + .5*vFace*vFace) + c*.4) * uPower;
  vec3 col = mix(uMid, uHot, c);
  gl_FragColor = vec4(col*a, a);
}`;

const ribbonGeo = (() => {
  const g = new THREE.BufferGeometry();
  const S = 6, pos = [], idx = [];
  for (let i = 0; i <= S; i++) { const y = i / S; pos.push(-1, y, 0, 1, y, 0); }
  for (let i = 0; i < S; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  return g;
})();
const haloGeo = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3)); g.setIndex([0, 1, 2, 1, 3, 2]);
  return g;
})();

const common = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide };
export const PALETTE = {
  engine: { hot: [1.0, 0.97, 0.9], mid: [1.0, 0.55, 0.18], cool: [0.55, 0.12, 0.04] },
  boost: { hot: [0.85, 0.93, 1.0], mid: [0.95, 0.6, 0.35], cool: [0.5, 0.18, 0.1] },
  rcs: { hot: [0.9, 0.96, 1.0], mid: [0.55, 0.75, 1.0], cool: [0.2, 0.35, 0.7] },
};

// The plume points along its local +Z. Mount it with the group's orientation.
export class Plume extends THREE.Group {
  constructor(palette = PALETTE.engine, { octaves = 3 } = {}) {
    super();
    this.palette = palette; this.seed = Math.random() * 20;
    const defs = { OCT: octaves };
    const u = { uTime: { value: 0 }, uPower: { value: 0 }, uBoost: { value: 0 }, uSeed: { value: this.seed }, uLen: { value: 1 }, uWidth: { value: 0.3 },
      uHot: { value: new THREE.Color(...palette.hot) }, uMid: { value: new THREE.Color(...palette.mid) }, uCool: { value: new THREE.Color(...palette.cool) } };
    this.ribbon = new THREE.Mesh(ribbonGeo, new THREE.ShaderMaterial({ ...common, defines: defs, uniforms: u, vertexShader: RIBBON_VS, fragmentShader: RIBBON_FS }));
    const hu = { uTime: u.uTime, uPower: u.uPower, uSeed: u.uSeed, uHot: u.uHot, uMid: u.uMid, uSize: { value: 0.4 }, uOff: { value: 0.1 } };
    this.halo = new THREE.Mesh(haloGeo, new THREE.ShaderMaterial({ ...common, defines: defs, uniforms: hu, vertexShader: HALO_VS, fragmentShader: HALO_FS }));
    this.ribbon.frustumCulled = this.halo.frustumCulled = false;
    this.ribbon.renderOrder = this.halo.renderOrder = 5;
    this.add(this.ribbon, this.halo); this.u = u; this.hu = hu; this.visible = false;
  }
  // power 0..1, len/width in metres, boost 0..1
  set(power, len, width, boost = 0, haloScale = 1) {
    this.visible = power > 0.015;
    if (!this.visible) return;
    const u = this.u; u.uPower.value = power; u.uLen.value = len; u.uWidth.value = width; u.uBoost.value = boost;
    const p = boost > 0.5 ? PALETTE.boost : this.palette;
    if (this.palette === PALETTE.engine) { u.uHot.value.set(...p.hot); u.uMid.value.set(...p.mid); u.uCool.value.set(...p.cool); }
    this.hu.uSize.value = width * 1.7 * haloScale; this.hu.uOff.value = len * 0.06;
  }
  tick(t) { this.u.uTime.value = t; }
}
