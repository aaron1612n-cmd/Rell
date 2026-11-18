import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { addHullDetail } from './hullDetail.js';

// The pilot in a work suit, built from primitives: soft fabric limbs with hard bearing rings at the joints,
// a hard upper torso, a smoked visor, and a boxy jetpack with two thruster pods. Bone suit, slate hardware,
// one hazard-orange accent (shoulder bands, cuffs, the tool's emitter), per docs/identity.md.
// Units are metres. The body faces -Z with +Y up; the origin is the centre of the torso.

let fabricTex = null;
function fabric() {
  if (fabricTex) return fabricTex;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  x.fillStyle = 'rgb(128,128,128)'; x.fillRect(0, 0, S, S);
  // weave
  for (let y = 0; y < S; y += 2) for (let i = 0; i < S; i += 4) { x.fillStyle = `rgba(${(i + y) % 8 < 4 ? 255 : 0},${(i + y) % 8 < 4 ? 255 : 0},${(i + y) % 8 < 4 ? 255 : 0},.08)`; x.fillRect(i, y, 4, 2); }
  // quilting seams and a few wrinkles
  x.strokeStyle = 'rgba(0,0,0,.55)'; x.lineWidth = 2;
  for (let y = 0; y < S; y += 64) { x.beginPath(); x.moveTo(0, y + 1); x.lineTo(S, y + 1); x.stroke(); }
  x.strokeStyle = 'rgba(0,0,0,.18)'; x.lineWidth = 5;
  for (let i = 0; i < 18; i++) { const y = Math.random() * S; x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(S * .3, y + 10, S * .6, y - 12, S, y + 3); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); t.colorSpace = THREE.NoColorSpace;
  return (fabricTex = t);
}

function tint(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo;
}

export function suitMaterials(envMap) {
  return {
    suit: new THREE.MeshStandardMaterial({ color: 0xd9d2c0, roughness: 0.86, metalness: 0, bumpMap: fabric(), bumpScale: 1.2 }),
    suitD: new THREE.MeshStandardMaterial({ color: 0xb9b19f, roughness: 0.9, metalness: 0, bumpMap: fabric(), bumpScale: 1.4 }),
    hard: addHullDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 }), { scale: 6, grime: 0.45, scratch: 0.5, bump: 0.5 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.38, metalness: 0.85 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.75, metalness: 0 }),
    glove: new THREE.MeshStandardMaterial({ color: 0xcfc7b3, roughness: 0.78, metalness: 0, bumpMap: fabric(), bumpScale: 0.8 }),
    haz: new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.6, metalness: 0.1 }),
    visor: new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.04, metalness: 1, envMap, envMapIntensity: 1.6 }),
    lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 1.4) }),
    emit: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.3, 0.35) }),
  };
}

const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; };
const ring = (r, t, mat) => { const m = mesh(new THREE.TorusGeometry(r, t, 8, 20), mat); m.rotation.x = Math.PI / 2; return m; };

// glove: palm + four two-joint fingers + thumb. `curl` 0 open .. 1 fist; returns { group, setCurl }
export function buildGlove(M, side = 1) {
  const g = new THREE.Group();
  const palm = mesh(new RoundedBoxGeometry(0.088, 0.032, 0.095, 2, 0.012), M.glove, 0, 0, -0.045); g.add(palm);
  const back = mesh(new RoundedBoxGeometry(0.07, 0.01, 0.06, 2, 0.004), M.rubber, 0, 0.018, -0.045); g.add(back);
  const cuff = mesh(new THREE.CylinderGeometry(0.05, 0.043, 0.06, 14, 1, true), M.glove, 0, 0, 0.02); cuff.rotation.x = Math.PI / 2; g.add(cuff);
  const band = mesh(new THREE.CylinderGeometry(0.0505, 0.0505, 0.012, 14, 1, true), M.haz, 0, 0, 0.04); band.rotation.x = Math.PI / 2; g.add(band);
  const fingers = [];
  const segGeo = new THREE.CapsuleGeometry(0.0115, 0.026, 3, 8); segGeo.rotateX(Math.PI / 2); segGeo.translate(0, 0, -0.019);
  for (let i = 0; i < 4; i++) {
    const base = new THREE.Group(); base.position.set((i - 1.5) * 0.022, 0, -0.095); g.add(base);
    const a = mesh(segGeo, M.glove); base.add(a);
    const mid = new THREE.Group(); mid.position.z = -0.036; base.add(mid);
    const b = mesh(segGeo, M.glove); b.scale.set(0.95, 0.95, 0.85); mid.add(b);
    fingers.push([base, mid]);
  }
  const thumb = new THREE.Group(); thumb.position.set(-side * 0.046, -0.004, -0.03); thumb.rotation.set(0, side * 0.7, 0); g.add(thumb);
  const ta = mesh(segGeo, M.glove); ta.scale.setScalar(1.1); thumb.add(ta);
  const setCurl = (c, spread = 0) => {
    fingers.forEach(([b, m], i) => { b.rotation.x = -0.2 - c * 1.25 - i * 0.04 * c; b.rotation.y = (i - 1.5) * spread * 0.12; m.rotation.x = -0.15 - c * 1.35; });
    thumb.rotation.x = -c * 0.6; thumb.rotation.y = side * (0.7 - c * 0.5);
  };
  setCurl(0.3);
  return { group: g, setCurl };
}

// the multi-tool: plasma cutter / welder, gripped in the right glove. Emitter ring and tip are separate for glow.
export function buildTool(M) {
  const g = new THREE.Group();
  const hard = (w, h, d, c, r = 0.008) => tint(new RoundedBoxGeometry(w, h, d, 2, r), c);
  g.add(mesh(hard(0.042, 0.06, 0.2, 0x8c8a84), M.hard, 0, 0.035, -0.07));
  g.add(mesh(hard(0.036, 0.075, 0.034, 0x2c2e33), M.hard, 0, -0.015, 0.0));              // grip
  g.add(mesh(new RoundedBoxGeometry(0.046, 0.012, 0.12, 2, 0.004), M.haz, 0, 0.068, -0.08));
  const barrel = mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.11, 12), M.dark, 0, 0.035, -0.22); barrel.rotation.x = Math.PI / 2; g.add(barrel);
  const shroud = mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.03, 12, 1, true), M.dark, 0, 0.035, -0.27); shroud.rotation.x = Math.PI / 2; g.add(shroud);
  const emitter = mesh(new THREE.TorusGeometry(0.017, 0.004, 6, 18), M.emit.clone(), 0, 0.035, -0.283); g.add(emitter);
  // side cell with a level window
  g.add(mesh(hard(0.02, 0.04, 0.08, 0x3a3c40), M.hard, 0.03, 0.03, -0.05));
  const tip = new THREE.Object3D(); tip.position.set(0, 0.035, -0.29); g.add(tip);
  g.userData = { emitter, tip };
  return g;
}

// one arm: shoulder pivot -> upper arm -> elbow -> forearm -> wrist -> glove
export function buildArm(M, side = 1) {
  const sh = new THREE.Group();
  sh.add(ring(0.075, 0.016, M.dark));
  const up = mesh(new THREE.CapsuleGeometry(0.064, 0.2, 4, 12), M.suit, 0, -0.14, 0); sh.add(up);
  const band = mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.035, 14, 1, true), M.haz, 0, -0.07, 0); sh.add(band);
  const el = new THREE.Group(); el.position.y = -0.29; sh.add(el);
  el.add(ring(0.062, 0.012, M.dark));
  const fo = mesh(new THREE.CapsuleGeometry(0.058, 0.17, 4, 12), M.suit, 0, -0.12, 0); el.add(fo);
  const wr = new THREE.Group(); wr.position.y = -0.25; el.add(wr);
  const wring = ring(0.05, 0.012, M.dark); wr.add(wring);
  const gl = buildGlove(M, side);
  gl.group.rotation.x = -Math.PI / 2; gl.group.position.y = -0.03; wr.add(gl.group);
  return { shoulder: sh, elbow: el, wrist: wr, glove: gl };
}

function buildLeg(M) {
  const hip = new THREE.Group();
  hip.add(mesh(new THREE.CapsuleGeometry(0.088, 0.26, 4, 12), M.suit, 0, -0.17, 0));
  const kn = new THREE.Group(); kn.position.y = -0.36; hip.add(kn);
  kn.add(ring(0.08, 0.014, M.dark));
  kn.add(mesh(new THREE.CapsuleGeometry(0.076, 0.24, 4, 12), M.suit, 0, -0.16, 0));
  const an = new THREE.Group(); an.position.y = -0.33; kn.add(an);
  an.add(ring(0.07, 0.013, M.dark));
  an.add(mesh(new RoundedBoxGeometry(0.12, 0.11, 0.24, 2, 0.03), M.suitD, 0, -0.06, -0.04));
  an.add(mesh(new RoundedBoxGeometry(0.125, 0.025, 0.25, 2, 0.01), M.rubber, 0, -0.115, -0.04));
  return { hip, knee: kn, ankle: an };
}

export function buildAstronaut(M) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const hard = (geo, c) => tint(geo, c);

  // torso: soft lower body, hard upper shell, chest unit
  const torso = mesh(new THREE.CapsuleGeometry(0.2, 0.24, 4, 16), M.suit); torso.scale.set(1.12, 1, 0.82); body.add(torso);
  const hut = mesh(hard(new THREE.SphereGeometry(0.245, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), 0xcfc8b6), M.hard, 0, 0.04, 0); hut.scale.set(1.1, 0.95, 0.86); body.add(hut);
  const belt = mesh(new THREE.TorusGeometry(0.205, 0.022, 8, 24), M.dark, 0, -0.14, 0); belt.rotation.x = Math.PI / 2; belt.scale.set(1.1, 0.82, 1); body.add(belt);
  const dcm = mesh(hard(new RoundedBoxGeometry(0.2, 0.1, 0.07, 2, 0.012), 0x3a3c41), M.hard, 0, 0.0, -0.21); dcm.rotation.x = -0.25; body.add(dcm);
  for (let i = 0; i < 3; i++) dcm.add(mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.012, 8), i === 1 ? M.haz : M.dark, -0.05 + i * 0.05, 0.01, -0.035).rotateX(Math.PI / 2));
  const stat = mesh(new THREE.SphereGeometry(0.006, 8, 6), M.emit, 0.075, 0.03, -0.036); dcm.add(stat);

  // helmet
  const head = new THREE.Group(); head.position.set(0, 0.42, -0.02); body.add(head);
  head.add(ring(0.13, 0.022, M.dark)).position.y = -0.13;
  const shell = mesh(hard(new THREE.SphereGeometry(0.17, 28, 18), 0xd4cdbb), M.hard); head.add(shell);
  const visor = mesh(new THREE.SphereGeometry(0.176, 28, 16, Math.PI * 0.62, Math.PI * 0.76, Math.PI * 0.2, Math.PI * 0.45), M.visor); visor.rotation.y = Math.PI; head.add(visor);
  const brow = mesh(new THREE.TorusGeometry(0.172, 0.012, 6, 24, Math.PI * 0.8), M.dark, 0, 0.055, 0); brow.rotation.set(Math.PI / 2 - 0.35, 0, Math.PI * 1.1); head.add(brow);
  for (const sx of [-1, 1]) {
    const pod = mesh(hard(new RoundedBoxGeometry(0.05, 0.05, 0.09, 2, 0.01), 0x2f3135), M.hard, sx * 0.17, 0.05, -0.02); head.add(pod);
    pod.add(mesh(new THREE.CircleGeometry(0.016, 12), M.lamp, 0, 0, -0.0455).rotateY(Math.PI));
  }
  const lampL = new THREE.SpotLight(0xffe2c0, 0, 14, 0.42, 0.6, 1.6); lampL.position.set(0, 0.06, -0.12); head.add(lampL, lampL.target); lampL.target.position.set(0, 0, -2);

  // jetpack
  const pack = new THREE.Group(); pack.position.set(0, 0.04, 0.24); body.add(pack);
  pack.add(mesh(hard(new RoundedBoxGeometry(0.46, 0.58, 0.22, 3, 0.04), 0xc8c1ae), M.hard));
  pack.add(mesh(new RoundedBoxGeometry(0.47, 0.05, 0.225, 2, 0.01), M.haz, 0, 0.2, 0));
  pack.add(mesh(hard(new RoundedBoxGeometry(0.3, 0.2, 0.05, 2, 0.01), 0x34363b), M.hard, 0, -0.05, 0.12));
  for (let i = 0; i < 4; i++) pack.add(mesh(new THREE.BoxGeometry(0.26, 0.008, 0.012), M.dark, 0, -0.12 + i * 0.045, 0.148));
  const nozzles = [];
  for (const sx of [-1, 1]) {
    const pod = mesh(hard(new THREE.CylinderGeometry(0.06, 0.065, 0.42, 14), 0x45474c), M.hard, sx * 0.27, -0.02, 0.04); pack.add(pod);
    pod.add(ring(0.066, 0.008, M.dark)).position.y = 0.12;
    const bell = mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.07, 14, 1, true), M.dark, 0, -0.245, 0); pod.add(bell);
    const inner = mesh(new THREE.CircleGeometry(0.03, 12), M.emit.clone(), 0, -0.25, 0); inner.rotation.x = Math.PI / 2; inner.material.color.setRGB(0.05, 0.03, 0.02); pod.add(inner);
    const exit = new THREE.Object3D(); exit.position.set(0, -0.29, 0); pod.add(exit);
    nozzles.push({ exit, inner, dir: new THREE.Vector3(0, -1, 0) });
    // small corner RCS quads up top
    const q = mesh(hard(new RoundedBoxGeometry(0.05, 0.05, 0.05, 1, 0.01), 0x2a2c30), M.hard, sx * 0.21, 0.27, 0.08); pack.add(q);
  }
  // antenna + tether reel on the left hip
  const ant = mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.22, 5), M.dark, 0.16, 0.38, 0.05); pack.add(ant);
  ant.add(mesh(new THREE.SphereGeometry(0.009, 8, 6), M.emit, 0, 0.11, 0));
  const reel = mesh(hard(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 16), 0x3a3c41), M.hard, -0.24, -0.16, -0.02); reel.rotation.z = Math.PI / 2; body.add(reel);
  reel.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.052, 12), M.haz));
  const hook = new THREE.Object3D(); hook.position.set(-0.27, -0.16, -0.02); body.add(hook);

  // limbs
  const armR = buildArm(M, 1), armL = buildArm(M, -1);
  armR.shoulder.position.set(0.29, 0.18, 0); armL.shoulder.position.set(-0.29, 0.18, 0);
  body.add(armR.shoulder, armL.shoulder);
  const legR = buildLeg(M), legL = buildLeg(M);
  legR.hip.position.set(0.11, -0.3, 0); legL.hip.position.set(-0.11, -0.3, 0);
  body.add(legR.hip, legL.hip);
  const tool = buildTool(M); armR.glove.group.add(tool); tool.position.set(0, -0.02, -0.05); tool.rotation.x = -Math.PI / 2;
  armR.glove.setCurl(0.8);

  root.userData = { body, head, armR, armL, legR, legL, nozzles, lamp: lampL, tool, hook, visor };
  return root;
}

// a relaxed zero-g pose with slow drift; thrust direction (body frame) swings the legs a little
export function poseAstronaut(a, t, thrust, reach = 0) {
  const { armR, armL, legR, legL, body } = a.userData;
  const s = Math.sin(t * 0.7), c = Math.cos(t * 0.53);
  armR.shoulder.rotation.set(0.45 + reach * 0.9 + s * 0.05, 0, 0.22 + c * 0.04); armR.elbow.rotation.x = 0.9 - reach * 0.6;
  armL.shoulder.rotation.set(0.3 + c * 0.06, 0, -0.28 - s * 0.05); armL.elbow.rotation.x = 0.75 + s * 0.08;
  armL.glove.setCurl(0.35 + 0.1 * s);
  legR.hip.rotation.set(0.32 + s * 0.06 - thrust.z * 0.25, 0, 0.05 - thrust.x * 0.12); legR.knee.rotation.x = -0.6 - c * 0.08;
  legL.hip.rotation.set(0.2 - s * 0.05 - thrust.z * 0.25, 0, -0.07 - thrust.x * 0.12); legL.knee.rotation.x = -0.45 + c * 0.06;
  body.rotation.x = 0.12 + thrust.z * 0.08;
}
