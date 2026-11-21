"""Debris family: eight salvage props + a hull chunk. Roughly 1 m radius each (scaled in game).
Run: python tools/blender/debris.py -> src/assets/debris.glb, debris.json (collision radius per type)"""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(__file__))
from kit import *
import bmesh, bpy
from mathutils import Vector

ks = {}
def D(name, seed=1):
    k = Kit(name, seed); k.maxlen = .22; ks[name] = k; return k

# tank: capsule with straps, valves
k = D('tank', 2)
k.cyl((0, 0, 0), .6, .6, 1.8, 'z', 14, BONE_D, bevel=.0)
for z in (-.95, .95): k.sphere((0, 0, z), .6, (1, 1, .55), BONE_D, 14, 8)
for z in (-.55, 0, .55): k.cyl((0, 0, z), .63, .63, .12, 'z', 14, RUST, bevel=.02)
k.cyl((0, .66, .2), .12, .12, .3, 'y', 8, SLATE); k.cyl((0, .85, .2), .2, .2, .08, 'y', 8, HAZ, wear=0)
k.box((0, -.7, 0), (.5, .2, 1.4), SLATE, bevel=.03)
k.stripes((0, .6, -.75), (.4, .5), 4, 'y', thick=.02) if False else None

# solar panel (bent)
k = D('panel', 3)
k.box((0, 0, 0), (2.4, .06, 1.5), SLATE_D, bevel=.02, wear=0)
for i in range(5):
    for j in range(3):
        if (i, j) in ((4, 2), (3, 2)): continue
        sh = 1 + (k.rng.random() - .5) * .3
        k.box((-.96 + i * .48, .04, -.5 + j * .5), (.44, .03, .46), tuple(min(1, x * sh) for x in lin(0x2f4b63)), wear=0)
k.box((0, .03, 0), (2.4, .05, .05), BONE_D); k.box((-1.2, .02, 0), (.06, .09, 1.5), BONE_D); k.box((1.2, .02, 0), (.06, .09, 1.5), BONE_D)
k.box((0, -.1, 0), (.1, .1, 1.6), SLATE_L); k.box((-1.3, -.1, 0), (.28, .2, .3), RUST, bevel=.03)

# truss segment
k = D('truss', 4)
L = 3.2
for sx in (-1, 1):
    for sy in (-1, 1): k.box((sx * .3, sy * .3, 0), (.09, .09, L), BONE_D, bevel=.01)
for i in range(6):
    z0 = -L / 2 + i * L / 5
    for sx in (-1, 1): k.box((sx * .3, 0, z0), (.07, .62, .07), BONE_D); 
    k.box((0, .3, z0), (.62, .07, .07), BONE_D); k.box((0, -.3, z0), (.62, .07, .07), BONE_D)
for i in range(5):
    z0 = -L / 2 + (i + .5) * L / 5
    beam(k, (-.3, .3, z0 - L / 10), (.3, -.3, z0 + L / 10), .06, RUST)
    beam(k, (.3, .3, z0 - L / 10), (-.3, -.3, z0 + L / 10), .06, RUST)
k.box((0, 0, -L / 2), (.9, .9, .1), SLATE_L, bevel=.02); k.box((0, .5, -L / 2), (.3, .3, .3), HAZ, bevel=.02, wear=0)
k.box((.3, .3, 1.2), (.12, .12, .5), RUST)  # snapped stub

# hatch
k = D('hatch', 5)
k.cyl((0, 0, 0), 1.0, 1.0, .18, 'z', 16, BONE, bevel=.03)
k.cyl((0, 0, .1), .78, .78, .08, 'z', 16, BONE_D, bevel=.02)
k.cyl((0, 0, .17), .12, .12, .12, 'z', 10, SLATE)
for a in range(0, 360, 90): k.box((.36 * math.cos(math.radians(a)), .36 * math.sin(math.radians(a)), .2), (.55, .07, .07), SLATE_L, rot=(0, 0, a))
for a in range(0, 360, 30):
    r = math.radians(a); k.box((.9 * math.cos(r), .9 * math.sin(r), .1), (.1, .1, .08), SLATE, rot=(0, 0, a))
k.box((.95, 0, -.08), (.3, .5, .2), RUST, bevel=.03)
k.box((-.2, -.7, .13), (.7, .12, .04), HAZ, rot=(0, 0, 20), wear=0)

# engine bell
k = D('bell', 6)
k.cyl((0, 0, -.1), .35, .95, 1.4, 'z', 16, SLATE, bevel=.0)
for z in (-.5, -.1, .3): k.cyl((0, 0, z), .5 + (z + .8) * .32, .5 + (z + .8) * .32, .07, 'z', 16, SLATE_L, bevel=.01)
k.cyl((0, 0, .62), .98, .98, .1, 'z', 16, RUST, bevel=.02)
k.cyl((0, 0, .66), .8, .8, .06, 'z', 16, BLACK)
k.cyl((0, 0, -.9), .3, .3, .4, 'z', 10, BONE_D, bevel=.04)
k.box((.4, 0, -.7), (.3, .12, .5), SLATE_L); k.box((-.4, 0, -.7), (.3, .12, .5), SLATE_L)

# container
k = D('container', 7)
k.box((0, 0, 0), (.9, .9, 2.2), BONE_D, bevel=.04)
for i in range(11): k.box((.455, 0, -.95 + i * .19), (.05, .78, .1), BONE, bevel=.01); k.box((-.455, 0, -.95 + i * .19), (.05, .78, .1), BONE, bevel=.01)
for sx in (-1, 1):
    for sy in (-1, 1):
        for sz in (-1, 1): k.box((sx * .43, sy * .43, sz * 1.05), (.14, .14, .14), SLATE_L, bevel=.02)
k.box((0, 0, 1.12), (.82, .82, .04), RUST); k.box((0, 0, 1.15), (.05, .8, .04), SLATE_L)
k.box((.48, .2, .5), (.04, .5, .5), HAZ, wear=0)
k.box((-.2, .46, -.4), (.5, .04, .6), RUST)

# dish
k = D('dish', 8)
k.sphere((0, 0, 0), .95, (1, 1, .32), BONE, 16, 8, half=True)
k.cyl((0, 0, -.02), .95, .95, .05, 'z', 16, BONE_D, caps=True)
k.cyl((0, 0, .25), .06, .06, .5, 'z', 6, SLATE_L); k.box((0, 0, .52), (.14, .14, .08), SLATE)
for a in range(0, 360, 120): beam(k, (.8 * math.cos(math.radians(a)), .8 * math.sin(math.radians(a)), .05), (0, 0, .5), .03, SLATE_L)
k.cyl((0, 0, -.35), .12, .12, .6, 'z', 8, SLATE); k.box((0, 0, -.7), (.5, .5, .1), RUST, bevel=.02)
k.lamp((.9, 0, .06), (.08, .08, .08), RED)

# hull plate (jagged)
k = D('plate', 9)
pts = [(-1.1, -.7), (-.3, -.85), (.5, -.7), (1.2, -.2), (.9, .5), (.2, .8), (-.5, .55), (-1.2, .65)]
k.poly(pts, .14, (0, 0, 0), BONE, 'xy', bevel=.02)
for (a, b) in ((-.7, -.1), (.2, .25)): k.box((a, b, .08), (1.1, .07, .05), BONE_D) if False else None
for x in (-.6, 0, .6): k.box((x, 0, .1), (.07, 1.3, .08), BONE_D, bevel=.01)
k.box((0, .1, .1), (2.2, .07, .08), BONE_D, bevel=.01)
k.box((.4, -.2, .1), (.6, .5, .05), HAZ, wear=0)
k.poly([(-.6, .1), (-.3, .3), (-.1, .0), (-.4, -.2)], .06, (-.2, -.25, .13), BLACK, 'xy', wear=0)

# hull chunk: a torn lump of plating & rock
k = D('chunk', 10)
bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
rr = random.Random(5)
for v in bm.verts:
    n = 0.62 + rr.random() * .55
    v.co = Vector((v.co.x * 1.15, v.co.y * .85, v.co.z)) * n
mesh = bpy.data.meshes.new('ico'); bm.to_mesh(mesh); bm.free()
bk = bmesh.new(); bk.from_mesh(mesh)
before = set(k.bm.faces)
for f in bk.faces:
    vs = [k.bm.verts.new(v.co) for v in f.verts]
    nf = k.bm.faces.new(vs)
for f in k.bm.faces:
    if f in before: continue
    f.material_index = 0
    c = lin(RUST_D) if f.calc_center_median().z < 0 else lin(0x7a6c5c)
    j = .8 + rr.random() * .4
    for l in f.loops: l[k.col] = (c[0] * j, c[1] * j, c[2] * j, 1)
# plating shards sticking out
k.box((.5, .55, .5), (.9, .06, .7), BONE, rot=(25, 20, 10), bevel=.01); k.box((-.4, .2, .8), (.07, .9, .6), BONE_D, rot=(10, 0, 30))
k.box((.7, -.3, .4), (.5, .5, .06), HAZ, rot=(60, 20, 0), wear=0)
beam(k, (-.3, -.2, -.5), (-.9, -.9, -1.3), .08, SLATE_L)

# radius per type (bounding sphere about origin, then a bit tighter for gameplay)
meta = {}
for n, k in ks.items():
    r = max((v.co.length for v in k.bm.verts), default=1)
    meta[n] = round(r * .82, 3)
bake_ao(list(ks.values()), rays=20, dist=.9, strength=.9)
out = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'assets')
export_glb(list(ks.values()), os.path.join(out, 'debris.glb'))
json.dump({'radius': meta, 'order': list(ks)}, open(os.path.join(out, 'debris.json'), 'w'))
print(meta)
