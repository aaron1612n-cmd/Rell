import * as THREE from 'three';

// A personnel hatch for the fleet ships: a seated frame, a plug door on a hinge, six latch dogs, lamps and a lit lock
// chamber behind it. Built once at unit radius (+Y out of the hull, hinge on the -X side) and scaled per ship.
// set(k): 0 closed and dogged, 1 wide open. The dogs retract, the door lifts off its seat, then swings up and over.
//
// From outside the hull the mouth is a dark tunnel (a disc with a drawn tunnel): the hull mesh has no hole, so a
// body passing the disc plane simply disappears behind it. From inside (the lock chamber, drawn back-face only so
// the hull still hides it from outside) the eye sees real walls, light rings and the door swinging.

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smr = (a, b, t) => { const k = clamp01((t - a) / (b - a)); return k * k * k * (k * (6 * k - 15) + 10); };

let shared = null;
function build() {
  if (shared) return shared;
  const std = (c, r, m, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...extra });
  const M = {
    frame: std(0x8a9096, 0.5, 0.65), door: std(0x9aa0a4, 0.46, 0.6), dark: std(0x1b1d20, 0.8, 0.3), dog: std(0x5d646a, 0.4, 0.8),
    hazard: std(0xd9a21b, 0.55, 0.3), rib: std(0x6f767c, 0.5, 0.6),
    lamp: new THREE.MeshBasicMaterial({ color: 0xffb040, toneMapped: false }),
  };
  // concentric tunnel for the mouth: dark, with receding light rings
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128); g.addColorStop(0, '#05080a'); g.addColorStop(0.55, '#0c1114'); g.addColorStop(1, '#1d262b');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  for (const [r, a] of [[118, 0.55], [92, 0.4], [66, 0.28], [44, 0.18], [26, 0.1]]) { x.strokeStyle = `rgba(190,215,225,${a})`; x.lineWidth = 5 * (r / 118) + 1.5; x.beginPath(); x.arc(128, 128, r, 0, 7); x.stroke(); }
  const tunnel = new THREE.CanvasTexture(c); tunnel.colorSpace = THREE.SRGBColorSpace;
  M.mouth = new THREE.MeshBasicMaterial({ map: tunnel, toneMapped: false });

  // frame: a seated collar. profile pairs give hard edges.
  const P = (pts) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 56);
  const frame = P([[1.0, -0.6], [1.0, -0.6], [1.38, -0.6], [1.38, 0.02], [1.38, 0.02], [1.32, 0.15], [1.32, 0.15], [1.2, 0.17], [1.2, 0.17], [1.04, 0.17], [1.04, 0.17], [1.04, -0.04], [1.04, -0.04], [1.0, -0.04], [1.0, -0.6]]);
  // door: thick plug with a rounded edge and a domed top, a dark gasket under the lip
  const door = P([[0, 0.0], [0.98, 0.0], [1.02, 0.04], [1.02, 0.04], [1.02, 0.15], [1.02, 0.15], [0.98, 0.185], [0.98, 0.185], [0.8, 0.185], [0.8, 0.185], [0.76, 0.21], [0.76, 0.21], [0.3, 0.215], [0.3, 0.215], [0.26, 0.185], [0.26, 0.185], [0, 0.185]]);
  const gasket = new THREE.TorusGeometry(1.0, 0.035, 8, 56).rotateX(Math.PI / 2);
  const rib = new THREE.BoxGeometry(0.46, 0.05, 0.1);
  const dogG = new THREE.BoxGeometry(0.34, 0.075, 0.2);
  const lampG = new THREE.CylinderGeometry(0.06, 0.07, 0.04, 12);
  // hazard ring: alternating wedges on the frame top
  const wedges = []; const N = 18;
  for (let i = 0; i < N; i += 2) wedges.push(new THREE.RingGeometry(1.22, 1.31, 1, 1, (i / N) * Math.PI * 2, (Math.PI * 2) / N).rotateX(-Math.PI / 2));
  const hazard = wedges.length ? mergeSimple(wedges) : null;
  // lock chamber: open tube walls (back faces only), a floor and three light rings
  const D = 2.3;
  const tube = new THREE.CylinderGeometry(1.12, 1.12, D, 40, 1, true); tube.translate(0, -0.06 - D / 2, 0);
  const floor = new THREE.CircleGeometry(1.12, 40).rotateX(-Math.PI / 2); floor.translate(0, -0.06 - D, 0);
  const ring = new THREE.TorusGeometry(1.1, 0.03, 6, 40).rotateX(Math.PI / 2);
  const mouth = new THREE.CircleGeometry(1.0, 56).rotateX(-Math.PI / 2);
  M.tube = new THREE.MeshBasicMaterial({ color: 0x3a4750, side: THREE.BackSide, toneMapped: false });
  M.floor = new THREE.MeshBasicMaterial({ color: 0x242d33, side: THREE.BackSide, toneMapped: false });
  M.ring = new THREE.MeshBasicMaterial({ color: 0xcfeaff, toneMapped: false });
  shared = { M, frame, door, gasket, rib, dogG, lampG, hazard, tube, floor, ring, mouth, D };
  return shared;
}

// merge a few non-indexed-agnostic geometries (positions, normals only)
function mergeSimple(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), idx = []; let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    const ix = g.index ? g.index.array : [...Array(g.attributes.position.count).keys()];
    for (const i of ix) idx.push(i + o); o += g.attributes.position.count;
  }
  const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); m.setIndex(idx);
  return m;
}

export function buildAirlockHatch() {
  const S = build(), M = S.M;
  const root = new THREE.Group(); root.name = 'airlock-hatch';
  const mesh = (g, m, parent = root) => { const o = new THREE.Mesh(g, m); parent.add(o); return o; };
  mesh(S.frame, M.frame); if (S.hazard) { const h = mesh(S.hazard, M.hazard); h.position.y = 0.176; }
  // the mouth sits under the door; the chamber is only seen from inside
  const mouth = mesh(S.mouth, M.mouth); mouth.position.y = -0.05;
  mesh(S.tube, M.tube); mesh(S.floor, M.floor);
  for (const y of [-0.5, -1.2, -1.95]) { const r = mesh(S.ring, M.ring); r.position.y = y; r.material = M.ring; }
  // hinge barrels
  const hinge = new THREE.Group(); hinge.position.set(-1.1, 0.12, 0); root.add(hinge);
  const door = new THREE.Group(); door.position.set(1.1, -0.12, 0); hinge.add(door);
  mesh(S.door, M.door, door); mesh(S.gasket, M.dark, door).position.y = 0.02;
  for (let i = 0; i < 8; i++) { const r = mesh(S.rib, M.rib, door); const a = (i / 8) * Math.PI; r.rotation.y = a; r.position.y = 0.205; }
  for (const z of [-0.5, 0.5]) { const b = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.3, 14).rotateX(Math.PI / 2), M.dog, root); b.position.set(-1.1, 0.12, z); }
  // dogs
  const dogs = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6, g = new THREE.Group(); g.rotation.y = -a; root.add(g);
    const d = mesh(S.dogG, M.dog, g); d.position.y = 0.23; dogs.push(d);
  }
  // lamps: three on the frame top, tinted by state
  const lampMat = M.lamp.clone(), lamps = [];
  for (const a of [Math.PI * 0.5, Math.PI * 0.5 + 0.42, Math.PI * 0.5 - 0.42]) { const l = mesh(S.lampG, lampMat); l.position.set(Math.cos(a) * 1.26, 0.2, Math.sin(a) * 1.26); lamps.push(l); }
  root.userData = { hinge, door, dogs, lampMat, lamps, mouth, k: -1 };
  return root;
}

// pose the hatch for open amount k (0 shut, 1 open); lamp colour by state
export function poseHatch(root, k) {
  const u = root.userData; if (Math.abs(u.k - k) < 1e-4) return; u.k = k;
  const dogK = 1 - smr(0, 0.22, k), lift = smr(0.16, 0.34, k), swing = smr(0.32, 1, k);
  for (const d of u.dogs) d.position.x = 1.5 - 0.35 * dogK;   // retracted dogs sit out on the frame, engaged ones reach over the door's lip
  u.hinge.rotation.z = swing * 1.85;
  u.door.position.y = -0.12 + 0.12 * lift;
  u.mouth.visible = k > 0.001;
}
export function lampColor(root, state) {
  const c = { shut: 0xffb040, open: 0x59ff8a, locked: 0xff3b2a, cycling: 0xffd45a }[state] || 0xffb040;
  root.userData.lampMat.color.setHex(c);
}
