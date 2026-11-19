"""Hero ship: salvage skiff. Nose -Z, up +Y, wings +-X. Run: python tools/blender/ship.py

Rebuilt as sculpted surfaces: the hull, wings, fin, pods and canopy are lofts through dense sections
(superellipse hull, airfoil wings and fin, lathed nacelles), painted with a panelled livery in vertex
colours; hard-surface bits are limited to small details. Moving parts stay separate objects: canopy,
flap_l / flap_r and dish. Numbers that other code reads (nozzles, pods at x=+-.66, aft face z=1.69,
canopy table, mast at (0,1.55,1.55), nav lights) are kept.
"""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(__file__))
from kit import *
from mathutils import Vector

k = Kit('ship', seed=7)
k.maxlen = 0.12

# ---- helpers -------------------------------------------------------------------------
def hermite(tab, x):
    """Monotone-ish cubic through tab [(x, v...)]; returns tuple of values."""
    n = len(tab)
    if x <= tab[0][0]: return tuple(tab[0][1:])
    if x >= tab[-1][0]: return tuple(tab[-1][1:])
    i = 0
    while tab[i + 1][0] < x: i += 1
    x0, x1 = tab[i][0], tab[i + 1][0]; t = (x - x0) / (x1 - x0)
    out = []
    for c in range(1, len(tab[0])):
        v0, v1 = tab[i][c], tab[i + 1][c]
        def slope(j):
            if j <= 0 or j >= n - 1:
                a, b = (tab[0], tab[1]) if j <= 0 else (tab[-2], tab[-1])
                return (b[c] - a[c]) / (b[0] - a[0])
            return (tab[j + 1][c] - tab[j - 1][c]) / (tab[j + 1][0] - tab[j - 1][0])
        s0, s1 = slope(i), slope(i + 1)
        # clamp tangents so the curve cannot overshoot the segment
        d = (v1 - v0) / (x1 - x0)
        if d == 0: s0 = s1 = 0
        else:
            s0 = max(0, min(s0 / d, 3)) * d; s1 = max(0, min(s1 / d, 3)) * d
        h = x1 - x0
        t2, t3 = t * t, t * t * t
        out.append((2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * h * s0 + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * h * s1)
    return tuple(out)

def sgp(v, e): return math.copysign(abs(v) ** e, v)
def hsh(*a):
    h = 2166136261
    for v in a: h = ((h ^ int(v)) * 16777619) & 0xffffffff
    return h / 0xffffffff
def shade(c, f):
    r, g, b = (c >> 16) & 255, (c >> 8) & 255, c & 255
    return (min(255, int(r * f)) << 16) | (min(255, int(g * f)) << 8) | min(255, int(b * f))

# ---- fuselage ------------------------------------------------------------------------
PROFILE = [(-2.25, .10, .08), (-1.95, .26, .19), (-1.3, .50, .38), (-0.4, .70, .50), (.6, .82, .55), (1.6, .78, .52), (1.88, .58, .42)]
NEXP = [(-2.25, 2.0), (-1.3, 2.4), (-0.4, 3.0), (.6, 3.3), (1.88, 2.8)]
def hull_wh(z):
    z = max(PROFILE[0][0], min(PROFILE[-1][0], z))
    return hermite(PROFILE, z)
def prof(z): return hull_wh(z)   # (w, h)

def hull_ring(z, segs=36):
    w, h = hull_wh(z); n = hermite(NEXP, z)[0]
    pts = []
    for j in range(segs):
        t = 2 * math.pi * j / segs; c, s = math.cos(t), math.sin(t)
        x = w * sgp(c, 2 / n)
        y = h * sgp(s, 2 / n) * (1.0 if s > 0 else 0.96)
        # shoulders: the upper deck is a touch narrower than the flanks, like a lifting body
        if s > 0: x *= 1 - 0.10 * s
        pts.append(Vector((x, y, z)))
    return pts

SEAMS = [-1.95, -1.3, -.4, .6, 1.2]
def hull_color(p, nrm):
    w, h = hull_wh(p.z); yn = p.y / h
    if p.z < -2.04: return SLATE_D                       # radome tip
    if any(abs(p.z - s) < .014 for s in SEAMS): return shade(BONE_D, .5)      # panel seams
    if abs(p.x) < .02 and p.y > 0: return shade(BONE_D, .55)                  # centre seam
    if p.z > 1.62: return SLATE if yn > -.3 else SLATE_D                      # engine bay
    if yn < -.66: return RUST_D                                                # belly
    if yn < -.52: return shade(RUST_D, .55)                                    # belly seam
    if abs(yn) < .13 and -.98 < p.z < -.5 and abs(p.x) > .3: return HAZ        # flank band
    # panel patches: each cell of the skin gets its own slight tone
    cell = (int((p.z + 3) / .35), int((math.atan2(p.y, p.x) + 4) / .45))
    r = hsh(*cell)
    base = BONE if yn > -.2 else BONE_D
    return shade(base, .93 + .14 * r)

# dense rings; seams get a tight pair so the dark line stays crisp
zs = []
z = PROFILE[0][0]
while z < PROFILE[-1][0] - 1e-6:
    zs.append(round(z, 4)); z += .1
zs.append(PROFILE[-1][0])
for s in SEAMS:
    zs += [s - .014, s + .014]
zs = sorted(set(zs))
k.rings([hull_ring(z) for z in zs], hull_color, HULL, cap0=True, cap1=True)

# ---- canopy --------------------------------------------------------------------------
CAN = [(-1.5, .16, .10), (-1.0, .38, .30), (-.3, .46, .38), (.3, .42, .30), (.72, .30, .12)]
def can_at(z):
    cw, ch = hermite(CAN, z); return cw, ch, hull_wh(z)[1] - .08
def arch(z, sc=1.0, grow=0.0, n=2.5, pts=15):
    cw, ch, y0 = can_at(z)
    out = []
    for j in range(pts):
        t = math.pi * (1 - j / (pts - 1)); c, s = math.cos(t), math.sin(t)
        out.append((cw * sc * sgp(c, 2 / n) + grow * c, y0 + ch * sc * sgp(s, 2 / n) * 1.0 + grow * s))
    return out
# the canopy is its own object (glass, ribs, spine rail): it hinges open at runtime about its aft top edge
kc = Kit('canopy', seed=8); kc.maxlen = 0.16
czs = [-1.5 + i * 2.22 / 18 for i in range(19)]
kc.rings([[Vector((x, y, z)) for x, y in arch(z)] for z in czs], SLATE_D, GLASS, cap0=True, cap1=True, wear=0)
def bow(z, w=.04, t=.032):
    out_ = arch(z, 1.0, .028); in_ = arch(z, 1.0, -.004)
    for dz in (z - w, z + w):
        pass
    ring = lambda zz, g: [Vector((x, y, zz)) for x, y in arch(z, 1.0, g)]
    # a hollow arch band: outer arch there, inner arch back
    rA = ring(z - w, .032) + ring(z - w, -.012)[::-1]
    rB = ring(z + w, .032) + ring(z + w, -.012)[::-1]
    kc.rings([rA, rB], BONE_D, HULL, cap0=True, cap1=True, wear=0.1)
for z in (-1.42, -.62, 0.0, .66): bow(z, .03 if z in (-.62, 0.0) else .04)
# centre rail along the crown + the aft sill bar
crown = [(z, can_at(z)) for z in czs]
kc.rings([[Vector((x, can_at(z)[2] + can_at(z)[1] + .012 + dy, z)) for x in (-.03, -.012, .012, .03)] for z in czs for dy in (0,)], BONE_D, HULL, cap0=True, cap1=True, wear=0.1)
kc.box((0, hull_wh(-1.45)[1] + .0, -1.46), (.1, .03, .05), HAZ, bevel=.008, wear=0)  # lift tab on the canopy nose
for sx in (-1, 1): kc.box((sx * .45, prof(-.1)[1] - .06, -.1), (.05, .06, .1), SLATE, bevel=.01)  # strut lugs on the frame sill

# ---- headlamp, nose details ------------------------------------------------------------
k.lamp((0, -.02, -2.2), (.12, .07, .05), WHITE)
k.lamp((.30, -.12, -1.88), (.06, .05, .05), AMBER); k.lamp((-.30, -.12, -1.88), (.06, .05, .05), AMBER)
# chin sensor blister under the nose
k.lathe_z([(-.30, 0), (-.27, .07), (-.1, .11), (.12, .11), (.28, .06), (.30, 0)], (0, -.27, -1.62), SLATE, HULL, 18, sx=1.0, sy=.8)
k.lathe_z([(-.28, 0), (-.25, .045), (-.2, .0)], (0, -.27, -1.62), BLACK, LAMP, 14, cap0=False, cap1=True, rot=(0, 0, 0))
# cheek air scoops either side of the canopy
for sx in (-1, 1):
    k.lathe_z([(-.24, 0), (-.20, .055), (-.04, .08), (.16, .075), (.26, 0)], (sx * .445, .13, -.98), SLATE_D, HULL, 16, rot=(0, sx * 3, 0))

# ---- dorsal spine, cargo clamp, tail fin, mast ----------------------------------------
def spine_ring(z, wd, hh):
    base = hull_wh(z)[1] * .93 - .04
    return [Vector((wd * sgp(math.cos(2 * math.pi * j / 20), 2 / 2.6), base + hh * (.5 + .5 * sgp(math.sin(2 * math.pi * j / 20), 2 / 2.6)), z)) for j in range(20)]
sp_z = [(.25, .02, .02), (.45, .17, .06), (.8, .26, .18), (1.2, .28, .22), (1.6, .24, .20), (1.88, .18, .13)]
k.rings([spine_ring(z, wd, hh) for z, wd, hh in sp_z], lambda p, n: BONE_D if (int((p.z + 3) / .21) % 2 == 0) else shade(BONE_D, .8), HULL, cap0=True, cap1=True)
for z in (.85, 1.1, 1.35):       # clamp bands
    k.rings([[Vector((x * 1.04, y + .005, z + dz)) for x, y, _ in spine_ring(z, .28, .21)] for dz in (-.04, .04)], RUST, HULL, cap0=True, cap1=True)
for x in (-.12, .12): k.link((x, .64, 1.5), (x, .8, 1.48), .035, .028, SLATE_L, 8)

FIN_Y0, FIN_Y1, TE = .30, 1.38, 1.97
def fin_le(y): return .85 + (y - FIN_Y0) / (FIN_Y1 - FIN_Y0) * .66
def foil(s, up=1.0):
    """Unit airfoil half-thickness at chord s (0 LE .. 1 TE); max ~1."""
    return up * (.2969 * math.sqrt(s) - .126 * s - .3516 * s * s + .2843 * s ** 3 - .1015 * s ** 4) / .078
def foil_ring(n, chord0, chord1, thick, up=1.0, lo=1.0):
    """Closed ring: TE -> top -> LE -> bottom -> TE, returns list of (s, side, half-thickness)."""
    r = []
    for i in range(n): s = 1 - i / (n - 1) * 1.0; r.append((s, 1, foil(s, up) * thick))
    for i in range(1, n - 1): s = i / (n - 1); r.append((s, -1, foil(s, lo) * thick))
    return r
fin_c = lambda p, nrm: (HAZ if (p.y > 1.28 and p.z > 1.82) else (BONE_L if hsh(int(p.y * 5), int(p.z * 4)) > .5 else BONE))
rr = []
for i in range(13):
    y = FIN_Y0 + (FIN_Y1 - FIN_Y0) * i / 12; le = fin_le(y); th = .075 - .042 * (y - FIN_Y0) / (FIN_Y1 - FIN_Y0)
    rr.append([Vector((side * h, y, le + s * (TE - le))) for s, side, h in foil_ring(10, 0, 1, th)])
k.rings(rr, fin_c, HULL, cap0=False, cap1=True)
k.box((0, 1.4, 1.93), (.05, .06, .13), HAZ, bevel=.012, wear=0)      # fin-tip beacon block
# mast + dish
k.cyl((.0, 1.18, 1.55), .02, .02, .78, 'y', 8, SLATE_L)
kd = Kit('dish', seed=11); kd.maxlen = .26
kd.sphere((0, 1.55, 1.55), .12, (1, .5, 1), SLATE_L, 14, 8, half=True, rot=(-90, 0, 0))
kd.cyl((0, 1.55, 1.49), .008, .008, .14, 'z', 6, SLATE)        # feed horn
kd.box((0, 1.55, 1.42), (.025, .025, .025), HAZ, wear=0)
kd.cyl((0, 1.55, 1.6), .03, .03, .08, 'z', 8, SLATE_D)         # gimbal hub
k.link((.32, .60, .1), (.32, .98, .1), .02, .02, SLATE_L, 6); k.lamp((.32, 1.0, .1), (.06, .06, .06), RED)

# ---- engine pods ---------------------------------------------------------------------
POD = [(.18, .0), (.22, .24), (.30, .335), (.46, .385), (.8, .405), (1.3, .395), (1.55, .37), (1.69, .365)]
def pod_prof(z0=.18, z1=1.69, n=26):
    out = []
    for i in range(n + 1):
        z = z0 + (z1 - z0) * i / n; out.append((z, hermite([(a, b) for a, b in POD], z)[0]))
    return out
def pod_color(p, nrm):
    z = p.z
    if z < .5: return RUST
    for i in range(5):
        if .66 + i * .1 <= z < .76 + i * .1: return HAZ if i % 2 == 0 else BLACK     # hazard sleeve
    if z > 1.52: return SLATE
    if abs(z - .45) < .014 or abs(z - 1.1) < .014: return shade(BONE_D, .5)
    return shade(BONE_D, .95 + .1 * hsh(int(z * 6), int((math.atan2(p.y, p.x - math.copysign(.66, p.x)) + 4) * 2)))
for sx in (-1, 1):
    x = sx * .66
    k.lathe_z(pod_prof(), (x, 0, 0), pod_color, HULL, 32)
    k.lathe_z([(1.5, .372), (1.5, .39), (1.56, .395), (1.62, .39), (1.62, .372)], (x, 0, 0), SLATE, HULL, 32)   # aft collar
    # intake lip ring + dark throat
    k.lathe_z([(.17, .0), (.17, .105), (.2, .125), (.24, .1), (.24, .0)], (x, 0, 0), SLATE_D, HULL, 20, cap0=False, cap1=False)
    k.box((x, .33, .85), (.1, .07, .85), RUST, bevel=.02)                       # pod crest
    # pylon blend to the fuselage: a swept fairing
    k.rings([[Vector((sx * (.28 + a * wd), -.04 + b * hh, z)) for a, b in [(0, 1), (.5, .9), (1, .5), (1, -.5), (.5, -.9), (0, -1)]] for z, wd, hh in [(.3, .02, .06), (.55, .1, .22), (1.0, .12, .26), (1.5, .08, .2), (1.72, .02, .06)]],
            BONE_D, HULL, cap0=True, cap1=True)

# ---- wings ---------------------------------------------------------------------------
def wing_le(x): return -.4 + (x - .5) * (1.08 / 1.85)
def wing_te(x): return 1.55 - (x - .5) * (.30 / 1.85)
def wing_t(x): return .28 - (x - .5) * (.20 / 1.85)         # thickness
def wing_yc(x): return -.12 + (x - .5) * .008
HINGE_S = .76
wing_color = lambda sx: (lambda p, nrm: (HAZ if (p.z < wing_le(abs(p.x)) + .075 and abs(p.x) > 1.0 and nrm.y > -.3) else
                                         (RUST_D if nrm.y < -.2 else (BONE_L if hsh(int(abs(p.x) * 3.3), int(p.z * 3)) > .55 else BONE))))
FLAPS = []
flaps_meta = []
for sx in (-1, 1):
    xs = [.46 + i * (2.38 - .46) / 15 for i in range(16)]
    ring_set = []
    for xv in xs:
        le, te, th, yc = wing_le(xv), wing_te(xv), wing_t(xv), wing_yc(xv)
        tip = max(0.0, (xv - 2.26) / .12)    # round the tip off
        sc = math.sqrt(max(0.0, 1 - tip * tip))
        ring_set.append([Vector((sx * xv, yc + side * h * sc, le + s * (te - le))) for s, side, h in foil_ring(14, 0, 1, th / 2)])
    k.rings(ring_set, wing_color(sx), HULL, cap0=False, cap1=True)
    # flap: the rear 24% of the wing, standing a hair proud so its edges read as a control surface
    kf = Kit('flap_' + ('l' if sx < 0 else 'r'), seed=9 + sx); kf.maxlen = .16; FLAPS.append(kf)
    fr = []
    for xv in [.95 + i * (2.2 - .95) / 8 for i in range(9)]:
        le, te, th, yc = wing_le(xv), wing_te(xv), wing_t(xv), wing_yc(xv)
        zs_ = [(HINGE_S + (1 - HINGE_S) * i / 7) for i in range(8)]
        top = [Vector((sx * xv, yc + foil(s) * th / 2 * 1.04 + .004, le + s * (te - le))) for s in zs_]
        bot = [Vector((sx * xv, yc - foil(s) * th / 2 * 1.04 - .004, le + s * (te - le))) for s in zs_[::-1]]
        fr.append(top + bot[:-1])
    kf.rings(fr, lambda p, nrm: HAZ if abs(p.z - (wing_te(abs(p.x)) - .02)) < .02 and nrm.y > 0.3 else RUST, HULL, cap0=True, cap1=True)
    xa, xb = .95, 2.2
    pa = Vector((sx * xa, -.12, wing_le(xa) + HINGE_S * (wing_te(xa) - wing_le(xa)))); pb = Vector((sx * xb, -.12, wing_le(xb) + HINGE_S * (wing_te(xb) - wing_le(xb))))
    ax = (pb - pa).normalized()
    if ax.x < 0: ax = -ax
    mid = (pa + pb) / 2
    flaps_meta.append({'pivot': [round(v, 3) for v in mid], 'axis': [round(v, 4) for v in ax], 'side': sx})
    # leading-edge root strake blends the wing into the fuselage flank
    k.rings([[Vector((sx * (hull_wh(z)[0] - .04 + dx * wd), -.14 + dy * hh, z)) for dx, dy in [(-1, 0), (-.5, .75), (.5, .95), (1, 0), (.5, -.8), (-.5, -.7)]]
             for z, wd, hh in [(-1.6, .02, .015), (-1.15, .1, .05), (-.7, .17, .075), (-.4, .2, .1)]], BONE_D, HULL, cap0=True, cap1=False)
    # tip pod: RCS block with the nav lamp on its nose
    tp = [(.55, 0), (.62, .09), (.8, .14), (1.1, .14), (1.3, .11), (1.36, 0)]
    k.lathe_z([(a, b) for a, b in tp], (sx * 2.3, -.09, 0), lambda p, n: SLATE if p.z < .85 else SLATE_L, HULL, 16)
    k.lamp((sx * 2.4, -.09, .68), (.05, .06, .06), RED if sx < 0 else GREEN)
    k.lamp((sx * 2.3, -.09, .6), (.05, .05, .02), RED if sx < 0 else GREEN)
    # under-wing hardpoint: pylon and a slim tool pod
    k.link((sx * 1.4, -.1, .6), (sx * 1.4, -.28, .62), .05, .05, SLATE_L, 8)
    k.lathe_z([(.24, 0), (.3, .06), (.4, .085), (.85, .085), (1.0, .05), (1.06, 0)], (sx * 1.4, -.34, 0), lambda p, n: BONE_D if p.z > .5 else SLATE, HULL, 14)
    # wing panel lines: raised access plates on the upper surface
    for (xa_, xb_) in ((.8, 1.45), (1.5, 2.1)):
        xm = (xa_ + xb_) / 2; zm = (wing_le(xm) + wing_te(xm)) / 2 - .12
        k.box((sx * xm, wing_yc(xm) + wing_t(xm) * .42, zm), (xb_ - xa_ - .08, .018, .3), shade(BONE_L, 1.0), rot=(0, -sx * 8, 0), bevel=.008, wear=0.05)

# ---- salvage arms + keel sled ---------------------------------------------------------
for sx in (-1, 1):
    x = sx * .3
    k.lathe_z([(-.12, 0), (-.1, .095), (.1, .095), (.12, 0)], (x, -.48, -1.1), SLATE, HULL, 14, rot=(0, 0, 0))                  # shoulder housing
    k.sphere((x, -.5, -1.1), .095, (1, 1, 1), SLATE_L, 14, 8)
    # upper arm (tapered boom) + hydraulic ram alongside
    k.link((x, -.52, -1.1), (x, -.55, -1.75), .07, .055, BONE_D, 12)
    k.link((x + sx * .075, -.43, -1.2), (x + sx * .06, -.5, -1.62), .016, .016, 0xc8ccd0, 8)
    k.link((x + sx * .075, -.43, -1.2), (x + sx * .068, -.46, -1.4), .026, .026, SLATE, 8)
    # elbow, forearm, wrist
    k.sphere((x, -.55, -1.78), .075, (1, 1, 1), SLATE_L, 14, 8)
    k.link((x, -.55, -1.8), (x, -.52, -2.25), .05, .04, BONE_D, 12)
    k.cyl((x, -.52, -2.24), .052, .052, .06, 'z', 12, HAZ, wear=0)
    # claw: palm block and two curved pincers
    k.lathe_z([(-.0, .05), (.07, .045), (.12, 0)], (x, -.52, -2.3), SLATE, HULL, 12, cap0=True, cap1=True)
    for dx in (-1, 1):
        k.link((x + dx * .035, -.52, -2.33), (x + dx * .065, -.52, -2.46), .018, .014, SLATE_L, 8)
        k.link((x + dx * .065, -.52, -2.46), (x + dx * .03, -.52, -2.56), .014, .008, 0xc8ccd0, 8)
# keel sled: a rounded skid plate under the belly
def keel_ring(z, wd, hh):
    yb = -hull_wh(z)[1] * .96 + .05
    return [Vector((wd * sgp(math.cos(2 * math.pi * j / 18), 2 / 2.6), yb - hh * (.5 - .5 * sgp(math.sin(2 * math.pi * j / 18), 2 / 2.6)) - .0, z)) for j in range(18)]
kl = [(-1.1, .1, .02), (-.8, .34, .1), (-.2, .45, .15), (.9, .45, .15), (1.5, .36, .1), (1.7, .1, .03)]
k.rings([keel_ring(z, wd, hh) for z, wd, hh in kl], lambda p, n: RUST if (int((p.z + 3) / .35) % 2 == 0) else shade(RUST, .82), HULL, cap0=True, cap1=True)

# ---- RCS nozzles (positions are read by src/rcs.js) -------------------------------------
NOZ = []
def nozzle(pos, d):
    d = Vector(d).normalized(); p = Vector(pos)
    rot = Vector((0, 0, 1)).rotation_difference(d).to_euler()
    k.lathe_z([(-.1, .03), (-.02, .045), (.05, .075), (.075, .08), (.075, .06), (.03, .05)], tuple(p), BLACK, HULL, 12, rot=rot, wear=0, cap0=True, cap1=False)
    NOZ.append({'pos': [round(v, 3) for v in p], 'dir': [round(v, 3) for v in d]})
# nose cluster
for sx in (-1, 1):
    hw, hh = prof(-1.2)
    nozzle((sx * hw, 0, -1.2), (sx, 0, 0))
    k.rings([[Vector((sx * (.42 + a), -.22 + b, z)) for a, b in [(-.12, .09), (.12, .09), (.12, -.09), (-.12, -.09)]] for z in (-1.1, -1.4, -1.72)], BONE_D, HULL, cap0=False, cap1=True) if False else None
    k.link((sx * .42, -.22, -1.25), (sx * .42, -.22, -1.74), .12, .08, BONE_D, 12)
    nozzle((sx * .42, -.22, -1.75), (0, 0, -1))
hw, hh = prof(-1.3)
nozzle((0, hh, -1.3), (0, 1, 0)); nozzle((0, -hh - .12, -1.3), (0, -1, 0))
k.lathe_z([(-.15, .0), (-.12, .13), (.12, .13), (.15, 0)], (0, -hh - .06, -1.3), SLATE_L, HULL, 16, rot=(0, 0, 0), sy=.5)
# tail cluster
for sx in (-1, 1): nozzle((sx * 1.04, 0, 1.0), (sx, 0, 0))
nozzle((0, .8 + .03, 1.0), (0, 1, 0)); nozzle((0, -.83, 1.0), (0, -1, 0))
# wingtip roll jets
for sx in (-1, 1):
    nozzle((sx * 2.3, .05, .95), (0, 1, 0)); nozzle((sx * 2.3, -.23, .95), (0, -1, 0))

# ---- hull greebles: vents, hatches, a hand rail ------------------------------------------
for sx in (-1, 1):
    for i in range(5):                    # louvred vent on the flank
        k.box((sx * (hull_wh(-.05)[0] - .005), -.12 + i * .045, -.05), (.014, .018, .26), BLACK, bevel=.004, wear=0)
    k.box((sx * (hull_wh(.35)[0] - .01), .05, .35), (.02, .24, .3), shade(BONE_L, .95), bevel=.008)   # access hatch
    k.box((sx * (hull_wh(.35)[0] + .002), .05, .35), (.012, .02, .12), HAZ, wear=0)                     # hatch pull
    k.link((sx * (hull_wh(-.7)[0] - .0), .22, -.7), (sx * (hull_wh(-.7)[0] - .0), .22, -.22), .014, .014, 0xc8ccd0, 6)
for z in (-.7, -.22): k.box((0, 0, 0), (.001, .001, .001), BONE) if False else None

meta = {'nozzles': NOZ, 'glow': [[-.66, 0, 2.38], [.66, 0, 2.38]],
        'nav': [[-2.4, -.09, .68, 0xff3b2a], [2.4, -.09, .68, 0x3bff7a], [0, .98, 1.97, 0xffffff]]}  # on the wingtip lamps / fin trailing edge
meta['flaps'] = flaps_meta
bake_ao([k, kc, kd] + FLAPS, rays=20, dist=.9, strength=.9)
out = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'assets')
export_glb([k, kc, kd] + FLAPS, os.path.join(out, 'ship.glb'))
json.dump(meta, open(os.path.join(out, 'ship.json'), 'w'))
