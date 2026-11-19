// Dev-only turntable for the EVA suit, lit by the game's own light rig. /tools/suitview/?yaw=30&pitch=10&dist=2.6&y=0&reach=0&part=
import * as THREE from 'three';
import { setupLights } from '../../src/look.js';
import { loadSuit, suitMaterials, buildAstronaut, poseAstronaut, poseBody, restPose, poseFirstPerson, heatTool, buildGlove, buildTool, driveJets, SUIT, buildArm, solveArm, handBasis } from '../../src/astronaut.js';
const q = new URLSearchParams(location.search), n = (k, d) => (q.has(k) ? +q.get(k) : d);
const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(), sunDir = new THREE.Vector3(n('sx', -0.55), n('sy', 0.45), n('sz', -0.7)).normalize();
const { sun } = setupLights(scene, renderer, sunDir, false);
sun.position.copy(sunDir).multiplyScalar(10); sun.shadow.camera.left = sun.shadow.camera.bottom = -2; sun.shadow.camera.right = sun.shadow.camera.top = 2; sun.shadow.camera.far = 30; sun.shadow.normalBias = 0.01; sun.shadow.camera.updateProjectionMatrix();
scene.background = new THREE.Color(0x05070a);
await loadSuit();
const M = suitMaterials(scene.environment), a = buildAstronaut(M);
// part=glove|fist|tool|gun (glove holding the tool): a single piece, centred, for close inspection
const partName = q.get('part');
if (partName === 'arm') {
  // part=arm&bend=0..1: one right arm on its own, elbow bent by `bend`, glove curl `curl`
  const arm = buildArm(M, 1, false), b = n('bend', 0.6), L = (SUIT.ua + SUIT.fa) * (1 - 0.5 * b);
  const W = new THREE.Vector3(0, -L * Math.cos(b * 0.9), -L * Math.sin(b * 0.9));
  solveArm(arm, new THREE.Vector3(), W, new THREE.Vector3(0, -0.2, 1).normalize(), handBasis(W.clone().normalize(), new THREE.Vector3(-1, 0, 0)));
  arm.glove.setCurl(n('curl', 0.3));
  scene.add(arm.root); const bb = new THREE.Box3().setFromObject(arm.root), c = bb.getCenter(new THREE.Vector3()); arm.root.position.sub(c);
} else if (partName) {
  const g = partName === 'tool' ? buildTool(M) : buildGlove(M);
  const o = partName === 'tool' ? g : g.group;
  if (partName !== 'tool') g.setCurl(n('curl', partName === 'glove' ? 0.25 : 0.95));
  if (partName === 'gun') { const t = buildTool(M); g.group.add(t); t.position.set(-0.036, -0.074, 0.006); t.rotation.set(-Math.PI / 2 - 0.5, 0, 0); }
  if (q.has('side')) o.traverse((m) => { if (m.isMesh) m.material = m.material.clone(), m.material.side = THREE.FrontSide; });
  scene.add(o); const bb = new THREE.Box3().setFromObject(o), c = bb.getCenter(new THREE.Vector3()); o.position.sub(c);
} else scene.add(a);
poseAstronaut(a, n('t', 0), new THREE.Vector3(), n('reach', 0));
// pose=1: the animated pose record. lean=x,y,z legs=x,y,z support= reel= reelph= grab= drop= empty=1 stream= heat= arc=
const v3q = (k) => new THREE.Vector3(...(q.get(k) || '0,0,0').split(',').map(Number));
if (q.has('pose')) {
  const P = restPose(); P.t = n('t', 0); P.reach = n('reach', 0.2); P.lean.copy(v3q('lean')); P.legR.copy(v3q('legs')); P.legL.copy(P.legR);
  P.support = n('support', 0); P.reel = n('reel', 0); P.reelPh = n('reelph', 0); P.grab = n('grab', 0); P.drop = n('drop', 0); P.empty = !!n('empty', 0);
  P.stream = n('stream', 0); P.recoil.copy(v3q('recoil')); P.trig = n('trig', 0); P.rope.set(0.3, -0.2, 1).normalize(); P.head.copy(v3q('head'));
  if (P.empty) a.userData.stowTool(true);
  poseBody(a, P);
}
if (q.has('heat')) { const tl = partName === 'tool' ? scene.children[scene.children.length - 1] : a.userData.tool; scene.updateMatrixWorld(true); heatTool(tl, n('heat', 0), n('arc', 0), 0.3); }
const fp = n('fp', 0);
if (fp) { const u = a.userData; poseFirstPerson(u.armR, u.armL, { reach: n('reach', 0), support: n('support', 0), reel: n('reel', 0), reelPh: n('reelph', 0), drop: n('drop', 0), empty: !!n('empty', 0), recoil: v3q('recoil') });
  if (n('empty', 0)) u.armR.tool.visible = false; u.armL.glove.setCurl(0.3); u.armR.glove.setCurl(0.95);
  u.body.rotation.x = 0;
  if (fp === 2) u.body.children.forEach((c) => { if (c !== u.armR.root && c !== u.armL.root) c.visible = false; }); }
const cam = new THREE.PerspectiveCamera(n('fov', 35), innerWidth / innerHeight, 0.01, 100);
const yaw = n('yaw', 30) * Math.PI / 180, pit = n('pitch', 8) * Math.PI / 180, d = n('dist', 3.2), ty = n('y', -0.2);
if (fp === 2) { cam.position.copy(SUIT.eye); cam.fov = n('fov', 74); cam.updateProjectionMatrix(); cam.lookAt(SUIT.eye.x, SUIT.eye.y, SUIT.eye.z - 1); } else cam.position.set(Math.sin(yaw) * Math.cos(pit) * d, ty + Math.sin(pit) * d, -Math.cos(yaw) * Math.cos(pit) * d); if (fp !== 2) cam.lookAt(0, ty, 0);
// thrust=x,y,z  spin=x,y,z: fire the jetpack as the game would
if (q.has('thrust') || q.has('spin')) {
  const v3 = (k) => new THREE.Vector3(...(q.get(k) || '0,0,0').split(',').map(Number));
  a.updateMatrixWorld(true); scene.add(a.userData.jetFx); a.userData.jetFx.matrix.copy(a.userData.body.matrixWorld);
  for (let i = 0; i < 10; i++) driveJets(a, v3('thrust'), v3('spin'), i * 0.1, 0.1);
}
renderer.render(scene, cam); window.__ready = true;
