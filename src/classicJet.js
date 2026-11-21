import * as THREE from 'three';

// The very first Low Orbit jet, rebuilt from the original commit (d98ce55): a hex-prism fuselage, a box canopy,
// slab wings and cylinder nozzles. Kept as an admin-panel joke. Nose points to -Z like the real ship.
export function buildClassicJet() {
  const g = new THREE.Group(); g.name = 'classicJet';
  const hull = new THREE.MeshStandardMaterial({ color: 0xcfc6b0, roughness: 0.78, metalness: 0.15, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6, metalness: 0.4, flatShading: true });
  const accent = new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.6, flatShading: true });
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  };
  const body = new THREE.CylinderGeometry(0.28, 0.85, 3.6, 6); body.rotateX(-Math.PI / 2);
  add(body, hull, 0, 0, 0);
  add(new THREE.BoxGeometry(0.9, 0.5, 1.3), dark, 0, 0.55, -0.15);
  const wing = new THREE.BoxGeometry(2.3, 0.12, 1.5);
  add(wing, hull, -1.45, -0.1, 0.6, 0, 0.45, 0.06); add(wing, hull, 1.45, -0.1, 0.6, 0, -0.45, -0.06);
  add(new THREE.BoxGeometry(2.0, 0.14, 0.22), accent, -1.5, -0.03, 0.12, 0, 0.45, 0.06);
  add(new THREE.BoxGeometry(2.0, 0.14, 0.22), accent, 1.5, -0.03, 0.12, 0, -0.45, -0.06);
  add(new THREE.BoxGeometry(0.1, 0.9, 1.0), hull, 0, 0.7, 1.35, 0.25, 0, 0);
  const nozzle = new THREE.CylinderGeometry(0.34, 0.44, 0.7, 8); nozzle.rotateX(Math.PI / 2);
  add(nozzle, dark, -0.55, 0, 1.95); add(nozzle, dark, 0.55, 0, 1.95);
  return g;
}
