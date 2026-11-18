import * as THREE from 'three';

// Cockpit displays, drawn on one canvas atlas that every screen samples from.
// Amber phosphor on warm black; hazard orange only for warnings. Numerals are a stroke font
// drawn here (narrow DIN-like), so they look the same on every device.

export const ATLAS = 1024;
export const RECT = {
  C: [0, 0, 512, 384],        // proximity scope + heading tape
  L: [512, 0, 512, 384],      // speed, drift, thrust
  R: [0, 384, 512, 384],      // hull, heat, rcs, assist
  G: [512, 384, 256, 256],    // standby accelerometer dial (needle is a mesh)
  HUD: [0, 768, 512, 256],    // HUD symbology in angle space (see HUD_FIELD)
  ANN: [512, 768, 512, 32],   // annunciator strip
};
// HUD canvas covers these angles (degrees) around the boresight; x right, y up
export const HUD_FIELD = { x0: -12, x1: 12, y0: 4, y1: -8 };

const AMB = '#ffb35c', AMB_D = 'rgba(255,170,90,.32)', AMB_DD = 'rgba(255,160,80,.13)', HAZ = '#ff5a1f', BONE = '#e8e0cc', BG = '#0a0706';
const MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,"DejaVu Sans Mono",monospace';

// ---- stroke numerals: segments on a 0..1 x 0..1 box (y down), narrow and squared off
const GLYPH = {
  '0': [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
  '1': [[[.25, .18], [.6, 0], [.6, 1]], [[.25, 1], [.95, 1]]],
  '2': [[[0, .12], [.15, 0], [1, 0], [1, .45], [0, 1], [1, 1]]],
  '3': [[[0, 0], [1, 0], [1, 1], [0, 1]], [[.3, .48], [1, .48]]],
  '4': [[[.75, 1], [.75, 0], [0, .68], [1, .68]]],
  '5': [[[1, 0], [0, 0], [0, .45], [1, .45], [1, 1], [0, 1]]],
  '6': [[[1, 0], [0, 0], [0, 1], [1, 1], [1, .48], [0, .48]]],
  '7': [[[0, 0], [1, 0], [.35, 1]]],
  '8': [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]], [[0, .48], [1, .48]]],
  '9': [[[0, 1], [1, 1], [1, 0], [0, 0], [0, .52], [1, .52]]],
  '-': [[[.15, .5], [.85, .5]]],
  '.': [[[.45, .92], [.55, .92], [.55, 1], [.45, 1], [.45, .92]]],
  '%': [[[0, 1], [1, 0]], [[0, 0], [.3, 0], [.3, .3], [0, .3], [0, 0]], [[.7, .7], [1, .7], [1, 1], [.7, 1], [.7, .7]]],
};

export class Instruments {
  constructor(scale = 1) {
    this.s = scale;
    const c = this.canvas = document.createElement('canvas');
    c.width = c.height = ATLAS * scale;
    this.x = c.getContext('2d');
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.tex.generateMipmaps = true; this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    // scanline overlay, drawn once
    const o = this.scan = document.createElement('canvas'); o.width = 4; o.height = 4;
    const ox = o.getContext('2d'); ox.fillStyle = 'rgba(0,0,0,.22)'; ox.fillRect(0, 3, 4, 1); ox.fillStyle = 'rgba(0,0,0,.08)'; ox.fillRect(3, 0, 1, 4);
    this.scanPat = this.x.createPattern(o, 'repeat');
    this.power = { C: 0, L: 0, R: 0, G: 0, HUD: 0, ANN: 0 };
    this.headingSm = 0;
  }

  // atlas rect -> texture UV offset/repeat
  static uv(name) { const [x, y, w, h] = RECT[name]; return { u0: x / ATLAS, v0: 1 - (y + h) / ATLAS, du: w / ATLAS, dv: h / ATLAS }; }

  // ---- drawing helpers --------------------------------------------------------------------
  num(str, x, y, h, col = AMB, w = h * .5, lw = Math.max(1.5, h * .11), align = 'left') {
    const x_ = this.x, gap = w * .42, total = str.length * w + (str.length - 1) * gap;
    if (align === 'right') x -= total; else if (align === 'center') x -= total / 2;
    x_.strokeStyle = col; x_.lineWidth = lw; x_.lineJoin = 'miter'; x_.lineCap = 'square';
    for (const ch of str) {
      const g = GLYPH[ch];
      if (g) for (const path of g) { x_.beginPath(); path.forEach(([px, py], i) => (i ? x_.lineTo : x_.moveTo).call(x_, x + px * w, y + py * h)); x_.stroke(); }
      x += w + gap;
    }
    return total;
  }
  label(t, x, y, size = 13, col = AMB_D, align = 'left') {
    const x_ = this.x; x_.font = `600 ${size}px ${MONO}`; x_.fillStyle = col; x_.textAlign = align; x_.textBaseline = 'middle';
    x_.fillText(t, x, y);
  }
  begin(name) {
    const [x, y, w, h] = RECT[name], x_ = this.x;
    x_.save(); x_.translate(x * this.s, y * this.s); x_.scale(this.s, this.s);
    x_.beginPath(); x_.rect(0, 0, w, h); x_.clip();
    x_.fillStyle = BG; x_.fillRect(0, 0, w, h);
    return [w, h];
  }
  end(name, w, h) {
    const x_ = this.x;
    // power-up: content fades in with a bright line wiping down
    const p = this.power[name];
    if (p < 1) {
      x_.fillStyle = `rgba(10,7,6,${1 - p})`; x_.fillRect(0, 0, w, h);
      if (p > 0) { x_.fillStyle = 'rgba(255,190,120,.55)'; x_.fillRect(0, h * p - 2, w, 3); }
    }
    x_.restore();
  }
  overlay(name) {
    const [x, y, w, h] = RECT[name], x_ = this.x;
    x_.save(); x_.scale(this.s, this.s); x_.fillStyle = this.scanPat; x_.fillRect(x, y, w, h);
    // edge falloff like a real panel's backlight
    const g = x_.createRadialGradient(x + w / 2, y + h / 2, h * .3, x + w / 2, y + h / 2, w * .75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.45)'); x_.fillStyle = g; x_.fillRect(x, y, w, h);
    x_.restore();
  }

  // ---- frame ------------------------------------------------------------------------------
  draw(st, dt) {
    for (const k in this.power) this.power[k] = st.on ? Math.min(1, this.power[k] + dt * (k === 'C' ? 2.2 : k === 'L' ? 2.6 : k === 'R' ? 1.9 : 3)) : 0;
    this.drawC(st); this.drawL(st); this.drawR(st); this.drawG(st); this.drawHUD(st); this.drawAnn(st);
    for (const k of ['C', 'L', 'R']) this.overlay(k);
    this.tex.needsUpdate = true;
  }

  // heading tape + tilted proximity scope with height stalks
  drawC(st) {
    const [w, h] = this.begin('C'), x = this.x;
    // heading tape
    const hd = st.heading;
    x.save(); x.beginPath(); x.rect(40, 0, w - 80, 70); x.clip();
    for (let d = Math.floor(hd / 5) * 5 - 40; d <= hd + 40; d += 5) {
      const px = w / 2 + (d - hd) * 6.2, m = ((d % 360) + 360) % 360;
      x.strokeStyle = m % 30 === 0 ? AMB : AMB_D; x.lineWidth = 2;
      x.beginPath(); x.moveTo(px, 44); x.lineTo(px, m % 10 === 0 ? 30 : 37); x.stroke();
      if (m % 30 === 0) this.num(String(m / 10).padStart(2, '0'), px, 8, 18, AMB_D, 9, 2, 'center');
    }
    x.restore();
    x.fillStyle = BG; x.fillRect(w / 2 - 34, 4, 68, 30);
    x.strokeStyle = AMB; x.lineWidth = 2; x.strokeRect(w / 2 - 34, 4, 68, 30);
    this.num(String(Math.round(((hd % 360) + 360) % 360)).padStart(3, '0'), w / 2, 10, 18, AMB, 10, 2.4, 'center');
    x.beginPath(); x.moveTo(w / 2 - 7, 44); x.lineTo(w / 2, 54); x.lineTo(w / 2 + 7, 44); x.fillStyle = AMB; x.fill();

    // scope: a disc seen at 62deg, contacts with stalks to their height
    const cx = w / 2, cy = 228, R = 190, tilt = .42, RANGE = st.range;
    x.strokeStyle = AMB_DD; x.lineWidth = 1.5;
    for (const f of [1 / 3, 2 / 3, 1]) { x.beginPath(); x.ellipse(cx, cy, R * f, R * f * tilt, 0, 0, 7); x.stroke(); }
    x.strokeStyle = AMB_D;
    x.beginPath(); x.ellipse(cx, cy, R, R * tilt, 0, 0, 7); x.stroke();
    for (let a = 0; a < 12; a++) { const s = Math.sin(a * Math.PI / 6), c = Math.cos(a * Math.PI / 6); x.beginPath(); x.moveTo(cx + s * R * .97, cy - c * R * tilt * .97); x.lineTo(cx + s * R, cy - c * R * tilt); x.stroke(); }
    // forward cone
    x.strokeStyle = AMB_DD; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx - R * .38, cy - R * tilt * .92); x.moveTo(cx, cy); x.lineTo(cx + R * .38, cy - R * tilt * .92); x.stroke();
    // contacts, far first so near ones draw on top
    const pts = st.contacts; pts.sort((a, b) => b.d - a.d);
    for (const p of pts) {
      let sx = p.x / RANGE, sz = p.z / RANGE, sy = p.y / RANGE;
      const r = Math.hypot(sx, sz); let edge = false;
      if (r > 1) { sx /= r; sz /= r; sy /= r; edge = true; }
      const bx = cx + sx * R, by = cy + sz * R * tilt, ty = by - sy * R * .55;
      const near = p.d < 25, col = p.kind === 0 ? (near ? HAZ : AMB) : p.kind === 1 ? AMB_D : AMB_DD;
      x.strokeStyle = col; x.fillStyle = col; x.lineWidth = 1.6;
      if (!edge) { x.beginPath(); x.moveTo(bx, by); x.lineTo(bx, ty); x.stroke(); }
      if (p.kind === 0) { const s = edge ? 3 : 5 + Math.min(4, p.r); x.fillRect(bx - s / 2, ty - s / 2, s, s); }
      else if (p.kind === 1) { x.fillRect(bx - 3, ty - 3, 6, 6); }
      else { x.beginPath(); x.arc(bx, ty, 1.6, 0, 7); x.fill(); }
    }
    // own ship
    x.fillStyle = BONE; x.beginPath(); x.moveTo(cx, cy - 9); x.lineTo(cx + 6, cy + 6); x.lineTo(cx, cy + 3); x.lineTo(cx - 6, cy + 6); x.fill();
    // velocity vector on the disc
    const vx = st.vl.x / 40, vz = st.vl.z / 40, vm = Math.hypot(vx, vz);
    if (vm > .02) { const k = Math.min(1, vm) / vm; x.strokeStyle = BONE; x.lineWidth = 2; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + vx * k * R * .5, cy + vz * k * R * tilt * .5); x.stroke(); }
    this.label('RNG', 22, h - 22); this.num(String(RANGE), 66, h - 31, 18, AMB_D, 9, 2);
    if (st.nearest < 999) { this.label('PROX', w - 120, h - 22, 13, st.nearest < 25 ? HAZ : AMB_D); this.num(String(Math.round(st.nearest)).padStart(3, '0'), w - 22, h - 31, 18, st.nearest < 25 ? HAZ : AMB, 9, 2, 'right'); }
    this.end('C', w, h);
  }

  drawL(st) {
    const [w, h] = this.begin('L'), x = this.x;
    // big speed
    this.label('SPD', 26, 30);
    const sp = Math.round(st.speed);
    this.num(String(sp).padStart(3, '0'), 26, 50, 92, sp > 58 ? HAZ : AMB, 44, 8);
    this.label('M/S', 210, 132);
    // speed track 0..100 with the assist cap
    const tx = 26, ty = 166, tw = 220;
    x.fillStyle = AMB_DD; x.fillRect(tx, ty, tw, 10);
    x.fillStyle = sp > 58 ? HAZ : AMB; x.fillRect(tx, ty, tw * Math.min(1, st.speed / 100), 10);
    x.fillStyle = BONE; x.fillRect(tx + tw * .58 - 1, ty - 6, 2, 22);
    for (let i = 0; i <= 10; i++) { x.fillStyle = AMB_D; x.fillRect(tx + tw * i / 10 - 1, ty + 14, 2, i % 5 ? 4 : 8); }
    // drift box: lateral (x) and vertical (y) velocity in ship axes
    const bx = 96, by = 282, bs = 66;
    x.strokeStyle = AMB_D; x.lineWidth = 1.5; x.strokeRect(bx - bs, by - bs, bs * 2, bs * 2);
    x.beginPath(); x.moveTo(bx - bs, by); x.lineTo(bx + bs, by); x.moveTo(bx, by - bs); x.lineTo(bx, by + bs); x.strokeStyle = AMB_DD; x.stroke();
    x.strokeStyle = AMB_D; x.strokeRect(bx - bs * .25, by - bs * .25, bs * .5, bs * .5);
    const dx = THREE.MathUtils.clamp(st.vl.x / 20, -1, 1), dy = THREE.MathUtils.clamp(-st.vl.y / 20, -1, 1);
    x.strokeStyle = AMB; x.lineWidth = 2.5; x.beginPath(); x.moveTo(bx, by); x.lineTo(bx + dx * bs, by + dy * bs); x.stroke();
    x.fillStyle = Math.hypot(st.vl.x, st.vl.y) > 8 ? HAZ : AMB; x.beginPath(); x.arc(bx + dx * bs, by + dy * bs, 6, 0, 7); x.fill();
    this.label('DRIFT', bx - bs, by - bs - 14);
    // thrust bars: main (with boost band), then the three translation axes
    const gx = 200, gy = 216, gh = 128;
    const bar = (x0, v, lab, signed) => {
      x.strokeStyle = AMB_D; x.lineWidth = 1.5; x.strokeRect(x0, gy, 30, gh);
      if (signed) {
        x.fillStyle = AMB_DD; x.fillRect(x0, gy + gh / 2 - 1, 30, 2);
        const hh = gh / 2 * Math.min(1, Math.abs(v)); x.fillStyle = AMB; x.fillRect(x0 + 4, v > 0 ? gy + gh / 2 - hh : gy + gh / 2, 22, hh);
      } else {
        const hh = (gh - 8) * Math.min(1, v); x.fillStyle = AMB; x.fillRect(x0 + 4, gy + gh - 4 - hh, 22, hh);
      }
      this.label(lab, x0 + 15, gy + gh + 16, 12, AMB_D, 'center');
    };
    bar(gx, st.main, 'THR');
    if (st.boost > .02) { x.fillStyle = HAZ; x.fillRect(gx + 4, gy + 4, 22, (gh - 8) * .3 * st.boost); }
    bar(gx + 52, st.th.fwd, 'Z', true);
    bar(gx + 94, st.th.strafe, 'X', true);
    bar(gx + 136, st.th.vert, 'Y', true);
    // engine temperature
    this.label('EGT', 330, 30); x.strokeStyle = AMB_D; x.strokeRect(330, 46, 150, 12);
    x.fillStyle = st.heat > .85 ? HAZ : AMB; x.fillRect(332, 48, 146 * Math.min(1, st.heat), 8);
    this.label('BOOST', 330, 86, 13, st.boost > .02 ? HAZ : AMB_DD);
    this.label('BRAKE', 330, 112, 13, st.brake ? AMB : AMB_DD);
    this.end('L', w, h);
  }

  drawR(st) {
    const [w, h] = this.begin('R'), x = this.x;
    // top-view hull silhouette, segments light by integrity
    const cx = 150, cy = 190, k = 52;
    const P = (pts) => { x.beginPath(); pts.forEach(([px, pz], i) => (i ? x.lineTo : x.moveTo).call(x, cx + px * k, cy + pz * k)); x.closePath(); };
    const hull = st.hull, segs = 10, lit = Math.ceil(hull * segs - 1e-6), low = lit <= 3;
    const flick = low && (st.t * 4 % 1) < .5;
    const part = (pts, i) => { P(pts); x.strokeStyle = i < lit ? (low ? (flick ? HAZ : AMB_D) : AMB) : AMB_DD; x.lineWidth = 2.2; x.stroke(); if (i < lit) { x.fillStyle = 'rgba(255,170,90,.08)'; x.fill(); } };
    part([[-.25, -2.2], [.25, -2.2], [.7, -.4], [.8, 1.6], [-.8, 1.6], [-.7, -.4]], 9);
    part([[.8, -.4], [2.35, .68], [2.35, 1.25], [.8, 1.55]], 7);
    part([[-.8, -.4], [-2.35, .68], [-2.35, 1.25], [-.8, 1.55]], 5);
    part([[.3, .2], [1.04, .2], [1.04, 1.9], [.3, 1.9]], 3);
    part([[-.3, .2], [-1.04, .2], [-1.04, 1.9], [-.3, 1.9]], 1);
    // integrity readout
    this.label('HULL', 320, 40);
    this.num(String(Math.round(hull * 100)).padStart(3, '0'), 320, 58, 60, low ? HAZ : AMB, 28, 5.5);
    for (let i = 0; i < segs; i++) { x.fillStyle = i < lit ? (low ? HAZ : AMB) : AMB_DD; x.fillRect(320 + i * 16, 136, 11, 18); }
    // RCS: six arrows light with the translation and rotation the jets are working on
    const rx = 400, ry = 250, a = st.rcs;
    const arrow = (dx, dy, v) => {
      x.save(); x.translate(rx + dx * 46, ry + dy * 46); x.rotate(Math.atan2(dy, dx));
      x.beginPath(); x.moveTo(12, 0); x.lineTo(-6, -9); x.lineTo(-6, 9); x.closePath();
      x.fillStyle = v > .08 ? AMB : AMB_DD; x.globalAlpha = .35 + .65 * Math.min(1, v); x.fill(); x.restore(); x.globalAlpha = 1;
    };
    arrow(1, 0, Math.max(0, a.x)); arrow(-1, 0, Math.max(0, -a.x)); arrow(0, -1, Math.max(0, a.y)); arrow(0, 1, Math.max(0, -a.y));
    x.strokeStyle = AMB_D; x.lineWidth = 1.5; x.beginPath(); x.arc(rx, ry, 14, 0, 7); x.stroke();
    x.beginPath(); x.arc(rx, ry, 30, -Math.PI / 2 - .9 * a.r, -Math.PI / 2 + .9 * a.r, a.r < 0); x.strokeStyle = Math.abs(a.r) > .08 ? AMB : AMB_DD; x.lineWidth = 3; x.stroke();
    this.label('RCS', rx, ry + 78, 13, AMB_D, 'center');
    // flight assist state
    x.strokeStyle = st.assist ? AMB : AMB_D; x.lineWidth = 2; x.strokeRect(300, 330, 190, 34);
    if (st.assist) { x.fillStyle = 'rgba(255,170,90,.14)'; x.fillRect(300, 330, 190, 34); }
    this.label(st.assist ? 'ASSIST' : 'FREE', 395, 347, 15, st.assist ? AMB : HAZ, 'center');
    this.end('R', w, h);
  }

  drawG(st) {
    const [w, h] = this.begin('G'), x = this.x, cx = w / 2, cy = h / 2;
    x.fillStyle = '#0c0b0a'; x.fillRect(0, 0, w, h);
    const a0 = Math.PI * .75, span = Math.PI * 1.5;
    for (let i = 0; i <= 20; i++) {
      const a = a0 + span * i / 20, r0 = i % 2 ? 98 : 88, c = Math.cos(a), s = Math.sin(a);
      x.strokeStyle = i >= 14 ? HAZ : BONE; x.lineWidth = i % 2 ? 2 : 4;
      x.beginPath(); x.moveTo(cx + c * r0, cy + s * r0); x.lineTo(cx + c * 108, cy + s * 108); x.stroke();
      if (i % 4 === 0) this.num(String(i / 2), cx + c * 68, cy + s * 68 - 11, 22, BONE, 11, 2.6, 'center');
    }
    // peak-hold marker
    const pa = a0 + span * Math.min(1, st.gPeak / 10);
    x.fillStyle = HAZ; x.beginPath(); x.arc(cx + Math.cos(pa) * 114, cy + Math.sin(pa) * 114, 4, 0, 7); x.fill();
    this.label('G', cx, cy + 52, 18, BONE, 'center');
    this.end('G', w, h);
  }

  // HUD: drawn in angle space; the glass shader maps each pixel's view direction back here, so it's collimated
  drawHUD(st) {
    const [, , w, h] = RECT.HUD, x = this.x, F = HUD_FIELD;
    x.save(); x.translate(RECT.HUD[0] * this.s, RECT.HUD[1] * this.s); x.scale(this.s, this.s);
    x.clearRect(0, 0, w, h); x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
    const px = (ax) => (ax - F.x0) / (F.x1 - F.x0) * w, py = (ay) => (ay - F.y0) / (F.y1 - F.y0) * h, ppd = w / (F.x1 - F.x0);
    const C = '#ffd2a0';
    x.strokeStyle = C; x.fillStyle = C; x.lineWidth = 3; x.lineCap = 'round';
    // boresight cross
    const bx = px(0), by = py(0);
    x.beginPath(); x.moveTo(bx - 14, by); x.lineTo(bx - 5, by); x.moveTo(bx + 5, by); x.lineTo(bx + 14, by); x.moveTo(bx, by - 14); x.lineTo(bx, by - 5); x.stroke();
    // pitch ladder against the planet
    x.save(); x.beginPath(); x.rect(30, 20, w - 60, h - 40); x.clip();
    const roll = st.roll, cr = Math.cos(roll), sr = Math.sin(roll);
    for (let p = -90; p <= 90; p += 10) {
      const off = (p - st.pitch);
      if (Math.abs(off) > 20) continue;
      const ox = bx - sr * off * ppd, oy = by - cr * off * ppd;
      const L = p === 0 ? 150 : 46, g = p === 0 ? 40 : 26;
      x.lineWidth = p === 0 ? 3.2 : 2.6; x.setLineDash(p < 0 ? [8, 6] : []);
      x.beginPath();
      for (const s of [-1, 1]) { x.moveTo(ox + cr * s * g, oy - sr * s * g); x.lineTo(ox + cr * s * (g + L), oy - sr * s * (g + L)); }
      x.stroke(); x.setLineDash([]);
      if (p !== 0) for (const s of [-1, 1]) { const ex = ox + cr * s * (g + L), ey = oy - sr * s * (g + L); x.beginPath(); x.moveTo(ex, ey); x.lineTo(ex + sr * (p > 0 ? 8 : -8), ey + cr * (p > 0 ? 8 : -8)); x.stroke(); }
    }
    x.restore();
    // flight path marker (where you're actually going); clamps to the glass edge and turns dashed
    if (st.speed > 1.2) {
      let ax = st.fpm.x, ay = st.fpm.y, clamped = false;
      const lx = F.x1 - 1.4, ly0 = F.y1 + 1.2, ly1 = F.y0 - 1.2;
      if (st.fpm.back || ax < -lx || ax > lx || ay < ly0 || ay > ly1) { clamped = true; ax = THREE.MathUtils.clamp(ax, -lx, lx); ay = THREE.MathUtils.clamp(ay, ly0, ly1); }
      const fx = px(ax), fy = py(ay), r = 9;
      x.strokeStyle = st.fpm.back ? HAZ : C; x.lineWidth = 3.2; x.setLineDash(clamped ? [4, 4] : []);
      x.beginPath(); x.arc(fx, fy, r, 0, 7); x.stroke(); x.setLineDash([]);
      x.beginPath(); x.moveTo(fx - r, fy); x.lineTo(fx - r - 12, fy); x.moveTo(fx + r, fy); x.lineTo(fx + r + 12, fy); x.moveTo(fx, fy - r); x.lineTo(fx, fy - r - 8); x.stroke();
      if (st.fpm.back) { x.beginPath(); x.moveTo(fx - 6, fy - 6); x.lineTo(fx + 6, fy + 6); x.moveTo(fx + 6, fy - 6); x.lineTo(fx - 6, fy + 6); x.stroke(); }
    }
    // speed (left) and heading (top), small
    this.num(String(Math.round(st.speed)).padStart(3, '0'), 40, by - 11, 22, C, 11, 3);
    this.num(String(Math.round(((st.heading % 360) + 360) % 360)).padStart(3, '0'), bx, 18, 20, C, 10, 2.8, 'center');
    if (this.power.HUD < 1) { x.fillStyle = `rgba(0,0,0,${1 - this.power.HUD})`; x.fillRect(0, 0, w, h); }
    x.restore();
  }

  drawAnn(st) {
    const [w, h] = this.begin('ANN'), x = this.x;
    const cells = [['MASTER', st.caution, true], ['ASSIST', st.assist], ['BOOST', st.boost > .05], ['BRAKE', st.brake], ['PROX', st.nearest < 25, true], ['HULL', st.hull <= .3, true]];
    const cw = w / cells.length;
    cells.forEach(([t, on, warn], i) => {
      const blink = warn && on && (st.t * 3 % 1) < .5;
      x.fillStyle = on ? (warn ? (blink ? HAZ : '#5a1e0a') : '#5a3d1c') : '#120d0a'; x.fillRect(i * cw + 2, 2, cw - 4, h - 4);
      this.label(t, i * cw + cw / 2, h / 2 + 1, 13, on ? (warn ? (blink ? '#1a0a04' : HAZ) : '#ffd9a8') : 'rgba(255,170,90,.18)', 'center');
    });
    this.end('ANN', w, h);
  }
}
