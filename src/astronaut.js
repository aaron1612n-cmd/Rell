import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import suitUrl from './assets/astronaut.glb?url';
import J from './assets/astronaut.json';
import { Plume } from './plume.js';

// cold nitrogen jets: a clear white core going pale blue, nothing hot
const GAS = { hot: [1.0, 1.0, 1.0], mid: [0.62, 0.74, 0.92], cool: [0.22, 0.28, 0.4] };

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

// glove: palm + four three-phalanx fingers + a two-segment thumb. setCurl(c): 0 open .. 1 fist
export function buildGlove(M) {
  const g = new THREE.Group();
  g.add(part('palm', M));
  const [LA, LB] = J.fingerLen;
  const seg = (name, parent, y, s) => {
    const j = new THREE.Group(); j.position.y = y; parent.add(j);
    const m = part(name, M); m.scale.set(1, s, 1); j.add(m); m.traverse((o) => { o.castShadow = false; });
    return j;
  };
  const fingers = J.fingers.map((p, i) => {
    const s = J.fingerScale[i];
    const base = new THREE.Group(); base.position.set(...p); g.add(base);
    const a = seg('finA', base, 0, s), b = seg('finB', a, -LA * s, s), c = seg('finC', b, -LB * s, s);
    return [a, b, c];
  });
  const thumb = new THREE.Group(); thumb.position.set(...J.thumb); g.add(thumb);
  const ta = seg('thumbA', thumb, 0, 1), tb = seg('thumbB', ta, -J.thumbLen, 1);
  // a gloved fist: the pressurised fingers never fully close, the little finger curls the most
  // trig: the index finger on its own (the trigger finger); null follows the rest
  const setCurl = (c0, spread = 0, trig = null) => {
    fingers.forEach(([a, b, d], i) => {
      const k = 1 + (i - 1.5) * 0.06, c = i === 0 && trig !== null ? trig : c0;
      a.rotation.set((i - 1.5) * (0.04 + spread * 0.1) * (1 - c * 0.6), 0, -(0.1 + c * 1.25 * k));
      b.rotation.z = -(0.14 + c * 1.35 * k);
      d.rotation.z = -(0.1 + c * 0.95);
    });
    const c = c0; thumb.rotation.set(0.8 - c * 0.3, 0.15 + c * 0.25, -(0.3 + c * 0.55)); ta.rotation.z = 0; tb.rotation.z = -(0.15 + c * 0.75);
  };
  setCurl(0.3);
  return { group: g, setCurl };
}

// the multi-tool: plasma cutter / welder. Origin at the grip; barrel -Z. Emitter ring glows.
// The tool gets its own copies of the metal and shell materials so its barrel can heat up: a glow that
// spreads back from the nozzle over the fin stack as `heat` (0..1) climbs, dull red to orange.
const AX = J.toolTip[1];
const HEAT_AT = new THREE.Vector3(0, AX, -0.215);
function heatMaterial(base, U) {
  const m = base.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uHeat = U.heat; sh.uniforms.uHotP = U.pos;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vHW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvHW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vHW; uniform float uHeat; uniform vec3 uHotP;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { vec3 dd = vHW - uHotP; float d2 = dot(dd, dd);
          float reach = 0.0004 + 0.0018 * uHeat;                       // squared metres: grows with heat
          float g = exp(-d2 / reach) * uHeat * uHeat;
          totalEmissiveRadiance += mix(vec3(0.7, 0.06, 0.0), vec3(1.6, 0.42, 0.08), uHeat) * g * 1.4; }`);
  };
  m.customProgramCacheKey = () => 'toolheat';
  return m;
}
let flareTex = null;
function flare() {
  if (flareTex) return flareTex;
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,200,140,.75)'); g.addColorStop(0.5, 'rgba(255,110,40,.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  return (flareTex = new THREE.CanvasTexture(c));
}
export function buildTool(M) {
  const g = part('tool', M);
  const U = { heat: { value: 0 }, pos: { value: new THREE.Vector3() } };
  const swapM = new Map();
  g.traverse((m) => {
    if (!m.isMesh || (m.material !== M.metal && m.material !== M.hard)) return;
    if (!swapM.has(m.material)) swapM.set(m.material, heatMaterial(m.material, U));
    m.material = swapM.get(m.material);
  });
  const emitter = new THREE.Mesh(new THREE.TorusGeometry(J.toolEmitR, 0.0016, 8, 24), M.emit.clone());
  emitter.position.set(...J.toolEmit); g.add(emitter);
  const tip = new THREE.Object3D(); tip.position.set(...J.toolTip); g.add(tip);
  // the arc's flare at the nozzle (additive, only while cutting)
  const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: flare(), color: new THREE.Color(3, 1.6, 0.8), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
  fl.position.copy(tip.position); fl.scale.setScalar(0.0001); fl.visible = false; g.add(fl);
  const hot = new THREE.Object3D(); hot.position.copy(HEAT_AT); g.add(hot);
  // the cheek-plate vent slots (both sides), where the heat dumps as a puff of gas
  const vents = [];
  for (const sx of [1, -1]) for (let i = 0; i < 5; i++) vents.push({ p: new THREE.Vector3(sx * 0.034, AX - 0.002, 0.022 - i * 0.014), d: new THREE.Vector3(sx, 0, 0) });
  g.userData = { emitter, tip, flare: fl, heatU: U, hot, vents };
  return g;
}

// heat the tool: 0 cold .. 1 glowing. fire: 0..1 arc strength (flare). t for flicker
const _hp = new THREE.Vector3();
export function heatTool(tool, heat, fire, t) {
  const u = tool.userData;
  u.heatU.heat.value = THREE.MathUtils.clamp(heat, 0, 1);
  tool.updateWorldMatrix(true, false);
  u.heatU.pos.value.copy(_hp.copy(HEAT_AT).applyMatrix4(tool.matrixWorld));
  const f = fire * (0.75 + 0.25 * Math.sin(t * 87) * Math.sin(t * 41));
  u.flare.visible = f > 0.02; u.flare.scale.setScalar(0.02 + 0.05 * f); u.flare.material.rotation = t * 9;
  u.emitter.material.color.setRGB(1.2 + 6 * fire + heat * 2, 0.4 + 2.4 * fire + heat * 0.5, 0.1 + 0.8 * fire);
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
  const torso = part('torso', M); body.add(torso);
  const head = new THREE.Group(); head.position.copy(SUIT.neck); body.add(head);
  const helmet = part('helmet', M); head.add(helmet);
  // no real helmet lamp light: toggling the suit's visibility would change the scene's light count and
  // recompile every material in the world (a long freeze on Windows/ANGLE); the lamp is emissive only
  const lampL = null;

  // jetpack: 16 cold-gas nozzles on four thruster heads (out, back, forward, up/down). Each has a throat disc
  // that flashes when its valve opens, and a gas plume; the plumes live in their own group (jetFx) so they
  // still show in first person, where the suit itself is hidden. The game copies the body's pose onto it.
  const jetFx = new THREE.Group(); jetFx.matrixAutoUpdate = false;
  const throatGeo = new THREE.CircleGeometry(0.0062, 14), _zAxis = new THREE.Vector3(0, 0, 1);
  const nozzles = J.jets.map((j) => {
    const dir = new THREE.Vector3(...j.d), pos = new THREE.Vector3(...j.p);
    const q = new THREE.Quaternion().setFromUnitVectors(_zAxis, dir);
    const throat = new THREE.Mesh(throatGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.03, 0.035, 0.04), toneMapped: false }));
    throat.position.copy(pos).addScaledVector(dir, -0.012); throat.quaternion.copy(q); body.add(throat);
    const plume = new Plume(GAS, { octaves: 2 }); plume.position.copy(pos); plume.quaternion.copy(q); jetFx.add(plume);
    return { pos, dir, throat, plume, level: 0 };
  });
  const hook = new THREE.Object3D(); hook.position.set(...J.hook); body.add(hook);

  const armR = buildArm(M, 1, true), armL = buildArm(M, -1);
  body.add(armR.root, armL.root);
  const legR = buildLeg(M), legL = buildLeg(M);
  const lr = new THREE.Group(), ll = new THREE.Group(); ll.scale.x = -1;
  legR.hip.position.copy(SUIT.hip); legL.hip.position.copy(SUIT.hip);
  lr.add(legR.hip); ll.add(legL.hip); body.add(lr, ll);

  // holster: the cutter hangs barrel-down on the outside of the right-hip caddy when it's put away
  const holster = new THREE.Group(); holster.position.set(0.335, -0.19, -0.02); holster.rotation.set(-Math.PI / 2, 0, 0); body.add(holster);
  const grip = { p: armR.tool.position.clone(), r: armR.tool.rotation.clone() };
  const stowTool = (stow) => {
    const t = armR.tool;
    if (stow) { holster.add(t); t.position.set(0, 0, 0); t.rotation.set(0, 0, 0); }
    else { armR.glove.group.add(t); t.position.copy(grip.p); t.rotation.copy(grip.r); }
  };

  root.userData = { body, torso, head, armR, armL, legR, legL, nozzles, jetFx, lamp: lampL, tool: armR.tool, hook, holster, stowTool };
  poseAstronaut(root, 0, new THREE.Vector3(), 0);
  return root;
}

// ---- posing -------------------------------------------------------------------------------------------
// Everything the body does is in a pose record (see restPose); SuitAnim fills it from what the pilot is doing,
// with springs so limbs lag, swing and settle the way loose mass does in zero g.
export function restPose() {
  const v = () => new THREE.Vector3();
  return {
    t: 0, breath: 0,
    lean: v(),              // torso pitch / yaw / roll against the flight frame
    legR: v(), legL: v(),   // x: fore-aft swing, z: sideways, y: knee extension (+ straightens)
    armL: v(), armR: v(),   // hand offsets from inertia (body space, metres)
    head: v(),              // x pitch, y yaw
    stream: 0, reach: 0.2, recoil: v(), trig: 0, drop: 0, empty: false,
    support: 0, reel: 0, reelPh: 0, grab: 0, rope: new THREE.Vector3(0, 0, 1), fidget: 0,
  };
}
const _S = new THREE.Vector3(), _W = new THREE.Vector3(), _P = new THREE.Vector3(), _F = new THREE.Vector3(), _T = new THREE.Vector3(), _hq = new THREE.Quaternion();
const _W2 = new THREE.Vector3(), _F2 = new THREE.Vector3(), _T2 = new THREE.Vector3(), _sp = new THREE.Vector3(), _mm = new THREE.Matrix4();
const blend3 = (a, b, k) => a.lerp(b, THREE.MathUtils.clamp(k, 0, 1));
// a point on the right hand's tool, in body (= right arm) space: where the left hand takes hold to steady it
const SUPPORT_PT = new THREE.Vector3(0, AX - 0.03, -0.085);
function supportPoint(armR, out) {
  const t = armR.tool; armR.root.updateWorldMatrix(true, true);
  _mm.copy(armR.root.matrixWorld).invert().multiply(t.matrixWorld);
  return out.copy(SUPPORT_PT).applyMatrix4(_mm);
}

export function poseBody(a, P) {
  const { armR, armL, legR, legL, body, head, torso } = a.userData;
  const t = P.t, s = Math.sin(t * 0.7), c = Math.cos(t * 0.53), br = P.breath;
  // breathing: the chest swells a little, shoulders and helmet ride up with it
  torso.scale.set(1 + 0.01 * br, 1 + 0.004 * br, 1 + 0.014 * br);
  head.position.copy(SUIT.neck); head.position.y += 0.004 * br;
  head.rotation.set(P.head.x, P.head.y, P.head.y * -0.15);
  body.rotation.set(0.1 + P.lean.x, P.lean.y, P.lean.z);
  _S.copy(SUIT.shoulder); _S.y += 0.005 * br;

  // right: the tool hand. relaxed at the hip-front .. raised and aimed; kicked by the cutter's recoil
  const r = P.reach, rc = P.recoil;
  if (!P.empty) {
    _W.set(0.2 - r * 0.06, -0.14 + r * 0.27 + s * 0.01, -0.3 - r * 0.12).add(P.armR);
    _W.y += rc.y; _W.z += rc.z;
    _F.set(-0.1 * r, -0.3 + r * 0.75 + rc.x * 1.2, -1).normalize(); _T.set(-0.25, 1, -0.1);
  } else {
    // empty: floats open like the left
    _W.set(0.25 - c * 0.01, -0.21 - s * 0.012, -0.22).add(P.armR);
    _F.set(0.25, -0.6, -1).normalize(); _T.set(-1, 0.3, 0);
  }
  // reaching down to the holster (and back up) as the tool is drawn or put away
  if (P.drop > 0) {
    _W2.set(0.36, -0.09, 0.0); _F2.set(0.05, -1, 0.15); _T2.set(-0.3, 0, -1);
    const k = P.drop; blend3(_W, _W2, k); blend3(_F, _F2, k); blend3(_T, _T2, k);
  }
  _P.set(0.8, -0.6, 0.35);
  solveArm(armR, _S, _W, _P, handBasis(_F, _T, _hq));
  if (P.empty) armR.glove.setCurl(0.34 + 0.06 * c + P.drop * 0.5, 0.35);
  else armR.glove.setCurl(0.9 + 0.06 * P.trig, 0, 0.72 + 0.28 * P.trig);

  // left (mirrored space: +x is outward). idle: open hand floating out to the side, pushed about by inertia
  const aL = _sp.copy(P.armL); aL.x = -aL.x;
  _W.set(0.24 + c * 0.01, -0.2 + s * 0.012, -0.24).add(aL);
  _F.set(0.25, -0.6, -1).normalize(); _T.set(-1, 0.3, 0);
  let curl = 0.38 + 0.08 * s + P.fidget, spread = 0.4;
  // boosting: tuck the arm in, make a fist
  if (P.stream > 0) { const k = P.stream; blend3(_W, _W2.set(0.2, -0.27, -0.1), k); curl += 0.45 * k; spread *= 1 - k; }
  // clamp a tag: reach out ahead
  if (P.grab > 0) { const k = P.grab; blend3(_W, _W2.set(0.12, 0.06, -0.52), k); blend3(_F, _F2.set(-0.1, 0.1, -1), k); curl = THREE.MathUtils.lerp(curl, 0.75, k); }
  // reel: hand over hand on the tether where it leaves the hip reel
  if (P.reel > 0) {
    const k = P.reel, ph = P.reelPh % 1, pull = ph < 0.6 ? ph / 0.6 : 1 - (ph - 0.6) / 0.4;
    _sp.set(-P.rope.x, P.rope.y, P.rope.z);
    _W2.set(-J.hook[0], J.hook[1] + 0.1, J.hook[2]).addScaledVector(_sp, 0.34 - 0.2 * pull);
    _W2.y += ph < 0.6 ? 0 : 0.05 * Math.sin((ph - 0.6) / 0.4 * Math.PI);
    blend3(_W, _W2, k); blend3(_F, _F2.set(-0.6, -0.4, -0.2), k); blend3(_T, _T2.copy(_sp), k);
    curl = THREE.MathUtils.lerp(curl, ph < 0.6 ? 0.95 : 0.35, k);
  }
  // cutting: the left hand comes under the tool to steady it
  if (P.support > 0 && !P.empty) {
    const k = P.support; supportPoint(armR, _W2); _W2.x = -_W2.x; _W2.y -= 0.02;
    blend3(_W, _W2, k); blend3(_F, _F2.set(-1, 0.25, -0.8), k); blend3(_T, _T2.set(0.6, 0.6, -1), k);
    curl = THREE.MathUtils.lerp(curl, 0.6, k); spread *= 1 - k;
  }
  _P.set(0.85, -0.5, 0.5);
  solveArm(armL, _S, _W, _P, handBasis(_F, _T, _hq));
  armL.glove.setCurl(curl, spread);

  // legs: a slow loose drift, swung by inertia, straightened and drawn together while boosting
  const st = 1 - 0.55 * P.stream;
  legR.hip.rotation.set((0.3 + s * 0.05) * st + P.legR.x, 0, 0.06 * st + P.legR.z);
  legR.knee.rotation.x = Math.min(-0.05, (-0.62 - c * 0.06) * st + P.legR.y); legR.ankle.rotation.x = -0.22 + P.legR.x * 0.3;
  legL.hip.rotation.set((0.16 - s * 0.05) * st + P.legL.x, 0, 0.08 * st - P.legL.z);
  legL.knee.rotation.x = Math.min(-0.05, (-0.42 + c * 0.05) * st + P.legL.y); legL.ankle.rotation.x = -0.18 + P.legL.x * 0.3;
}

// the old one-shot pose (the viewer still uses it): thrust swings the legs, reach raises the tool
const _rp = restPose();
export function poseAstronaut(a, t, thrust, reach = 0) {
  _rp.t = t; _rp.reach = reach;
  _rp.legR.set(thrust.z * 0.3, 0, -thrust.x * 0.2); _rp.legL.copy(_rp.legR);
  _rp.lean.set(thrust.z * 0.08, 0, 0);
  poseBody(a, _rp);
}

// A damped spring on a vector; underdamped so limbs overshoot a little and settle.
class Spring {
  constructor(k, zeta) { this.k = k; this.c = 2 * zeta * Math.sqrt(k); this.x = new THREE.Vector3(); this.v = new THREE.Vector3(); }
  step(target, dt) {
    const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v.x += ((target.x - this.x.x) * this.k - this.v.x * this.c) * h;
      this.v.y += ((target.y - this.x.y) * this.k - this.v.y * this.c) * h;
      this.v.z += ((target.z - this.x.z) * this.k - this.v.z * this.c) * h;
      this.x.addScaledVector(this.v, h);
    }
    return this.x;
  }
  reset() { this.x.set(0, 0, 0); this.v.set(0, 0, 0); }
}
export { Spring };

// The third-person suit's motion. Feed it once a frame with what the pilot is doing:
// acc   body-space acceleration in units of full jetpack thrust (thrust, braking, bumps, tether jerks)
// spin  body-space turn rate (rad/s)      boost, o2 (0..1)
// aim   0..1 the tool is up and aimed      firing, kind ('weld'|'cut'|'core'|null)
// reel  winching in       rope: body-space direction the tether runs      look: body-space dir to look along (or null)
// recoil (Vector3 from the cutter), drop / empty (holster), trig (0..1)
const _tg = new THREE.Vector3(), _a3 = new THREE.Vector3();
const damp = THREE.MathUtils.damp, clamp = THREE.MathUtils.clamp;
export class SuitAnim {
  constructor(a) {
    this.a = a; this.P = restPose(); this.ph = 0;
    this.lean = new Spring(34, 0.55); this.lr = new Spring(15, 0.28); this.ll = new Spring(11, 0.3);
    this.al = new Spring(22, 0.34); this.ar = new Spring(30, 0.4); this.hd = new Spring(42, 0.75);
  }
  reset() { for (const s of [this.lean, this.lr, this.ll, this.al, this.ar, this.hd]) s.reset(); }
  update(dt, I) {
    dt = Math.min(dt, 1 / 20);
    const P = this.P; P.t += dt;
    const A = _a3.copy(I.acc); if (A.lengthSq() > 9) A.setLength(3);
    const W = I.spin;
    // breathing: ~15 a minute at rest, faster on boost and when the air runs low
    this.ph += dt * Math.PI * 2 * (0.24 + (I.boost ? 0.16 : 0) + (I.o2 < 0.25 ? 0.4 : 0) + (I.firing ? 0.05 : 0));
    P.breath = Math.sin(this.ph);
    // torso: leans into the push (flying "into" the thrust), banks into strafes and turns, lags a turn
    P.lean.copy(this.lean.step(_tg.set(A.z * 0.16 - W.x * 0.05, -W.y * 0.07, -A.x * 0.13 + W.y * 0.09 - W.z * 0.05), dt));
    // legs: loose mass, they trail the push and overshoot when it stops; up/down thrust bends or straightens knees
    _tg.set(A.z * 0.42 - W.x * 0.12, A.y * 0.3 - Math.abs(A.z) * 0.06, -A.x * 0.3 + W.y * 0.16);
    P.legR.copy(this.lr.step(_tg, dt)); P.legL.copy(this.ll.step(_tg, dt));
    // arms: the hands lag the body
    _tg.copy(A).multiplyScalar(-0.045); _tg.x += W.y * 0.03; _tg.y += W.x * 0.03;
    P.armL.copy(this.al.step(_tg, dt)); P.armR.copy(this.ar.step(_tg.multiplyScalar(0.5), dt));
    // head: leads into a turn, then looks at the work
    let hy = clamp(W.y * 0.22, -0.35, 0.35), hx = clamp(W.x * 0.16, -0.25, 0.25);
    if (I.look) { hy = clamp(Math.atan2(-I.look.x, -I.look.z), -0.4, 0.4); hx = clamp(Math.asin(clamp(I.look.y, -1, 1)), -0.3, 0.3); }
    P.head.copy(this.hd.step(_tg.set(hx, hy, 0), dt));
    P.stream = damp(P.stream, I.boost ? 1 : 0, 5, dt);
    P.reach = damp(P.reach, I.aim, 7, dt);
    P.support = damp(P.support, I.firing && I.kind !== 'core' && !I.empty ? 1 : 0, 6, dt);
    P.grab = damp(P.grab, I.firing && I.kind === 'core' ? 1 : 0, 8, dt);
    P.reel = damp(P.reel, I.reel ? 1 : 0, 6, dt);
    if (I.reel) P.reelPh += dt * 1.1;
    if (I.rope) P.rope.copy(I.rope);
    P.recoil.copy(I.recoil); P.trig = I.trig; P.drop = I.drop; P.empty = I.empty;
    // every so often the free hand flexes its fingers (glove fatigue)
    P.fidget = 0.32 * Math.max(0, Math.sin(P.t * 0.45)) ** 12 * Math.sin(P.t * 9);
    poseBody(this.a, P);
  }
}

// First person, in body space (the camera sits at SUIT.eye looking -Z). The view-model cheat every
// first-person game makes: the shoulders sit lower and wider than the suit's, so the forearms rise into
// view from the bottom corners and you see the backs of the gloves rather than down the sleeves.
export const FP_SHOULDER = new THREE.Vector3().copy(SUIT.eye).add(new THREE.Vector3(0.28, -0.52, -0.12));
const _zero = new THREE.Vector3();
const _ff = new THREE.Vector3(), _ft = new THREE.Vector3();
const FPT = ['R', 'L'].reduce((o, k) => (o[k] = { S: FP_SHOULDER.clone(), W: new THREE.Vector3(), P: new THREE.Vector3(0.5, -1, 0.3), Q: new THREE.Quaternion() }, o), {});
// the first-person arm targets (arm space; left in its mirrored space), so transitions can blend into them.
// o: narrow, sway, bob, kick, firing, reach (left clamps a tag), recoil (Vector3: pitch, up, back), drop (0..1
// arm dips out of view to the holster), empty (no tool in the right hand), reel (0..1) + reelPh
export function fpTargets(o = {}) {
  const E = SUIT.eye, nar = o.narrow ?? 1, sw = o.sway || _zero, bob = o.bob || 0, r = o.reach || 0, rc = o.recoil || _zero, drop = o.drop || 0;
  const R = FPT.R, L = FPT.L;
  R.S.copy(FP_SHOULDER); L.S.copy(FP_SHOULDER);
  if (!o.empty) {
    // the cutter is held canted in toward the reticle (it crosses the view about a metre out), so you see its
    // flank, the canister and your fist on the grip instead of looking straight down its back end
    R.W.set(E.x + 0.2 * nar + (o.kick || 0), E.y - 0.21 - 0.06 * (1 - nar) + bob + sw.y + rc.y, E.z - 0.4 + (o.firing ? 0.012 : 0) + sw.z + rc.z); R.W.x += sw.x;
    _ff.set(E.x - 0.24, E.y + 0.04, E.z - 1.2).sub(R.W).normalize(); _ff.y += Math.sin(TOOL_RAKE) + rc.x * 1.4; _ft.set(0.25, 1, 0.3);
  } else {
    // empty hand: open, low right, the mirror of the left
    R.W.set(E.x + 0.19 * nar + sw.x, E.y - 0.24 + bob + sw.y, E.z - 0.42 + sw.z);
    _ff.set(-0.12, 0.5, -1); _ft.set(-1, 0.2, -0.15);
  }
  if (drop > 0) { R.W.y -= 0.42 * drop; R.W.z += 0.16 * drop; R.W.x += 0.06 * drop; _ff.lerp(_ft.set(0.1, -0.6, -1), drop * 0.6); if (!o.empty) _ft.set(0.25, 1, 0.3); else _ft.set(-1, 0.2, -0.15); }
  handBasis(_ff, _ft, R.Q);
  // left (mirrored space, +x is outward): open hand low left, palm down; reaches forward and in to clamp tags
  L.W.set(E.x + (0.19 - 0.07 * r) * nar - sw.x, E.y - 0.24 + 0.08 * r - bob + sw.y, E.z - 0.42 - 0.1 * r + sw.z);
  _ff.set(-0.12 - 0.2 * r, 0.5 + 0.1 * r, -1); _ft.set(-1, 0.2, -0.15);
  const rl = o.reel || 0;
  if (rl > 0) {
    // hand over hand on the tether: grab low and ahead, haul back toward the hip, let go, reach again
    const ph = (o.reelPh || 0) % 1, pull = ph < 0.6 ? ph / 0.6 : 1 - (ph - 0.6) / 0.4;
    _W2.set(E.x + 0.16 * nar, E.y - 0.3 - 0.06 * pull + (ph < 0.6 ? 0 : 0.04 * Math.sin((ph - 0.6) / 0.4 * Math.PI)), E.z - 0.5 + 0.2 * pull);
    L.W.lerp(_W2, rl); _ff.lerp(_F2.set(-0.7, -0.1, -0.6), rl); _ft.lerp(_T2.set(-0.2, 0.3, -1), rl);
  }
  handBasis(_ff, _ft, L.Q);
  return FPT;
}
export function poseFirstPerson(armR, armL, o = {}) {
  const T = fpTargets(o);
  solveArm(armR, T.R.S, T.R.W, T.R.P, T.R.Q);
  // steadying the cutter: the left hand comes in under it (its shoulder cheats in toward the middle to reach)
  const k = o.support || 0;
  if (k > 0 && !o.empty && armR.tool) {
    supportPoint(armR, _W2); _W2.x = -_W2.x; _W2.y -= 0.022;
    T.L.S.lerp(_sp.copy(FP_SHOULDER).add(_T.set(-0.16, 0.1, -0.06)), k);
    T.L.W.lerp(_W2, k);
    _ff.set(-1, 0.25, -0.8); _ft.set(0.6, 0.6, -1); handBasis(_ff, _ft, _hq);
    T.L.Q.slerp(_hq, k);
  }
  solveArm(armL, T.L.S, T.L.W, T.L.P, T.L.Q);
}

// Fire the jetpack. force: the push wanted on the body (body space, 1 = full thrust); spin: the turn wanted
// (body space angular rate, rad/s). Every nozzle pushes the body opposite to its exhaust, so a nozzle opens
// when that push (or the twist it gives about the torso) helps; turning fires opposed couples, the way a
// real manoeuvring unit does. Returns the summed valve opening (for sound / fuel feel).
const _jf = new THREE.Vector3(), _jt = new THREE.Vector3();
export function driveJets(a, force, spin, t, dt, boost = 0) {
  let total = 0;
  for (const n of a.userData.nozzles) {
    _jf.copy(n.dir).negate();
    _jt.copy(n.pos).cross(_jf);
    const s = Math.max(0, _jf.dot(force)) + Math.max(0, _jt.dot(spin)) * 0.9;
    const want = s < 0.16 ? 0 : Math.min(1, (s - 0.16) / 0.7);
    // valves snap open, the gas tails off for a moment after they shut
    n.level = want > n.level ? THREE.MathUtils.lerp(n.level, want, 1 - Math.exp(-40 * dt)) : Math.max(want, n.level - dt * 6);
    const L = n.level; total += L;
    const flick = 0.85 + 0.15 * Math.sin(t * 61 + n.pos.x * 40 + n.pos.y * 23);
    n.plume.set(0.9 * L * flick * (1 + boost * 0.3), 0.2 + 0.4 * L * (1 + boost * 0.5), 0.028 + 0.02 * L, 0, 0.6);
    n.plume.tick(t);
    n.throat.material.color.setRGB(0.03 + L * 1.4, 0.035 + L * 1.6, 0.04 + L * 2.0);
  }
  return total;
}
