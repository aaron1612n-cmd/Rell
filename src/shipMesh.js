import * as THREE from 'three';
import { NOZZLES } from './rcs.js';
import shipData from './assets/ship.json';

// Wraps the authored ship model (src/assets/ship.glb) and adds the live bits: engine glow, engine light, RCS flames.
export function buildShip(model) {
  const g = new THREE.Group();
  g.add(model.clone());
  // glow cones (scaled by thrust)
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff7a35, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const glowGeo = new THREE.ConeGeometry(0.3, 1, 10); glowGeo.rotateX(-Math.PI / 2); glowGeo.translate(0, 0, 0.5); // base at z=0, tip +Z
  const glows = shipData.glow.map(([x, y, z]) => { const m = new THREE.Mesh(glowGeo, glowMat); m.position.set(x, y, z); g.add(m); return m; });
  const light = new THREE.PointLight(0xff6a2a, 0, 14, 1.6); light.position.set(0, 0, 3.2); g.add(light);
  // RCS: a short cool-white flame per nozzle (layout authored with the model)
  const flameGeo = new THREE.ConeGeometry(0.09, 0.9, 6); flameGeo.rotateX(Math.PI / 2); flameGeo.translate(0, 0, 0.45); // base z=0, tip +Z
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const q = new THREE.Quaternion(), zp = new THREE.Vector3(0, 0, 1);
  const nubs = NOZZLES.map((n) => {
    q.setFromUnitVectors(zp, n.dir);
    const f = new THREE.Mesh(flameGeo, flameMat); f.position.copy(n.pos).addScaledVector(n.dir, 0.08); f.quaternion.copy(q); f.visible = false; g.add(f);
    return f;
  });
  g.userData = { glows, light, nubs };
  return g;
}
