import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// The game's "camera and film": light rig, reflection environment, tone mapping and the post chain.
// Desktop: MSAA, bloom, lens ghosts, chromatic fringe, grain. Phones: grade + vignette only.

export function setupLights(scene, renderer, sunDir, coarse) {
  renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = 0.95;
  // key: hard low sun. Shadow box is wide enough to put the ship's shadow on the station when close.
  const sun = new THREE.DirectionalLight(0xffe4c2, 4.2);
  const SH = coarse ? 2048 : 4096;
  sun.castShadow = true; sun.shadow.mapSize.set(SH, SH);
  Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 1, far: 700 });
  sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.18; sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  // fill: black sky above, cool slate bounce from the planet below
  scene.add(new THREE.HemisphereLight(0x0c1016, 0x2c4554, 0.55));
  // rim: thin cold light from behind the subject, opposite the sun, picks out silhouettes on the dark side
  const rim = new THREE.DirectionalLight(0x8fb4d6, 0.9);
  rim.position.copy(sunDir).multiplyScalar(-1).add(new THREE.Vector3(0, -0.4, 0)); scene.add(rim);

  // reflection environment: black space, planet glow below with a bright limb band, the sun
  const env = new THREE.Scene(), g = new THREE.SphereGeometry(50, 64, 32);
  const col = new Float32Array(g.attributes.position.count * 3), c = new THREE.Color(), d = new THREE.Vector3();
  for (let i = 0; i < g.attributes.position.count; i++) {
    d.fromBufferAttribute(g.attributes.position, i).normalize();
    const y = d.y, lit = Math.max(0, d.dot(sunDir)) * 0.5 + 0.5;
    c.setRGB(0.004, 0.006, 0.009);
    if (y < -0.3) c.setRGB(0.05, 0.075, 0.09).multiplyScalar(lit * 1.4);                         // planet face
    const limb = Math.exp(-Math.pow((y + 0.3) * 9, 2));
    c.r += limb * 0.55 * lit; c.g += limb * 0.6 * lit; c.b += limb * 0.75 * lit;                // atmosphere band
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  env.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const disc = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(60, 50, 38) }));
  disc.position.copy(sunDir).multiplyScalar(40); env.add(disc);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(env, 0.0).texture; scene.environmentIntensity = 0.8; pm.dispose();
  scene.background = new THREE.Color(0x020305);
  return { sun, rim };
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uSun: { value: new THREE.Vector3(0.5, 0.5, 0) }, uFull: { value: 1 }, uAspect: { value: 1 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse; uniform float uTime, uFull, uAspect; uniform vec2 uRes; uniform vec3 uSun;
    float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    vec3 ghost(vec2 uv, vec2 c, float r, vec3 tint){ vec2 d = uv - c; d.x *= uAspect; float l = length(d); return tint * smoothstep(r, r * .7, l) * (.6 + .4 * smoothstep(r * .5, r, l)); }
    void main(){
      vec2 uv = vUv, cc = uv - .5;
      float r2 = dot(cc, cc);
      vec3 col;
      if (uFull > .5) {                               // chromatic fringe, only toward the corners
        vec2 off = cc * r2 * .006;
        col = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
      } else col = texture2D(tDiffuse, uv).rgb;

      // lens ghosts from the sun, gated by how bright the sun pixel actually is (so the station blocks them)
      if (uSun.z > 0.) {
        vec2 s = uSun.xy; float vis = 0.;
        for (int i = 0; i < 5; i++){ vec2 o = vec2(float(i - 2) * 2., float((i * 3) % 5 - 2) * 2.) / uRes; vis += smoothstep(.75, .98, dot(texture2D(tDiffuse, s + o).rgb, vec3(.33))); }
        vis = vis / 5. * uSun.z;
        if (vis > .001) {
          vec2 axis = vec2(.5) - s; vec3 g = vec3(0.);
          g += ghost(uv, s + axis * .55, .035, vec3(.9, .5, .25) * .10);
          g += ghost(uv, s + axis * 1.25, .07, vec3(.35, .55, .8) * .06);
          g += ghost(uv, s + axis * 1.6, .02, vec3(1., .7, .4) * .14);
          g += ghost(uv, s + axis * 2.1, .13, vec3(.4, .5, .45) * .035);
          // faint horizontal streak through the sun
          vec2 dv = uv - s; g += vec3(1., .82, .62) * exp(-abs(dv.y) * 900.) * exp(-abs(dv.x) * 4.) * .25;
          col += g * vis;
        }
      }

      // grade: cool slate shadows, warm highlights, gentle S-curve
      float l = dot(col, vec3(.2126, .7152, .0722));
      col = mix(col, col * vec3(.86, .98, 1.1) + vec3(.004, .009, .014), 1. - smoothstep(.0, .45, l));
      col = mix(col, col * vec3(1.06, 1.0, .9), smoothstep(.5, 1., l));
      col = mix(col, col * col * (3. - 2. * col), .22);
      // vignette
      col *= mix(1., smoothstep(.95, .2, r2 * 1.6), .55);
      // film grain in the mids
      if (uFull > .5) { float n = hash(uv * uRes + fract(uTime * 13.7) * 100.) - .5; col += n * .035 * (1. - abs(l - .4) * 1.4); }
      gl_FragColor = vec4(col, 1.);
    }`,
};

export class Look {
  constructor(renderer, scene, camera, coarse, extra = []) {
    this.renderer = renderer; this.camera = camera; this.coarse = coarse;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: coarse ? 0 : 4 });
    const c = this.composer = new EffectComposer(renderer, rt);
    c.addPass(new RenderPass(scene, camera));
    for (const p of extra) c.addPass(p);
    // bloom only picks up HDR values (exhaust, lamps, sun) so the hull never washes out.
    // Phones skip it: their exhaust particles carry their own halo.
    this.bloom = coarse ? null : new UnrealBloomPass(new THREE.Vector2(512, 512), 0.45, 0.3, 1.0);
    if (this.bloom) {
      // belt and braces: one NaN/Inf pixel fed into the blur chain spreads into a black hole, so scrub them here
      const hp = this.bloom.materialHighPassFilter;
      hp.fragmentShader = hp.fragmentShader.replace('vec4 texel = texture2D( tDiffuse, vUv );',
        'vec4 texel = texture2D( tDiffuse, vUv ); if (any(isnan(texel)) || any(isinf(texel))) texel = vec4(0.); texel = min(texel, vec4(64.));');
      c.addPass(this.bloom);
    }
    c.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.uFull.value = coarse ? 0 : 1;
    c.addPass(this.grade);
  }

  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr); this.composer.setSize(w, h);
    this.grade.uniforms.uRes.value.set(w * pr, h * pr); this.grade.uniforms.uAspect.value = w / h;
  }

  render(time, sunWorld) {
    const u = this.grade.uniforms; u.uTime.value = time;
    const p = _v.copy(sunWorld).project(this.camera);
    const on = p.z < 1 && Math.abs(p.x) < 1.15 && Math.abs(p.y) < 1.15;
    u.uSun.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, on ? 1 : 0);
    this.composer.render();
  }
}
const _v = new THREE.Vector3();
