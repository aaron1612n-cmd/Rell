"""Derelict station as named chunks (so it can break apart later) + collider data.
Run: python tools/blender/station.py  ->  src/assets/station.glb, station.json"""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(__file__))
from kit import *
from mathutils import Vector

kits = {}
def K(name, seed=None, maxlen=3.0):
    k = Kit(name, seed or (hash(name) % 1000)); k.maxlen = maxlen; kits[name] = k; return k

def windows(k, c, n, along, size=(1.4, .85), gap=2.6, normal='y', lit_kit=None, rng=None, sign=1, lit=0.22):
    """Row of dark window panes with a few lit amber ones (lit ones go to a flicker kit)."""
    for i in range(n):
        o = (i - (n - 1) / 2) * gap
        p = [c[0] + (o if along == 'x' else 0), c[1] + (o if along == 'y' else 0), c[2] + (o if along == 'z' else 0)]
        d = .06
        if normal == 'y': s_ = (size[0], d, size[1]); p[1] += sign * d / 2
        elif normal == 'x': s_ = (d, size[1], size[0]); p[0] += sign * d / 2
        else: s_ = (size[0], size[1], d); p[2] += sign * d / 2
        # recessed frame
        k.box(tuple(p), tuple(v * (1.18 if j != {'y': 1, 'x': 0, 'z': 2}[normal] else 1) for j, v in enumerate(s_)), BONE_D, bevel=.03, wear=0)
        q = list(p); q[{'y': 1, 'x': 0, 'z': 2}[normal]] += sign * .04
        if rng.random() < lit and lit_kit is not None:
            lit_kit.box(tuple(q), s_, AMBER, mat=LAMP, wear=0)
        else:
            k.box(tuple(q), s_, BLACK, mat=GLASS, wear=0)

rng = random.Random(11)
LA, LB, LC = K('lamps_a'), K('lamps_b'), K('lamps_c')
lamps = [LA, LB, LC]

# ---------------------------------------------------------------- hub (z -14..14) --------------
hub = K('hub', maxlen=3.6)
hub.cyl((0, 0, 0), 13.0, 13.0, 28, 'z', 8, BONE, rot=(0, 0, 22.5), bevel=.45, collide=False)
hub.box((0, 0, 0), (24, 24, 28), BONE, collide=True, wear=0) if False else None
hub._obb(Matrix.Identity(4), (12, 12, 14))
for z in (-13.4, 13.4): hub.cyl((0, 0, z), 13.7, 13.7, 1.4, 'z', 8, BONE_D, rot=(0, 0, 22.5), bevel=.2)
for z in (-8, 8): hub.cyl((0, 0, z), 13.2, 13.2, .8, 'z', 8, RUST, rot=(0, 0, 22.5))
for sx in (-1, 1):  # docking ports on the flanks
    for z in (-7, 7):
        hub.cyl((sx * 12.6, 0, z), 3.6, 3.6, 1.6, 'x', 16, BONE_D, bevel=.2)
        hub.cyl((sx * 13.4, 0, z), 2.8, 2.8, .5, 'x', 16, SLATE_D, bevel=.1)
        hub.cyl((sx * 13.7, 0, z), 2.0, 2.0, .2, 'x', 16, BLACK)
        for a in range(0, 360, 45):
            hub.box((sx * 13.1, 3.1 * math.cos(math.radians(a)), z + 3.1 * math.sin(math.radians(a))), (.35, .5, .5), HAZ if a % 90 == 0 else BLACK, wear=0)
for sy in (-1, 1):
    hub.panels((0, sy * 12.3, 0), (14, 22), 3, 4, 'y', sy, gap=.18, lift=.18, color=BONE, vary=.25, skip=.12, bevel=0)
    hub.greebles((0, sy * 12.4, 0), (16, 22), 10, 'y', sy, hmax=.7, smax=2.2, smin=.5)
for sx in (-1, 1):
    hub.greebles((sx * 12.4, 0, 0), (20, 22), 8, 'x', sx, hmax=.5, smax=1.6, smin=.5)

# ---------------------------------------------------------------- spine ------------------------
def spine(name, z0, z1, side_greebles=True):
    k = K(name, maxlen=3.6)
    L = z1 - z0; zc = (z0 + z1) / 2
    k.box((0, 0, zc), (10, 10, L), BONE, bevel=.4, collide=True)
    n = int(L // 8)
    for i in range(n + 1):
        z = z0 + .5 + i * (L - 1) / n
        k.box((0, 0, z), (11.3, 11.3, 1.0), BONE_D, bevel=.18)
        for sx in (-1, 1):
            k.box((sx * 5.7, 0, z), (.4, 2.4, .8), RUST, bevel=.05)
    for i in range(n):
        z = z0 + 4.5 + i * (L - 1) / n
        for sy in (-1, 1): k.panels((0, sy * 5.0, z), (9, 6.4), 3, 2, 'y', sy, gap=.14, lift=.12, color=BONE, vary=.3, skip=.1, bevel=0)
        for sx in (-1, 1): k.panels((sx * 5.0, 0, z), (9, 6.4), 3, 2, 'x', sx, gap=.14, lift=.12, color=BONE_L, vary=.3, skip=.1, bevel=0)
    for sx in (-1, 1):  # conduits
        k.cyl((sx * 3.2, 5.7, zc), .32, .32, L - 1, 'z', 8, SLATE_L); k.cyl((sx * 4.2, 5.5, zc), .22, .22, L - 1, 'z', 8, RUST)
        k.cyl((sx * 3.2, -5.7, zc), .32, .32, L - 1, 'z', 8, SLATE_L)
    k.greebles((0, 5.2, zc), (8, L - 2), int(L / 3), 'y', 1, hmax=.45, smax=1.4, smin=.4)
    k.greebles((0, -5.2, zc), (8, L - 2), int(L / 4), 'y', -1, hmax=.45, smax=1.4, smin=.4)
    return k
spine('spine_fore', 14, 74)
spine('spine_aft', -74, -14)

# ---------------------------------------------------------------- nose module (z 72..96) -------
nose = K('nose', maxlen=3.2)
nose.box((0, 0, 84), (17, 17, 24), BONE, bevel=1.1, seg=2, collide=True)
for z in (74.5, 93.5):
    nose.box((0, 0, z), (17.8, 17.8, 2.2), BONE_D, bevel=.3)
    for sy in (-1, 1): nose.stripes((0, sy * 8.95, z), (17.2, 2.0), 12, 'y', thick=.06) if False else None
for z in (74.5, 93.5):
    nose.stripes((0, 8.92, z), (17, 2.0), 12, 'y', thick=.08)
    nose.stripes((0, -8.92, z), (17, 2.0), 12, 'y', thick=.08)
    nose.stripes((8.92, 0, z), (17, 2.0), 12, 'x', thick=.08)
    nose.stripes((-8.92, 0, z), (17, 2.0), 12, 'x', thick=.08)
windows(nose, (0, 8.55, 84), 5, 'x', normal='y', lit_kit=LA, rng=rng)
windows(nose, (0, 8.55, 78), 5, 'x', normal='y', lit_kit=LB, rng=rng)
windows(nose, (8.55, 0, 84), 6, 'z', size=(1.4, .85), gap=3, normal='x', lit_kit=LC, rng=rng, sign=1)
windows(nose, (-8.55, 0, 84), 6, 'z', size=(1.4, .85), gap=3, normal='x', lit_kit=LA, rng=rng, sign=-1)
nose.sphere((0, 8.6, 90), 3.6, (1, .55, 1), SLATE_D, 14, 8, half=True, rot=(-90, 0, 0), mat=GLASS, wear=0)   # bridge dome
nose.cyl((0, 8.7, 90), 3.9, 3.9, .5, 'y', 14, BONE_D, bevel=.1)
nose.panels((0, 8.6, 90), (14, 4), 5, 1, 'y', 1, gap=.2, lift=.12, color=BONE, skip=0)
for sy in (-1, 1): nose.greebles((0, sy * 8.6, 87), (14, 10), 9, 'y', sy, hmax=.5, smax=1.4, smin=.4)
nose.greebles((8.7, 0, 88), (12, 12), 5, 'x', 1, hmax=.4, smax=1.3, smin=.4)
# fore wall, windows
nose.greebles((0, 0, 96.1), (15, 15), 7, 'z', 1, hmax=.4, smax=2.0, smin=.6)
# docking collar
col = K('collar', maxlen=3.0)
col.cyl((0, 0, 102), 6.2, 6.2, 10, 'z', 12, BONE_D, rot=(0, 0, 15), bevel=.3, collide=False)
col._obb(Matrix.Translation(Vector((0, 0, 102))), (6, 6, 5))
col.cyl((0, 0, 107.2), 6.9, 6.9, 1.2, 'z', 12, RUST, bevel=.2)
col.cyl((0, 0, 107.9), 4.4, 4.4, .6, 'z', 12, BLACK)
for a in range(0, 360, 30):
    r = math.radians(a)
    col.box((6.6 * math.cos(r), 6.6 * math.sin(r), 107.2), (.9, .9, 1.0), HAZ if a % 60 == 0 else BLACK, rot=(0, 0, a), wear=0)
for sx in (-1, 1): beam(col, (sx * 6, 0, 97), (sx * 3.4, 0, 107.5), .5, SLATE_L)
col.greebles((0, 6.2, 102), (6, 9), 3, 'y', 1, hmax=.4, smax=1.2, smin=.4)

# ---------------------------------------------------------------- aft engine block -------------
eng = K('engine', maxlen=3.2)
eng.box((0, 0, -86), (16, 16, 28), BONE_D, bevel=.9, seg=2, collide=True)
for z in (-73.5, -98.5): eng.box((0, 0, z), (16.8, 16.8, 2), BONE, bevel=.3)
eng.box((0, 0, -106), (10, 10, 10), RUST_D, bevel=.5, collide=True)
for (x, y) in ((0, 0), (4.2, 3.2), (-4.2, 3.2), (4.2, -3.2), (-4.2, -3.2)):
    r = 2.6 if (x, y) != (0, 0) else 3.6
    eng.cyl((x, y, -112.5), r * .7, r * 1.35, 5.5, 'z', 14, SLATE, bevel=.1)
    eng.cyl((x, y, -115.2), r * 1.1, r * 1.1, .4, 'z', 14, BLACK)
    eng.cyl((x, y, -110.0), r * .75, r * .75, 1.4, 'z', 14, SLATE_L)
for a in range(0, 360, 45):
    r_ = math.radians(a); eng.box((8.2 * math.cos(r_), 8.2 * math.sin(r_), -98.8), (.9, .9, 1.1), HAZ if a % 90 == 0 else BLACK, wear=0)
eng.stripes((0, 8.5, -79), (15, 2.0), 10, 'y', thick=.08); eng.stripes((8.5, 0, -79), (15, 2.0), 10, 'x', thick=.08)
eng.stripes((0, -8.5, -79), (15, 2.0), 10, 'y', thick=.08); eng.stripes((-8.5, 0, -79), (15, 2.0), 10, 'x', thick=.08)
for sy in (-1, 1): eng.panels((0, sy * 8.3, -86), (14, 24), 3, 4, 'y', sy, gap=.2, lift=.14, color=BONE_D, vary=.3, skip=.12, bevel=0)
for sx in (-1, 1):
    eng.panels((sx * 8.3, 0, -86), (14, 24), 3, 4, 'x', sx, gap=.2, lift=.14, color=BONE_D, vary=.3, skip=.12, bevel=0)
    for z in (-82, -90):  # tank straps
        eng.cyl((sx * 9.2, 0, z), 2.4, 2.4, 1.0, 'x', 12, RUST, bevel=.1)
eng.greebles((0, 8.5, -86), (12, 22), 8, 'y', 1, hmax=.6, smax=1.6, smin=.5)

# ---------------------------------------------------------------- cargo pods -------------------
def pod(name, c, axis_len=20, r=5.5, rot=(0, 0, 0), tag=True):
    k = K(name, maxlen=3.0)
    with k.at(c, rot):
        k.cyl((0, 0, 0), r, r, axis_len, 'z', 14, BONE_D if rng.random() < .5 else BONE, bevel=.3, collide=False)
        k._obb(Matrix.Identity(4), (r * .95, r * .95, axis_len / 2))
        for z in (-axis_len / 2 + 1.2, 0, axis_len / 2 - 1.2): k.cyl((0, 0, z), r + .25, r + .25, .9, 'z', 14, RUST, bevel=.08)
        for z in (-axis_len / 2 + .3, axis_len / 2 - .3): k.cyl((0, 0, z), r * .72, r * .72, .5, 'z', 14, SLATE, bevel=.08)
        k.stripes((0, 0, 0), (1, 1), 2, 'z') if False else None
        if tag: k.box((r + .1, 0, axis_len / 2 - 3.5), (.3, 2.4, 3.0), HAZ, wear=0, bevel=.05)
        k.greebles((0, r + .1, 0), (r * 1.2, axis_len - 4), 4, 'y', 1, hmax=.4, smax=1.4, smin=.4)
        for a in (-1, 1): beam(k, (a * r * .6, -r * .8, 0), (a * r * .6, -r * 1.05, 0), .6, SLATE_L)
    return k
for i, (x, z) in enumerate([(14, 32), (-14, 32), (14, -38), (-14, -38)]):
    pod(f'pod_{i}', (x, 0, z), 20, 5.5)
    kk = kits['spine_fore' if z > 0 else 'spine_aft']
    for zz in (z - 6, z + 6): beam(kk, (sx := (5.4 if x > 0 else -5.4), 0, zz), (x * 0.62, 0, zz), 1.0, BONE_D, collide=False)
    kk.box((x * .68, 0, z), (2.4, 2.4, 16), SLATE, bevel=.2)
# vertical modules
for name, (y, z) in (('module_up', (15, 44)), ('module_dn', (-15, -52))):
    k = K(name, maxlen=3.0)
    k.box((0, y, z), (8, 8, 18), BONE, bevel=.5, seg=1, collide=True)
    s = 1 if y > 0 else -1
    k.box((0, y * .6, z), (3, abs(y) * .5, 3), SLATE, bevel=.3)
    k.box((0, y - s * 4.3, z), (6, .8, 14), RUST, bevel=.1)
    for zz in (z - 7.8, z + 7.8): k.stripes((0, y + s * 4.2, zz), (7.8, 1.2), 8, 'y', thick=.08) if False else None
    k.stripes((0, y + s * 4.05, z - 6.5), (7.6, 1.4), 8, 'y', thick=.08)
    k.panels((0, y + s * 4.0, z + 1), (7.4, 10), 2, 3, 'y', s, gap=.16, lift=.12, color=BONE_L, skip=.1, bevel=0)
    for sx in (-1, 1): k.panels((sx * 4.0, y, z), (14, 7), 3, 2, 'x', sx, gap=.16, lift=.12, color=BONE, skip=.1, bevel=0)
    k.greebles((0, y + s * 4.0, z + 1), (7, 14), 4, 'y', s, hmax=.4, smax=1.2, smin=.4)
    windows(k, (0, y, z + 9.05), 3, 'x', normal='z', size=(1.3, .85), gap=2.2, lit_kit=LB, rng=rng)

# ---------------------------------------------------------------- solar arrays -----------------
boom = K('solar_boom', maxlen=6)
boom.box((0, 0, -26), (120, 1.6, 1.6), SLATE, bevel=.2, collide=True)
for x in range(-56, 60, 8): boom.box((x, 0, -26), (.6, 2.2, 2.2), SLATE_L, bevel=.1)
boom.cyl((0, 0, -26), 4.6, 4.6, 5, 'x', 12, BONE_D, bevel=.2)
def panel_array(name, cx, rot, damage=0.0):
    k = K(name, maxlen=8)
    with k.at((cx, 0, -26), rot):
        k.box((0, 0, 0), (50, .7, 22), SLATE_D, collide=True, bevel=.1, wear=0)
        for i in range(10):
            for j in range(4):
                if rng.random() < damage: continue
                sh = 1 + (rng.random() - .5) * .3
                col = tuple(min(1, x_ * sh) for x_ in lin(0x2a4258))
                k.box((-22.5 + i * 5, .4, -8.25 + j * 5.5), (4.7, .12, 5.1), col, bevel=.04, wear=0)
        for i in range(11): k.box((-25 + i * 5, .38, 0), (.25, .3, 22), BONE_D)
        for j in range(5): k.box((0, .38, -11 + j * 5.5), (50, .3, .25), BONE_D)
        k.box((0, -.6, 0), (50, .5, 1), SLATE_L); k.box((-25, 0, 0), (.6, .9, 22.2), BONE_D, bevel=.05); k.box((25, 0, 0), (.6, .9, 22.2), BONE_D, bevel=.05)
    return k
panel_array('solar_r', 42, (0, 0, 1.7), damage=.07)
panel_array('solar_l', -42, (0, 0, -31.5), damage=.22)

# ---------------------------------------------------------------- antennae ---------------------
for name, base, rot in (('mast_fore', (6, 6, 60), (0, 10, 0)), ('mast_aft', (-4, 5.5, -66), (11.5, 0, 6))):
    k = K(name, maxlen=2)
    k.box((0, 0, 0), (.1, .1, .1), BONE, wear=0)
    if name == 'mast_fore':
        with k.at((6, 12, 60), (0, 10, 0)):
            k.box((0, 0, 0), (.8, .8, 40), SLATE_L, bevel=.1, collide=True)
            for z in range(-18, 20, 6): k.box((0, 0, z), (2.2, .35, .35), SLATE_L); k.box((0, 0, z), (.35, 2.2, .35), SLATE_L)
            k.sphere((0, 0, -20.5), 3.0, (1, 1, .5), BONE, 16, 8, half=True, rot=(180, 0, 0))
            k.cyl((0, 0, -19.8), .25, .25, 1.6, 'z', 6, SLATE_L)
            k.lamp((0, 1, 19.5), (.4, .4, .4), RED)
        with k.at((6, 5.3, 44)): beam(k, (0, 0, 0), (0, 5.5, 14), .5, SLATE)
    else:
        with k.at((-4, 18, -66), (11.5, 0, 6)):
            k.box((0, 0, 0), (.8, 30, .8), SLATE_L, bevel=.1, collide=True)
            for y in range(-12, 14, 6): k.box((0, y, 0), (2.4, .35, .35), SLATE_L); k.box((0, y, 0), (.35, .35, 2.4), SLATE_L)
            k.sphere((0, 15.6, 0), 2.2, (1, .6, 1), BONE_D, 14, 8, half=True, rot=(-90, 0, 0))
            k.lamp((0, 15.5, 1.2), (.4, .4, .4), RED)

# ---------------------------------------------------------------- ring (rotates) --------------
ring = K('ring', maxlen=4.5)
RR, NSEG = 50.0, 40
ring.cyl((0, 0, 0), 13.6, 13.6, 4.4, 'z', 16, BONE_D, bevel=.25)                     # slip collar
ring.cyl((0, 0, 0), 14.2, 14.2, .8, 'z', 16, RUST, bevel=.1)
def octa_(r, ch=.6): return [(r * ch, r), (r, r * ch), (r, -r * ch), (r * ch, -r), (-r * ch, -r), (-r, -r * ch), (-r, r * ch), (-r * ch, r)]
chord = 2 * RR * math.sin(math.pi / NSEG)
for i in range(NSEG):
    a = i / NSEG * 2 * math.pi
    c = (math.cos(a) * RR, math.sin(a) * RR, 0)
    hab = (i % 5 == 0)
    r = 4.4 if hab else 3.4
    with ring.at(c, (0, 0, math.degrees(a) + 90)):   # local z along tangent? rotate so z axis points along tangent
        pass
    # segment frame: x radial, y -> world z, z tangential
    rotm = Matrix(((math.cos(a), -math.sin(a), 0), (math.sin(a), math.cos(a), 0), (0, 0, 1)))
    with ring.at(c, Euler((0, 0, a))):
        with ring.at((0, 0, 0), Euler((math.pi / 2, 0, 0))):   # now local z = world... build loft along local z then orient
            pass
    # simplest: build as three boxes aligned to tangent
    with ring.at(c, Euler((0, 0, a + math.pi / 2))):   # local y = tangent
        ring.box((0, 0, 0), (r * 2, chord + .15, r * 2), BONE_D if not hab else BONE, bevel=.5 if hab else .6, seg=1)
        ring.box((0, 0, 0), (r * 2 + .5, .7, r * 2 + .5), RUST, bevel=.2)
        ring.box((0, chord / 2, 0), (r * 2 + 1.1, .9, r * 2 + 1.1), BONE_D, bevel=.25)
        if hab:
            ring.box((0, 0, 0), (r * 2 + .8, chord * .62, r * 2 + .8), BONE, bevel=.5)
            ring.box((-r - .6, 0, 0), (.5, chord * .55, 2.2), AMBER, mat=LAMP, wear=0) if False else None
        else:
            for zz in (-1, 1): ring.box((0, 0, zz * r * .98), (r * 1.4, chord * .8, .12), SLATE_L)
        ring.panels((0, 0, r), (chord - 1.2, r * 1.6), 2, 1, 'z', 1, gap=.15, lift=.1, color=BONE_L, vary=.3, skip=.15, bevel=0) if False else None
        # ring windows on the inner face (x negative), flickering lamp kit
        if rng.random() < .8:
            n = 2 if hab else 1
            for j in range(n):
                y = (j - (n - 1) / 2) * 3.0
                w = (.9, .6)
                ring.box((-r - (.4 if hab else 0) - .05, y, 0), (.1, 2.0, .9), BLACK, mat=GLASS, wear=0) if hab else ring.box((-r - .02, y, 0), (.1, 2.0, .7), BLACK, mat=GLASS, wear=0)
                if rng.random() < .3:
                    L = rng.choice(lamps)
                    with L.at(c, Euler((0, 0, a + math.pi / 2))):
                        L.box((-r - (.4 if hab else 0) - .12, y, 0), (.08, 1.9, .8), AMBER, mat=LAMP, wear=0)
        if i % 10 == 3: ring.box((0, 0, 0), (r * 2 + 1.6, 1.2, r * 2 + 1.6), HAZ, wear=0)
# spokes (truss)
for k_ in range(4):
    a = k_ * math.pi / 2 + .3
    d = Vector((math.cos(a), math.sin(a), 0)); n_ = Vector((-math.sin(a), math.cos(a), 0)); z_ = Vector((0, 0, 1))
    p0, p1 = d * 12, d * 47
    for sgn in (-1, 1):
        for sz in (-1, 1):
            beam(ring, p0 + n_ * sgn * 1.2 + z_ * sz * 1.2, p1 + n_ * sgn * 1.2 + z_ * sz * 1.2, .5, BONE_D)
    nn = 7
    for i in range(nn):
        t0, t1 = i / nn, (i + 1) / nn
        a0, a1 = p0 + (p1 - p0) * t0, p0 + (p1 - p0) * t1
        s_ = 1 if i % 2 == 0 else -1
        beam(ring, a0 - n_ * s_ * 1.2 + z_ * 1.2, a1 + n_ * s_ * 1.2 + z_ * 1.2, .3, SLATE_L)
        beam(ring, a0 - n_ * s_ * 1.2 - z_ * 1.2, a1 + n_ * s_ * 1.2 - z_ * 1.2, .3, SLATE_L)
    ring.box(tuple(d * 28), (3.0, 3.0, 3.0), RUST, rot=Euler((0, 0, a)), bevel=.3)
    ring.box(tuple(d * 12.6), (2.6, 3.6, 3.6), BONE_D, rot=Euler((0, 0, a)), bevel=.3)
    ring.box(tuple(d * 47.4), (3.0, 3.6, 3.6), BONE_D, rot=Euler((0, 0, a)), bevel=.3)

# ---------------------------------------------------------------- hazard bands on hub/spine ----
hub.stripes((0, 12.55, -16), (24, 2.2), 14, 'y', thick=.08) if False else None
for z in (-79, -93): pass
for z in (-16,):
    for sy in (-1, 1): hub.stripes((0, sy * 12.6, 0), (14, 1.4), 10, 'y', thick=.06) if False else None
for kname, z in (('spine_fore', 66), ('spine_aft', -66)):
    k = kits[kname]
    for sy in (-1, 1): k.stripes((0, sy * 5.65, z), (10.6, 1.6), 9, 'y', thick=.08)
    for sx in (-1, 1): k.stripes((sx * 5.65, 0, z), (10.6, 1.6), 9, 'x', thick=.08)

# ---------------------------------------------------------------- bake + export ---------------
names = [n for n in kits]
all_k = [kits[n] for n in names]
bake_ao([k for k in all_k if not k.name.startswith('lamps')], rays=16, dist=7.0, strength=.85, other=[kits[n] for n in names if n.startswith('lamps')])
out = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'assets')
export_glb(all_k, os.path.join(out, 'station.glb'))
meta = {'chunks': {}}
for n in names:
    k = kits[n]
    if not k.obbs: continue
    meta['chunks'][n] = {'obbs': k.obbs}
json.dump(meta, open(os.path.join(out, 'station.json'), 'w'))
print('chunks', len(names), 'obbs', sum(len(v['obbs']) for v in meta['chunks'].values()))
