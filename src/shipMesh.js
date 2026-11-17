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
  const flameGeo = new THREE.ConeGeometry(0.06, 0.5, 6); flameGeo.rotateX(Math.PI / 2); flameGeo.translate(0, 0, 0.25); // base z=0, tip +Z
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  const q = new THREE.Quaternion(), zp = new THREE.Vector3(0, 0, 1);
  const nubs = NOZZLES.map((n) => {
    q.setFromUnitVectors(zp, n.dir);
    const f = new THREE.Mesh(flameGeo, flameMat); f.position.copy(n.pos).addScaledVector(n.dir, 0.08); f.quaternion.copy(q); f.visible = false; g.add(f);
    return f;
  });
  // nav lights: red port, green starboard, white tail strobe (sprites, driven from main.js)
  const dot = new THREE.CanvasTexture((() => { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'); const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 32, 32); return c; })());
  const navs = (shipData.nav || [[-2.45, -0.05, 1.0, 0xff3b2a], [2.45, -0.05, 1.0, 0x3bff7a], [0, 0.9, 2.0, 0xffffff]]).map(([x, y, z, col]) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.position.set(x, y, z); sp.scale.setScalar(0.6); g.add(sp); return sp;
  });
  g.userData = { glows, light, nubs, navs };
  return g;
}
