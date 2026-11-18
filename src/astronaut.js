import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import suitUrl from './assets/astronaut.glb?url';
import J from './assets/astronaut.json';

// The pilot's EVA suit. The parts are modelled in Blender (tools/blender/astronaut.py): hard upper torso,
// soft brief with waist bellows, life-support pack with the jetpack pods, a helmet with a gold visor, and
// limbs with bearing rings and convolute joints. Each part sits in its own joint frame, so here we only
// assemble and pose them. Limbs are modelled for the right side and mirrored for the left.
// Arms are posed by two-bone IK from a hand target, so the first-person hands and the third-person body
// use the same arms, gloves and tool, and the hands always connect back to the shoulders.
// Units are metres. The body faces -Z with +Y up; the origin is the centre of the torso.

const V = (a) => new THREE.Vector3(...a);
export const SUIT = {
  eye: V(J.eye), shoulder: V(J.shoulder), hip: V(J.hip), neck: V(J.neck),
  ua: J.upperArm, fa: J.foreArm, thigh: J.thighLen, shin: J.shinLen,
};

let parts = null;
export async function loadSuit() {
  if (parts) return parts;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const g = await loader.loadAsync(suitUrl);
  parts = {};
  for (const o of g.scene.children) parts[o.name] = o;
  return parts;
}

let fabricTex = null;
function fabric() {
  if (fabricTex) return fabricTex;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  x.fillStyle = 'rgb(128,128,128)'; x.fillRect(0, 0, S, S);
  // ripstop weave: a fine grid with a heavier thread every 16px
  for (let y = 0; y < S; y += 2) for (let i = 0; i < S; i += 2) { const v = (i + y) % 4 ? 136 : 120; x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(i, y, 2, 2); }
  x.fillStyle = 'rgba(255,255,255,.18)';
  for (let i = 0; i < S; i += 16) { x.fillRect(i, 0, 1, S); x.fillRect(0, i, S, 1); }
  // soft folds
  x.strokeStyle = 'rgba(0,0,0,.10)'; x.lineWidth = 9; let s = 7;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 10; i++) { const y = r() * S; x.beginPath(); x.moveTo(-10, y); x.bezierCurveTo(S * .3, y + 14 * (r() - .5) * 2, S * .7, y - 14, S + 10, y + 4); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 0.5); t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  return (fabricTex = t);
}

export function suitMaterials(envMap) {
  const fab = fabric();
  return {
    // painted composite shell: soft clearcoat over a satin base
    hard: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.0, clearcoat: 0.35, clearcoatRoughness: 0.3 }),
    // outer thermal-micrometeoroid fabric: matte with a woven sheen
    suit: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, bumpMap: fab, bumpScale: 0.9, sheen: 0.35, sheenRoughness: 0.55, sheenColor: new THREE.Color(0xfff6e6) }),
    glove: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, bumpMap: fab, bumpScale: 0.5, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xfff6e6) }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.9 }),
    rubber: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 }),
    haz: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 }),
    // gold-film sun visor
    visor: new THREE.MeshPhysicalMaterial({ color: 0xd4a050, roughness: 0.06, metalness: 1, envMap, envMapIntensity: 1.8, clearcoat: 1, clearcoatRoughness: 0.03 }),
    lamp: new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2, 2, 2), toneMapped: false }),
    emit: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.3, 0.35), toneMapped: false }),
  };
}

// a copy of one modelled part with the suit's materials
function part(name, M) {
  if (!parts) throw new Error('loadSuit() first');
  // wrapped: a compressed part keeps its dequantization transform on its own node, so never touch that one
  const o = new THREE.Group(); o.add(parts[name].clone(true));
  o.traverse((m) => {
    if (!m.isMesh) return;
    m.material = M[m.material.name] || M.hard;
    m.castShadow = m.receiveShadow = true;
  });
  return o;
}

// glove: palm + four two-segment fingers + thumb. setCurl(c): 0 open .. 1 fist
export function buildGlove(M) {
  const g = new THREE.Group();
  g.add(part('palm', M));
  const fingers = [];
  J.fingers.forEach((p, i) => {
    const s = J.fingerScale[i];
    const base = new THREE.Group(); base.position.set(...p); g.add(base);
    const a = part('finA', M); a.scale.set(1, s, 1); base.add(a); a.traverse((m) => { m.castShadow = false; });
    const mid = new THREE.Group(); mid.position.y = -0.038 * s; base.add(mid);
    const b = part('finB', M); b.scale.set(1, s, 1); mid.add(b); b.traverse((m) => { m.castShadow = false; });
    fingers.push([base, mid]);
  });
  const thumb = new THREE.Group(); thumb.position.set(...J.thumb); g.add(thumb);
  thumb.add(part('thumbA', M));
  const tmid = new THREE.Group(); tmid.position.y = -0.034; thumb.add(tmid); tmid.add(part('thumbB', M));
  const setCurl = (c, spread = 0) => {
    fingers.forEach(([b, m], i) => {
      b.rotation.set(0, 0, -(0.12 + c * 1.35 + i * 0.05 * c)); b.rotation.x = (i - 1.5) * (0.05 + spread * 0.1);
      m.rotation.z = -(0.18 + c * 1.45);
    });
    thumb.rotation.set(0.85 - c * 0.25, 0, -(0.25 + c * 0.65)); tmid.rotation.z = -(0.15 + c * 0.6);
  };
  setCurl(0.3);
  return { group: g, setCurl };
}

// the multi-tool: plasma cutter / welder. Origin at the grip; barrel -Z. Emitter ring glows.
export function buildTool(M) {
  const g = part('tool', M);
  const emitter = new THREE.Mesh(new THREE.TorusGeometry(0.0175, 0.0038, 8, 24), M.emit.clone());
  emitter.position.set(...J.toolEmit); g.add(emitter);
  const tip = new THREE.Object3D(); tip.position.set(...J.toolTip); g.add(tip);
  g.userData = { emitter, tip };
  return g;
}

// the tool sits raked forward in the fist (wrist cocked up, barrel level), which is also what lets you see
// the back of the glove in first person instead of looking into the cuff
const TOOL_RAKE = 0.5;

// one arm as three free pieces (posed by IK, not nested): upper arm, forearm, glove (+ tool on the right)
export function buildArm(M, side = 1, withTool = false) {
  const root = new THREE.Group(); root.scale.x = side;          // mirrored for the left
  const upper = part('upperArm', M), fore = part('foreArm', M), glove = buildGlove(M);
  const wrist = new THREE.Group(); wrist.add(glove.group);
  root.add(upper, fore, wrist);
  let tool = null;
  if (withTool) {
    tool = buildTool(M); glove.group.add(tool);
    tool.position.set(-0.036, -0.074, 0.006); tool.rotation.set(-Math.PI / 2 - TOOL_RAKE, 0, 0);
    // flip back so the tool is never mirrored (it's only ever in the right hand)
  }
  return { root, upper, fore, wrist, glove, tool, side };
}

// Two-bone IK in the arm's own (unmirrored) space. S shoulder, W wrist target, pole: where the elbow goes,
// hand: the glove's orientation (quaternion; glove fingers -Y, palm -X, thumb -Z).
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _e = new THREE.Vector3(), _m = new THREE.Matrix4();
function aimBone(obj, from, to, pole) {
  // bone runs down its -Y; its +Z leans toward the pole
  const y = _a.subVectors(from, to).normalize();
  const z = _b.copy(pole).addScaledVector(y, -pole.dot(y)).normalize();
  const x = _c.crossVectors(y, z);
  _m.makeBasis(x, y, z); obj.quaternion.setFromRotationMatrix(_m); obj.position.copy(from);
}
export function solveArm(arm, S, W, pole, hand) {
  const a = SUIT.ua, b = SUIT.fa;
  const d = _e.subVectors(W, S); let L = d.length();
  const maxL = (a + b) * 0.995; if (L > maxL) { d.multiplyScalar(maxL / L); L = maxL; }
  const Wc = new THREE.Vector3().addVectors(S, d);
  const dir = d.clone().normalize();
  const x = (a * a - b * b + L * L) / (2 * L), h = Math.sqrt(Math.max(0, a * a - x * x));
  const pp = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  const E = S.clone().addScaledVector(dir, x).addScaledVector(pp, h);
  // twist: forearm leans its +Z the way the back of the hand faces, so the forearm detail sits on the outside
  aimBone(arm.upper, S, E, pole);
  aimBone(arm.fore, E, Wc, _c.set(0, 0, 0).add(pole));
  arm.wrist.position.copy(Wc); arm.wrist.quaternion.copy(hand);
  return E;
}

// handy: a glove orientation from where the fingers point and where the thumb points (arm space)
const _q = new THREE.Quaternion();
export function handBasis(fingers, thumb, out = _q) {
  const y = _a.copy(fingers).normalize().negate();
  const z = _b.copy(thumb).addScaledVector(y, -thumb.dot(y)).normalize().negate();
  const x = _c.crossVectors(y, z);
  _m.makeBasis(x, y, z); return out.setFromRotationMatrix(_m);
}

function buildLeg(M) {
  const hip = new THREE.Group(); hip.add(part('thigh', M));
  const knee = new THREE.Group(); knee.position.y = -SUIT.thigh; hip.add(knee); knee.add(part('shin', M));
  const ankle = new THREE.Group(); ankle.position.y = -SUIT.shin; knee.add(ankle); ankle.add(part('boot', M));
  return { hip, knee, ankle };
}

export function buildAstronaut(M) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  body.add(part('torso', M));
  const head = new THREE.Group(); head.position.copy(SUIT.neck); body.add(head);
  const helmet = part('helmet', M); head.add(helmet);
  const lampL = new THREE.SpotLight(0xffe2c0, 0, 14, 0.42, 0.6, 1.6); lampL.position.set(...J.lamp); head.add(lampL, lampL.target); lampL.target.position.set(0, 0, -2);

  // jetpack nozzle glow discs (inside the bells) and exhaust points
  const nozzles = J.nozzles.map((p) => {
    const inner = new THREE.Mesh(new THREE.CircleGeometry(0.03, 16), M.emit.clone()); inner.position.set(...p); inner.rotation.x = Math.PI / 2;
    inner.material.color.setRGB(0.05, 0.03, 0.02); inner.material.side = THREE.DoubleSide; body.add(inner);
    const exit = new THREE.Object3D(); exit.position.set(p[0], p[1] - 0.08, p[2]); body.add(exit);
    return { exit, inner, dir: new THREE.Vector3(0, -1, 0) };
  });
  const hook = new THREE.Object3D(); hook.position.set(...J.hook); body.add(hook);

  const armR = buildArm(M, 1, true), armL = buildArm(M, -1);
  body.add(armR.root, armL.root);
  const legR = buildLeg(M), legL = buildLeg(M);
  const lr = new THREE.Group(), ll = new THREE.Group(); ll.scale.x = -1;
  legR.hip.position.copy(SUIT.hip); legL.hip.position.copy(SUIT.hip);
  lr.add(legR.hip); ll.add(legL.hip); body.add(lr, ll);

  root.userData = { body, head, armR, armL, legR, legL, nozzles, lamp: lampL, tool: armR.tool, hook };
  poseAstronaut(root, 0, new THREE.Vector3(), 0);
  return root;
}

// a relaxed zero-g pose: arms float forward and out, knees bent, slow drift. Thrust swings the legs a little;
// `reach` brings the tool hand up in front of the visor, aimed forward.
const _S = new THREE.Vector3(), _W = new THREE.Vector3(), _P = new THREE.Vector3(), _F = new THREE.Vector3(), _T = new THREE.Vector3(), _hq = new THREE.Quaternion();
export function poseAstronaut(a, t, thrust, reach = 0) {
  const { armR, armL, legR, legL, body } = a.userData;
  const s = Math.sin(t * 0.7), c = Math.cos(t * 0.53);
  _S.copy(SUIT.shoulder);
  // right: tool hand. relaxed at the hip-front .. raised and aimed
  _W.set(0.2 - reach * 0.06, -0.14 + reach * 0.27 + s * 0.01, -0.3 - reach * 0.12);
  _P.set(0.8, -0.6, 0.35);
  _F.set(-0.1 * reach, -0.3 + reach * 0.75, -1).normalize(); _T.set(-0.25, 1, -0.1);
  solveArm(armR, _S, _W, _P, handBasis(_F, _T, _hq));
  armR.glove.setCurl(0.92);
  // left: open hand floating out to the side
  _W.set(0.24 + c * 0.01, -0.2 + s * 0.012, -0.24); _P.set(0.85, -0.5, 0.5);
  _F.set(0.25, -0.6, -1).normalize(); _T.set(-1, 0.3, 0);
  solveArm(armL, _S, _W, _P, handBasis(_F, _T, _hq));
  armL.glove.setCurl(0.38 + 0.08 * s, 0.4);
  legR.hip.rotation.set(0.3 + s * 0.05 - thrust.z * 0.2, 0, 0.06 + thrust.x * 0.1); legR.knee.rotation.x = -0.62 - c * 0.06; legR.ankle.rotation.x = -0.22;
  legL.hip.rotation.set(0.16 - s * 0.05 - thrust.z * 0.2, 0, 0.08 - thrust.x * 0.1); legL.knee.rotation.x = -0.42 + c * 0.05; legL.ankle.rotation.x = -0.18;
  body.rotation.x = 0.1 + thrust.z * 0.08;
}

// First person, in body space (the camera sits at SUIT.eye looking -Z). The view-model cheat every
// first-person game makes: the shoulders sit lower and wider than the suit's, so the forearms rise into
// view from the bottom corners and you see the backs of the gloves rather than down the sleeves.
export const FP_SHOULDER = new THREE.Vector3().copy(SUIT.eye).add(new THREE.Vector3(0.28, -0.52, -0.12));
const _zero = new THREE.Vector3();
const _ff = new THREE.Vector3(), _ft = new THREE.Vector3();
const FPT = ['R', 'L'].reduce((o, k) => (o[k] = { S: FP_SHOULDER, W: new THREE.Vector3(), P: new THREE.Vector3(0.5, -1, 0.3), Q: new THREE.Quaternion() }, o), {});
// the first-person arm targets (arm space; left in its mirrored space), so transitions can blend into them
export function fpTargets(o = {}) {
  const E = SUIT.eye, nar = o.narrow ?? 1, sw = o.sway || _zero, bob = o.bob || 0, r = o.reach || 0;
  // right: tool hand low right, barrel converging on the reticle far out
  const R = FPT.R, L = FPT.L;
  R.W.set(E.x + 0.17 * nar + (o.kick || 0), E.y - 0.22 + bob + sw.y, E.z - 0.44 + (o.firing ? 0.012 : 0) + sw.z); R.W.x += sw.x;
  _ff.set(E.x + 0.04, E.y + 0.12, E.z - 9).sub(R.W).normalize(); _ff.y += Math.sin(TOOL_RAKE); _ft.set(-0.45, 1, 0.5);
  handBasis(_ff, _ft, R.Q);
  // left (mirrored space, +x is outward): open hand low left, palm down; reaches forward and in to clamp tags
  L.W.set(E.x + (0.19 - 0.07 * r) * nar - sw.x, E.y - 0.24 + 0.08 * r - bob + sw.y, E.z - 0.42 - 0.1 * r + sw.z);
  _ff.set(-0.12 - 0.2 * r, 0.5 + 0.1 * r, -1); _ft.set(-1, 0.2, -0.15);
  handBasis(_ff, _ft, L.Q);
  return FPT;
}
export function poseFirstPerson(armR, armL, o = {}) {
  const T = fpTargets(o);
  solveArm(armR, T.R.S, T.R.W, T.R.P, T.R.Q);
  solveArm(armL, T.L.S, T.L.W, T.L.P, T.L.Q);
}
