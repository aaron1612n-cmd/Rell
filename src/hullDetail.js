import * as THREE from 'three';

// Surface detail for the authored models, which ship with vertex colours only (no UVs, no textures).
// A small procedural tile (panel seams + rivets / grime / scratches) is generated once on a canvas and
// projected triplanar in object space, so it sticks to the ship, station chunks and every debris instance.
// It darkens seams, adds grime and bare-metal scratches, varies roughness, and bumps the normal.

let seed = 91;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

function detailTexture(size = 512) {
  const S = size;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return [c, c.getContext('2d')]; };
  // draw a shape at all 9 wrap offsets so the tile repeats seamlessly
  const wrap = (x, f) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { x.save(); x.translate(ox, oy); f(); x.restore(); } };

  // R: height. Recursive panel split, recessed seams, a few raised plates, rivet rows.
  const [hc, h] = mk();
  h.fillStyle = 'rgb(128,128,128)'; h.fillRect(0, 0, S, S);
  const rects = [];
  const split = (x, y, w, hh, d) => {
    if (d > 3 || (d > 1 && rnd() < 0.3) || w < 48 || hh < 48) { rects.push([x, y, w, hh]); return; }
    if ((w > hh) ^ (rnd() < 0.2)) { const k = Math.round(w * (0.3 + rnd() * 0.4)); split(x, y, k, hh, d + 1); split(x + k, y, w - k, hh, d + 1); }
    else { const k = Math.round(hh * (0.3 + rnd() * 0.4)); split(x, y, w, k, d + 1); split(x, y + k, w, hh - k, d + 1); }
  };
  split(0, 0, S, S, 0);
  for (const [x, y, w, hh] of rects) {
    const lv = 118 + rnd() * 22 | 0;
    wrap(h, () => {
      h.fillStyle = `rgb(${lv},${lv},${lv})`; h.fillRect(x + 2, y + 2, w - 4, hh - 4);
      if (rnd() < 0.18 && w > 70 && hh > 70) {   // raised access plate
        const iw = w * 0.5, ih = hh * 0.4; h.fillStyle = 'rgb(160,160,160)'; h.fillRect(x + (w - iw) / 2, y + (hh - ih) / 2, iw, ih);
        h.fillStyle = 'rgb(175,175,175)'; h.fillRect(x + (w - iw) / 2 + 2, y + (hh - ih) / 2 + 2, iw - 4, ih - 4);
      }
      if (rnd() < 0.5) {                          // rivets along the top and bottom edges
        h.fillStyle = 'rgb(190,190,190)';
        for (let px = x + 8; px < x + w - 6; px += 14) { h.beginPath(); h.arc(px, y + 7, 1.8, 0, 7); h.arc(px, y + hh - 7, 1.8, 0, 7); h.fill(); }
      }
    });
  }
  h.strokeStyle = 'rgb(20,20,20)'; h.lineWidth = 2;
  for (const [x, y, w, hh] of rects) wrap(h, () => h.strokeRect(x + 0.5, y + 0.5, w, hh));

  // G: grime. Soft blotches and downward streaks pooling in the seams.
  const [gc, g] = mk();
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) {
    const x = rnd() * S, y = rnd() * S, r = 20 + rnd() * 90, a = 0.08 + rnd() * 0.16;
    wrap(g, () => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); });
  }
  for (let i = 0; i < 160; i++) {
    const x = rnd() * S, y = rnd() * S, l = 20 + rnd() * 120, w = 1 + rnd() * 4;
    wrap(g, () => { const gr = g.createLinearGradient(x, y, x, y + l); gr.addColorStop(0, `rgba(255,255,255,${0.1 + rnd() * 0.2})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x, y, w, l); });
  }

  // B: scratches and chipped paint (bare metal shows through)
  const [bc, b] = mk();
  b.fillStyle = '#000'; b.fillRect(0, 0, S, S); b.lineCap = 'round';
  for (let i = 0; i < 220; i++) {
    const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI, l = 6 + rnd() * 40;
    b.strokeStyle = `rgba(255,255,255,${0.25 + rnd() * 0.6})`; b.lineWidth = 0.6 + rnd() * 1.2;
    wrap(b, () => { b.beginPath(); b.moveTo(x, y); b.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); b.stroke(); });
  }
  for (let i = 0; i < 90; i++) {
    const x = rnd() * S, y = rnd() * S, r = 1 + rnd() * 5;
    b.fillStyle = `rgba(255,255,255,${0.5 + rnd() * 0.5})`;
    wrap(b, () => { b.beginPath(); for (let k = 0; k < 7; k++) { const t = k / 7 * 6.283, rr = r * (0.5 + rnd()); b.lineTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr); } b.fill(); });
  }

  // pack + fine noise
  const out = document.createElement('canvas'); out.width = out.height = S; const o = out.getContext('2d');
  const id = o.createImageData(S, S), D = id.data;
  const H = h.getImageData(0, 0, S, S).data, G = g.getImageData(0, 0, S, S).data, B = b.getImageData(0, 0, S, S).data;
  for (let i = 0; i < S * S; i++) {
    const n = (rnd() - 0.5) * 10;
    D[i * 4] = H[i * 4];
    D[i * 4 + 1] = Math.max(0, Math.min(255, G[i * 4] + Math.max(0, 110 - H[i * 4]) * 0.9 + n));   // grime pools in seams
    D[i * 4 + 2] = B[i * 4];
    D[i * 4 + 3] = 255;
  }
  o.putImageData(id, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

let TEX = null;

// scale: tiles per metre. grime/scratch/bump: strengths.
export function addHullDetail(mat, { scale = 0.35, grime = 0.55, scratch = 0.5, bump = 1.0 } = {}) {
  TEX ||= detailTexture();
  const u = { uDetail: { value: TEX }, uScale: { value: scale }, uGrime: { value: grime }, uScratch: { value: scratch }, uBump: { value: bump } };
  mat.userData.detail = u;
  mat.customProgramCacheKey = () => 'hulldetail';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying vec3 vON;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position; vON = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vOP; varying vec3 vON;
        uniform sampler2D uDetail; uniform float uScale, uGrime, uScratch, uBump;
        vec4 detTri(vec3 p, vec3 n){
          vec3 w = n * n; w *= w * w; w /= max(w.x + w.y + w.z, 1e-6);
          return texture2D(uDetail, p.zy) * w.x + texture2D(uDetail, p.xz + .37) * w.y + texture2D(uDetail, p.xy + .71) * w.z;
        }
        vec3 perturbDet(vec3 sp, vec3 sn, vec2 dH, float fd){
          vec3 sx = dFdx(sp), sy = dFdy(sp), r1 = cross(sy, sn), r2 = cross(sn, sx);
          float det = dot(sx, r1) * fd; vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
          vec3 r = abs(det) * sn - grad; float l = dot(r, r);
          return l > 1e-30 ? r * inversesqrt(l) : sn;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec4 det = detTri(vOP * uScale, vON * inversesqrt(max(dot(vON, vON), 1e-12)));
        float lum = dot(diffuseColor.rgb, vec3(.3,.59,.11));
        float accent = smoothstep(.12, .35, diffuseColor.r - diffuseColor.b);           // hazard paint chips more
        float seam = smoothstep(.25, .0, det.r);
        float grime = det.g * uGrime;
        float scr = det.b * uScratch * (0.6 + accent);
        diffuseColor.rgb *= (1. - seam * .55) * (1. - grime * .55);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.42, .40, .37) * (0.6 + lum), clamp(scr, 0., 1.) * .8);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + grime * .25 - scr * .45 - (det.r - .5) * .15, .2, 1.);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, .9, clamp(scr, 0., 1.));`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float fade = 1. - smoothstep(25., 160., length(vViewPosition));
          // skip the bump where a 2x2 pixel quad straddles a hard edge: the triplanar lookup jumps there
          fade *= 1. - smoothstep(.02, .08, length(fwidth(vON)));
          vec2 dH = vec2(dFdx(det.r), dFdy(det.r)) * uBump * .012 * fade;   // height channel spans ~1.2 cm
          normal = perturbDet(-vViewPosition, normal, dH, faceDirection);
        }`);
  };
  mat.needsUpdate = true;
  return mat;
}
