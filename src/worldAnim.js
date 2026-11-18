import * as THREE from 'three';
import { mats } from './assets.js';

// Life on the structures: rotating radar heads, blinking beacons, and torn cables that spark on drifting
// debris. Everything is pinned to the chunk it sits on, so it rides along when a wreck comes apart.

const dotTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'); const g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, '#fff'); g.addColorStop(0.3, 'rgba(255,255,255,.6)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();

// keep `obj` (posed in the site group's space) glued to a chunk node whatever that node's own transform is
function pin(site, node, obj) {
  site.group.updateMatrixWorld(true);
  const w = new THREE.Group(); w.matrixAutoUpdate = false;
  w.matrix.copy(node.matrixWorld).invert().multiply(site.group.matrixWorld);
  node.add(w); w.add(obj); return obj;
}

// blender XYZ euler (deg) -> point in the site group
const _e = new THREE.Euler(), _m = new THREE.Matrix4();
const local = (base, rotDeg, p) => new THREE.Vector3(...p).applyMatrix4(_m.makeRotationFromEuler(_e.set(...rotDeg.map((d) => d * Math.PI / 180), 'ZYX'))).add(new THREE.Vector3(...base));

function radar(scale = 1) {
  const g = new THREE.Group(), steel = mats.hull;
  const m = (geo, x, y, z) => { const o = new THREE.Mesh(geo, steel); o.position.set(x, y, z); o.castShadow = true; return o; };
  const col = (geo, c) => { const n = geo.attributes.position.count, a = new Float32Array(n * 3); const cc = new THREE.Color(c); for (let i = 0; i < n; i++) a.set([cc.r, cc.g, cc.b], i * 3); geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo; };
  g.add(m(col(new THREE.CylinderGeometry(0.5, 0.7, 1.2, 10), 0x5a6068), 0, 0.6, 0));
  const head = new THREE.Group(); head.position.y = 1.3; g.add(head);
  head.add(m(col(new THREE.CylinderGeometry(0.35, 0.35, 0.5, 10), 0x8a8f96), 0, 0, 0));
  const bar = m(col(new THREE.BoxGeometry(7, 0.35, 0.35), 0x8a8f96), 0, 0.5, 0); head.add(bar);
  const face = m(col(new THREE.BoxGeometry(6.2, 1.5, 0.12), 0xb9b09c), 0, 1.05, 0.2); face.rotation.x = -0.25; head.add(face);
  for (const x of [-3.5, 3.5]) head.add(m(col(new THREE.BoxGeometry(0.3, 0.3, 0.3), 0xff5a1f), x, 0.5, 0));
  g.scale.setScalar(scale); g.userData.head = head;
  return g;
}

const at = (o, p) => { o.position.copy(p); return o; };
function beacon(col, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(size); return s;
}

export class WorldAnim {
  constructor(world) {
    this.world = world; this.radars = []; this.beacons = [];
    const S = world.site;
    // Meridian: radar on the fore mast tip, red beacons on both mast tips
    const m = S.meridian;
    if (m) {
      const fore = m.byName.mast_fore?.node, aft = m.byName.mast_aft?.node;
      if (fore) {
        const r = radar(1); r.position.copy(local([6, 12, 60], [0, 10, 0], [0, 0.4, 14])); r.rotation.y = 10 * Math.PI / 180;
        this.radars.push({ obj: pin(m, fore, r), site: m, rate: 0.9, w: 0.9 });
        this.beacons.push({ obj: pin(m, fore, at(beacon(0xff3b2a, 5), local([6, 12, 60], [0, 10, 0], [0, 1.6, 19.6]))), site: m, period: 2.4, ph: 0 });
      }
      if (aft) this.beacons.push({ obj: pin(m, aft, at(beacon(0xff3b2a, 5), local([-4, 18, -66], [11.5, 0, 6], [0, 16.2, 1.4]))), site: m, period: 2.4, ph: 1.2 });
    }
    // Depot and freighter: a radar head on the highest point of the structure, beacons at the far ends
    for (const s of [S.depot, S.freighter, S.halves]) if (s) this.dress(s);
  }

  // find the top of a site's model (ship-free, by raycasting down onto it) and put a radar there
  dress(s) {
    const meshes = []; s.group.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const box = new THREE.Box3().setFromObject(s.group), inv = s.group.matrixWorld.clone().invert();
    const rc = new THREE.Raycaster(), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const hitDown = (x, z) => { rc.set(new THREE.Vector3(x, box.max.y + 5, z), new THREE.Vector3(0, -1, 0)); const h = rc.intersectObjects(meshes, false)[0]; return h; };
    // radar: try a few spots near the middle, keep the highest flat-ish hit
    let best = null;
    for (const [fx, fz] of [[0, 0], [0.15, 0], [-0.15, 0], [0, 0.15], [0, -0.15], [0.1, 0.25], [-0.1, -0.25]]) {
      const h = hitDown(c.x + fx * size.x, c.z + fz * size.z);
      if (h && h.face && (!best || h.point.y > best.point.y)) best = h;
    }
    const dead = s.id === 'halves';
    if (best && !dead) {
      const r = radar(s.id === 'depot' ? 0.9 : 1.1); r.position.copy(best.point).applyMatrix4(inv);
      this.radars.push({ obj: pin(s, best.object, r), site: s, rate: s.id === 'depot' ? 0.7 : 0.25, w: 0 });
    }
    // beacons near both ends of the long axis
    const long = size.x > size.z ? 'x' : 'z';
    [-0.42, 0.42].forEach((f, i) => {
      const x = long === 'x' ? c.x + f * size.x : c.x, z = long === 'z' ? c.z + f * size.z : c.z;
      const h = hitDown(x, z); if (!h) return;
      const b = beacon(dead ? 0xffa040 : s.id === 'depot' ? 0x3bff7a : 0xff3b2a, dead ? 2.5 : 4);
      b.position.copy(h.point).applyMatrix4(inv); b.position.y += 0.6;
      this.beacons.push({ obj: pin(s, h.object, b), site: s, period: dead ? 0 : 1.9, ph: i * 0.95, dying: dead });
    });
  }

  update(dt, time) {
    for (const r of this.radars) {
      // spins down when its wreck comes apart; the Meridian one hunts back and forth instead of a full sweep
      const alive = r.site.state !== 'collapsed';
      r.v = THREE.MathUtils.damp(r.v ?? r.rate, alive ? r.rate : 0, 0.4, dt);
      const head = r.obj.userData.head;
      if (r.w) head.rotation.y = Math.sin(time * 0.35 * r.v) * 2.2 + Math.sin(time * 1.1) * 0.15 * r.v;
      else head.rotation.y += r.v * dt;
    }
    for (const b of this.beacons) {
      const m = b.obj.material, s = b.site;
      if (s.state === 'collapsed') { m.opacity = 0; continue; }
      if (b.dying) { m.opacity = Math.sin(time * 13 + b.ph * 9) * Math.sin(time * 2.3 + b.ph) > 0.35 ? 0.9 : 0.02; continue; }   // shorted lamp
      const t = ((time + b.ph) % b.period) / b.period;
      m.opacity = s.state === 'unstable' ? (Math.sin(time * 25) > 0 ? 1 : 0.1) : (t < 0.06 ? 1 : 0.03);
    }
  }
}

// torn cables on some of the drifting debris: short crackling bursts of sparks near the camera
export class DebrisSparks {
  constructor(fx, K) { this.fx = fx; this.K = K; this.t = 0; }
  update(dt, fxT, debris, camPos, shipVel) {
    const fx = this.fx, K = this.K;
    for (const d of debris) {
      if (d.sparky === undefined) d.sparky = d.radius > 0.6 && Math.random() < 0.22 ? { next: Math.random() * 4, n: 0, dir: new THREE.Vector3().randomDirection() } : null;
      const s = d.sparky; if (!s) continue;
      const dist = d.pos.distanceTo(camPos); if (dist > 90) continue;
      s.next -= dt;
      if (s.next <= 0 && s.n <= 0) { s.n = 4 + Math.floor(Math.random() * 10); s.next = 1.5 + Math.random() * 5; }
      if (s.n > 0 && Math.random() < 0.6) {
        s.n--;
        const p = _p.copy(s.dir).multiplyScalar(d.radius * 0.9).applyEuler(d.euler).add(d.pos);
        for (let i = 0; i < 3; i++) {
          _v.copy(s.dir).applyEuler(d.euler).multiplyScalar(1.5 + Math.random() * 3).add(_r.randomDirection().multiplyScalar(2)).add(d.vel);
          fx.emit(p, _v, fxT, 0.25 + Math.random() * 0.4, 0.025, 0.02, Math.random() < 0.3 ? K.EMBER : K.SPARK, 0.5, 0.03);
        }
        if (Math.random() < 0.25) fx.emit(p, d.vel, fxT, 0.08, 0.3, 0.25, K.FLASH, 1.2, 0);
      }
    }
  }
}
const _p = new THREE.Vector3(), _v = new THREE.Vector3(), _r = new THREE.Vector3();
