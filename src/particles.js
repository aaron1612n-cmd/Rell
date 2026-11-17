import * as THREE from 'three';

// One additive Points object, CPU-simulated pool. Used for exhaust, sparks, debris puffs.
export class Particles {
  constructor(max = 700) {
    this.max = max; this.n = 0; this.head = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.ttl = new Float32Array(max);
    this.s0 = new Float32Array(max); this.c0 = new Float32Array(max * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    this.uniforms = { uScale: { value: 400 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying float vA; varying vec3 vC; uniform float uScale;
        void main(){ vA=alpha; vC=color; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=size*uScale/-mv.z; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying float vA; varying vec3 vC;
        void main(){ float d=length(gl_PointCoord-.5)*2.; float a=smoothstep(1.,0.,d); gl_FragColor=vec4(vC*a*vA, a*vA); }`,
    }));
    this.points.frustumCulled = false;
    for (let i = 0; i < max; i++) this.alpha[i] = 0;
  }

  emit(p, v, ttl, size, color) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.life[i] = ttl; this.ttl[i] = ttl; this.s0[i] = size;
    this.c0[i * 3] = color.r; this.c0[i * 3 + 1] = color.g; this.c0[i * 3 + 2] = color.b;
  }

  update(dt, height, pixelRatio) {
    this.uniforms.uScale.value = height * pixelRatio * 0.5;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.ttl[i]);
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alpha[i] = t; this.size[i] = this.s0[i] * (0.4 + 0.6 * t);
      this.col[i * 3] = this.c0[i * 3]; this.col[i * 3 + 1] = this.c0[i * 3 + 1]; this.col[i * 3 + 2] = this.c0[i * 3 + 2];
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = true;
  }
}
