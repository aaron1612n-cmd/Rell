"""Salvage props: things worth towing home. Each is one node; orange-tagged = valuable.
  canister: sealed cargo canister (~2.6 m), glowing hazard band
  crate:    small cargo crate (~3 m) with lashing points
  core:     reactor core in a cage (~4.4 m): the big prize, pulling it destabilises its wreck
Run: python tools/blender/salvage.py -> src/assets/salvage.glb, salvage.json (sphere colliders, local)
"""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(__file__))
from kit import *

ks = {}
def D(name, seed=1, maxlen=.3):
    k = Kit(name, seed); k.maxlen = maxlen; ks[name] = k; return k

meta = {}

k = D('canister', 3)
k.cyl((0, 0, 0), .62, .62, 1.9, 'z', 16, BONE, bevel=.04)
for z in (-1.0, 1.0): k.sphere((0, 0, z), .62, (1, 1, .45), BONE_D, 16, 8)
for z in (-.62, .62): k.cyl((0, 0, z), .66, .66, .16, 'z', 16, RUST, bevel=.02)
k.cyl((0, 0, 0), .645, .645, .3, 'z', 16, HAZ, mat=LAMP, wear=0)
for a in (0, 180):
    with k.at((0, 0, 0), (0, 0, a)):
        k.box((.72, 0, .0), (.1, .14, 1.3), SLATE_L)
        k.box((.66, 0, .62), (.14, .14, .14), SLATE_L); k.box((.66, 0, -.62), (.14, .14, .14), SLATE_L)
k.cyl((0, 0, 1.33), .16, .16, .2, 'z', 8, SLATE); k.cyl((0, 0, 1.45), .26, .26, .06, 'z', 8, HAZ, wear=0)
meta['canister'] = {'spheres': [[0, 0, -.7, .7], [0, 0, .7, .7]], 'mass': 1.6, 'value': 90}

k = D('crate', 5, maxlen=.35)
k.box((0, 0, 0), (2.0, 1.8, 3.0), BONE_D, bevel=.08)
for z in (-1.35, 0, 1.35): k.box((0, 0, z), (2.12, 1.92, .16), RUST, bevel=.03)
for sx in (-1, 1):
    for sy in (-1, 1): k.box((sx * .98, sy * .88, 0), (.18, .18, 3.08), SLATE_L, bevel=.02)
k.box((1.02, 0, .7), (.06, 1.2, 1.0), HAZ, wear=0)
k.box((0, .92, -.7), (1.4, .06, .8), HAZ, wear=0)
k.panels((0, .9, .6), (1.6, 1.0), 2, 1, 'y', 1, gap=.06, lift=.03, color=BONE, bevel=0)
k.lamp((-1.03, .5, 1.2), (.05, .2, .2), AMBER)
meta['crate'] = {'spheres': [[0, 0, -.8, 1.1], [0, 0, .8, 1.1]], 'mass': 4.0, 'value': 180}

k = D('core', 7, maxlen=.4)
k.sphere((0, 0, 0), 1.25, (1, 1, 1), HAZ, 18, 12, mat=LAMP, wear=0)           # hot glowing core
for a in range(0, 360, 30):   # cage ribs
    r = math.radians(a)
    with k.at((0, 0, 0), (0, 0, a)):
        k.cyl((0, 0, 0), 1.75, 1.75, .14, 'x', 20, BONE_D) if False else None
for i in range(6):
    with k.at((0, 0, 0), (0, i * 30, 0)):
        k.cyl((0, 0, 0), 1.72, 1.72, .14, 'z', 22, BONE_D, caps=False)
        k.cyl((0, 0, 0), 1.62, 1.62, .14, 'z', 22, RUST, caps=False)
for s in (-1, 1):
    k.cyl((0, s * 1.85, 0), 1.0, 1.0, .5, 'y', 14, SLATE_L, bevel=.06)
    k.cyl((0, s * 2.15, 0), .55, .55, .35, 'y', 10, SLATE, bevel=.04)
    k.stripes((0, s * 2.1, 0), (1, 1), 2, 'y') if False else None
    k.box((0, s * 2.0, .95), (.4, .3, .4), HAZ, wear=0)
meta['core'] = {'spheres': [[0, 0, 0, 1.95]], 'mass': 9.0, 'value': 900}

names = list(ks)
bake_ao([ks[n] for n in names], rays=14, dist=.8, strength=.7)
out = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'assets')
# each prop is one object; the lamp faces of the core use the lamp material slot
export_glb([ks[n] for n in names], os.path.join(out, 'salvage.glb'))
json.dump(meta, open(os.path.join(out, 'salvage.json'), 'w'))
