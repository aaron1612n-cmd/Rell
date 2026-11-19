import * as THREE from 'three';
import { addHullDetail, addHeatGlow } from './hullDetail.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import shipUrl from './assets/ship.glb?url';
import stationUrl from './assets/station.glb?url';
import debrisUrl from './assets/debris.glb?url';
import depotUrl from './assets/depot.glb?url';
import freighterUrl from './assets/freighter.glb?url';
import salvageUrl from './assets/salvage.glb?url';

// Shared materials for authored models. Colour (with baked ambient occlusion) lives in vertex colours,
// so there are no textures: small downloads, nothing to decode on a phone.
export const mats = {
  hull: addHullDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.3 }), { scale: 0.22, grime: 0.8, bump: 1.4 }),
  shipHull: addHeatGlow(addHullDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.35 }), { scale: 0.5, grime: 0.6, scratch: 0.6, bump: 1.6 })),
  lamp: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  glass: new THREE.MeshStandardMaterial({ color: 0x0c1218, roughness: 0.14, metalness: 0.75 }),
};
const byName = { hull: mats.hull, lamp: mats.lamp, glass: mats.glass };

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
export function loadModel(url, hull = mats.hull) {
  return new Promise((res, rej) => loader.load(url, (g) => {
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = Array.isArray(o.material) ? o.material : [o.material];
      o.material = m.map((x) => x.name === 'hull' || !byName[x.name] ? hull : byName[x.name]);
      if (o.material.length === 1) o.material = o.material[0];
      o.castShadow = true; o.receiveShadow = true;
    });
    res(g.scene);
  }, undefined, rej));
}

export const urls = { ship: shipUrl, station: stationUrl, debris: debrisUrl, depot: depotUrl, freighter: freighterUrl, salvage: salvageUrl };
