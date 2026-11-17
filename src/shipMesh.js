import * as THREE from 'three';

// Low-poly salvage skiff. Nose points to -Z. Bone hull, hazard-orange accents, dark canopy.
export function buildShip() {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0xcfc6b0, roughness: 0.78, metalness: 0.15, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6, metalness: 0.4, flatShading: true });
  const accent = new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.6, flatShading: true });
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  };
  // fuselage: tapered hex prism pointing forward
  const body = new THREE.CylinderGeometry(0.28, 0.85, 3.6, 6); body.rotateX(-Math.PI / 2); // narrow end to -Z
  add(body, hull, 0, 0, 0);
  add(new THREE.BoxGeometry(0.9, 0.5, 1.3), dark, 0, 0.55, -0.15);                         // canopy
  // swept wings
  const wing = new THREE.BoxGeometry(2.3, 0.12, 1.5);
  const wl = add(wing, hull, -1.45, -0.1, 0.6, 0, 0.45, 0.06); const wr = add(wing, hull, 1.45, -0.1, 0.6, 0, -0.45, -0.06);
  add(new THREE.BoxGeometry(2.0, 0.14, 0.22), accent, -1.5, -0.03, 0.12, 0, 0.45, 0.06);
  add(new THREE.BoxGeometry(2.0, 0.14, 0.22), accent, 1.5, -0.03, 0.12, 0, -0.45, -0.06);
  // tail fin
  add(new THREE.BoxGeometry(0.1, 0.9, 1.0), hull, 0, 0.7, 1.35, 0.25, 0, 0);
  // engine nozzles
  const nozzle = new THREE.CylinderGeometry(0.34, 0.44, 0.7, 8); nozzle.rotateX(Math.PI / 2);
  add(nozzle, dark, -0.55, 0, 1.95); add(nozzle, dark, 0.55, 0, 1.95);
  // glow cones (scaled by thrust)
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff7a35, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const glowGeo = new THREE.ConeGeometry(0.3, 1, 10); glowGeo.rotateX(-Math.PI / 2); glowGeo.translate(0, 0, 0.5); // base at z=0, tip +Z
  const glows = [-0.55, 0.55].map((x) => { const m = new THREE.Mesh(glowGeo, glowMat); m.position.set(x, 0, 2.3); g.add(m); return m; });
  const light = new THREE.PointLight(0xff6a2a, 0, 14, 1.6); light.position.set(0, 0, 3); g.add(light);
  g.userData = { glows, light };
  return g;
}
