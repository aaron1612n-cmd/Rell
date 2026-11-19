"""The EVA suit: a hard-shell work suit in game coordinates (Y up, face -Z), metres.
Run: python tools/blender/astronaut.py  ->  src/assets/astronaut.glb + astronaut.json

Built as separate rigid parts, each modelled in its own joint frame (pivot at the origin), so the game
can pose them: torso (hard upper torso, soft brief, chest unit, life-support pack with the jetpack
pods, hoses, tether reel), helmet (shell with a visor opening, gold visor, lamps, camera), upper arm,
forearm, glove palm + finger/thumb segments, thigh, shin, boot and the multi-tool. Limbs are the
right side only; the game mirrors them for the left.

Soft parts are lathed / lofted with convolute (bellows) joints and carry UVs for the fabric bump.
Colour and ambient occlusion live in vertex colours. Joint offsets and markers go to astronaut.json.

Material slots (by name in the .glb): hard, lamp, visor, suit, metal, rubber, haz, glove.
"""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(__file__))
from kit import Kit, lin, R
import bpy, bmesh, random
from mathutils import Vector, Matrix, Euler
from mathutils.bvhtree import BVHTree

HARD, LAMP, VISOR, SUIT, METAL, RUBBER, HAZ_M, GLOVE = range(8)
MAT_NAMES = ['hard', 'lamp', 'visor', 'suit', 'metal', 'rubber', 'haz', 'glove']

# palette: bone-white suit (identity "bone", lifted), warm grey hard shell, slate hardware, one hazard accent
C_SUIT, C_SUIT_D = 0xd3cdbf, 0xbcb5a5
C_SHELL, C_SHELL_D = 0xd9d4c8, 0xaaa496
C_METAL, C_METAL_D = 0xa3a7ab, 0x6c7176
C_SLATE, C_SLATE_L = 0x2b3a44, 0x445560
C_RUB, C_BLACK = 0x242528, 0x141518
C_HAZ, C_AMBER = 0xff5a1f, 0xffb066
C_VISOR = 0xc89a48


class P(Kit):
    """A part: Kit's bmesh + colour layer, plus a UV layer and smooth surface builders."""
    def __init__(self, name, seed=1):
        super().__init__(name, seed)
        self.uv = self.bm.loops.layers.uv.new('UVMap')

    # rings: list of lists of Vector, same count; each ring goes around (θ ascending), rings in order along the part.
    def rings(self, rings, color, mat, cap0=False, cap1=False, closed=True, vs=None, wear=0.0):
        before = set(self.bm.faces)
        n = len(rings[0])
        V = [[self.bm.verts.new(p) for p in r] for r in rings]
        faces = []
        # v coordinate: cumulative length along the part
        vv = [0.0]
        for a, b in zip(rings, rings[1:]):
            ca = sum(a, Vector()) / n; cb = sum(b, Vector()) / n
            vv.append(vv[-1] + (cb - ca).length + 1e-4)
        if vs is not None: vv = vs
        m = n if closed else n - 1
        for i in range(len(V) - 1):
            for j in range(m):
                k = (j + 1) % n
                f = self.bm.faces.new((V[i][j], V[i + 1][j], V[i + 1][k], V[i][k]))
                for l, (uu, vy) in zip(f.loops, ((j, i), (j, i + 1), (j + 1, i + 1), (j + 1, i))):
                    l[self.uv].uv = (uu / n, vv[vy] * 6)
                faces.append(f)
        caps = []
        for flag, ring in ((cap0, V[0]), (cap1, V[-1])):
            if not flag: continue
            c = self.bm.verts.new(sum((v.co for v in ring), Vector()) / n)
            for j in range(n):
                k = (j + 1) % n
                # wound to match the side faces at the shared edge (they run k->j on the first ring, j->k on the last)
                f = self.bm.faces.new((c, ring[j], ring[k]) if ring is V[0] else (c, ring[k], ring[j]))
                caps.append(f)
        allf = faces + caps
        # orient outward: compare against the part's own centroid, majority vote
        self.bm.normal_update()
        cen = sum((v.co for r in V for v in r), Vector()) / (len(V) * n)
        score = sum((f.calc_center_median() - cen).dot(f.normal) for f in faces)
        if score < 0:
            bmesh.ops.reverse_faces(self.bm, faces=allf)
        self._finish(before, color, mat, wear)
        return allf

    def lathe(self, prof, color, mat, segs=28, M=None, sx=1.0, sz=1.0, cap0=False, cap1=False, ripple=None):
        """prof: [(y, r)] along local +Y. M: Matrix placing the part. sx/sz squash the section to an ellipse."""
        M = M or Matrix.Identity(4)
        rs = []
        for (y, r) in prof:
            ring = []
            for j in range(segs):
                t = 2 * math.pi * j / segs
                ring.append(M @ Vector((r * sx * math.cos(t), y, r * sz * math.sin(t))))
            rs.append(ring)
        return self.rings(rs, color, mat, cap0, cap1)

    def sloft(self, secs, color, mat, segs=32, M=None, cap0=False, cap1=False, axis='y'):
        """Superellipse loft. secs: [(t, cx, cz, a, b, n)]: section at height t along `axis`, centre (cx, cz), half sizes a (x) b (z), exponent n."""
        M = M or Matrix.Identity(4)
        rs = []
        for (t, cx, cz, a, b, n) in secs:
            ring = []
            for j in range(segs):
                th = 2 * math.pi * j / segs
                c, s = math.cos(th), math.sin(th)
                x = cx + a * math.copysign(abs(c) ** (2 / n), c)
                z = cz + b * math.copysign(abs(s) ** (2 / n), s)
                p = Vector((x, t, z)) if axis == 'y' else Vector((x, z, t))  # axis z: section in xy, t along z
                ring.append(M @ p)
            rs.append(ring)
        return self.rings(rs, color, mat, cap0, cap1)

    def sweep(self, pts, r, color, mat, segs=10, ripple=0.0, rip_n=0, cap=True, closed=False):
        """Tube through points (Catmull-Rom resampled), parallel-transported frames. ripple: corrugation depth."""
        P_ = [Vector(p) for p in pts]
        if closed: P_ = P_ + [P_[0]]; cap = False
        res = []
        N = max(12, len(P_) * 8) if not closed else len(P_) - 1
        L = len(P_)
        for i in range(N + 1):
            u = i / N * (L - 1); k = min(int(u), L - 2); t = u - k
            if closed:
                g = lambda m: P_[m % (L - 1)]
                p0, p1, p2, p3 = g(k - 1), g(k), g(k + 1), g(k + 2)
            else:
                p0, p1, p2, p3 = P_[max(k - 1, 0)], P_[k], P_[k + 1], P_[min(k + 2, L - 1)]
            t2, t3 = t * t, t * t * t
            res.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
        if closed: tang = [(res[(i + 1) % N] - res[(i - 1) % N]).normalized() for i in range(N + 1)]
        else: tang = [(res[min(i + 1, N)] - res[max(i - 1, 0)]).normalized() for i in range(N + 1)]
        up = Vector((0, 1, 0)) if abs(tang[0].y) < 0.9 else Vector((1, 0, 0))
        nrm = tang[0].cross(up).normalized()
        rs = []
        for i in range(N + 1):
            if i:
                nrm = (nrm - tang[i] * nrm.dot(tang[i])).normalized()
            bi = tang[i].cross(nrm)
            rr = r * (1 + ripple * math.sin(i / N * rip_n * math.pi * 2)) if rip_n else r
            rs.append([res[i] + (nrm * math.cos(2 * math.pi * j / segs) + bi * math.sin(2 * math.pi * j / segs)) * rr for j in range(segs)])
        return self.rings(rs, color, mat, cap, cap)

    def rbox(self, c, s, color, mat=HARD, rot=(0, 0, 0), bevel=0.006, seg=2):
        self.box(c, s, color=color, rot=rot, bevel=bevel, seg=seg, mat=mat, wear=0)

    def tube(self, c, r1, r2, h, axis, color, mat=METAL, segs=24, rot=(0, 0, 0), bevel=0.0, caps=True):
        self.cyl(c, r1, r2, h, axis=axis, segs=segs, color=color, rot=rot, bevel=bevel, mat=mat, wear=0, caps=caps)


def convolute(y0, y1, r, depth, n, ends=None):
    """Bellows profile from y0 to y1 (y0 > y1 going down a limb): n ripples of `depth` around radius r."""
    out = []
    steps = n * 6
    for i in range(steps + 1):
        t = i / steps
        y = y0 + (y1 - y0) * t
        out.append((y, r + depth * (0.5 - 0.5 * math.cos(t * n * 2 * math.pi))))
    return out


def ring_prof(y, r, h, t):
    """A bearing ring: a rounded band of height h, standing proud of r by t."""
    return [(y + h / 2, r - 0.002), (y + h / 2, r + t * 0.7), (y + h * 0.35, r + t), (y - h * 0.35, r + t), (y - h / 2, r + t * 0.7), (y - h / 2, r - 0.002)]


def rotM(x=0, y=0, z=0, t=(0, 0, 0)):
    return Matrix.Translation(Vector(t)) @ R(x, y, z).to_matrix().to_4x4()


J = {}   # joint offsets / markers -> json


# ---- torso ----------------------------------------------------------------------------------------
def build_torso():
    k = P('torso', 3)
    # hard upper torso: a rounded shell, broad at the shoulders, flatter on the chest
    k.sloft([
        (-0.16, 0, 0.0, 0.180, 0.135, 2.4),
        (-0.10, 0, -0.003, 0.205, 0.150, 2.6),
        (0.00, 0, -0.008, 0.228, 0.162, 2.8),
        (0.10, 0, -0.010, 0.244, 0.168, 3.0),
        (0.18, 0, -0.008, 0.246, 0.162, 3.0),
        (0.235, 0, -0.004, 0.225, 0.148, 2.8),
        (0.275, 0, 0.000, 0.180, 0.128, 2.4),
        (0.300, 0, 0.004, 0.130, 0.112, 2.0),
        (0.310, 0, 0.004, 0.118, 0.104, 2.0),
    ], C_SHELL, HARD, segs=40)
    # waist bearing + body seal closure (two metal rings)
    k.lathe(ring_prof(-0.165, 0.172, 0.022, 0.010), C_METAL, METAL, segs=36, sx=1.06, sz=0.8)
    k.lathe(ring_prof(-0.195, 0.168, 0.014, 0.006), C_SLATE, METAL, segs=36, sx=1.06, sz=0.8)
    # soft lower torso (brief) with waist bellows, then the seat that the legs plug into
    prof = [(-0.18, 0.168)] + convolute(-0.205, -0.30, 0.160, 0.012, 3) + [(-0.34, 0.168), (-0.40, 0.165), (-0.45, 0.145), (-0.49, 0.10), (-0.505, 0.04), (-0.508, 0.0)]
    k.lathe(prof, C_SUIT, SUIT, segs=36, sx=1.12, sz=0.82, cap1=False)
    # scye bearings where the arms plug in: tilted rings on the shoulders
    for sx in (1, -1):
        M = rotM(0, 0, sx * -68, (sx * 0.232, 0.17, -0.004))
        k.lathe(ring_prof(0.0, 0.082, 0.026, 0.010), C_METAL, METAL, segs=32, M=M)
        k.lathe(ring_prof(-0.016, 0.080, 0.010, 0.006), C_SLATE, METAL, segs=32, M=M)
    # neck ring (helmet seats here)
    k.lathe(ring_prof(0.315, 0.118, 0.026, 0.012), C_METAL, METAL, segs=36, sz=0.92)
    k.lathe([(0.33, 0.114), (0.33, 0.124), (0.318, 0.126), (0.318, 0.114)], C_HAZ, HAZ_M, segs=36, sz=0.92)
    # chest unit (DCM): a slanted box with controls, a status lamp and a purge knob
    with k.at((0, 0.005, -0.186), (-18, 0, 0)):
        k.rbox((0, 0, -0.02), (0.22, 0.115, 0.07), C_SLATE, HARD, bevel=0.012, seg=3)
        k.rbox((0, 0.03, -0.058), (0.13, 0.036, 0.006), C_BLACK, HARD, bevel=0.002)      # display window
        k.box((0.035, 0.03, -0.062), (0.05, 0.016, 0.003), color=C_AMBER, mat=LAMP, wear=0)
        for i, x in enumerate((-0.075, -0.025, 0.025, 0.075)):
            k.tube((x, -0.03, -0.058), 0.011, 0.011, 0.012, 'z', C_HAZ if i == 3 else C_METAL_D, METAL if i < 3 else HAZ_M, segs=14, bevel=0.002)
        k.tube((-0.122, 0.0, -0.025), 0.016, 0.016, 0.03, 'x', C_HAZ, HAZ_M, segs=16, bevel=0.003)   # purge valve
        k.tube((0.122, 0.0, -0.025), 0.014, 0.014, 0.024, 'x', C_METAL_D, METAL, segs=16, bevel=0.003)
    # hard-shell detail: chest plate seams, a name patch, mission patch, shoulder flag
    k.rbox((0.0, 0.215, -0.15), (0.2, 0.012, 0.03), C_SHELL_D, HARD, rot=(-35, 0, 0), bevel=0.004)
    k.rbox((-0.13, 0.11, -0.163), (0.07, 0.028, 0.006), C_SLATE, HARD, rot=(0, 18, 0), bevel=0.002)      # name tag
    k.rbox((-0.13, 0.111, -0.167), (0.05, 0.004, 0.002), C_SHELL, HARD, rot=(0, 18, 0), bevel=0.0)
    k.tube((0.135, 0.12, -0.162), 0.024, 0.024, 0.006, 'z', C_SLATE, HARD, segs=24, rot=(0, -18, 0))   # mission patch
    k.tube((0.135, 0.12, -0.166), 0.017, 0.017, 0.004, 'z', C_HAZ, HAZ_M, segs=24, rot=(0, -18, 0))
    k.tube((0.135, 0.12, -0.168), 0.010, 0.010, 0.004, 'z', C_SLATE_L, HARD, segs=18, rot=(0, -18, 0))
    # side straps from the pack to the front
    for sx in (1, -1):
        k.sweep([(sx * 0.2, 0.25, 0.12), (sx * 0.17, 0.27, -0.02), (sx * 0.13, 0.2, -0.15), (sx * 0.1, 0.08, -0.172)], 0.011, C_SLATE, RUBBER, segs=8)
    # waist hoses from the pack to the chest unit, corrugated
    k.sweep([(-0.22, -0.02, 0.2), (-0.255, -0.06, 0.08), (-0.235, -0.07, -0.06), (-0.16, -0.05, -0.17), (-0.11, -0.02, -0.215)], 0.014, C_SHELL_D, SUIT, segs=10, ripple=0.12, rip_n=22)
    k.sweep([(0.22, -0.02, 0.2), (0.255, -0.08, 0.08), (0.235, -0.09, -0.06), (0.17, -0.06, -0.17), (0.11, -0.03, -0.215)], 0.012, C_SLATE_L, SUIT, segs=10, ripple=0.12, rip_n=20)

    # life support pack + jetpack (back, +Z)
    pz = 0.265
    k.sloft([
        (-0.34, 0, pz, 0.20, 0.085, 3.6), (-0.33, 0, pz, 0.205, 0.092, 4.2), (-0.2, 0, pz, 0.222, 0.102, 4.4), (0.0, 0, pz, 0.236, 0.108, 4.4), (0.2, 0, pz, 0.246, 0.11, 4.6),
        (0.30, 0, pz, 0.25, 0.108, 4.6), (0.36, 0, pz - 0.005, 0.238, 0.102, 4.2), (0.385, 0, pz - 0.01, 0.2, 0.085, 3.2), (0.392, 0, pz - 0.012, 0.15, 0.06, 2.4)], C_SHELL, HARD, segs=48, cap0=True, cap1=True)
    # back cover: a domed upper hatch and a lower radiator bay, each a low convex loft with a bevelled edge
    k.sloft([(0.0, 0, pz + 0.1, 0.17, 0.004, 4.0), (0.012, 0, pz + 0.108, 0.18, 0.012, 4.5), (0.14, 0, pz + 0.111, 0.182, 0.014, 4.5), (0.27, 0, pz + 0.108, 0.17, 0.011, 4.5), (0.285, 0, pz + 0.1, 0.15, 0.004, 4.0)], C_SHELL_D, HARD, segs=36, cap0=True, cap1=True)
    k.sloft([(-0.3, 0, pz + 0.098, 0.15, 0.004, 4.0), (-0.288, 0, pz + 0.104, 0.165, 0.01, 4.5), (-0.07, 0, pz + 0.108, 0.17, 0.012, 4.5), (-0.056, 0, pz + 0.1, 0.15, 0.004, 4.0)], C_SLATE_L, HARD, segs=36, cap0=True, cap1=True)
    # upper hatch: status window, charge bar, knobs, indicator lights, bolts, hazard tag
    zf = pz + 0.126
    k.rbox((0, 0.205, zf), (0.15, 0.06, 0.006), C_BLACK, HARD, bevel=0.003, seg=2)
    k.rbox((0, 0.205, zf + 0.0035), (0.13, 0.04, 0.002), 0x1a2f34, VISOR, bevel=0.001)
    for i in range(7):
        k.box((-0.054 + i * 0.018, 0.205, zf + 0.0052), (0.012, 0.012 + 0.003 * i, 0.002), color=C_AMBER if i < 5 else C_HAZ, mat=LAMP, wear=0)
    for i, x in enumerate((-0.09, -0.045, 0.0)):
        k.tube((x, 0.13, zf), 0.015, 0.015, 0.012, 'z', C_METAL if i != 2 else C_HAZ, METAL if i != 2 else HAZ_M, segs=18, rot=(90, 0, 0), bevel=0.002)
    for i, c in enumerate((C_AMBER, 0x8ef0c8, C_HAZ)):
        k.box((0.06 + i * 0.026, 0.13, zf), (0.014, 0.014, 0.004), color=c, mat=LAMP, wear=0)
    k.rbox((0.09, 0.07, zf), (0.1, 0.03, 0.005), C_HAZ, HAZ_M, bevel=0.002)
    for sx in (-1, 1):
        for y in (0.03, 0.26):
            k.tube((sx * 0.15, y, zf - 0.002), 0.006, 0.006, 0.005, 'z', C_METAL, METAL, segs=8, rot=(90, 0, 0))
        k.rbox((sx * 0.172, 0.14, zf - 0.004), (0.008, 0.2, 0.008), C_SHELL, HARD, bevel=0.003)   # edge rail
    # lower bay: radiator louvres, a service port, a heat plate
    for i in range(8):
        k.rbox((0, -0.285 + i * 0.0185, pz + 0.118), (0.2, 0.007, 0.008), C_BLACK, HARD, bevel=0.002)
    k.tube((-0.11, -0.12, pz + 0.122), 0.014, 0.014, 0.008, 'z', C_METAL_D, METAL, segs=14, rot=(90, 0, 0))
    k.tube((-0.11, -0.12, pz + 0.127), 0.009, 0.009, 0.004, 'z', C_BLACK, HARD, segs=12, rot=(90, 0, 0))
    k.rbox((0.0, 0.31, pz + 0.106), (0.47, 0.03, 0.012), C_HAZ, HAZ_M, bevel=0.004)
    k.rbox((0, 0.31, pz - 0.106), (0.47, 0.03, 0.012), C_HAZ, HAZ_M, bevel=0.004)
    # top: the tether/comm hump and an antenna
    k.rbox((0.08, 0.40, pz + 0.02), (0.12, 0.04, 0.12), C_SLATE, HARD, bevel=0.012, seg=3)
    k.tube((0.12, 0.52, pz + 0.04), 0.004, 0.003, 0.22, 'y', C_METAL_D, METAL, segs=6)
    J['antenna'] = [0.12, 0.63, pz + 0.04]
    k.tube((-0.1, 0.405, pz + 0.0), 0.022, 0.022, 0.05, 'y', C_METAL, METAL, segs=16, bevel=0.003)
    # handholds on the shoulders of the pack
    for sx in (1, -1):
        k.sweep([(sx * 0.2, 0.36, pz - 0.06), (sx * 0.22, 0.42, pz + 0.0), (sx * 0.2, 0.36, pz + 0.07)], 0.009, C_HAZ, HAZ_M, segs=8)
    # jetpack: a propellant tank down each side of the pack, capped top and bottom by a thruster head. Each
    # head carries four nozzles (out, back, forward, and up or down), so the pack can push along every
    # axis and the jets that fire are always the ones pointing away from where you're going.
    jets = []
    def nozzle(c, d):
        d = Vector(d); c = Vector(c)
        M = Matrix.Translation(c) @ Vector((0, 1, 0)).rotation_difference(d).to_matrix().to_4x4()
        # boss, then a flared bell with a lip and a dark throat
        k.lathe([(0.0, 0.0), (0.0, 0.0125), (0.004, 0.0125), (0.004, 0.0085)], C_METAL_D, METAL, segs=18, M=M, cap0=True)
        k.lathe([(0.003, 0.0045), (0.009, 0.0062), (0.016, 0.0095), (0.0215, 0.0125), (0.0225, 0.0128), (0.0225, 0.0112), (0.016, 0.0078), (0.009, 0.0048), (0.006, 0.0)], C_METAL, METAL, segs=18, M=M)
        jets.append({'p': [round(v, 4) for v in (c + d * 0.023)], 'd': [round(v, 4) for v in d]})
    for sx in (1, -1):
        x, z = sx * 0.285, pz + 0.01
        T = rotM(t=(x, -0.025, z))
        # tank: a capsule-ish lathe with weld rings and a hazard band
        k.lathe([(0.2, 0.0), (0.2, 0.03), (0.19, 0.046), (0.17, 0.054), (-0.17, 0.054), (-0.19, 0.046), (-0.2, 0.03), (-0.2, 0.0)], C_SLATE_L, HARD, segs=28, M=T, cap0=True, cap1=True)
        for y in (0.12, -0.12):
            k.lathe(ring_prof(y, 0.054, 0.012, 0.004), C_METAL, METAL, segs=28, M=T)
        k.lathe(ring_prof(0.0, 0.054, 0.03, 0.003), C_HAZ, HAZ_M, segs=28, M=T)
        # mounting yokes back to the pack
        k.rbox((sx * 0.245, 0.06, z), (0.05, 0.05, 0.07), C_SLATE, HARD, bevel=0.008)
        k.rbox((sx * 0.245, -0.11, z), (0.05, 0.05, 0.07), C_SLATE, HARD, bevel=0.008)
        # thruster heads
        for hy, vy in ((0.215, 1), (-0.265, -1)):
            hc = (x + sx * 0.012, hy, z)
            k.sloft([(hy - 0.04, x + sx * 0.012, z, 0.036, 0.04, 3.0), (hy - 0.036, x + sx * 0.012, z, 0.042, 0.046, 4.5), (hy + 0.036, x + sx * 0.012, z, 0.042, 0.046, 4.5),
                     (hy + 0.04, x + sx * 0.012, z, 0.036, 0.04, 3.0)], C_SLATE, HARD, segs=32, cap0=True, cap1=True)
            # neck from the tank into the head
            k.lathe([(0.0, 0.026), (-0.02, 0.026)] if vy > 0 else [(0.02, 0.026), (0.0, 0.026)], C_METAL_D, METAL, segs=20, M=rotM(t=(x, hy - vy * 0.04, z)))
            k.rbox((hc[0], hy, z + 0.047), (0.03, 0.03, 0.004), C_HAZ, HAZ_M, bevel=0.0015)            # hazard tag on the back face
            nozzle((hc[0] + sx * 0.042, hy, z), (sx, 0, 0))
            nozzle((hc[0], hy, z + 0.046), (0, 0, 1))
            nozzle((hc[0], hy, z - 0.046), (0, 0, -1))
            nozzle((hc[0], hy + vy * 0.04, z), (0, vy, 0))
    J['jets'] = jets
    k.rbox((0, -0.345, pz + 0.01), (0.42, 0.03, 0.08), C_SLATE, HARD, bevel=0.01, seg=2)
    # tether reel on the left hip, hazard drum
    k.lathe([(-0.03, 0.0), (-0.03, 0.055), (-0.026, 0.06), (0.026, 0.06), (0.03, 0.055), (0.03, 0.0)], C_SLATE, HARD, segs=28, M=rotM(0, 0, 90, (-0.25, -0.24, -0.01)))
    k.lathe([(-0.018, 0.0), (-0.018, 0.035), (0.018, 0.035), (0.018, 0.0)], C_HAZ, HAZ_M, segs=24, M=rotM(0, 0, 90, (-0.283, -0.24, -0.01)))
    k.rbox((-0.24, -0.2, -0.01), (0.04, 0.05, 0.06), C_SLATE, HARD, bevel=0.006)
    J['hook'] = [-0.305, -0.24, -0.01]
    # a tool caddy on the right hip
    k.rbox((0.25, -0.24, -0.03), (0.05, 0.11, 0.09), C_SLATE_L, HARD, bevel=0.01, seg=2)
    k.rbox((0.276, -0.22, -0.03), (0.006, 0.03, 0.05), C_HAZ, HAZ_M, bevel=0.002)
    J['shoulder'] = [0.262, 0.172, -0.004]
    J['hip'] = [0.105, -0.43, 0.0]
    J['neck'] = [0.0, 0.31, 0.004]
    return k


# visor opening: a superellipse in (yaw, pitch) degrees around the face. Shared with the first-person
# visor shader in src/eva.js (OPEN_* there), so the helmet edge you see from inside is this edge.
OPEN_W, OPEN_H, OPEN_C, OPEN_N = 72.0, 39.0, -7.0, 4.0


def ang(d):
    return math.degrees(math.atan2(d.x, -d.z)), math.degrees(math.asin(max(-1, min(1, d.y))))


def from_ang(yaw, pit):
    y, p = math.radians(yaw), math.radians(pit)
    return Vector((math.cos(p) * math.sin(y), math.sin(p), -math.cos(p) * math.cos(y)))


def opening(d):
    yaw, pit = ang(d)
    if abs(yaw) > 120: return 9.0
    return (abs(yaw / OPEN_W) ** OPEN_N + abs((pit - OPEN_C) / OPEN_H) ** OPEN_N) ** (1 / OPEN_N)


# ---- helmet ---------------------------------------------------------------------------------------
def build_helmet():
    k = P('helmet', 5)
    C = Vector((0, 0.112, -0.016))   # bubble centre relative to the neck
    J['eye'] = [0, J['neck'][1] + 0.112, J['neck'][2] - 0.016]
    r_out = 0.188
    # shell: a lat/long sphere with the visor opening and neck removed, then given thickness
    nu, nv = 96, 52
    bm = k.bm
    before = set(bm.faces)
    grid = []
    for i in range(nv + 1):
        ph = math.pi * i / nv - math.pi / 2       # -90..90
        row = []
        for j in range(nu):
            th = 2 * math.pi * j / nu
            d = Vector((math.cos(ph) * math.sin(th), math.sin(ph), -math.cos(ph) * math.cos(th)))
            row.append(d)
        grid.append(row)
    verts = {}
    def V(i, j):
        key = (i, j % nu)
        if key not in verts: verts[key] = bm.verts.new(C + grid[i][j % nu] * r_out)
        return verts[key]
    faces = []
    for i in range(nv):
        for j in range(nu):
            d = (grid[i][j] + grid[i + 1][j] + grid[i][(j + 1) % nu] + grid[i + 1][(j + 1) % nu]).normalized()
            if d.y < -0.6 or opening(d) < 1: continue
            faces.append(bm.faces.new((V(i, j), V(i, j + 1), V(i + 1, j + 1), V(i + 1, j))))
    # snap the stair-stepped edge of the opening onto the smooth contour
    for v in {v for f in faces for v in f.verts}:
        if not any(e.is_boundary for e in v.link_edges): continue
        d = (v.co - C).normalized()
        if d.y < -0.55: continue
        yaw, pit = ang(d)
        f = opening(d)
        if f < 1.25: v.co = C + from_ang(yaw / f, OPEN_C + (pit - OPEN_C) / f) * r_out
    bm.normal_update()
    if sum((f.calc_center_median() - C).dot(f.normal) for f in faces) < 0: bmesh.ops.reverse_faces(bm, faces=faces)
    res = bmesh.ops.solidify(bm, geom=faces, thickness=0.011)
    k._finish(before, C_SHELL, HARD, 0)
    # rolled lip around the opening
    lip = [C + from_ang(OPEN_W * math.copysign(abs(math.cos(t)) ** 0.5, math.cos(t)), OPEN_C + OPEN_H * math.copysign(abs(math.sin(t)) ** 0.5, math.sin(t))) * (r_out - 0.004) for t in [2 * math.pi * i / 120 for i in range(120)]]
    k.sweep(lip, 0.0085, C_SHELL_D, HARD, segs=10, closed=True)
    # gold visor: a sphere cap just inside the shell, covering the opening with margin
    before = set(bm.faces)
    vf, vv = [], {}
    rv = r_out - 0.006
    def W(i, j):
        key = (i, j % nu)
        if key not in vv: vv[key] = bm.verts.new(C + grid[i][j % nu] * rv)
        return vv[key]
    for i in range(nv):
        for j in range(nu):
            d = (grid[i][j] + grid[i + 1][j] + grid[i][(j + 1) % nu] + grid[i + 1][(j + 1) % nu]).normalized()
            if d.y < -0.6: continue
            dd = d.copy()
            if opening(dd) < 1.12:
                vf.append(bm.faces.new((W(i, j), W(i, j + 1), W(i + 1, j + 1), W(i + 1, j))))
    bm.normal_update()
    if sum((f.calc_center_median() - C).dot(f.normal) for f in vf) < 0: bmesh.ops.reverse_faces(bm, faces=vf)
    k._finish(before, C_VISOR, VISOR, 0)
    # neck: the helmet's own ring onto the suit's neck ring
    k.lathe(ring_prof(0.012, 0.128, 0.03, 0.012), C_METAL, METAL, segs=40, sz=0.92)
    k.lathe([(0.03, 0.12), (0.03, 0.146), (0.045, 0.15), (0.06, 0.14)], C_SHELL_D, HARD, segs=40, sz=0.95)
    # side visor pivots, lamps, a camera
    for sx in (1, -1):
        k.tube((sx * 0.188, 0.112, -0.016), 0.03, 0.026, 0.016, 'x', C_SLATE, HARD, segs=20, bevel=0.003)
        k.tube((sx * 0.197, 0.112, -0.016), 0.012, 0.012, 0.008, 'x', C_METAL, METAL, segs=14)
        # lamp pod high on each side, lens forward
        with k.at((sx * 0.15, 0.225, -0.035), (8, 0, sx * -28)):
            k.rbox((0, 0, 0), (0.05, 0.045, 0.1), C_SLATE, HARD, bevel=0.01, seg=2)
            k.tube((0, 0, -0.049), 0.019, 0.019, 0.006, 'z', C_BLACK, METAL, segs=18)
            k.tube((0, 0, -0.052), 0.014, 0.014, 0.004, 'z', 0x8a8478, LAMP, segs=16)
            k.rbox((0, 0.026, -0.01), (0.03, 0.008, 0.06), C_HAZ, HAZ_M, bevel=0.002)
    with k.at((-0.17, 0.2, 0.02), (0, 0, 28)):
        k.rbox((0, 0, 0), (0.036, 0.04, 0.07), C_BLACK, HARD, bevel=0.006)
        k.tube((0, 0, -0.036), 0.011, 0.011, 0.006, 'z', C_SLATE_L, METAL, segs=14)
    J['lamp'] = [0, 0.225, -0.09]
    return k


# ---- limbs ----------------------------------------------------------------------------------------
UA, FA = 0.29, 0.26      # upper arm (shoulder->elbow), forearm (elbow->wrist)


def G(v, s):
    return math.exp(-(v / s) ** 2)


def sstep(a, b, v):
    t = min(1.0, max(0.0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)


def keyed(keys, y):
    """Catmull-Rom through rows (y, v1, v2, ...) sorted by descending y; returns the interpolated values."""
    if y >= keys[0][0]: return list(keys[0][1:])
    if y <= keys[-1][0]: return list(keys[-1][1:])
    i = 0
    while keys[i + 1][0] > y: i += 1
    a, b = keys[i], keys[i + 1]
    p0, p3 = keys[max(i - 1, 0)], keys[min(i + 2, len(keys) - 1)]
    t = (a[0] - y) / (a[0] - b[0])
    t2, t3 = t * t, t * t * t
    out = []
    for j in range(1, len(a)):
        m1 = (b[j] - p0[j]) / 2; m2 = (p3[j] - a[j]) / 2
        out.append((2 * t3 - 3 * t2 + 1) * a[j] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * b[j] + (t3 - t2) * m2)
    return out


def floft(k, ts, fn, segs, color, mat, cap0=False, cap1=False):
    """A loft of free-form rings: fn(t, theta) -> Vector. One continuous skin, no stacked primitives."""
    return k.rings([[fn(t, 2 * math.pi * j / segs) for j in range(segs)] for t in ts], color, mat, cap0, cap1)


def paint(k, faces, fn):
    """Recolour faces: fn(centre) -> None or (hex, material)."""
    for f in faces:
        if not f.is_valid: continue
        r = fn(f.calc_center_median())
        if not r: continue
        f.material_index = r[1]
        for l in f.loops: l[k.col] = (*lin(r[0]), 1.0)


def angd(a, b):
    return (a - b + math.pi) % (2 * math.pi) - math.pi


# Sleeve cross-sections (shoulder frame, down -Y). +X lateral, +Z the elbow point, -Z the crook of the arm.
# rows: y, half width x, front (-Z) half depth, back (+Z) half depth, centre x, centre z
SLEEVE = [
    (0.000, 0.088, 0.080, 0.083, 0.004, 0.002),
    (-0.040, 0.080, 0.077, 0.079, 0.002, 0.000),
    (-0.085, 0.070, 0.075, 0.072, 0.000, -0.002),
    (-0.140, 0.066, 0.075, 0.068, 0.000, -0.003),
    (-0.200, 0.063, 0.070, 0.065, 0.000, -0.002),
    (-0.255, 0.060, 0.066, 0.066, 0.000, 0.000),
    (-0.290, 0.059, 0.063, 0.070, 0.000, 0.002),
    (-0.325, 0.061, 0.061, 0.064, 0.000, 0.000),
    (-0.370, 0.062, 0.059, 0.058, 0.000, -0.001),
    (-0.425, 0.057, 0.053, 0.053, 0.000, 0.000),
    (-0.470, 0.052, 0.047, 0.047, 0.000, 0.000),
    (-0.492, 0.050, 0.045, 0.045, 0.000, 0.000),
]
PAD_Y = -UA


def sleeve_disp(y, th):
    """Fabric: bunched folds in the crook of the elbow, a quilted elbow pad, armpit drape, a wavy bunch above the
    wrist ring, long soft drapes and a stitched seam down the inside. Displacement along the section normal."""
    c, s = math.cos(th), math.sin(th)
    front, med = max(0.0, -s), max(0.0, -c)
    d = 0.0
    # crook: crescent folds, deepest in front, curling up toward the sides
    for yk, amp, tilt, curv in ((-0.236, 0.0026, 0.4, 0.010), (-0.257, 0.0042, -0.3, 0.014), (-0.279, 0.0052, 0.35, 0.017),
                                (-0.301, 0.0046, -0.25, 0.014), (-0.322, 0.0032, 0.2, 0.010), (-0.342, 0.0018, -0.1, 0.006)):
        yc = yk + tilt * 0.018 * c + curv * (1 - front) + 0.006 * math.sin(2 * th + yk * 50)
        w = 0.3 + 0.7 * front ** 1.4
        d += 1.35 * amp * w * (G(y - yc, 0.0052) - 0.4 * G(y - yc + 0.0105, 0.0035))
    # elbow pad: a raised quilted patch over the point of the elbow, stitched round its edge
    r = math.hypot((y - PAD_Y) / 0.046, angd(th, math.pi / 2) / 0.9)
    d += 0.0042 * (1 - sstep(0.78, 1.0, r)) - 0.001 * G(r - 0.86, 0.045)
    d -= 0.0007 * G(r - 0.45, 0.04)                       # inner quilting ring
    # armpit: diagonal folds on the inner side
    for yk, amp, tilt in ((-0.03, 0.0038, 0.55), (-0.062, 0.0034, 0.45), (-0.094, 0.0024, 0.35)):
        d += amp * med ** 1.5 * G(y - (yk + tilt * 0.05 * s), 0.0068)
    # long drapes: a couple of slack helical folds on the upper arm and forearm
    d += 0.0016 * max(0.0, math.sin(2 * th + y * 55)) ** 3 * sstep(-0.24, -0.2, y) * sstep(-0.1, -0.13, y)
    d += 0.0019 * max(0.0, math.sin(th - y * 32 + 1.0)) ** 4 * sstep(-0.48, -0.45, y) * sstep(-0.35, -0.38, y)
    # bunched over the wrist ring, wavy rather than a clean ring
    for yk, amp in ((-0.462, 0.0022), (-0.477, 0.003)):
        d += amp * G(y - (yk + 0.0045 * math.sin(3 * th + yk * 90)), 0.0045)
    # hazard patch sewn on the outside of the upper arm
    d += 0.0012 * (1 - sstep(0.85, 1.0, max(abs(y + 0.1) / 0.024, abs(angd(th, 0.0)) / 0.42)))
    # stitched seam along the inside
    d -= 0.0008 * G(angd(th, math.pi), 0.035)
    # slack in the cloth
    d += 0.0006 * math.sin(th * 3 + y * 23) * math.sin(y * 61 + th)
    return d


def sleeve_pt(y, th, dome=1.0):
    ax, bf, bb, cx, cz = keyed(SLEEVE, y)
    c, s = math.cos(th), math.sin(th)
    n = 2.25
    ax *= dome; bf *= dome; bb *= dome
    x = cx + ax * sgp(c, 2 / n); z = cz + (bb if s > 0 else bf) * sgp(s, 2 / n)
    nx, nz = x - cx, z - cz; l = math.hypot(nx, nz) or 1
    d = sleeve_disp(y, th) * dome
    return Vector((x + nx / l * d, y, z + nz / l * d))


def build_sleeve():
    """The whole arm, shoulder to wrist, as ONE soft skin (the game skins it to the shoulder, elbow and wrist), then
    the wrist disconnect ring and the glove's gauntlet. Built in the shoulder frame, the arm hanging down -Y."""
    k = P('sleeve', 7)
    ts = [(0.072 * math.sin(a), math.cos(a)) for a in [math.pi / 2 * (1 - i / 9) for i in range(10)]]   # shoulder cap
    ys = [y for y, _ in ts] + [-0.004 * i for i in range(1, 125)] + [-0.4985]
    domes = [d for _, d in ts] + [1.0] * 124 + [0.88]
    rows = list(zip(ys, domes))
    fs = k.rings([[sleeve_pt(y, 2 * math.pi * j / 56, dm) if y <= 0 else
                   Vector((sleeve_pt(0, 2 * math.pi * j / 56, dm).x, y, sleeve_pt(0, 2 * math.pi * j / 56, dm).z)) for j in range(56)] for y, dm in rows],
                 C_SUIT, SUIT, cap0=True, cap1=True)

    def col(p):
        th = math.atan2(p.z, p.x)
        if math.hypot((p.y - PAD_Y) / 0.046, angd(th, math.pi / 2) / 0.9) < 0.84: return (0xb9b2a1, SUIT)
        if abs(p.y + 0.1) < 0.021 and abs(angd(th, 0.0)) < 0.37: return (C_HAZ, HAZ_M)
        if abs(angd(th, math.pi)) < 0.05: return (C_SUIT_D, SUIT)
        return None
    paint(k, fs, col)
    # wrist disconnect: a machined oval ring with a chamfered lip, three lock lugs and the latch
    W = -UA - FA
    rp = [(W + 0.066, 0.043), (W + 0.066, 0.050), (W + 0.063, 0.0545), (W + 0.054, 0.0555), (W + 0.051, 0.0535), (W + 0.049, 0.0535),
          (W + 0.047, 0.0552), (W + 0.04, 0.0548), (W + 0.037, 0.051), (W + 0.037, 0.043)]
    k.lathe(rp, C_METAL, METAL, segs=48, sx=1.06, sz=0.93)
    for a in (30, 150, 270):
        t = math.radians(a)
        k.rbox((0.0585 * math.cos(t), W + 0.0515, 0.0545 * math.sin(t)), (0.008, 0.009, 0.012), C_METAL_D, METAL, rot=(0, -a, 0), bevel=0.0018)
    k.rbox((0.0, W + 0.052, 0.058), (0.016, 0.012, 0.007), C_HAZ, HAZ_M, bevel=0.002)
    # gauntlet: the glove's soft cuff, flared and oval, slight creases, a rolled hem; strap with a buckle
    def gpt(y, th):
        t = (W + 0.04 - y) / 0.04
        a, b = 0.0495 + 0.004 * t * t, 0.0455 + 0.0035 * t * t
        c, s = math.cos(th), math.sin(th)
        r = 1 + 0.03 * G(y - (W + 0.004), 0.0025) + 0.012 * math.sin(5 * th + 0.7) * t * (1 - t) * 3
        return Vector((a * r * sgp(c, 2 / 2.3), y, b * r * sgp(s, 2 / 2.3)))
    gy = [W + 0.04 - 0.004 * i for i in range(11)]
    # one closed skin: down the outside, round the rolled hem and back up the inside as a liner (no open edge)
    gl = [(y, 1.0) for y in gy] + [(W - 0.0015, 0.985), (W - 0.002, 0.95), (W - 0.001, 0.915), (W + 0.002, 0.9), (W + 0.007, 0.892)]
    k.rings([[(lambda p: Vector((p.x * f, p.y, p.z * f)))(gpt(y if f == 1.0 else W, 2 * math.pi * j / 48)) + Vector((0, (y - W) if f != 1.0 else 0, 0)) for j in range(48)] for y, f in gl], C_SUIT_D, GLOVE)
    k.rings([[Vector((p.x * 1.035, p.y, p.z * 1.04)) for p in (gpt(y, 2 * math.pi * j / 48) for j in range(48))] for y in (W + 0.027, W + 0.014)], C_SLATE, RUBBER)
    k.rbox((0.0, W + 0.0205, 0.0505), (0.02, 0.016, 0.006), C_METAL_D, METAL, bevel=0.002)
    # cuff checklist on the inside of the forearm: a thin plate curved to the sleeve
    def ck(y, j):
        n = 10; a = -math.pi / 2 + 0.5 * ((j if j <= n else 2 * n + 1 - j) / n - 0.5)
        p = sleeve_pt(y, a); f = 1.075 if j <= n else 1.005
        return Vector((p.x * f, y, p.z * f))
    k.rings([[ck(y, j) for j in range(22)] for y in [-0.372 - 0.012 * i for i in range(8)]], C_SLATE, HARD, cap0=True, cap1=True)
    return k


def sgp(v, e):
    return math.copysign(abs(v) ** e, v)


def asec(k, secs, color, mat, segs=28, M=None, cap0=False, cap1=False, closed=True, arc=None):
    """Asymmetric superellipse loft down local Y. secs: [(y, ox, oz, back, palm, half_w, n)]: centre (ox, oz),
    +X half depth `back`, -X half depth `palm`, Z half width; n superellipse exponent. arc: (a0, a1) for an open strip."""
    M = M or Matrix.Identity(4)
    rs = []
    for (y, ox, oz, db, dp, w, n) in secs:
        ring = []
        cnt = segs if arc is None else segs + 1
        for j in range(cnt):
            th = (2 * math.pi * j / segs) if arc is None else (arc[0] + (arc[1] - arc[0]) * j / segs)
            c, s = math.cos(th), math.sin(th)
            x = ox + (db if c > 0 else dp) * sgp(c, 2 / n)
            ww = w if not isinstance(w, tuple) else (w[0] if s > 0 else w[1])
            z = oz + ww * sgp(s, 2 / n)
            ring.append(M @ Vector((x, y, z)))
        rs.append(ring)
    return k.rings(rs, color, mat, cap0, cap1, closed=arc is None)


def dome(y0, dirn, r, n=4):
    """y positions and scale factors for a rounded end of radius r going from y0 in direction dirn (+1 / -1)."""
    out = []
    for i in range(1, n + 1):
        a = i / n * math.pi / 2
        out.append((y0 + dirn * r * math.sin(a), math.cos(a)))
    return out



# ---- glove ----------------------------------------------------------------------------------------
# Right glove in its wrist frame: fingers -Y, palm normal -X, back of hand +X, thumb toward -Z.
# rows: y, half width thumb side, half width little-finger side, back depth, palm depth, centre x
PALM = [
    (0.052, 0.027, 0.029, 0.0165, 0.018, 0.0),
    (0.030, 0.029, 0.031, 0.0172, 0.0192, 0.0),
    (0.006, 0.032, 0.034, 0.0185, 0.021, 0.001),
    (-0.010, 0.036, 0.039, 0.0198, 0.025, 0.0),
    (-0.026, 0.043, 0.042, 0.0204, 0.0285, 0.0),
    (-0.044, 0.048, 0.0445, 0.0204, 0.0288, 0.0),
    (-0.062, 0.0485, 0.0455, 0.0198, 0.027, 0.0),
    (-0.078, 0.048, 0.0455, 0.0188, 0.0245, 0.0),
    (-0.092, 0.047, 0.045, 0.0172, 0.0222, 0.001),
    (-0.101, 0.046, 0.0435, 0.0158, 0.0202, 0.002),
]
FINGERS = [   # base (x, y, z), segment lengths, width, back depth, palm depth
    ((0.002, -0.102, -0.0312), (0.037, 0.025, 0.020), 0.0112, 0.0094, 0.0104),
    ((0.002, -0.105, -0.0104), (0.040, 0.028, 0.021), 0.0115, 0.0096, 0.0106),
    ((0.002, -0.1035, 0.0104), (0.038, 0.026, 0.020), 0.0110, 0.0093, 0.0102),
    ((0.002, -0.0965, 0.0305), (0.030, 0.021, 0.017), 0.0098, 0.0084, 0.0092),
]


def palm_pt(y, th, dome=1.0):
    wt, wp, db, dp, cx = keyed(PALM, y)
    c, s = math.cos(th), math.sin(th)
    n = 2.6
    x = cx + (db if c > 0 else dp) * dome * sgp(c, 2 / n)
    z = (wp if s > 0 else wt) * (0.8 + 0.2 * dome) * sgp(s, 2 / n)
    if x < 0:
        x += 0.0045 * G(y + 0.06, 0.02) * G(z + 0.002, 0.02)        # the hollow of the palm
        x -= 0.0065 * G(y + 0.034, 0.017) * G(z + 0.033, 0.015)     # thenar (ball of the thumb)
        x -= 0.0032 * G(y + 0.052, 0.024) * G(z - 0.036, 0.011)     # hypothenar
        x -= 0.0024 * G(y + 0.094, 0.0055) * dome                  # pads under the knuckles
        x += 0.0011 * G(y + 0.072 + 0.22 * z, 0.0018)               # palm crease
        x += 0.0012 * G(y + 0.059, 0.0016)                          # gap between the grip pads
    else:
        x += 0.0008 * math.cos(z / 0.0205 * math.pi) ** 2 * sstep(-0.03, -0.06, y)   # tendons
    return Vector((x, y, z))


def finger_part(name, lens, w0, b0, p0, root=0.014, rflare=0.25, tipped=True, seed=13, taper=0.2, guard=True):
    """One whole finger (all phalanges) as one continuous skin in its base frame, down -Y: flattened section, a
    knuckle on the back of every joint, sharp creases and fat pads on the palm side, a real fingertip (flatter on
    the nail side, the pad rolling round the end) with a silicone cap. The game skins it to one bone per phalanx."""
    k = P(name, seed)
    js = [0.0]
    for L in lens[:-1]: js.append(js[-1] - L)
    Lt = sum(lens)
    kb = [0.0024, 0.0016, 0.0012]

    def sec(y):
        u = min(1.0, max(0.0, -y / Lt)); tp = (1 - taper * u) * (1 + 0.1 * G(y + 0.004, 0.012))
        w, db, dp = w0 * tp, b0 * tp, p0 * tp
        for i, yj in enumerate(js):
            g = G(y - yj, 0.0045)
            db += kb[i] * g; w += 0.0006 * g
            dp -= 0.0017 * G(y - yj - 0.001, 0.0017)
        bounds = js + [-Lt]
        for y0, y1 in zip(bounds, bounds[1:]):
            if y1 <= y <= y0: dp += 0.0011 * math.sin(math.pi * (y0 - y) / (y0 - y1)) ** 2
            if y1 <= y <= y0: db -= 0.0005 * math.sin(math.pi * (y0 - y) / (y0 - y1)) ** 2
        if y > 0:
            f = 1 + rflare * y / root; w *= f; db *= f; dp *= f
        return w, db, dp

    def pt(t, th):
        y, sc = t
        w, db, dp = sec(max(y, -Lt))
        cx = 0.0
        if sc < 1:
            w *= sc ** 0.75; cx = 0.3 * db * (1 - sc); db *= sc ** 1.25; dp *= sc ** 0.6
        c, s = math.cos(th), math.sin(th)
        x = cx + (db if c > 0 else dp) * sgp(c, 2 / 2.4)
        z = w * sgp(s, 2 / 2.4)
        return Vector((x, y, z))
    rT = sec(-Lt)[0] * 0.95
    ts = [(root - 0.0018 * i, 1.0) for i in range(int((root + Lt) / 0.0018) + 1)]
    ts += [(-Lt - rT * math.sin(a), math.cos(a)) for a in [math.pi / 2 * i / 8 for i in range(1, 9)]]
    fs = floft(k, ts, pt, 26, C_SUIT, GLOVE, cap0=True, cap1=True)
    yt = js[-1] - lens[-1] * 0.45

    def col(p):
        w, db, dp = sec(max(p.y, -Lt))
        if tipped and p.y < yt and (p.x < 0.0015 or p.y < -Lt + 0.001): return (0x5f5f5a, RUBBER)   # silicone tip and pad
        if guard and p.x > db * 0.45 and abs(p.y - js[0]) < 0.0062: return (0x55524b, RUBBER)                  # knuckle guard
        if abs(p.z) > w * 0.9 and p.y < 0: return (C_SUIT_D, GLOVE)                                    # side seams
        return None
    paint(k, fs, col)
    J.setdefault('fingerParts', {})[name] = {'js': js, 'len': Lt}
    return k


def build_glove():
    """Glove: the palm (rigid, with the wrist ball, back-of-hand shell and wrist strap), four whole fingers and a
    thumb, each one continuous skin."""
    parts = []
    k = P('palm', 11)
    dm = [(-0.101 - 0.011 * math.sin(a), math.cos(a)) for a in [math.pi / 2 * i / 6 for i in range(1, 7)]]
    ts = [(0.052 - 0.0035 * i, 1.0) for i in range(44)] + dm
    pf = floft(k, ts, lambda t, th: palm_pt(t[0], th, t[1]) if t[1] >= 1 else (lambda p: Vector((p.x, t[0], p.z)))(palm_pt(-0.101, th, t[1])), 52, C_SUIT, GLOVE, cap0=True, cap1=True)
    paint(k, pf, lambda p: (0x55524b, RUBBER) if p.x < -0.0125 and -0.098 < p.y < -0.02 and abs(p.y + 0.059) > 0.0022 and -0.04 < p.z < 0.034 else None)
    # back-of-hand shell: one contoured plate arched across the hand
    bs = []
    for y, w, hgt in ((-0.020, 0.030, 0.0215), (-0.034, 0.036, 0.0238), (-0.05, 0.039, 0.0248), (-0.066, 0.0405, 0.0247), (-0.080, 0.041, 0.0236), (-0.088, 0.039, 0.022), (-0.093, 0.034, 0.0196)):
        bs.append((y, 0.003, -0.0015, hgt, 0.0, w, 3.4))
    asec(k, bs, C_SHELL, HARD, segs=40, cap0=True, cap1=True)
    for z in (-0.013, 0.0, 0.013):
        pts = [Vector((0.0255 + 0.0006 * math.sin((yy + 0.026) * 30), yy, z)) for yy in (-0.026, -0.04, -0.056, -0.072, -0.086)]
        k.sweep(pts, 0.0021, C_SHELL_D, HARD, segs=8)
    ws = [(-0.004, 0.0, -0.002, 0.0235, 0.0265, 0.0375, 2.6), (-0.014, 0.0005, -0.003, 0.0245, 0.0285, 0.0405, 2.7)]
    asec(k, ws, C_SLATE, RUBBER, segs=36, cap0=False, cap1=False)
    k.rbox((0.026, -0.009, 0.006), (0.006, 0.014, 0.02), C_METAL_D, METAL, bevel=0.002)
    k.rbox((0.0285, -0.009, 0.006), (0.002, 0.007, 0.011), C_HAZ, HAZ_M, bevel=0.0007)
    parts.append(k)
    for i, (base, lens, w, b, p) in enumerate(FINGERS):
        parts.append(finger_part('finger%d' % i, lens, w, b, p, seed=13 + i))
    parts.append(finger_part('thumb', (0.032, 0.027), 0.0142, 0.012, 0.0136, root=0.014, rflare=0.35, seed=19, taper=0.26, guard=False))
    J['fingers'] = [list(f[0]) for f in FINGERS]
    J['fingerLens'] = [list(f[1]) for f in FINGERS]
    J['thumb'] = [-0.012, -0.04, -0.046]
    J['thumbLens'] = [0.032, 0.027]
    return parts


def build_thigh():
    k = P('thigh', 17)
    k.lathe([(0.085, 0.0), (0.08, 0.04), (0.06, 0.08), (0.03, 0.098), (0.0, 0.1)], C_SUIT, SUIT, segs=32, cap0=True)
    prof = [(0.0, 0.1), (-0.05, 0.096)] + convolute(-0.06, -0.1, 0.094, 0.006, 2) + [(-0.12, 0.093), (-0.3, 0.084)] + convolute(-0.31, -0.42, 0.08, 0.009, 4) + [(-0.44, 0.079), (-0.47, 0.068), (-0.49, 0.045), (-0.5, 0.0)]
    k.lathe(prof, C_SUIT, SUIT, segs=32, cap1=True)
    k.lathe(ring_prof(-0.11, 0.093, 0.022, 0.009), C_METAL, METAL, segs=32)       # thigh bearing
    k.lathe([(-0.15, 0.0925), (-0.15, 0.0945), (-0.2, 0.0925), (-0.2, 0.0905)], C_HAZ, HAZ_M, segs=32)  # commander stripe
    # thigh pocket
    k.rbox((0.09, -0.22, -0.01), (0.03, 0.1, 0.09), C_SUIT_D, SUIT, rot=(0, 0, 4), bevel=0.012, seg=2)
    k.rbox((0.105, -0.18, -0.01), (0.008, 0.018, 0.07), C_SLATE, RUBBER, rot=(0, 0, 4), bevel=0.003)
    bmesh.ops.scale(k.bm, vec=(1.1, 1, 1.1), verts=k.bm.verts[:])
    return k


def build_shin():
    k = P('shin', 19)
    prof = [(0.08, 0.0), (0.072, 0.035), (0.05, 0.066), (0.025, 0.078), (0.0, 0.08), (-0.06, 0.08), (-0.25, 0.072), (-0.33, 0.066)] + convolute(-0.335, -0.39, 0.064, 0.007, 2) + [(-0.41, 0.065), (-0.42, 0.06)]
    k.lathe(prof, C_SUIT, SUIT, segs=30, cap0=True)
    k.lathe(ring_prof(-0.32, 0.066, 0.02, 0.008), C_METAL, METAL, segs=30)
    k.rbox((0.0, -0.16, -0.075), (0.07, 0.12, 0.014), C_SHELL_D, HARD, bevel=0.006, seg=2)    # shin guard
    bmesh.ops.scale(k.bm, vec=(1.1, 1, 1.1), verts=k.bm.verts[:])
    return k


def build_boot():
    k = P('boot', 23)
    # ankle cuff
    k.lathe([(0.03, 0.068), (0.03, 0.074), (-0.02, 0.075), (-0.04, 0.072)], C_SHELL_D, HARD, segs=30)
    # boot body: loft along -Z (heel to toe), sections in x/y, n boxy
    secs = []
    for (z, cy, a, b) in ((0.085, -0.06, 0.05, 0.035), (0.075, -0.055, 0.058, 0.06), (0.04, -0.045, 0.064, 0.075), (0.0, -0.05, 0.065, 0.075), (-0.06, -0.075, 0.066, 0.052),
                          (-0.13, -0.085, 0.063, 0.042), (-0.18, -0.088, 0.055, 0.035), (-0.205, -0.09, 0.04, 0.026), (-0.214, -0.092, 0.02, 0.014)):
        secs.append((z, 0, cy, a, b, 3.0))
    k.sloft(secs, C_SUIT_D, SUIT, segs=28, axis='z', cap0=True, cap1=True)
    # sole: rubber slab with a heel block and lugs
    k.rbox((0, -0.128, -0.06), (0.135, 0.022, 0.31), C_RUB, RUBBER, bevel=0.008, seg=2)
    for z in (-0.18, -0.12, -0.06, 0.0, 0.06):
        k.rbox((0, -0.142, z), (0.12, 0.008, 0.02), C_BLACK, RUBBER, bevel=0.002)
    k.rbox((0, -0.088, -0.18), (0.11, 0.03, 0.07), C_SHELL_D, HARD, bevel=0.012, seg=2)      # toe cap
    k.rbox((0, -0.07, 0.07), (0.1, 0.05, 0.04), C_SHELL_D, HARD, bevel=0.01, seg=2)          # heel counter
    k.rbox((0, -0.045, -0.035), (0.11, 0.014, 0.05), C_SLATE, RUBBER, rot=(-20, 0, 0), bevel=0.004)  # strap
    return k


C_COPPER, C_CERAMIC = 0xb9773f, 0x8f8578


def zsec(k, secs, color, mat, segs=32, cap0=True, cap1=True, M=None):
    """Superellipse loft along -Z: secs [(z, cx, cy, half_w (x), half_h (y), n)]."""
    M = M or Matrix.Identity(4)
    rs = []
    for (z, cx, cy, a, b, n) in secs:
        ring = []
        for j in range(segs):
            th = 2 * math.pi * j / segs
            c, s = math.cos(th), math.sin(th)
            ring.append(M @ Vector((cx + a * sgp(c, 2 / n), cy + b * sgp(s, 2 / n), z)))
        rs.append(ring)
    return k.rings(rs, color, mat, cap0, cap1)


def build_tool():
    """Plasma cutter, redesigned as one sculpted tool: a flowing monocoque shell whose rear swells into the
    integrated power cell, a ribbed heat-sink barrel that runs out into a ceramic nozzle with a copper tip,
    a rubber overmoulded grip with finger grooves and a paddle trigger with a guard.
    Origin at the centre of the grip; barrel along -Z, grip down -Y."""
    k = P('tool', 29)
    AX = 0.058                       # barrel axis height
    shell_c = lambda p_, n_: (C_SLATE if p_.y < AX - 0.012 else (C_HAZ if (0.046 < p_.z < 0.058 and p_.y > AX - 0.012) else (C_SHELL_D if p_.z < -0.04 else C_SHELL)))
    fs = zsec(k, [(0.092, 0, AX + 0.004, 0.016, 0.02, 2.4), (0.084, 0, AX + 0.007, 0.024, 0.029, 2.8), (0.06, 0, AX + 0.011, 0.031, 0.037, 3.1), (0.02, 0, AX + 0.012, 0.034, 0.039, 3.3),
              (-0.03, 0, AX + 0.006, 0.032, 0.036, 3.3), (-0.07, 0, AX, 0.027, 0.029, 3.0), (-0.098, 0, AX - 0.002, 0.022, 0.023, 2.6), (-0.106, 0, AX - 0.002, 0.018, 0.018, 2.3)], shell_c, HARD, segs=44)
    k.bm.normal_update()
    for fc in fs:
        if fc.is_valid and 0.046 < fc.calc_center_median().z < 0.058 and fc.calc_center_median().y > AX - 0.012: fc.material_index = HAZ_M
    # dorsal rail with a low sight blade, a three-cell charge indicator in the swell, a cell latch
    k.rbox((0, AX + 0.0495, 0.03), (0.01, 0.004, 0.075), C_METAL_D, METAL, bevel=0.0014)
    for i in range(3): k.box((0.0, AX + 0.0495, 0.062 - i * 0.012), (0.012, 0.0014, 0.0075), color=C_AMBER, mat=LAMP, wear=0)
    k.rbox((0, AX + 0.057, -0.045), (0.006, 0.008, 0.008), C_BLACK, HARD, bevel=0.001)
    for sx in (1, -1):
        for i in range(5):                # louvred vents (the game puffs heat out of these)
            k.rbox((sx * 0.0332, AX - 0.002, 0.022 - i * 0.014), (0.0026, 0.026, 0.0055), C_BLACK, HARD, bevel=0.0008)
        for (z, y) in ((0.052, AX + 0.02), (0.052, AX - 0.024), (-0.056, AX + 0.01), (-0.056, AX - 0.018)):
            k.tube((sx * 0.0325, y, z), 0.0034, 0.0034, 0.0035, 'x', C_METAL, METAL, segs=8)
        k.rbox((sx * 0.0338, AX + 0.02, 0.0), (0.0016, 0.004, 0.02), C_AMBER if sx > 0 else C_SLATE_L, LAMP if sx > 0 else METAL, bevel=0.0006)
    # feed hose: from the cell down the left flank into the barrel collar, corrugated
    k.sweep([(-0.026, AX + 0.016, 0.07), (-0.044, AX + 0.02, 0.03), (-0.045, AX + 0.016, -0.05), (-0.032, AX + 0.01, -0.108), (-0.012, AX + 0.004, -0.122)], 0.0058, C_BLACK, RUBBER, segs=12, ripple=0.14, rip_n=22)
    # barrel: collar, then one continuous ribbed heat-sink tube (smooth rib profile), ceramic nozzle, copper tip
    B = lambda z: rotM(90, 0, 0, (0, AX, z))     # local -Y runs forward (-Z)
    k.lathe([(0.0, 0.0), (0.0, 0.0225), (-0.004, 0.0245), (-0.024, 0.0245), (-0.03, 0.0215), (-0.03, 0.0)], C_METAL_D, METAL, segs=36, M=B(-0.1), cap0=True, cap1=True)
    k.lathe([(-0.0015, 0.0216), (-0.0075, 0.0232), (-0.013, 0.0232), (-0.0185, 0.0216)], C_HAZ, HAZ_M, segs=36, M=B(-0.1))     # hazard sleeve on the collar
    prof = [(0.0, 0.012)]
    for i in range(0, 41):
        y = -0.0 - i * 0.0018
        r = 0.0176 - 0.0014 * (i / 40) + 0.0028 * max(0.0, math.cos(i / 40 * 7 * 2 * math.pi)) ** 1.5
        prof.append((y, r))
    k.lathe(prof, C_METAL, METAL, segs=32, M=B(-0.13), cap0=True)
    k.lathe([(0.0, 0.0165), (-0.006, 0.0172), (-0.03, 0.0125), (-0.036, 0.0105), (-0.038, 0.0085)], C_CERAMIC, HARD, segs=28, M=B(-0.19), cap0=True)
    k.lathe([(0.0, 0.0084), (-0.006, 0.007), (-0.009, 0.0058), (-0.009, 0.0035), (-0.006, 0.0025)], C_COPPER, METAL, segs=24, M=B(-0.228))
    # grip: raked, rubber overmold with finger grooves on the front, palm swell at the back, pommel + lanyard ring
    gs = []
    for i in range(11):
        t = i / 10; y = 0.03 - t * 0.092
        groove = 0.0035 * max(0.0, math.cos(t * 3 * 2 * math.pi)) * (0.2 < t < 0.92)
        gs.append((y, 0.0, 0.004 + 0.012 * t + 0.002 * math.sin(math.pi * t), 0.016 + 0.002 * math.sin(math.pi * t), 0.019 - groove * 0.4, 0.024 + 0.003 * math.sin(math.pi * t), 3.0))
    # grip sections in (y, ox, oz, back(+X)..): reuse asec but the grip's depth runs in Z: build in a frame rotated -90 about Y
    rs = []
    for (y, ox, oz, wx, front, back, n) in gs:
        ring = []
        for j in range(32):
            th = 2 * math.pi * j / 32; c, s = math.cos(th), math.sin(th)
            z = oz + (back if s > 0 else front) * sgp(s, 2 / n)
            x = wx * sgp(c, 2 / n)
            ring.append(Vector((x, y, z)))
        rs.append(ring)
    k.rings(rs, C_RUB, RUBBER, True, True)
    k.lathe([(0.0, 0.0), (0.0, 0.017), (-0.004, 0.019), (-0.012, 0.018), (-0.014, 0.0)], C_SLATE, HARD, segs=24, sx=0.95, sz=1.25, M=rotM(0, 0, 0, (0, -0.06, 0.016)), cap0=True, cap1=True)
    k.sweep([(math.cos(math.radians(a)) * 0.009, -0.081 + math.sin(math.radians(a)) * 0.009, 0.026) for a in range(0, 360, 30)], 0.0022, C_HAZ, HAZ_M, segs=8, closed=True)
    # paddle trigger (sized for a glove) and a wide guard loop
    k.rbox((0, 0.012, -0.03), (0.016, 0.034, 0.011), C_HAZ, HAZ_M, rot=(14, 0, 0), bevel=0.004, seg=2)
    k.sweep([(0, 0.03, -0.062), (0, 0.004, -0.07), (0, -0.032, -0.058), (0, -0.05, -0.03), (0, -0.052, -0.008)], 0.0045, C_SLATE, HARD, segs=8, cap=True)
    J['toolTip'] = [0, AX, -0.252]
    J['toolEmit'] = [0, AX, -0.2365]
    J['toolEmitR'] = 0.0045
    return k


# ---- bake + export --------------------------------------------------------------------------------
def bake(parts, dist=0.12, rays=28, strength=0.8, occluders=()):
    comb = bmesh.new()
    for p in list(parts) + list(occluders):
        me = bpy.data.meshes.new('t'); p.bm.to_mesh(me); comb.from_mesh(me); bpy.data.meshes.remove(me)
    bvh = BVHTree.FromBMesh(comb)
    rnd = random.Random(5)
    dirs = []
    for i in range(rays):
        u1 = (i + rnd.random()) / rays; u2 = rnd.random(); r = math.sqrt(u1); th = 2 * math.pi * u2
        dirs.append(Vector((r * math.cos(th), r * math.sin(th), math.sqrt(max(0, 1 - u1)))))
    for p in parts:
        p.bm.normal_update()
        ao = {}
        for v in p.bm.verts:
            n = v.normal if v.normal.length > 0.5 else Vector((0, 1, 0))
            t = n.cross(Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))).normalized(); b = n.cross(t)
            o = v.co + n * 0.0015
            occ = 0.0
            for d in dirs:
                w = t * d.x + b * d.y + n * d.z
                hit = bvh.ray_cast(o, w, dist)
                if hit[0] is not None: occ += 1 - hit[3] / dist
            ao[v] = 1 - strength * occ / rays
        for f in p.bm.faces:
            if f.material_index == LAMP: continue
            for l in f.loops:
                a = ao[l.vert]; c = l[p.col]
                l[p.col] = (c[0] * a, c[1] * a, c[2] * a, 1.0)
    comb.free()


def export(parts, path):
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    mats = []
    for name in MAT_NAMES:
        m = bpy.data.materials.new(name); m.use_nodes = True; mats.append(m)
    tris = 0
    for k in parts:
        bmesh.ops.triangulate(k.bm, faces=k.bm.faces[:])
        k.smooth_by_angle(48)
        me = bpy.data.meshes.new(k.name); k.bm.to_mesh(me)
        for m in mats: me.materials.append(m)
        ob = bpy.data.objects.new(k.name, me); bpy.context.scene.collection.objects.link(ob)
        tris += len(me.polygons)
        print('  ', k.name, len(me.polygons))
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=False, export_yup=False, export_vertex_color='NAME', export_vertex_color_name='Col',
                              export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True, export_extras=False, export_cameras=False,
                              export_lights=False, export_normals=True, export_texcoords=True, export_materials='EXPORT')
    print(f'{path}: {len(parts)} parts, {tris} tris')


if __name__ == '__main__':
    root = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'assets')
    torso, helmet = build_torso(), build_helmet()
    sl = build_sleeve()
    glove = build_glove()
    th, sh, bo = build_thigh(), build_shin(), build_boot()
    tool = build_tool()
    J['upperArm'] = UA; J['foreArm'] = FA; J['thighLen'] = 0.44; J['shinLen'] = 0.42
    # occlusion: torso + helmet together (helmet moved to its seat), limbs and gloves on their own
    hm = bmesh.new(); me = bpy.data.meshes.new('h'); helmet.bm.to_mesh(me); hm.from_mesh(me); bpy.data.meshes.remove(me)
    bmesh.ops.translate(hm, vec=Vector(J['neck']), verts=hm.verts)
    occ = type('O', (), {'bm': hm})()
    bake([torso], occluders=[occ], dist=0.14)
    tm = bmesh.new(); me = bpy.data.meshes.new('t'); torso.bm.to_mesh(me); tm.from_mesh(me); bpy.data.meshes.remove(me)
    bmesh.ops.translate(tm, vec=-Vector(J['neck']), verts=tm.verts)
    bake([helmet], occluders=[type('O', (), {'bm': tm})()], dist=0.12)
    for p in (th, sh, bo, tool): bake([p], dist=0.08)
    bake([sl], dist=0.03, strength=0.75)
    bake([glove[0]], dist=0.05)
    for g in glove[1:]: bake([g], dist=0.012, strength=0.45)
    export([torso, helmet, sl, *glove, th, sh, bo, tool], os.path.join(root, 'astronaut.glb'))
    with open(os.path.join(root, 'astronaut.json'), 'w') as f: json.dump(J, f, indent=1)
