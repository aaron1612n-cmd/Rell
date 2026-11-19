"""Cockpit interior for the hero ship, in ship coordinates (nose -Z, up +Y), same units as ship.py.
Run: python tools/blender/cockpit.py  ->  src/assets/cockpit.glb + cockpit.json

The canopy is the faceted bubble from ship.py. The interior sits under it: a tub, a sloped
instrument panel under a glareshield hood, side consoles with a throttle and a side stick,
and an inner canopy frame (two bows, a spine, sill rails). Screens, the HUD glass, the canopy
glass and every moving part are built at runtime (src/cockpit.js) from the frames written to
cockpit.json, so they can be animated and lit by the game.
"""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(__file__))
from kit import *
from mathutils import Vector, Matrix

# interior paint: warm dark greys (cockpit paint), bone placards, black rubber, one hazard accent
IG, IG_D, IG_L, IG_X = 0x55595b, 0x3d4043, 0x75797b, 0x2a2c2e
PAD = 0x24262a

# ---- shared shape data (must match tools/blender/ship.py) -----------------------------
PROFILE = [(-2.25, .10, .08), (-1.95, .26, .19), (-1.3, .50, .38), (-0.4, .70, .50), (.6, .82, .55), (1.6, .78, .52), (1.88, .58, .42)]
CANOPY = [(-1.5, .16, .10), (-1.0, .38, .30), (-.3, .46, .38), (.3, .42, .30), (.72, .30, .12)]


def interp(tab, z):
    for a, b in zip(tab, tab[1:]):
        if a[0] <= z <= b[0]:
            t = (z - a[0]) / (b[0] - a[0])
            return tuple(a[i] + (b[i] - a[i]) * t for i in range(1, len(a)))
    return tab[0][1:] if z < tab[0][0] else tab[-1][1:]


def can(z):
    """canopy half-width, height and base y at z."""
    cw, ch = interp(CANOPY, z)
    return cw, ch, interp(PROFILE, z)[1] - .08


def canopy_poly(z):
    cw, ch, y0 = can(z)
    return [(cw, y0), (cw * .8, y0 + ch * .7), (cw * .35, y0 + ch), (-cw * .35, y0 + ch), (-cw * .8, y0 + ch * .7), (-cw, y0)]


EYE = Vector((0, .635, .15))
J = {'eye': list(EYE), 'canopy': CANOPY, 'profile': PROFILE, 'parts': {}}


def colmajor(M):
    return [round(M[r][c], 5) for c in range(4) for r in range(4)]


def mark(k, name, pos=(0, 0, 0), rot=(0, 0, 0), **extra):
    """Record a frame (in ship space) for runtime parts."""
    M = k.stack[-1] @ Matrix.Translation(Vector(pos)) @ R(*rot).to_matrix().to_4x4()
    J['parts'][name] = {'m': colmajor(M), **extra}


def frame_box(k, p0, p1, up, w, h, color, bevel=.004, mat=HULL, wear=.12):
    """Box from p0 to p1; `w` across, `h` along `up`."""
    a, b = Vector(p0), Vector(p1)
    zt = (b - a); ln = zt.length; zt.normalize()
    yt = Vector(up); yt = (yt - zt * yt.dot(zt)).normalized(); xt = yt.cross(zt)
    M = Matrix((xt, yt, zt)).transposed()
    k.box(tuple((a + b) / 2), (w, h, ln), color, rot=M.to_euler(), bevel=bevel, mat=mat, wear=wear)


def inset(poly, d):
    """Offset a canopy polyline inward (toward its centre) by d, with mitred corners."""
    out = []
    n = len(poly)
    for i in range(n):
        p = Vector(poly[i])
        segs = []
        if i > 0: segs.append(Vector(poly[i]) - Vector(poly[i - 1]))
        if i < n - 1: segs.append(Vector(poly[i + 1]) - Vector(poly[i]))
        nrm = Vector((0, 0))
        for s in segs: nrm += Vector((-s.y, s.x)).normalized()   # left-hand normal = inward for this winding
        nrm.normalize()
        cos = max(.5, min(1, nrm.dot(Vector((-segs[0].y, segs[0].x)).normalized())))
        out.append(tuple(p + nrm * d / cos))
    return out


# =========================================================================================
k = Kit('cockpit', seed=11)
k.maxlen = .05

# ---- tub: the well itself is part of the hull now (tools/blender/ship.py), so the outside and this view
# are the same surface. Here are only the things fitted into it.

# ---- seat: a moulded bucket on rails, padded, with a headrest and the ejection loop -------------------
def seat_ring(z, w, y0, y1, bol):
    """closed cross-section of the seat pan: flat base, cushion dip, raised side bolsters"""
    return [Vector(p) for p in [(-w, y0, z), (w, y0, z), (w, y1 + bol, z), (w * .82, y1 + bol + .012, z), (w * .62, y1 + .004, z),
                                (w * .3, y1, z), (0, y1 - .004, z), (-w * .3, y1, z), (-w * .62, y1 + .004, z), (-w * .82, y1 + bol + .012, z), (-w, y1 + bol, z)]]
pan = [(-.16, .19, .135, .162, .0), (-.12, .205, .13, .168, .02), (0, .21, .13, .165, .04), (.16, .21, .13, .162, .045), (.30, .205, .13, .17, .04), (.34, .19, .13, .175, .02)]
k.rings([seat_ring(z, w, a, b, c) for z, w, a, b, c in pan], lambda p, n: PAD if n.y > .5 and abs(p.x) < .15 else IG, HULL, cap0=True, cap1=True, wear=.15)
def back_ring(u, w, t, bol, lift=0.0):
    """cross-section of the seat back at height u (0 = pan, 1 = top), leaning back about 12 degrees"""
    cy, cz = .16 + .52 * u, .345 + .11 * u
    pts = [(-w, t / 2), (-w * .9, -t / 2 - bol), (-w * .62, -t / 2 - .006), (0, -t / 2 + .004), (w * .62, -t / 2 - .006), (w * .9, -t / 2 - bol), (w, t / 2), (w * .5, t / 2 + .012), (-w * .5, t / 2 + .012)]
    return [Vector((x, cy + lift, cz + d)) for x, d in pts]
k.rings([back_ring(u, w, t, b) for u, w, t, b in [(0, .19, .08, .01), (.25, .2, .075, .03), (.55, .19, .07, .035), (.72, .17, .065, .02), (.76, .12, .06, .0)]],
        lambda p, n: PAD if n.z < -.5 and abs(p.x) < .13 else IG, HULL, cap0=True, cap1=True, wear=.15)
k.rings([back_ring(u, w, t, b) for u, w, t, b in [(.8, .085, .09, .015), (.86, .11, .1, .03), (.96, .105, .1, .028), (1.0, .07, .08, .01)]],
        lambda p, n: PAD if n.z < -.4 else IG_D, HULL, cap0=True, cap1=True, wear=.2)
for sx in (-1, 1):
    k.link((sx * .1, .78 * .52 + .16, .345 + .78 * .11), (sx * .07, .87 * .52 + .16, .345 + .87 * .11), .009, .009, IG_L, 8)   # headrest posts
    k.link((sx * .15, .11, -.12), (sx * .15, .11, .4), .012, .012, IG_L, 8)                                                    # floor rails
    k.link((sx * .15, .115, -.05), (sx * .17, .135, -.05), .01, .01, IG_L, 6)
    k.link((sx * .15, .115, .3), (sx * .17, .135, .3), .01, .01, IG_L, 6)
    # shoulder harness lying over the cushion, down to the lap buckle
    k.link((sx * .08, .62, .43), (sx * .06, .30, .36), .006, .006, 0x4a4033, 4)
# the ejection loop between the knees: the second hazard-striped thing in here
k.link((-.035, .17, -.15), (0, .215, -.17), .007, .007, HAZ, 8); k.link((.035, .17, -.15), (0, .215, -.17), .007, .007, HAZ, 8)
k.cyl((0, .18, .30), .03, .03, .012, 'y', 14, IG_L, bevel=.003)                                                                  # lap buckle
# aft bulkhead behind the seat: avionics bay door, a fire bottle, and the O2 hose run
k.box((0, .30, .675), (.36, .26, .03), IG, bevel=.008)
k.panels((0, .30, .66), (.34, .24), 2, 1, 'z', -1, gap=.01, lift=.004, color=IG_L, vary=.1, bevel=.002)
k.cyl((.22, .24, .62), .03, .03, .2, 'y', 12, 0x8a2a20, bevel=.006)
k.link((-.2, .14, .55), (-.24, .30, .62), .011, .011, BLACK, 6)

# ---- floor: ribbed tread plate and foot rests ----------------------------------------------
for i in range(7):
    k.box((0, .103, -.75 + i * .1), (.42, .006, .02), IG_X, bevel=.002, wear=.3)
for sx in (-1, 1):
    k.box((sx * .12, .14, -.62), (.12, .03, .08), IG_D, rot=(-30, 0, 0), bevel=.008)
    k.box((sx * .12, .152, -.635), (.1, .006, .05), BLACK, rot=(-30, 0, 0), wear=0)

# side wall padding + ribs along the tub
for sx in (-1, 1):
    for z in (-.05, .32):
        cw, ch, y0 = can(z)
        k.box((sx * cw * .9, y0 - .1, z), (.03, .14, .05), IG, rot=(0, 0, sx * -12), bevel=.006)
    cw, ch, y0 = can(.12)
    k.box((sx * cw * .88, y0 - .09, .12), (.025, .1, .3), PAD, rot=(0, 0, sx * -12), bevel=.012, wear=.3)

# ---- sill rails: canopy rail along both sides, the frame the glass sits on -------------
ZR = [-1.48, -1.25, -1.0, -.62, -.3, 0, .3, .70]
for sx in (-1, 1):
    pts = []
    for z in ZR:
        cw, ch, y0 = can(z)
        pts.append(Vector((sx * (cw - .018), y0 + .012, z)))
    for a, b in zip(pts, pts[1:]):
        frame_box(k, a, b, (0, 1, 0), .042, .034, IG_L, bevel=.006)
    # rail bolts
    for z in (-1.1, -.8, -.45, -.15, .15, .45):
        cw, ch, y0 = can(z)
        k.cyl((sx * (cw - .018), y0 + .031, z), .006, .006, .006, 'y', 6, BONE_D, wear=0)
    # cable loom along the inside of the rail
    for a, b in zip(pts[3:], pts[4:]):
        a2, b2 = a + Vector((-sx * .03, -.035, 0)), b + Vector((-sx * .03, -.035, 0))
        frame_box(k, a2, b2, (0, 1, 0), .014, .014, PAD, bevel=.005, wear=.3)

# ---- inner canopy frame: two bows and a spine ---------------------------------------------
def bow(z, depth, w=.032, color=IG):
    poly = canopy_poly(z)
    cl = inset(poly, .012 + w / 2)
    # run the legs down past the sill into the rail
    cl[0] = (cl[0][0], cl[0][1] - .02); cl[-1] = (cl[-1][0], cl[-1][1] - .02)
    P = [Vector((x, y, z)) for x, y in cl]
    for a, b in zip(P, P[1:]):
        frame_box(k, a, b, (0, 0, 1), w, depth, color, bevel=.006)
    for i, p in enumerate(P[1:-1], 1):  # corner gussets
        d = (P[i + 1] - P[i - 1]).normalized()
        frame_box(k, p - d * .025, p + d * .025, (0, 0, 1), w * 1.25, depth * 1.12, IG_D, bevel=.005)
    # bolts on the inner face
    for a, b in zip(P, P[1:]):
        for t in (.25, .75):
            q = a.lerp(b, t)
            seg = (b - a).normalized(); nrm = Vector((-seg.y, seg.x, 0))
            k.cyl(tuple(q + nrm * (w / 2 + .001)), .0045, .0045, .006, 'z', 6, BONE_D, rot=Vector((0, 0, 1)).rotation_difference(nrm).to_euler(), wear=0)
    return P

FWD = bow(-.62, .05)
AFT = bow(0.0, .06)
# padded crash rail along the aft bow's top
a, b = AFT[2], AFT[3]
frame_box(k, a + Vector((0, -.022, .0)), b + Vector((0, -.022, .0)), (0, 0, 1), .024, .05, PAD, bevel=.01, wear=.3)
# spine between the bows, along the canopy roof
# grab handle under the aft bow, right side
hp = AFT[3].lerp(AFT[4], .55) + Vector((-.03, -.035, .0))
k.cyl(tuple(hp), .008, .008, .12, 'x', 8, BLACK, rot=(0, 0, -38))
for t in (-.05, .05):
    k.box(tuple(hp + Vector((t * .78, t * .62 + .015, 0))), (.014, .03, .014), IG_L, rot=(0, 0, -38), bevel=.003)
# canopy jettison handle on the forward bow, left leg: the one hazard-striped thing in here
jl = FWD[4].lerp(FWD[5], .45)
with k.at(tuple(jl + Vector((.035, 0, .03))), rot=(0, 0, -62)):
    k.box((0, 0, 0), (.06, .016, .016), HAZ, bevel=.004, wear=0)
    for i in range(3): k.box((-.02 + i * .02, 0, 0), (.006, .018, .018), BLACK, wear=0)
    k.box((0, -.012, 0), (.012, .02, .02), IG_L, bevel=.003)
mark(k, 'tag', tuple(FWD[2].lerp(FWD[3], .18) + Vector((0, -.02, .02))))
# map light under the aft bow, left: shines down onto the panel
ml = AFT[4].lerp(AFT[3], .3) + Vector((.0, -.03, -.03))
k.box(tuple(ml), (.05, .026, .03), IG_D, bevel=.006)
k.lamp(tuple(ml + Vector((0, -.014, 0))), (.032, .004, .016), 0xffd9a8)
mark(k, 'maplight', tuple(ml + Vector((0, -.02, 0))))

# ---- glareshield hood + coaming -------------------------------------------------------
def hood_ring(z, y, w):
    return [(-w, y - .028), (w, y - .028), (w, y - .008), (w * .96, y), (-w * .96, y), (-w, y - .008)]
HOOD = [(-.80, None, None), (-.70, .405, None), (-.55, .48, None), (-.42, .538, .37), (-.30, .545, .37), (-.215, .535, .37)]
secs = []
for z, y, w in HOOD:
    cw, ch, y0 = can(z)
    y = y if y is not None else y0 + .008
    w = w if w is not None else cw * .97
    w = min(w, cw * .97)
    secs.append((z, hood_ring(z, y, w)))
k.loft(secs, IG_X, bevel=.006)
# soft rubber lip on the hood edge
k.box((0, .523, -.212), (.70, .012, .012), PAD, bevel=.004, wear=.2)

# ---- forward deck under the windscreen (anti-glare) --------------------------------------
# a moulded anti-glare deck with the avionics fairing running down its middle into the hood
dsec = []
for z in (-1.48, -1.38, -1.25, -1.1, -1.0, -.9, -.80, -.72):
    cw, ch, y0 = can(z); t = max(0, min(1, (z + 1.48) / .68)); hm = .055 * (t * t * (3 - 2 * t))
    dsec.append((z, [(-cw * .985, y0 - .012), (cw * .985, y0 - .012), (cw * .985, y0 + .004), (cw * .62, y0 + .006),
                     (cw * .34, y0 + .006 + hm * .8), (cw * .14, y0 + .006 + hm), (-cw * .14, y0 + .006 + hm), (-cw * .34, y0 + .006 + hm * .8), (-cw * .62, y0 + .006)]))
k.loft(dsec, IG_X, bevel=.004)
# defog vents either side of the fairing, a standby compass on it, dzus seams along it
for sx in (-1, 1):
    for z in (-1.15, -.92):
        cw, ch, y0 = can(z)
        k.box((sx * cw * .5, y0 + .011, z), (.08, .01, .03), IG_D, bevel=.003)
        for i in range(4): k.box((sx * cw * .5 - .027 + i * .018, y0 + .017, z), (.009, .003, .02), BLACK, wear=0)
cw, ch, y0 = can(-.95)
k.cyl((0, y0 + .006 + .052, -.95), .028, .03, .03, 'y', 16, IG_D, bevel=.004)
k.cyl((0, y0 + .006 + .07, -.95), .022, .022, .01, 'y', 16, 0x0c0d0e, wear=0)
for z in (-1.3, -1.06):
    cw, ch, y0 = can(z); t = (z + 1.48) / .68; hm = .055 * (t * t * (3 - 2 * t))
    for sx in (-1, 1): k.cyl((sx * cw * .1, y0 + .008 + hm, z), .005, .005, .004, 'y', 6, BONE_D, wear=0)

# ---- HUD: projector box on the hood and two posts holding the combiner --------------------
k.box((0, .558, -.33), (.13, .03, .09), IG_D, bevel=.008)
k.box((0, .574, -.30), (.09, .006, .03), BLACK, wear=0)
for sx in (-1, 1):
    frame_box(k, (sx * .112, .55, -.312), (sx * .112, .68, -.332), (0, 0, 1), .01, .012, IG_L, bevel=.003)
    k.box((sx * .112, .684, -.333), (.016, .01, .016), IG_D, bevel=.003)
mark(k, 'hud', (0, .614, -.322), (-8, 0, 0), size=[.212, .13])

# ---- instrument panel -------------------------------------------------------------------
FACE_C = (0, .4415, -.1825)
with k.at(FACE_C, rot=(-34, 0, 0)):          # local +z = face normal toward the pilot, +y up the face
    k.box((0, 0, -.018), (.74, .205, .036), IG, bevel=.008)
    # centre MFD
    def mfd(name, w, h, nb, rect):
        bw, bh, bd = w + .03, h + .032, .016
        k.box((0, 0, .001), (bw + .004, bh + .004, .006), IG_X, bevel=.003)
        for (x, y, sx_, sy_) in ((0, (h + bh) / 4 + .0, bw, (bh - h) / 2), (0, -(h + bh) / 4, bw, (bh - h) / 2),
                                 ((w + bw) / 4, 0, (bw - w) / 2, h), (-(w + bw) / 4, 0, (bw - w) / 2, h)):
            k.box((x, y, bd / 2), (sx_, sy_, bd), IG_D, bevel=.003)
        # bezel push-buttons down both sides
        for sxb in (-1, 1):
            for i in range(nb):
                y = (i - (nb - 1) / 2) * (h / nb) * .95
                k.box((sxb * (w / 2 + .03), y, .006), (.018, .012, .012), BLACK, bevel=.002, wear=0)
                k.box((sxb * (w / 2 + .03), y, .0125), (.014, .008, .002), BONE_D, wear=0)
        mark(k, name, (0, 0, .0068), size=[w, h], rect=rect)
    with k.at((0, -.004, 0)):
        mfd('mfdC', .19, .1425, 5, [0, 0, 512, 384])
    for sx in (-1, 1):
        k.box((sx * .218, -.006, .015), (.17, .14, .03), IG_D, bevel=.004)   # raised pod for the side screens
        with k.at((sx * .218, -.006, .046), rot=(0, sx * -12, 0)):
            mfd('mfdL' if sx < 0 else 'mfdR', .136, .102, 4, [512, 0, 512, 384] if sx < 0 else [0, 384, 512, 384])
    # outer columns: rotary knobs and guarded toggles
    for sx in (-1, 1):
        for i, y in enumerate((.055, 0, -.055)):
            x = sx * .335
            if i == 1:
                k.box((x, y, .006), (.03, .03, .012), IG_D, bevel=.003)
                k.cyl((x, y, .02), .004, .003, .022, 'z', 6, BONE_L, rot=(14, 0, 0))
            else:
                k.cyl((x, y, .008), .016, .016, .016, 'z', 14, BLACK, bevel=.003)
                k.cyl((x, y, .019), .011, .009, .008, 'z', 12, IG_X, wear=0)
                k.box((x, y + .008, .0235), (.002, .007, .002), BONE_L, wear=0)
    # data plate under the centre MFD
    k.box((0, -.096, .002), (.12, .008, .004), BONE_D, bevel=.001, wear=0)
mark(k, 'face', FACE_C, (-34, 0, 0), size=[.74, .205])
mark(k, 'annun', (0, .5215, -.2042), size=[.40, .025])

# knee panel / dash body below the face, and the dash wings out to the canopy walls
k.box((0, .23, -.27), (.70, .27, .26), IG_D, bevel=.01)
for sx in (-1, 1):
    with k.at((sx * .40, .43, -.24), rot=(-30, sx * 18, 0)):
        k.box((0, 0, -.02), (.10, .22, .05), IG, bevel=.008)
        k.panels((0, 0, .005), (.09, .2), 1, 3, 'z', 1, gap=.008, lift=.004, color=IG_L, vary=.1, bevel=.002)
# standby G meter: round gauge on the left dash wing, needle animated in JS
with k.at((-.39, .435, -.205), rot=(-30, 18, 0)):
    k.cyl((0, 0, .02), .036, .036, .03, 'z', 20, IG_X, bevel=.004)
    k.cyl((0, 0, .036), .040, .040, .006, 'z', 20, IG_L, bevel=.002)
    mark(k, 'gmeter', (0, 0, .0365), size=[.064, .064], rect=[0, 896, 128, 128])

# ---- side consoles -----------------------------------------------------------------------
for sx in (-1, 1):
    with k.at((sx * .345, .33, -.13), rot=(0, 0, sx * 6)):
        k.box((0, 0, 0), (.17, .10, .56), IG, bevel=.01)
        k.box((0, .052, 0), (.16, .006, .54), IG_X, bevel=.002, wear=0)
        # dzus-fastened sub-panels
        for z0, ln in ((-.2, .14), (-.03, .16), (.16, .16)):
            k.box((0, .057, z0), (.15, .006, ln), IG_D, bevel=.002)
            for xx in (-.068, .068):
                for zz in (z0 - ln / 2 + .01, z0 + ln / 2 - .01):
                    k.cyl((xx, .061, zz), .004, .004, .003, 'y', 6, BONE_D, wear=0)
        if sx < 0:
            # throttle quadrant: slotted plate, the lever is a separate part
            k.box((.0, .062, -.17), (.06, .008, .17), IG_X, bevel=.002)
            k.box((.0, .066, -.17), (.012, .004, .15), BLACK, wear=0)
            mark(k, 'throttle', (0, .066, -.17))
            for i in range(3):
                k.cyl((-.05 + i * .05, .07, .16), .012, .012, .02, 'y', 12, BLACK, bevel=.002)
                k.box((-.05 + i * .05, .081, .16 - .006), (.002, .002, .008), BONE_L, wear=0)
            for i in range(4):
                k.box((-.05, .066, -.05 + i * .03), (.014, .008, .012), IG_D, bevel=.002)
                k.cyl((-.05, .076, -.05 + i * .03), .0025, .002, .016, 'y', 6, BONE_L, rot=(18, 0, 0))
        else:
            mark(k, 'stick', (.0, .062, -.16))
            k.cyl((0, .064, -.16), .03, .034, .012, 'y', 16, BLACK, bevel=.003)
            for i in range(5):
                k.box((-.045 + i * .022, .066, .15), (.012, .008, .012), IG_D, bevel=.002)
                k.cyl((-.045 + i * .022, .076, .15), .0025, .002, .016, 'y', 6, BONE_L, rot=(-18, 0, 0))
            k.box((0, .064, .05), (.11, .006, .05), BONE_D, bevel=.001, wear=0)

# =========================================================================================
# moving parts, built about their pivots
th = Kit('throttle', seed=12); th.maxlen = .05
th.box((0, .004, 0), (.03, .008, .03), IG_D, bevel=.003)
th.box((0, .045, 0), (.012, .08, .016), IG_L, bevel=.003)
with th.at((0, .095, -.004)):
    th.box((0, 0, 0), (.05, .03, .042), BLACK, bevel=.008)
    th.box((-.026, .004, -.006), (.004, .012, .01), IG_L, bevel=.002)
    th.box((0, .016, -.008), (.014, .004, .01), HAZ, bevel=.001, wear=0)      # boost button
    th.cyl((.022, .012, .006), .005, .005, .008, 'x', 8, IG_L)

st = Kit('stick', seed=13); st.maxlen = .05
st.cyl((0, .012, 0), .022, .012, .024, 'y', 12, PAD)                         # rubber boot
st.cyl((0, .05, 0), .006, .006, .06, 'y', 8, IG_L)
with st.at((0, .1, .004), rot=(-8, 0, 0)):
    st.cyl((0, 0, 0), .014, .016, .06, 'y', 12, BLACK, bevel=.004)
    st.box((0, .026, .0), (.03, .016, .03), BLACK, bevel=.006)
    st.cyl((0, .036, .004), .005, .005, .006, 'y', 8, HAZ, wear=0)            # trigger cap
    st.box((0, -.006, -.016), (.008, .02, .008), IG_L, bevel=.002)

bake_ao([k], rays=24, dist=.22, strength=.8)
bake_ao([th], rays=16, dist=.05, strength=.6)
bake_ao([st], rays=16, dist=.05, strength=.6)
out = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'assets')
export_glb([k, th, st], os.path.join(out, 'cockpit.glb'))
json.dump(J, open(os.path.join(out, 'cockpit.json'), 'w'))
print('cockpit.json parts:', list(J['parts']))
