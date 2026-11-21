import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Bake } from './bake.js';

// Hangar berths: telescoping pressure tubes that slide out of the bay's flank. Built in the berth frame: +x outward
// from the flank, y up, z across. Every section is a closed rectangular tube with a 0.6 m shell (0.3 plate, 0.3 ribs
// on the outside) and nests inside its parent with 0.2 m of clearance, so nothing intersects while it extends.
//   section j has half-width  hw_j = hw_root - j * STEP   (root is the widest, the last section the narrowest)
// The root is built as four hinged panels (floor, roof, two walls) that unfold off the flank; the others slide.
// The outer end is a portal frame with two blast leaves that swing open for traffic and close behind it.

export const STEP = 0.8;        // per side, between nested sections
export const SHELL = 0.6;
export const PORTAL = 1.0;      // how far the portal frame lips in from the last section's inner face
const COL = { plateA: 0xb6b2a5, plateB: 0xa7a396, rib: 0x3d4249, slate: 0x4a4f55, dark: 0x1c1e22, orange: 0xe8561a, base: 0x5a5d62, steel: 0x8e949a };

// one panel of a tube, built in the tube's final pose. kind: floor | roof | wallA | wallB
// o.ring: 'joint' (a lipped ring that closes the gap to the next section) | 'portal' (the heavy end frame)
function panel(kind, W, H, Ls, o = {}) {
  const B = new Bake(), hw = W / 2, hh = H / 2;
  const portal = o.ring === 'portal', ringD = portal ? 0.9 : 0.45, x1 = Ls - ringD;
  const X = (c, s, col) => B.box(c, s, { kind: 'hull', color: col, seg: 6 });
  const LAMP = (c, s, col, k) => B.box(c, s, { kind: 'lamp', color: col, k, seg: 9 });
  const horiz = kind === 'floor' || kind === 'roof';
  const sg = kind === 'floor' || kind === 'wallA' ? -1 : 1;
  const tiles = Math.max(1, Math.round(x1 / 4)), tl = x1 / tiles;
  if (horiz) {
    const w = W - 2 * SHELL, yc = sg * (hh - 0.45);
    for (let i = 0; i < tiles; i++) X([i * tl + tl / 2, yc, 0], [tl, 0.3, w], i % 2 ? COL.plateB : COL.plateA);
    for (const s of [-1, 1]) X([x1 / 2, sg * (hh - 0.3), s * (hw - 0.3)], [x1, SHELL, SHELL], COL.slate);                 // corner posts
    for (let x = 0.4; x < x1 - 0.3; x += 2.4) X([x, sg * (hh - 0.12), 0], [0.5, 0.36, w], COL.rib);                    // hoops
    const ns = Math.max(1, Math.round(w / 4));
    for (let i = 0; i < ns; i++) X([x1 / 2, sg * (hh - 0.15), -w / 2 + (i + 0.5) * w / ns], [x1 - 0.2, 0.3, 0.4], COL.slate); // stringers
    const yi = sg * (hh - SHELL);                                                                                     // the inside face
    if (sg < 0) {
      for (const s of [-1, 1]) X([x1 / 2, yi + 0.015, s * (hw - 2.4)], [x1 - 1, 0.03, 0.45], COL.orange);
      for (let x = 1.5; x < x1 - 1; x += 3) X([x, yi + 0.015, 0], [0.18, 0.03, w - 1.5], 0x30343a);
    } else {
      for (const s of [-1, 1]) LAMP([x1 / 2, yi - 0.03, s * hw * 0.42], [Math.max(1, x1 - 1.4), 0.05, 0.5], 0xd6ecff, 2.4);
    }
  } else {
    const h = H - 2 * SHELL, zc = sg * (hw - 0.45);
    for (let i = 0; i < tiles; i++) X([i * tl + tl / 2, 0, zc], [tl, h, 0.3], i % 2 ? COL.plateB : COL.plateA);
    for (let x = 0.4; x < x1 - 0.3; x += 2.4) X([x, 0, sg * (hw - 0.12)], [0.5, h, 0.36], COL.rib);
    const ns = Math.max(1, Math.round(h / 4));
    for (let i = 0; i < ns; i++) X([x1 / 2, -h / 2 + (i + 0.5) * h / ns, sg * (hw - 0.15)], [x1 - 0.2, 0.4, 0.3], COL.slate);
    const zi = sg * (hw - SHELL);
    LAMP([x1 / 2, h * 0.18, zi - sg * 0.03], [Math.max(1, x1 - 1.4), 0.3, 0.05], 0xffd9a8, 2.2);
    X([x1 / 2, -h / 2 + 1.6, zi - sg * 0.015], [x1 - 1, 0.45, 0.03], COL.orange);
  }
  // the end ring: closes the sliver to the child section (joint) or frames the door (portal)
  const inner = portal ? PORTAL : STEP - 0.02, ob = portal ? 0.5 : 0.15, x0 = Ls - ringD;
  const yr = [hh - SHELL - (portal ? PORTAL - SHELL : inner - SHELL), hh + ob], zr = [hw - SHELL - (portal ? PORTAL - SHELL : inner - SHELL), hw + ob];
  // ring bars: top/bottom span the full width, the side bars fit between them
  if (horiz) {
    const lo = yr[0], hi = yr[1];
    X([x0 + (ringD - 0.04) / 2, sg * (lo + hi) / 2, 0], [ringD - 0.04, hi - lo, 2 * zr[1]], COL.slate);
    const n = Math.max(2, Math.floor(2 * zr[1] / 1.2)), sl = 2 * zr[1] / n;
    for (let i = 0; i < n; i++) X([Ls - 0.02, sg * (lo + hi) / 2, -zr[1] + (i + 0.5) * sl], [0.04, hi - lo - 0.1, sl * 0.98], i % 2 ? COL.dark : COL.orange);
  } else {
    const lo = zr[0], hi = zr[1], ylim = yr[0];
    X([x0 + (ringD - 0.04) / 2, 0, sg * (lo + hi) / 2], [ringD - 0.04, 2 * ylim, hi - lo], COL.slate);
    const n = Math.max(2, Math.floor(2 * ylim / 1.2)), sl = 2 * ylim / n;
    for (let i = 0; i < n; i++) X([Ls - 0.02, -ylim + (i + 0.5) * sl, sg * (lo + hi) / 2], [0.04, sl * 0.98, hi - lo - 0.1], i % 2 ? COL.dark : COL.orange);
  }
  if (portal && horiz) for (const s of [-1, 1]) LAMP([Ls + 0.02, sg * (hh + 0.1), s * (hw + 0.1)], [0.08, 0.35, 0.35], 0xffa040, 3);
  return B.finish();
}

const merge = (gs) => { const a = gs.filter((g) => g && g.attributes.position.count); return a.length ? mergeGeometries(a, false) : null; };

// all four panels merged: one mesh for a sliding section
export function sectionGeometry(W, H, Ls, last) {
  const ring = last ? 'portal' : 'joint', ps = ['floor', 'roof', 'wallA', 'wallB'].map((k) => panel(k, W, H, Ls, { ring }));
  return { hull: merge(ps.map((p) => p.hull)), lamp: merge(ps.map((p) => p.lamp)) };
}
// the root's panels, each with its hinge line at the origin
export function rootPanels(W, H, Ls) {
  const hw = W / 2, hh = H / 2, ps = {};
  for (const [k, shift] of [['floor', [0, hh - 0.3, 0]], ['roof', [0, -(hh - 0.3), 0]], ['wallA', [0, 0, hw - 0.3]], ['wallB', [0, 0, -(hw - 0.3)]]]) {
    const p = panel(k, W, H, Ls, { ring: 'joint' });
    p.hull.translate(...shift); if (p.lamp.attributes.position.count) p.lamp.translate(...shift);
    ps[k] = p;
  }
  return { ps, hw, hh };
}
// the wall of the bay the root bolts to, with a hatch-frame look, and a collar closing the gap to the flank
export function backWall(W, H) {
  const B = new Bake(), hw = W / 2, hh = H / 2, X = (c, s, col) => B.box(c, s, { kind: 'hull', color: col, seg: 6 });
  X([-0.35, 0, 0], [1.1, H, W], COL.base);                                                   // collar: x -0.9 .. 0.2
  X([0.21, 0, 0], [0.02, H - 2 * SHELL, W - 2 * SHELL], 0x8e8b82);
  for (let k = -3; k <= 3; k++) X([0.23, 0, k * (W - 3) / 7], [0.04, H - 2 * SHELL - 1, 0.25], 0x6b6e70);
  X([0.25, hh - 1.6, 0], [0.04, 0.4, W - 3], COL.orange);
  for (const s of [-1, 1]) B.box([0.27, hh - 3.0, s * (hw - 2.4)], [0.06, 0.4, 1.4], { kind: 'lamp', color: 0xffa040, k: 2.6, seg: 9 });
  return B.finish();
}
// one blast leaf, hinged at its +x-end edge. Pivot at the hinge line, the leaf extends toward -z (mirror for the other side).
export function leafGeometry(wl, hl) {
  const B = new Bake(), X = (c, s, col) => B.box(c, s, { kind: 'hull', color: col, seg: 6 });
  X([0, 0, -wl / 2], [0.36, hl, wl], COL.plateA);
  for (let z = -1.2; z > -wl + 0.4; z -= 2.4) { X([0.24, 0, z], [0.14, hl - 0.4, 0.4], COL.rib); X([-0.24, 0, z], [0.14, hl - 0.4, 0.4], COL.rib); }
  for (let y = -hl / 2 + 1.5; y < hl / 2 - 0.5; y += 4) X([0.22, y, -wl / 2], [0.1, 0.4, wl - 0.4], COL.slate);
  const n = Math.max(2, Math.floor(hl / 1.2)), sl = (hl - 0.4) / n;
  for (let i = 0; i < n; i++) X([0.2, -hl / 2 + 0.2 + (i + 0.5) * sl, -wl + 0.35], [0.1, sl * 0.98, 0.7], i % 2 ? COL.dark : COL.orange);   // free-edge chevrons
  X([0, 0, -0.35], [0.5, hl, 0.7], COL.base);                                                // hinge stile
  B.box([0.19, hl / 2 - 0.5, -wl / 2], [0.04, 0.2, wl - 2], { kind: 'lamp', color: 0xffa040, k: 2.4, seg: 9 });
  return B.finish();
}
// hydraulic ram barrel (static) and its chrome rod (unit length along x, scaled per frame)
export function ramGeometry(len, r) {
  const B = new Bake();
  B.cyl([len / 2, 0, 0], r, len, 'x', { kind: 'hull', color: COL.slate, sides: 14, seg: 6 });
  B.cyl([0.3, 0, 0], r * 1.25, 0.6, 'x', { kind: 'hull', color: COL.orange, sides: 14, seg: 6 });
  B.cyl([len, 0, 0], r * 1.2, 0.5, 'x', { kind: 'hull', color: COL.dark, sides: 14, seg: 6 });
  return B.finish();
}
export const rodGeometry = () => new THREE.CylinderGeometry(1, 1, 1, 10, 1).rotateZ(Math.PI / 2).translate(0.5, 0, 0);

// colliders of a section's shell in its own frame at x offset `x`
export function sectionObbs(W, H, Ls, x, last) {
  const hw = W / 2, hh = H / 2, t = 0.36, o = [];
  o.push({ c: [x + Ls / 2, -hh + 0.3, 0], q: [0, 0, 0, 1], h: [Ls / 2, t, hw] }, { c: [x + Ls / 2, hh - 0.3, 0], q: [0, 0, 0, 1], h: [Ls / 2, t, hw] });
  o.push({ c: [x + Ls / 2, 0, -hw + 0.3], q: [0, 0, 0, 1], h: [Ls / 2, hh, t] }, { c: [x + Ls / 2, 0, hw - 0.3], q: [0, 0, 0, 1], h: [Ls / 2, hh, t] });
  if (last) {   // the portal frame: bars from 1.0 m inside the shell to 0.5 m outside it, over the last 0.9 m
    const cx = x + Ls - 0.45;
    for (const sy of [-1, 1]) o.push({ c: [cx, sy * (hh - 0.25), 0], q: [0, 0, 0, 1], h: [0.45, 0.8, hw + 0.5] });
    for (const sz of [-1, 1]) o.push({ c: [cx, 0, sz * (hw - 0.25)], q: [0, 0, 0, 1], h: [0.45, hh - PORTAL, 0.8] });
  }
  return o;
}
