import * as THREE from 'three';

// Backdrop: a dim Milky Way band with dust lanes, a real-feeling starfield, the sun with a soft glare,
// and the planet below with continents, clouds, night-side lights and an atmosphere limb.
// Palette stays in docs/identity.md: slate planet, bone clouds, warm sun, amber city lights.

let seed = 4242;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const NOISE = /* glsl */`
  float h13(vec3 p){ p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(mix(h13(i), h13(i + vec3(1,0,0)), f.x), mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), f.x), mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm(vec3 p, int o){ float a = .5, s = 0.; for (int i = 0; i < 8; i++){ if (i >= o) break; s += a * vn(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
`;

export const GALAXY = new THREE.Vector3(0.35, 0.82, -0.45).normalize();   // galactic pole

export function buildSky(sunDir, { coarse = false } = {}) {
  const sky = new THREE.Group();

  // ---- Milky Way + faint nebula dust, drawn on a dome that follows the camera -------------
  const dome = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uG: { value: GALAXY }, uSun: { value: sunDir } },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `varying vec3 vD; uniform vec3 uG, uSun; ${NOISE}
      void main(){
        vec3 d = normalize(vD);
        float b = dot(d, uG);
        float band = exp(-b * b * 22.);
        float core = exp(-b * b * 90.);
        float n = fbm(d * 3.5, 5), lanes = smoothstep(.45, .7, fbm(d * 7. + 3., 5));
        vec3 col = vec3(.11, .12, .14) * band * (.5 + n) * (1. - lanes * core * .85);
        col += vec3(.20, .16, .12) * core * n * (1. - lanes * .9);
        // two faint, desaturated nebula clouds off the band
        float neb = smoothstep(.55, .9, fbm(d * 2.2 + 9., 5));
        col += mix(vec3(.05, .09, .11), vec3(.13, .06, .04), smoothstep(.2, .8, fbm(d * 4. + 1., 3))) * neb * .9;
        // warm haze around the sun
        float s = max(0., dot(d, uSun));
        col += vec3(1., .78, .52) * (pow(s, 600.) * 2.5 + pow(s, 40.) * .05);
        gl_FragColor = vec4(col * .2, 1.);
      }`,
  }));
  dome.renderOrder = -10; dome.frustumCulled = false;
  sky.add(dome);

  // ---- stars: power-law brightness, colour temperature, a third crowd the galactic band ------
  const N = coarse ? 4500 : 9000;
  const p = new Float32Array(N * 3), c = new Float32Array(N * 3), s = new Float32Array(N);
  const v = new THREE.Vector3(), tmp = new THREE.Vector3();
  const temps = [[0.62, 0.74, 1], [0.8, 0.86, 1], [1, 0.97, 0.92], [1, 0.88, 0.7], [1, 0.72, 0.5]];
  for (let i = 0; i < N; i++) {
    const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    v.set(r * Math.cos(t), u, r * Math.sin(t));
    if (rnd() < 0.35) { v.addScaledVector(GALAXY, -v.dot(GALAXY) * (0.85 + rnd() * 0.15)).normalize(); }
    p.set(tmp.copy(v).multiplyScalar(8000).toArray(), i * 3);
    const m = Math.pow(rnd(), 9);                               // most faint, a few very bright
    const b = 0.18 + m * 3.2;
    const k = temps[Math.min(4, Math.floor(Math.pow(rnd(), 0.8) * 5))];
    c.set([k[0] * b, k[1] * b, k[2] * b], i * 3);
    s[i] = 1.2 + m * 3.5;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(p, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(c, 3));
  sg.setAttribute('size', new THREE.BufferAttribute(s, 1));
  const stars = new THREE.Points(sg, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uPR: { value: 1 } },
    vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float uPR;
      void main(){ vC = color; gl_PointSize = size * uPR; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord - .5) * 2.; float a = exp(-d * d * 5.); gl_FragColor = vec4(vC * a, 1.); }`,
  }));
  stars.frustumCulled = false; stars.renderOrder = -9;
  sky.add(stars);

  // ---- sun: hot disc and a wide soft glare (the bloom and lens ghosts in post do the rest) ----
  const sunPos = sunDir.clone().multiplyScalar(7000);
  const disc = new THREE.Mesh(new THREE.SphereGeometry(70, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.93, 0.8).multiplyScalar(40), fog: false }));
  disc.position.copy(sunPos); sky.add(disc);
  const glareTex = (() => {
    const C = document.createElement('canvas'); C.width = C.height = 256; const x = C.getContext('2d');
    const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,240,215,1)'); g.addColorStop(0.08, 'rgba(255,220,170,.55)'); g.addColorStop(0.3, 'rgba(255,170,110,.12)'); g.addColorStop(1, 'rgba(255,150,90,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(C);
  })();
  const glare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glareTex, color: new THREE.Color(3, 2.7, 2.3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  glare.position.copy(sunPos); glare.scale.setScalar(2600); sky.add(glare);

  return { sky, stars, sunPos };
}

export function buildPlanet(sunDir, { radius = 5200, coarse = false } = {}) {
  const g = new THREE.Group();
  const surf = new THREE.Mesh(new THREE.SphereGeometry(radius, coarse ? 96 : 160, coarse ? 64 : 110), new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir }, uTime: { value: 0 }, uR: { value: radius }, uC: { value: new THREE.Vector3() } },
    vertexShader: `varying vec3 vN; varying vec3 vW; varying vec3 vO;
      void main(){ vO = normalize(position); vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vW; varying vec3 vO; uniform vec3 uSun, uC; uniform float uTime, uR; ${NOISE}
      void main(){
        vec3 o = vO, n = normalize(vN), V = normalize(cameraPosition - vW);
        float dist = length(cameraPosition - vW);
        int oc = ${coarse ? 6 : 8};
        // continents with domain warp, eroded edges
        vec3 q = o * 9.;
        vec3 w = vec3(fbm(q + 1.7, 4), fbm(q + 8.3, 4), fbm(q + 4.1, 4));
        float h = fbm(q * 1.3 + w * 1.6, oc);
        float detail = fbm(o * 320., 4);
        float land = smoothstep(.5, .53, h + (detail - .5) * .05);
        float mtn = smoothstep(.58, .75, h + (detail - .5) * .1);
        vec3 ocean = mix(vec3(.010, .028, .040), vec3(.02, .06, .075), smoothstep(.5, .4, h));
        vec3 ground = mix(vec3(.045, .05, .045), vec3(.12, .095, .07), smoothstep(.35, .65, fbm(o * 40. + w * 3., 5)));
        ground = mix(ground, vec3(.15, .12, .09), smoothstep(.55, .7, fbm(o * 110., 4)) * .6);
        ground = mix(ground, vec3(.07, .07, .065), mtn);
        ground *= .8 + .4 * detail;
        vec3 col = mix(ocean, ground, land);
        // clouds: two layers drifting slowly, with thin wisps near the camera
        vec3 cq = o * 14. + vec3(uTime * .004, 0., 0.);
        vec3 cw = vec3(fbm(cq * 1.5, 3), fbm(cq * 1.5 + 5., 3), 0.);
        float cl = smoothstep(.56, .8, fbm(cq + cw * 1.2, oc));
        cl = max(cl, smoothstep(.6, .82, fbm(o * 70. + cw, 5)) * .45);
        cl *= .85 + .15 * fbm(o * 400., 3);
        // light: wrapped lambert, with a warm band along the terminator
        float ndl = dot(n, uSun);
        float day = smoothstep(-.12, .25, ndl);
        float term = exp(-pow((ndl - .02) * 7., 2.));
        vec3 sunC = mix(vec3(1., .55, .3), vec3(1., .95, .88), smoothstep(0., .35, ndl));
        vec3 lit = col * max(ndl, 0.) * sunC * 1.7;
        // ocean glint
        vec3 H = normalize(uSun + V);
        lit += (1. - land) * vec3(1., .9, .75) * pow(max(dot(n, H), 0.), 220.) * 3. * day;
        // clouds over the top with their own lighting
        vec3 cloudC = vec3(.62, .61, .58) * (max(ndl, 0.) * 1.4 * sunC + .01);
        lit = mix(lit, cloudC, cl * .85);
        // night side: sparse amber city lights on land, dimmed under cloud
        float city = smoothstep(.78, .95, fbm(o * 900., 3)) * smoothstep(.55, .75, fbm(o * 60. + 2., 3));
        lit += vec3(1., .62, .3) * city * land * (1. - smoothstep(-.15, .05, ndl)) * (1. - cl) * 1.4;
        lit += vec3(1., .45, .2) * term * .05 * (1. - cl * .5);
        // aerial perspective: haze toward the limb, blue by day, rust at the terminator
        float fr = pow(1. - clamp(dot(n, V), 0., 1.), 5.);
        vec3 haze = mix(vec3(.10, .2, .3), vec3(.7, .35, .18), term) * smoothstep(-.25, .3, ndl);
        lit = mix(lit, haze * 1.2, clamp(fr * .75, 0., .75) * smoothstep(-.3, .1, ndl));
        gl_FragColor = vec4(lit, 1.);
      }`,
  }));
  g.add(surf);

  // atmosphere limb: back faces of a slightly larger shell, density from the ray's closest approach
  const atmR = radius * 1.035;
  const atm = new THREE.Mesh(new THREE.SphereGeometry(atmR, 128, 64), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uSun: { value: sunDir }, uR: { value: radius }, uA: { value: atmR }, uC: { value: new THREE.Vector3() } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying vec3 vW; uniform vec3 uSun, uC; uniform float uR, uA;
      void main(){
        vec3 ro = cameraPosition, rd = normalize(vW - ro);
        float t = max(0., dot(uC - ro, rd));
        vec3 cp = ro + rd * t;
        float d = length(cp - uC);
        float alt = clamp((d - uR) / (uA - uR), 0., 1.);
        float dens = exp(-alt * 4.5) * (1. - alt);
        vec3 nrm = normalize(cp - uC);
        float ndl = dot(nrm, uSun);
        float lit = smoothstep(-.35, .25, ndl);
        float term = exp(-pow((ndl + .05) * 5., 2.));
        float fwd = pow(max(dot(rd, uSun), 0.), 6.);                 // forward scatter toward the sun
        vec3 col = mix(vec3(.18, .42, .75), vec3(1., .48, .2), term * .85) * lit + vec3(1., .7, .45) * fwd * lit * .8;
        gl_FragColor = vec4(col * dens * 1.25, 1.);
      }`,
  }));
  g.add(atm);
  g.userData = { surf, atm };
  return g;
}

export function placePlanet(planet, pos) {
  planet.position.copy(pos);
  planet.userData.surf.material.uniforms.uC.value.copy(pos);
  planet.userData.atm.material.uniforms.uC.value.copy(pos);
}
