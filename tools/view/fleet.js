// Dev viewer: one fleet ship under the game's light rig. ?id=wren&yaw=35&pitch=12&dist=1.4&w=1
import * as THREE from 'three';
import { loadModel, mats } from '../../src/assets.js';
import { setupLights } from '../../src/look.js';
import fleetUrl from '../../src/assets/fleet.glb?url';
import data from '../../src/assets/fleet.json';
const q = new URLSearchParams(location.search);
const id = q.get('id') || 'wren', yaw = +(q.get('yaw') ?? 35), pitch = +(q.get('pitch') ?? 14), dist = +(q.get('dist') ?? 1.35);
const canvas = document.getElementById('c');
const r = new THREE.WebGLRenderer({ canvas, antialias: true }); r.setSize(innerWidth, innerHeight); r.setPixelRatio(1);
const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.5, 20000);
const SUN = new THREE.Vector3(0.62, 0.5, 0.6).normalize();
const { sun } = setupLights(scene, r, SUN, false);
r.shadowMap.enabled = true;
const model = await loadModel(fleetUrl);
let ship = null; model.traverse((o) => { if (o.name === id) ship = o; });
for (const c of [...model.children]) if (c !== ship && !c.getObjectByName(id)) model.remove(c);
scene.add(model);
const d = data[id], mn = new THREE.Vector3(...d.min), mx = new THREE.Vector3(...d.max), ctr = mn.clone().add(mx).multiplyScalar(0.5), L = mx.clone().sub(mn).length();
sun.position.copy(ctr).addScaledVector(SUN, L * 2); sun.target.position.copy(ctr);
Object.assign(sun.shadow.camera, { left: -L, right: L, top: L, bottom: -L, near: 1, far: L * 4 }); sun.shadow.camera.updateProjectionMatrix();
const dir = new THREE.Vector3(Math.sin(yaw * Math.PI / 180) * Math.cos(pitch * Math.PI / 180), Math.sin(pitch * Math.PI / 180), -Math.cos(yaw * Math.PI / 180) * Math.cos(pitch * Math.PI / 180));
cam.position.copy(ctr).addScaledVector(dir, L * dist); cam.lookAt(ctr); cam.near = L * 0.01; cam.updateProjectionMatrix();
if (q.get('wire')) { for (const o of d.obbs) { const b = new THREE.Mesh(new THREE.BoxGeometry(o.h[0] * 2, o.h[1] * 2, o.h[2] * 2), new THREE.MeshBasicMaterial({ color: 0x00ff66, wireframe: true })); b.position.set(...o.c); b.quaternion.set(...o.q); scene.add(b); } }
r.render(scene, cam); window.__done = true;
