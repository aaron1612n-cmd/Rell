import * as THREE from 'three';
import { NOZZLES } from './rcs.js';
import { Plume, PALETTE } from './plume.js';
import { Engine } from './engine.js';
import shipData from './assets/ship.json';
import { rigShip } from './shipRig.js';

// Wraps the authored ship model (src/assets/ship.glb) and adds the live bits: engine glow, engine light, RCS flames.
const POD_AFT = 1.69;   // z of the engine pods' aft face (tools/blender/ship.py)

export function buildShip(model, coarse = false) {
  const g = new THREE.Group();
  const body = model.clone(); g.add(body);
  const rig = rigShip(body);   // canopy + vanes on hinges
  // engine plumes: soft shader gas jets, pointing aft (+Z)
  // main engines: procedural turbine rockets on gimbals (src/engine.js), mounted on each pod's aft face.
  // The plume rides on the nozzle's exit plane so it follows the gimbal.
  const engines = shipData.glow.map(([x, y]) => { const e = new Engine(coarse, Math.sign(x)); e.position.set(x, y, POD_AFT); e.gimbal(0, 0); g.add(e); return e; });
  const glows = engines.map((e) => { const m = new Plume(PALETTE.engine, { octaves: coarse ? 2 : 3 }); e.exit.add(m); return m; });
  const light = new THREE.PointLight(0xff6a2a, 0, 16, 1.6); light.position.set(0, 0, 3.4); g.add(light);
  // RCS: a tiny cool puff per nozzle (layout authored with the model)
  const q = new THREE.Quaternion(), zp = new THREE.Vector3(0, 0, 1);
  const nubs = NOZZLES.map((n) => {
    q.setFromUnitVectors(zp, n.dir);
    const f = new Plume(PALETTE.rcs, { octaves: 2 }); f.position.copy(n.pos).addScaledVector(n.dir, 0.04); f.quaternion.copy(q); g.add(f);
    return f;
  });
  // nav lights: red port, green starboard, white tail strobe (sprites, driven from main.js)
  const dot = new THREE.CanvasTexture((() => { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'); const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 32, 32); return c; })());
  const navs = (shipData.nav || [[-2.45, -0.05, 1.0, 0xff3b2a], [2.45, -0.05, 1.0, 0x3bff7a], [0, 0.9, 2.0, 0xffffff]]).map(([x, y, z, col]) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.position.set(x, y, z); sp.scale.setScalar(0.4); g.add(sp); return sp;
  });
  // extra running lights: mast beacon, leading-edge chasers, pod warning beacons (timed in main.js navFx)
  const spr = (x, y, z, col, s) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); sp.position.set(x, y, z); sp.scale.setScalar(s); g.add(sp); return sp; };
  const beacon = spr(0.32, 1.02, 0.1, 0xff3b2a, 0.3);
  const chase = [];
  for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) {
    const x = 0.95 + i * 0.25, z = -0.4 + (x - 0.5) * (1.08 / 1.85) - 0.06;
    chase.push({ sp: spr(sx * x, -0.1, z, 0xffb347, 0.13), i });
  }
  const pods = [-1, 1].map((sx) => spr(sx * 0.66, 0.4, 1.15, 0xff5a1f, 0.22));
  g.userData = { glows, light, nubs, navs, engines, rig, body, lights: { beacon, chase, pods } };
  return g;
}
