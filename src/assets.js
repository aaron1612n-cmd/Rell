import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import shipUrl from './assets/ship.glb?url';
import stationUrl from './assets/station.glb?url';
import debrisUrl from './assets/debris.glb?url';

// Shared materials for authored models. Colour (with baked ambient occlusion) lives in vertex colours,
// so there are no textures: small downloads, nothing to decode on a phone.
export const mats = {
  hull: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.22 }),
  lamp: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  glass: new THREE.MeshStandardMaterial({ color: 0x0c1218, roughness: 0.14, metalness: 0.75 }),
};
const byName = { hull: mats.hull, lamp: mats.lamp, glass: mats.glass };

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
export function loadModel(url) {
  return new Promise((res, rej) => loader.load(url, (g) => {
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = Array.isArray(o.material) ? o.material : [o.material];
      o.material = m.map((x) => byName[x.name] || mats.hull);
      if (o.material.length === 1) o.material = o.material[0];
      o.castShadow = true; o.receiveShadow = true;
    });
    res(g.scene);
  }, undefined, rej));
}

export const urls = { ship: shipUrl, station: stationUrl, debris: debrisUrl };
