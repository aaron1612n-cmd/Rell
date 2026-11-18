import * as THREE from 'three';
import shipData from './assets/ship.json';
import { HINGE } from './cockpit.js';
import { mats } from './assets.js';
import { addHullDetail } from './hullDetail.js';

// The ship's moving parts. ship.glb carries the canopy and the two trailing-edge vanes as their own
// objects; this hangs them on hinges (pivot groups) and adds the canopy's gas struts.
// Used for the world ship and for the cockpit view's exterior copy, so both move the same way.
const _z = new THREE.Vector3(0, 0, 1), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion();
const STRUT_A = [new THREE.Vector3(-0.47, 0.47, 0.35), new THREE.Vector3(0.47, 0.47, 0.35)];   // on the hull sill (ship space)
const STRUT_B = [new THREE.Vector3(-0.45, 0.455, -0.1), new THREE.Vector3(0.45, 0.455, -0.1)]; // lug on the canopy frame (closed pose)

function hingeAt(parent, node, pivot) {
  const h = new THREE.Group(); h.position.copy(pivot); parent.add(h);
  const off = new THREE.Group(); off.position.copy(pivot).negate(); h.add(off);
  off.add(node);   // node keeps its own (dequantize) transform
  return h;
}

export function rigShip(root, { struts = true } = {}) {
  const find = (n) => root.getObjectByName(n);
  const rig = { canopy: null, flaps: [], struts: [], angle: 0 };
  const can = find('canopy');
  if (can) {
    rig.canopy = hingeAt(root, can, HINGE); rig.canopyNode = can;
    const glass = []; can.traverse((o) => { if (o.isMesh && o.material === mats.glass) glass.push(o); });
    rig.glass = glass;
    // the canopy frame gets its own (fadeable) copy of the hull material, so it can thin out when the
    // camera is right behind it during EVA instead of a bar filling the screen
    rig.frameMat = addHullDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.35, transparent: true }), { scale: 0.5, grime: 0.6, scratch: 0.6, bump: 1.6 });
    can.traverse((o) => { if (o.isMesh && o.material === mats.shipHull) o.material = rig.frameMat; });
    const bb = new THREE.Box3(); can.updateMatrixWorld(true); root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    can.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); bb.union(o.geometry.boundingBox.clone().applyMatrix4(_m2.multiplyMatrices(inv, o.matrixWorld))); } });
    rig.center = bb.getCenter(new THREE.Vector3());   // closed pose, in root space
  }
  for (const f of shipData.flaps || []) {
    const n = find(f.side < 0 ? 'flap_l' : 'flap_r'); if (!n) continue;
    const h = hingeAt(root, n, new THREE.Vector3(...f.pivot));
    h.userData.axis = new THREE.Vector3(...f.axis).normalize(); h.userData.side = f.side;
    rig.flaps.push(h);
  }
  const dish = find('dish');
  if (dish) rig.dish = hingeAt(root, dish, new THREE.Vector3(0, 1.55, 1.55));
  if (struts && rig.canopy) {
    const body = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.45, metalness: 0.8 });
    const rod = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.2, metalness: 1 });
    const gb = new THREE.CylinderGeometry(0.016, 0.016, 1, 10).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    const gr = new THREE.CylinderGeometry(0.008, 0.008, 1, 8).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    for (let i = 0; i < 2; i++) {
      const b = new THREE.Mesh(gb, body), r = new THREE.Mesh(gr, rod); b.castShadow = true;
      root.add(b, r); rig.struts.push({ A: STRUT_A[i], B: STRUT_B[i], b, r, L0: STRUT_A[i].distanceTo(STRUT_B[i]) });
    }
  }
  return rig;
}

// angle: canopy open angle (rad). vanes: {pitch, roll} in -1..1.
export function poseShip(rig, angle, vanes) {
  if (rig.canopy) {
    rig.canopy.rotation.x = angle; rig.angle = angle;
    rig.canopy.updateMatrix();
    for (const s of rig.struts) {
      // the gas strut: barrel fixed at the sill end, rod slides out to the lug
      _b.copy(s.B).sub(HINGE).applyMatrix4(_m.makeRotationX(angle)).add(HINGE);
      _d.subVectors(_b, s.A); const len = _d.length(); _d.divideScalar(len);
      _q.setFromUnitVectors(_z, _d);
      const vis = angle > 0.01; s.b.visible = s.r.visible = vis;
      s.b.position.copy(s.A); s.b.quaternion.copy(_q); s.b.scale.set(1, 1, s.L0 * 0.62);
      s.r.position.copy(s.A); s.r.quaternion.copy(_q); s.r.scale.set(1, 1, len);
    }
  }
  if (rig.dish && vanes) {
    // the dish sweeps slowly, with the odd pause and a nod, like it's hunting for a signal
    const t = vanes.t || 0, s = Math.sin(t * 0.45) + 0.35 * Math.sin(t * 1.3 + 1);
    rig.dish.rotation.set(0.18 * Math.sin(t * 0.7), s * 1.2, 0, 'YXZ');
  }
  if (vanes) for (const h of rig.flaps) {
    // trailing-edge vanes: down on the rising side for roll, together for pitch
    const a = THREE.MathUtils.clamp(vanes.pitch * 0.38 + vanes.roll * h.userData.side * 0.38, -0.5, 0.5);
    h.quaternion.setFromAxisAngle(h.userData.axis, a);
  }
}
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _c = new THREE.Vector3();

// fade the canopy frame by how close the camera is to it (k: 0 solid .. 1 ghosted)
export function fadeCanopy(rig, camPos, on) {
  if (!rig.canopy) return;
  let k = 0;
  if (on) {
    _c.copy(rig.center).sub(HINGE).applyAxisAngle(_x, rig.angle).add(HINGE);
    rig.canopy.parent.localToWorld(_c);
    k = 1 - THREE.MathUtils.smoothstep(camPos.distanceTo(_c), 1.4, 2.6);
  }
  rig.fade = THREE.MathUtils.lerp(rig.fade ?? 0, k, 0.2);
  const op = 1 - 0.9 * rig.fade;
  rig.frameMat.opacity = op; rig.frameMat.depthWrite = op > 0.98;
}
const _x = new THREE.Vector3(1, 0, 0);
