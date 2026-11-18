"""Broken bulk freighter: a lattice keel snapped in two, container racks with gaps, a tilted bridge,
cold engines. Containers are separate chunks (`box_0..`) so they can be torn off and towed as salvage.
Run: python tools/blender/freighter.py -> src/assets/freighter.glb, freighter.json
"""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(__file__))
from kit import *
from mathutils import Vector, Matrix

kits = {}
def K(name, seed=None, maxlen=3.0):
    k = Kit(name, seed or (sum(map(ord, name)) % 1000)); k.maxlen = maxlen; kits[name] = k; return k

rng = random.Random(7)
LP = K('lamps')

def keel(k, z0, z1, ragged_end=None):
    L = z1 - z0; zc = (z0 + z1) / 2; W = 3.2
    for sx in (-1, 1):
        for sy in (-1, 1): k.box((sx * W, sy * W, zc), (1.0, 1.0, L), BONE_D, bevel=.1)
    k._obb(Matrix.Translation(Vector((0, 0, zc))), (W + .5, W + .5, L / 2))
    n = int(L / 6)
    for i in range(n + 1):
        z = z0 + i * L / n
        for (a, b) in (((-W, -W), (W, -W)), ((-W, W), (W, W)), ((-W, -W), (-W, W)), ((W, -W), (W, W))):
            beam(k, (a[0], a[1], z), (b[0], b[1], z), .55, BONE_D)
    for i in range(n):
        za, zb = z0 + i * L / n, z0 + (i + 1) * L / n
        s = 1 if i % 2 else -1
        for sx in (-1, 1): beam(k, (sx * W, -s * W, za), (sx * W, s * W, zb), .4, RUST)
        for sy in (-1, 1): beam(k, (-s * W, sy * W, za), (s * W, sy * W, zb), .4, SLATE_L)
    k.cyl((0, 0, zc), .7, .7, L, 'z', 8, SLATE)  # core pipe
    if ragged_end is not None:  # snapped members sticking out
        for sx in (-1, 1):
            for sy in (-1, 1):
                ln = rng.uniform(1.5, 5)
                beam(k, (sx * W, sy * W, ragged_end), (sx * W * rng.uniform(.6, 1.4), sy * W * rng.uniform(.6, 1.4), ragged_end + (ln if z1 == ragged_end else -ln)), .8, RUST)

# keel in two halves, aft is straight, fore is bent (built at an angle by the at() frame)
aft = K('keel_aft', maxlen=4)
keel(aft, -96, -6, ragged_end=-6)
fore = K('keel_fore', maxlen=4)
with fore.at((0, 4, -2), (8, -6, 4)):
    keel(fore, 2, 82, ragged_end=2)

# containers: racks either side of the keel. Each a chunk. Gaps where some already drifted off.
COL = [BONE, BONE_D, RUST, SLATE_L, RUST_D, BONE_L]
boxes = []
def container(name, c, rot, tag):
    k = K(name, maxlen=2.4)
    with k.at(c, rot):
        col = rng.choice(COL)
        k.box((0, 0, 0), (4.4, 4.4, 11), col, bevel=.12, collide=True)
        for z in (-5.3, 5.3): k.box((0, 0, z), (4.6, 4.6, .4), BONE_D if col != BONE_D else SLATE_L, bevel=.06)
        for i in range(9):  # corrugation
            z = -4.4 + i * 1.1
            for sx in (-1, 1): k.box((sx * 2.22, 0, z), (.08, 4.0, .45), tuple(x * .85 for x in lin(col)), wear=0)
            for sy in (-1, 1): k.box((0, sy * 2.22, z), (4.0, .08, .45), tuple(x * .85 for x in lin(col)), wear=0)
        for sx in (-1, 1):
            for sy in (-1, 1):
                for z in (-5.4, 5.4): k.box((sx * 2.15, sy * 2.15, z), (.5, .5, .5), SLATE, wear=0)
        if tag:
            k.box((2.3, 0, 3.0), (.12, 2.6, 2.0), HAZ, wear=0)
            k.box((0, 2.3, 3.0), (2.0, .12, 2.6), HAZ, wear=0)
    boxes.append(name)
    return k

slots = []
for side in (-1, 1):
    for row in (0, 1):
        for i in range(6):
            slots.append((side, row, i))
rng.shuffle(slots)
kept = slots[:14]
for j, (side, row, i) in enumerate(sorted(kept)):
    if i < 3:   # aft rack along the straight keel
        c = (side * (6.0 + row * 4.8), 0, -86 + i * 12.4)
        rot = (0, 0, rng.uniform(-3, 3))
    else:       # fore rack follows the bent keel
        z = 14 + (i - 3) * 12.4
        p = Matrix.Translation(Vector((0, 4, -2))) @ R(8, -6, 4).to_matrix().to_4x4() @ Vector((side * (6.0 + row * 4.8), 0, z, 1))
        c = (p.x, p.y, p.z); rot = (8 + rng.uniform(-6, 6), -6 + rng.uniform(-8, 8), 4 + rng.uniform(-10, 10))
    container(f'box_{j}', c, rot, tag=rng.random() < .35)

# bridge block at the bow, tilted, windows dark except a few
br = K('bridge', maxlen=3)
with br.at((0, 18, 84), (8, -6, 4)):
    with br.at((0, 0, 0), (-14, 0, 0)):
        br.box((0, 0, 0), (16, 9, 12), BONE, bevel=.6, collide=True)
        br.box((0, 5.2, -1), (12, 1.6, 9), BONE_D, bevel=.3)
        br.panels((8.05, 0, 0), (8, 11), 2, 3, 'x', 1, gap=.15, lift=.1, color=BONE_L, skip=.1, bevel=0)
        br.panels((-8.05, 0, 0), (8, 11), 2, 3, 'x', -1, gap=.15, lift=.1, color=BONE_L, skip=.1, bevel=0)
        for i in range(6):
            x = -6.25 + i * 2.5
            br.box((x, 1.2, 6.05), (2.0, 1.4, .1), BLACK, mat=GLASS, wear=0)
            if i in (1, 4): LP.box((x, 1.2, 6.1), (1.9, 1.3, .06), AMBER, mat=LAMP, wear=0)
        br.stripes((0, -3.0, 6.05), (15, 1.4), 12, 'z', thick=.07)
        br.box((0, -7, -2), (5, 6, 5), SLATE_L, bevel=.3)
        LP.box((7.6, 4.8, 5.8), (.5, .5, .5), RED, mat=LAMP, wear=0)

# engine block (cold) + three bells
en = K('engines', maxlen=3)
en.box((0, 0, -104), (14, 12, 16), BONE_D, bevel=.7, seg=2, collide=True)
for z in (-97, -111): en.box((0, 0, z), (14.6, 12.6, 1.2), RUST, bevel=.2)
for x in (-4.4, 0, 4.4):
    en.cyl((x, 0, -115), 1.6, 2.9, 5, 'z', 14, SLATE, bevel=.1)
    en.cyl((x, 0, -117.6), 2.95, 2.95, .3, 'z', 14, BLACK)
en.stripes((0, 6.1, -104), (13, 2), 10, 'y', thick=.08)
en.greebles((7.05, 0, -104), (10, 14), 8, 'x', 1, hmax=.5, smax=1.4, smin=.4)
en.greebles((-7.05, 0, -104), (10, 14), 8, 'x', -1, hmax=.5, smax=1.4, smin=.4)
# reactor housing on top of the engine block: open cage where the core sits (core is a salvage prop)
en.cyl((0, 8.4, -104), 4.2, 4.2, 2.0, 'y', 12, SLATE_L, bevel=.15)
for a in range(0, 360, 60):
    r = math.radians(a)
    beam(en, (math.cos(r) * 4, 7.6, -104 + math.sin(r) * 4), (math.cos(r) * 3, 14, -104 + math.sin(r) * 3), .4, BONE_D)
en.cyl((0, 14.2, -104), 3.4, 3.4, .5, 'y', 12, RUST)

names = list(kits)
bake_ao([kits[n] for n in names if n != 'lamps'], rays=14, dist=6.0, strength=.85, other=[kits['lamps']])
out = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'assets')
export_glb([kits[n] for n in names], os.path.join(out, 'freighter.glb'))
meta = {'chunks': {n: {'obbs': kits[n].obbs} for n in names if kits[n].obbs}, 'boxes': boxes, 'core': [0, 11, -104]}
json.dump(meta, open(os.path.join(out, 'freighter.json'), 'w'))
print('freighter chunks', len(names), 'obbs', sum(len(v['obbs']) for v in meta['chunks'].values()))
