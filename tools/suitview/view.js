// Dev-only turntable for the EVA suit, lit by the game's own light rig. /tools/suitview/?yaw=30&pitch=10&dist=2.6&y=0&reach=0&part=
import * as THREE from 'three';
import { setupLights } from '../../src/look.js';
import { loadSuit, suitMaterials, buildAstronaut, poseAstronaut, poseFirstPerson, SUIT } from '../../src/astronaut.js';
const q = new URLSearchParams(location.search), n = (k, d) => (q.has(k) ? +q.get(k) : d);
const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(), sunDir = new THREE.Vector3(n('sx', -0.55), n('sy', 0.45), n('sz', -0.7)).normalize();
const { sun } = setupLights(scene, renderer, sunDir, false);
sun.position.copy(sunDir).multiplyScalar(10); sun.shadow.camera.left = sun.shadow.camera.bottom = -2; sun.shadow.camera.right = sun.shadow.camera.top = 2; sun.shadow.camera.far = 30; sun.shadow.normalBias = 0.01; sun.shadow.camera.updateProjectionMatrix();
scene.background = new THREE.Color(0x05070a);
await loadSuit();
const M = suitMaterials(scene.environment), a = buildAstronaut(M); scene.add(a);
poseAstronaut(a, n('t', 0), new THREE.Vector3(), n('reach', 0));
const fp = n('fp', 0);
if (fp) { const u = a.userData; poseFirstPerson(u.armR, u.armL, { reach: n('reach', 0) }); u.armL.glove.setCurl(0.3); u.armR.glove.setCurl(0.95);
  u.body.rotation.x = 0;
  if (fp === 2) u.body.children.forEach((c) => { if (c !== u.armR.root && c !== u.armL.root) c.visible = false; }); }
const cam = new THREE.PerspectiveCamera(n('fov', 35), innerWidth / innerHeight, 0.01, 100);
const yaw = n('yaw', 30) * Math.PI / 180, pit = n('pitch', 8) * Math.PI / 180, d = n('dist', 3.2), ty = n('y', -0.2);
if (fp === 2) { cam.position.copy(SUIT.eye); cam.fov = n('fov', 74); cam.updateProjectionMatrix(); cam.lookAt(SUIT.eye.x, SUIT.eye.y, SUIT.eye.z - 1); } else cam.position.set(Math.sin(yaw) * Math.cos(pit) * d, ty + Math.sin(pit) * d, -Math.cos(yaw) * Math.cos(pit) * d); if (fp !== 2) cam.lookAt(0, ty, 0);
renderer.render(scene, cam); window.__ready = true;
