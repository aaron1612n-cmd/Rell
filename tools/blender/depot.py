"""Salvage depot ("the Yard"): a working tender where salvage is delivered and the ship is serviced.
Alive, unlike the wrecks: lots of lit windows, beacons, floodlit catch frame with hazard bands.
Run: python tools/blender/depot.py -> src/assets/depot.glb, depot.json (colliders per chunk + catch volume)

Layout (game coords, Y up): spine along Z. The catch (delivery cradle) is an open frame at +Z whose
mouth faces +Z; cargo towed through the mouth is captured. Hab drums at -Z, radiators aft.
"""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(__file__))
from kit import *
from mathutils import Vector, Matrix

kits = {}
def K(name, seed=None, maxlen=3.0):
    k = Kit(name, seed or (sum(map(ord, name)) % 1000)); k.maxlen = maxlen; kits[name] = k; return k

rng = random.Random(21)
LW = K('lamps')       # steady window light
LB = K('beacon')      # blinking nav beacons
LG = K('catch_lights')  # catch-frame state lights (tinted in game)

def windows(k, c, n, along, normal, sign=1, size=(1.3, .8), gap=2.4, lit=.7):
    for i in range(n):
        o = (i - (n - 1) / 2) * gap
        p = [c[0], c[1], c[2]]; p['xyz'.index(along)] += o
        ni = 'xyz'.index(normal)
        s_ = [0, 0, 0]; s_[ni] = .08
        rest = [j for j in range(3) if j != ni]
        s_[rest[0]] = size[0] if rest[0] == 'xyz'.index(along) else size[1]
        s_[rest[1]] = size[0] if rest[1] == 'xyz'.index(along) else size[1]
        fr = list(s_); fr[rest[0]] *= 1.2; fr[rest[1]] *= 1.2
        k.box(tuple(p), tuple(fr), BONE_D, bevel=.02, wear=0)
        q = list(p); q[ni] += sign * .05
        if rng.random() < lit: LW.box(tuple(q), tuple(s_), AMBER if rng.random() < .75 else WHITE, mat=LAMP, wear=0)
        else: k.box(tuple(q), tuple(s_), BLACK, mat=GLASS, wear=0)

# ------------------------------------------------------------ spine (z -60..40) -------------
sp = K('spine', maxlen=3.6)
sp.box((0, 0, -10), (9, 9, 100), BONE_D, bevel=.4, collide=True)
for i in range(11):
    z = -58 + i * 9.6
    sp.box((0, 0, z), (10.4, 10.4, 1.0), BONE, bevel=.15)
for sx in (-1, 1):
    sp.cyl((sx * 3.0, 5.0, -10), .35, .35, 98, 'z', 8, SLATE_L); sp.cyl((sx * 3.0, -5.0, -10), .35, .35, 98, 'z', 8, RUST)
    sp.panels((sx * 4.5, 0, -10), (8, 96), 2, 10, 'x', sx, gap=.15, lift=.12, color=BONE, vary=.25, skip=.08, bevel=0)
sp.greebles((0, 4.6, -10), (7, 94), 30, 'y', 1, hmax=.5, smax=1.4, smin=.4)
sp.greebles((0, -4.6, -10), (7, 94), 24, 'y', -1, hmax=.5, smax=1.4, smin=.4)
for z in (-30, 10):
    for sy in (-1, 1): sp.stripes((0, sy * 4.55, z), (8.6, 1.6), 8, 'y', thick=.08)

# ------------------------------------------------------------ hab drums (z -60..-24) ----------
hab = K('hab', maxlen=3.4)
for i in range(3):
    a = math.radians(90 + i * 120)
    c = (math.cos(a) * 11, math.sin(a) * 11, -42)
    hab.cyl(c, 7, 7, 30, 'z', 16, BONE, bevel=.3, collide=False)
    hab._obb(Matrix.Translation(Vector(c)), (6.6, 6.6, 15))
    for z in (-56.4, -27.6): hab.cyl((c[0], c[1], z), 7.5, 7.5, 1.2, 'z', 16, BONE_D, bevel=.15)
    for z in (-49, -35): hab.cyl((c[0], c[1], z), 7.2, 7.2, .7, 'z', 16, RUST)
    for z in (-60, -24): hab.cyl((c[0], c[1], z), 4.6, 4.6, 3.2, 'z', 12, SLATE, bevel=.2)
    # window rows facing outward
    for row in (-1, 0, 1):
        ang = a + row * .42
        n_ = Vector((math.cos(ang), math.sin(ang), 0))
        with hab.at((c[0] + n_.x * 7.02, c[1] + n_.y * 7.02, -42), Euler((0, 0, ang))):
            for j in range(9):
                z = (j - 4) * 2.9
                hab.box((0, 0, z), (.1, 1.3, 1.9), BONE_D, wear=0)
                if rng.random() < .72:
                    with LW.at((c[0] + n_.x * 7.08, c[1] + n_.y * 7.08, -42), Euler((0, 0, ang))):
                        LW.box((0, 0, z), (.08, 1.0, 1.55), AMBER if rng.random() < .8 else WHITE, mat=LAMP, wear=0)
                else: hab.box((.04, 0, z), (.08, 1.0, 1.55), BLACK, mat=GLASS, wear=0)
    beam(hab, (c[0] * .4, c[1] * .4, -42), (c[0] * .82, c[1] * .82, -42), 2.4, SLATE_L)

# ------------------------------------------------------------ tank farm (z 0..20) -------------
tk = K('tanks', maxlen=3.0)
for sx in (-1, 1):
    beam(tk, (sx * 4.5, 0, 6), (sx * 26, 0, 6), 1.4, SLATE_L)
    for j, z in enumerate((-2, 14)):
        beam(tk, (sx * 4.5, 0, z), (sx * 26, 0, 6), .7, SLATE)
    for k_, x in enumerate((13, 22)):
        for sy in (-1, 1):
            c = (sx * x, sy * 5.6, 6)
            tk.sphere(c, 4.6, (1, 1, 1), BONE_L if (k_ + sy) % 2 else BONE, 18, 12)
            tk._obb(Matrix.Translation(Vector(c)), (4.2, 4.2, 4.2))
            tk.cyl(c, 4.75, 4.75, .5, 'y', 18, RUST)
            tk.cyl((c[0], c[1], c[2]), 4.7, 4.7, .5, 'x', 18, BONE_D)
            tk.cyl((c[0], c[1] + sy * 4.7, c[2]), .6, .6, .9, 'y', 8, SLATE_L)
            tk.box((c[0], c[1] + sy * 2.6, c[2] + 3.8), (1.6, .3, 1.0), HAZ, rot=(30 * sy, 0, 0), wear=0)

# ------------------------------------------------------------ the catch (z 40..76) ------------
# open square frame, 30 m inside, 36 m long. Mouth at +Z. Colliders only on the frame members.
ct = K('catch', maxlen=3.4)
S, L, z0, z1 = 17.0, 36.0, 42.0, 78.0
zc = (z0 + z1) / 2
for sx in (-1, 1):
    for sy in (-1, 1):
        ct.box((sx * S, sy * S, zc), (2.6, 2.6, L), BONE_D, bevel=.25, collide=True)       # longerons
        beam(ct, (sx * 4.4, sy * 4.4, 39.5), (sx * S, sy * S, z0 + 2), 1.6, SLATE_L)       # struts back to spine
for z in (z0, z0 + L / 3, z0 + 2 * L / 3, z1):
    for (a, b, horiz) in (((-S, S), (S, S), 1), ((-S, -S), (S, -S), 1), ((S, -S), (S, S), 0), ((-S, -S), (-S, S), 0)):
        p0 = (a[0], a[1], z); p1 = (b[0], b[1], z)
        cc = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z)
        size = (2 * S, 2.0, 2.0) if horiz else (2.0, 2 * S, 2.0)
        ct.box(cc, size, BONE if z != z1 else BLACK, bevel=.2, collide=True)
# hazard bands framing the mouth
for sy in (-1, 1): ct.stripes((0, sy * (S - 1.06), z1), (2 * S - 2.6, 1.9), 18, 'y' if sy < 0 else 'y', thick=.1) if False else None
for sy in (-1, 1):
    with ct.at((0, sy * S, z1 + 1.05)):
        ct.stripes((0, 0, 0), (2 * S + 2.6, 2.0), 20, 'z', thick=.1)
for sx in (-1, 1):
    with ct.at((sx * S, 0, z1 + 1.05), (0, 0, 90)):
        ct.stripes((0, 0, 0), (2 * S - 2.0, 2.0), 18, 'z', thick=.1)
# back wall: grapple plate with clamp jaws
ct.box((0, 0, z0 - .6), (2 * S - 4, 2 * S - 4, .8), SLATE_D, bevel=.1, wear=0, collide=True)
ct.panels((0, 0, z0 - .2), (2 * S - 5, 2 * S - 5), 5, 5, 'z', 1, gap=.25, lift=.15, color=SLATE, vary=.3, skip=.1, bevel=0)
for a in range(4):
    r = math.radians(a * 90 + 45)
    ct.box((math.cos(r) * 9, math.sin(r) * 9, z0 + 1.5), (3, 3, 3), RUST, rot=(0, 0, a * 90 + 45), bevel=.25)
    ct.box((math.cos(r) * 7.6, math.sin(r) * 7.6, z0 + 3.4), (1.2, 1.2, 2.2), HAZ, rot=(0, 0, a * 90 + 45), bevel=.1, wear=0)
# floodlights in the corners (pointing inward), and the state light strips along the longerons
for sx in (-1, 1):
    for sy in (-1, 1):
        for z in (z0 + 6, z1 - 3):
            ct.box((sx * (S - 1.9), sy * (S - 1.9), z), (1.4, 1.4, 1.0), SLATE, rot=(0, 0, 45), bevel=.1)
            LW.box((sx * (S - 2.5), sy * (S - 2.5), z), (.9, .9, .6), WHITE, rot=(0, 0, 45), mat=LAMP, wear=0)
        LG.box((sx * (S - 1.35), sy * (S - 1.35), zc), (.25, .25, L - 4), WHITE, rot=(0, 0, 45), mat=LAMP, wear=0)
for sx in (-1, 1):
    for sy in (-1, 1):
        LG.box((sx * (S + 1.4), sy * (S + 1.4), z1 + .5), (1.0, 1.0, 1.0), WHITE, mat=LAMP, wear=0)

# ------------------------------------------------------------ radiators (z -64) --------------
rd = K('radiators', maxlen=6)
for sx in (-1, 1):
    with rd.at((sx * 30, 0, -66)):
        rd.box((0, 0, 0), (44, .5, 10), BONE_L, bevel=.05, collide=True, wear=0)
        for i in range(22): rd.box((-21 + i * 2, .35, 0), (.3, .3, 10), BONE_D, wear=0)
        rd.box((0, 0, -5.2), (44, .9, .6), SLATE_L); rd.box((0, 0, 5.2), (44, .9, .6), SLATE_L)
    beam(rd, (sx * 4.5, 0, -66), (sx * 8.5, 0, -66), 1.2, SLATE)

# ------------------------------------------------------------ crane + dish + mast ------------
cr = K('crane', maxlen=2.5)
beam(cr, (4.5, 4.5, 30), (14, 16, 34), 1.2, BONE_D, collide=False)
beam(cr, (14, 16, 34), (8, 22, 52), 1.0, BONE_D)
cr.box((14, 16, 34), (2.2, 2.2, 2.2), RUST, bevel=.2)
cr.box((8, 22, 52.5), (1.6, 1.6, 2.4), HAZ, bevel=.15, wear=0)
cr.cyl((8, 19.6, 52.5), .12, .12, 4.4, 'y', 6, SLATE)
cr.box((8, 17.2, 52.5), (2.0, .6, 2.0), SLATE_L, bevel=.1)
LB.box((8, 23, 52.5), (.5, .5, .5), RED, mat=LAMP, wear=0)

dh = K('dish', maxlen=2.5)
dh.cyl((0, 6.5, -6), 1.2, 1.2, 4, 'y', 10, SLATE_L)
dh.sphere((0, 11.4, -6), 6, (1, .38, 1), BONE_L, 20, 10, half=True, rot=(-150, 0, 0))
dh.cyl((0, 10.4, -6), .2, .2, 6, 'y', 6, SLATE, rot=(-60, 0, 0))
dh._obb(Matrix.Translation(Vector((0, 10, -6))), (5, 2.5, 5))

ms = K('mast', maxlen=2.5)
ms.box((0, -14, -40), (.7, 46, .7), SLATE_L, bevel=.08, collide=True)
for y in range(-34, 8, 6): ms.box((0, y, -40), (2.2, .3, .3), SLATE_L)
LB.box((0, -37.4, -40), (.7, .7, .7), RED, mat=LAMP, wear=0)
LB.box((0, 9.4, -40), (.7, .7, .7), WHITE, mat=LAMP, wear=0)
for sx in (-1, 1): LB.box((sx * 52, 0, -66), (.6, .6, .6), GREEN if sx > 0 else RED, mat=LAMP, wear=0)

# ------------------------------------------------------------ bake + export ------------------
names = list(kits)
lampk = [kits[n] for n in ('lamps', 'beacon', 'catch_lights')]
bake_ao([kits[n] for n in names if kits[n] not in lampk], rays=16, dist=7.0, strength=.85, other=lampk)
out = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'assets')
export_glb([kits[n] for n in names], os.path.join(out, 'depot.glb'))
meta = {'chunks': {n: {'obbs': kits[n].obbs} for n in names if kits[n].obbs},
        'catch': {'c': [0, 0, (z0 + z1) / 2], 'h': [S - 1.5, S - 1.5, L / 2], 'mouth': [0, 0, z1]},
        'dock': {'c': [0, 0, z1 + 30], 'r': 30}}
json.dump(meta, open(os.path.join(out, 'depot.json'), 'w'))
print('depot chunks', len(names), 'obbs', sum(len(v['obbs']) for v in meta['chunks'].values()))
