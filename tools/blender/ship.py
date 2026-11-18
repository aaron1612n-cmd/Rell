"""Hero ship: salvage skiff. Nose -Z, up +Y, wings +-X. Run: python tools/blender/ship.py"""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(__file__))
from kit import *
from mathutils import Vector

k = Kit('ship', seed=7)
k.maxlen = 0.26

# ---- fuselage ------------------------------------------------------------------------
PROFILE = [(-2.25, .10, .08), (-1.95, .26, .19), (-1.3, .50, .38), (-0.4, .70, .50), (.6, .82, .55), (1.6, .78, .52), (1.88, .58, .42)]
def prof(z):
    for (z0, w0, h0), (z1, w1, h1) in zip(PROFILE, PROFILE[1:]):
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0); return w0 + (w1 - w0) * t, h0 + (h1 - h0) * t
    return PROFILE[-1][1:]
def octa(w, h, ch=0.55, yo=0):
    return [(w * ch, h + yo), (w, h * .5 + yo), (w, -h * .5 + yo), (w * ch, -h + yo), (-w * ch, -h + yo), (-w, -h * .5 + yo), (-w, h * .5 + yo), (-w * ch, h + yo)]
k.loft([(z, octa(w, h)) for z, w, h in PROFILE], BONE, bevel=0.025)

# nose cone cap & lower belly keel (rust) for colour break
k.loft([(-1.4, octa(.46, .06, .6, -.40)), (-0.2, octa(.62, .09, .6, -.50)), (1.5, octa(.6, .09, .6, -.50))], RUST, bevel=0.02)
# upper hull panels (bone variations) + spine ridge
k.box((0, .56, .55), (.5, .06, 2.0), BONE_L, bevel=0.02)
for z0, ln in ((-1.1, .5), (-.2, .5), (.9, .6)):
    k.box((.46, .53, z0 + .0), (.34, .05, ln), BONE_D, bevel=0.015); k.box((-.46, .53, z0), (.34, .05, ln), BONE_D, bevel=0.015)
# hazard chevron across the nose cheeks
for sx in (-1, 1):
    k.box((sx * .45, .0, -1.55), (.04, .30, .16), HAZ, rot=(0, 0, 0), wear=0)
    k.box((sx * .55, .1, -1.0), (.05, .16, .5), HAZ, wear=0)

# ---- canopy --------------------------------------------------------------------------
def canopy(sc, dz=0):
    zs = [(-1.5, .16, .10), (-1.0, .38, .30), (-.3, .46, .38), (.3, .42, .30), (.72, .30, .12)]
    out = []
    for z, cw, ch in zs:
        y0 = prof(z)[1] - .08
        out.append((z + dz, [(-cw * sc, y0), (-cw * .8 * sc, y0 + ch * .7 * sc), (-cw * .35 * sc, y0 + ch * sc), (cw * .35 * sc, y0 + ch * sc), (cw * .8 * sc, y0 + ch * .7 * sc), (cw * sc, y0)]))
    return out
# the canopy is its own object (glass, ribs, spine rail): it hinges open at runtime about its aft top edge
kc = Kit('canopy', seed=8); kc.maxlen = 0.26
kc.loft(canopy(1.0), SLATE_D, mat=GLASS, wear=0, bevel=0.012)
# frame ribs
for z in (-.62, 0.0):
    zi = {-.62: .5, 0.0: .25}[z]
    cw = 0.40 + zi * .1; y0 = prof(z)[1] - .08
    kc.loft([(z - .035, [(-cw * 1.02, y0 - .02), (-cw * .84, y0 + .27), (-cw * .36, y0 + .36), (cw * .36, y0 + .36), (cw * .84, y0 + .27), (cw * 1.02, y0 - .02)]),
            (z + .035, [(-cw * 1.02, y0 - .02), (-cw * .84, y0 + .27), (-cw * .36, y0 + .36), (cw * .36, y0 + .36), (cw * .84, y0 + .27), (cw * 1.02, y0 - .02)])], BONE_D, bevel=.01)
kc.box((0, .80, -.32), (.05, .08, 1.0), BONE_D, bevel=.01)  # centre rail (sunk into the canopy crown)
kc.box((0, prof(-1.45)[1] + .02, -1.45), (.1, .03, .05), HAZ, bevel=.008, wear=0)  # lift tab on the canopy nose
for sx in (-1, 1): kc.box((sx * .45, prof(-.1)[1] - .06, -.1), (.05, .06, .1), SLATE, bevel=.01)  # strut lugs on the frame sill
# headlamp
k.lamp((0, -.02, -2.2), (.12, .07, .05), WHITE)
k.lamp((.30, -.12, -1.88), (.06, .05, .05), AMBER); k.lamp((-.30, -.12, -1.88), (.06, .05, .05), AMBER)

# ---- dorsal clamp / cargo rack -------------------------------------------------------
k.box((0, .67, 1.0), (.62, .26, 1.0), BONE_D, bevel=.03)
k.box((0, .82, 1.0), (.36, .06, .8), RUST, bevel=.015)
for x in (-.22, .22): k.box((x, .70, 1.45), (.12, .34, .14), SLATE, bevel=.015)
k.stripes((0, .595, .35), (.34, .14), 6, 'y', thick=.012)  # lies on the spine panel
# mast + dish
k.cyl((.0, 1.18, 1.55), .02, .02, .78, 'y', 6, SLATE_L)
k.sphere((0, 1.55, 1.55), .12, (1, .5, 1), SLATE_L, 10, 6, half=True, rot=(-90, 0, 0))
k.cyl((.32, .72, .1), .02, .02, .5, 'y', 6, SLATE_L); k.lamp((.32, 1.0, .1), (.06, .06, .06), RED)

# ---- engine pods ---------------------------------------------------------------------
for sx in (-1, 1):
    x = sx * .66
    k.cyl((x, 0, .95), .38, .36, 1.5, 'z', 14, BONE_D, bevel=.025)
    k.cyl((x, 0, .45), .385, .385, .14, 'z', 14, RUST, bevel=.01)           # collar
    k.cyl((x, 0, 1.58), .39, .39, .22, 'z', 14, SLATE, bevel=.01)
    # engine bells, gimbals and plumbing are built at runtime (src/engine.js) so the metal can heat up with thrust
    k.box((x, .32, .8), (.12, .08, .9), RUST, bevel=.015)                   # pod crest
    # pod hazard sleeve: alternating cylinder rings
    for i in range(5):
        k.cyl((x, 0, .66 + i * .1), .392, .392, .1, 'z', 14, HAZ if i % 2 == 0 else BLACK, wear=0)
    k.box((sx * .38, 0, .6), (.4, .14, 1.0), BONE_D, bevel=.02)            # pylon blend to fuselage

FLAPS = []
# ---- wings ---------------------------------------------------------------------------
for sx in (-1, 1):
    pts = [(.5, -.4), (.5, 1.55), (2.35, 1.25), (2.35, .68)]   # root buried in the fuselage (hull is only .70 wide at z=-.4)
    if sx < 0: pts = [(-x, z) for x, z in reversed(pts)]
    k.poly([(x, z) for x, z in pts], .13, (0, -.12, 0), BONE, 'xz', bevel=.02)
    # leading-edge hazard strip & rust trailing flap
    lx = [(1.0, -.12), (2.25, .62), (2.35, .68), (.8, -.4)]
    k.box((sx * 1.52, -.12, .22), (1.95, .15, .1), HAZ, rot=(0, -sx * 24, 0), bevel=.015, wear=0)
    # trailing-edge vane: its own object so it can swing (pivot/axis in ship.json)
    kf = Kit('flap_' + ('l' if sx < 0 else 'r'), seed=9 + sx); kf.maxlen = .26; FLAPS.append(kf)
    kf.box((sx * 1.55, -.12, 1.4), (1.5, .1, .14), RUST, rot=(0, sx * 10, 0), bevel=.015)
    kf.box((sx * 1.55, -.12, 1.47), (1.3, .03, .03), HAZ, rot=(0, sx * 10, 0), wear=0)
    k.panels((sx * 1.55, -.052, .95), (1.4, .8), 3, 2, 'y', 1, gap=.05, lift=.02, color=BONE_L, bevel=.01)
    # tip RCS block + nav light
    k.box((sx * 2.3, -.09, .95), (.22, .28, .55), SLATE, bevel=.03)
    k.lamp((sx * 2.4, -.09, .68), (.05, .06, .06), RED if sx < 0 else GREEN)
    # under-wing pylon + tool pod
    k.box((sx * 1.4, -.26, .7), (.18, .2, .6), SLATE_L, bevel=.02)

# ---- tail ----------------------------------------------------------------------------
# plane 'yz': point (a, b) -> (y, z). Base sits 0.14 below the old one so it bites into the tapering aft hull (top y=.42 at z=1.88)
k.poly([(0, 0), (1.14, 0), (.99, .72), (.59, 1.05), (0, 1.05)], .09, (0, .38, .98), BONE, 'yz', bevel=.02)
k.box((0, 1.0, 1.9), (.1, .12, .3), HAZ, bevel=.02, wear=0)

# ---- salvage arms + sled -------------------------------------------------------------
for sx in (-1, 1):
    k.box((sx * .3, -.45, -1.1), (.2, .12, .3), SLATE, bevel=.015)           # shoulder bracket into the keel
    k.cyl((sx * .3, -.52, -1.1), .09, .09, .22, 'x', 10, SLATE)
    k.box((sx * .3, -.52, -1.55), (.1, .1, .85), SLATE_L, bevel=.02)
    k.cyl((sx * .3, -.52, -1.95), .08, .08, .14, 'x', 10, SLATE)
    k.box((sx * .3, -.52, -2.15), (.08, .08, .4), BONE_D, rot=(0, sx * -10, 0), bevel=.015)
    k.box((sx * .3, -.52, -2.4), (.12, .1, .14), HAZ, bevel=.02, wear=0)
k.box((0, -.60, .5), (.9, .18, 1.9), BONE_D, bevel=.035)
k.box((0, -.72, .6), (.55, .08, 1.2), RUST, bevel=.02)

# retro-fire cheek pods + RCS nozzle stubs data
NOZ = []
def nozzle(pos, d):
    d = Vector(d).normalized(); p = Vector(pos)
    rot = Vector((0, 0, 1)).rotation_difference(d).to_euler()
    k.cyl(tuple(p - d * .07), .05, .085, .15, 'z', 8, BLACK, rot=rot, wear=0)
    NOZ.append({'pos': [round(v, 3) for v in p], 'dir': [round(v, 3) for v in d]})
# nose cluster
for sx in (-1, 1):
    hw, hh = prof(-1.2)
    nozzle((sx * hw, 0, -1.2), (sx, 0, 0))
    k.box((sx * .42, -.22, -1.3), (.24, .2, .9), BONE_D, bevel=.03)
    nozzle((sx * .42, -.22, -1.75), (0, 0, -1))
hw, hh = prof(-1.3)
nozzle((0, hh, -1.3), (0, 1, 0)); nozzle((0, -hh - .12, -1.3), (0, -1, 0))
k.box((0, -hh - .06, -1.3), (.3, .1, .3), SLATE_L, bevel=.02)
# tail cluster
for sx in (-1, 1): nozzle((sx * 1.04, 0, 1.0), (sx, 0, 0))
nozzle((0, .8 + .03, 1.0), (0, 1, 0)); nozzle((0, -.83, 1.0), (0, -1, 0))
# wingtip roll jets
for sx in (-1, 1):
    nozzle((sx * 2.3, .05, .95), (0, 1, 0)); nozzle((sx * 2.3, -.23, .95), (0, -1, 0))

# hull greebles on fuselage flanks
for sx in (-1, 1):
    # u runs along y, v along z: keep y within the flat flank (+-.27) and embed the base so none hover on the taper
    k.greebles((sx * .69, 0, .02), (.55, .75), 4, 'x', sx, hmax=.1, smax=.2, smin=.1)   # forward of the pods; hull is >=.70 wide for z>-.4
k.greebles((0, .54, -.2), (.5, 1.0), 6, 'y', 1, hmax=.07, smax=.2, smin=.08)   # on the spine panel

meta = {'nozzles': NOZ, 'glow': [[-.66, 0, 2.38], [.66, 0, 2.38]],
        'nav': [[-2.4, -.09, .68, 0xff3b2a], [2.4, -.09, .68, 0x3bff7a], [0, .98, 1.97, 0xffffff]]}  # on the wingtip lamps / fin trailing edge
k.meta['x'] = 1
a = math.radians(10)
meta['flaps'] = [{'pivot': [round(sx * 1.55 - math.sin(sx * a) * .07, 3), -.12, round(1.4 - .07 * math.cos(a), 3)], 'axis': [round(math.cos(a), 4), 0, round(-math.sin(sx * a), 4)], 'side': sx} for sx in (-1, 1)]
bake_ao([k, kc] + FLAPS, rays=24, dist=.9, strength=.9)
out = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'assets')
export_glb([k, kc] + FLAPS, os.path.join(out, 'ship.glb'))
json.dump(meta, open(os.path.join(out, 'ship.json'), 'w'))
