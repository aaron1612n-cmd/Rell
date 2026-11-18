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
                f = self.bm.faces.new((c, ring[k], ring[j]) if ring is V[0] else (c, ring[j], ring[k]))
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
        (-0.34, 0, pz, 0.225, 0.095, 4.0), (-0.33, 0, pz, 0.24, 0.105, 5.0), (0.30, 0, pz, 0.245, 0.11, 5.0),
        (0.36, 0, pz - 0.005, 0.235, 0.105, 4.5), (0.385, 0, pz - 0.01, 0.2, 0.085, 3.2), (0.392, 0, pz - 0.012, 0.15, 0.06, 2.4)], C_SHELL, HARD, segs=44, cap0=True, cap1=True)
    # back cover panels with seams, a vent grille, a hazard band
    k.rbox((0, 0.13, pz + 0.112), (0.36, 0.3, 0.012), C_SHELL, HARD, bevel=0.006, seg=2)
    k.rbox((0, -0.17, pz + 0.112), (0.36, 0.2, 0.012), C_SHELL_D, HARD, bevel=0.006, seg=2)
    for i in range(7):
        k.rbox((0, -0.22 + i * 0.016, pz + 0.12), (0.2, 0.006, 0.008), C_SLATE, HARD, bevel=0.002)
    k.rbox((0, 0.31, pz + 0.106), (0.47, 0.03, 0.012), C_HAZ, HAZ_M, bevel=0.004)
    k.rbox((0, 0.31, pz - 0.106), (0.47, 0.03, 0.012), C_HAZ, HAZ_M, bevel=0.004)
    # top: the tether/comm hump and an antenna
    k.rbox((0.08, 0.40, pz + 0.02), (0.12, 0.04, 0.12), C_SLATE, HARD, bevel=0.012, seg=3)
    k.tube((0.12, 0.52, pz + 0.04), 0.004, 0.003, 0.22, 'y', C_METAL_D, METAL, segs=6)
    J['antenna'] = [0.12, 0.63, pz + 0.04]
    k.tube((-0.1, 0.405, pz + 0.0), 0.022, 0.022, 0.05, 'y', C_METAL, METAL, segs=16, bevel=0.003)
    # handholds on the shoulders of the pack
    for sx in (1, -1):
        k.sweep([(sx * 0.2, 0.36, pz - 0.06), (sx * 0.22, 0.42, pz + 0.0), (sx * 0.2, 0.36, pz + 0.07)], 0.009, C_HAZ, HAZ_M, segs=8)
    # jetpack: two thruster pods down the sides with nozzle bells, a manifold across the bottom
    nozz = []
    for sx in (1, -1):
        x, z = sx * 0.285, pz + 0.01
        k.lathe([(-0.16, 0.0), (-0.16, 0.045), (-0.14, 0.058), (0.18, 0.058), (0.21, 0.05), (0.225, 0.03), (0.23, 0.0)], C_SLATE_L, HARD, segs=24, M=rotM(t=(x, -0.06, z)))
        k.lathe(ring_prof(0.12, 0.058, 0.02, 0.006), C_METAL, METAL, segs=24, M=rotM(t=(x, -0.06, z)))
        k.lathe(ring_prof(-0.06, 0.058, 0.02, 0.006), C_HAZ, HAZ_M, segs=24, M=rotM(t=(x, -0.06, z)))
        # bell: flared, open
        k.lathe([(-0.16, 0.03), (-0.19, 0.034), (-0.215, 0.044), (-0.24, 0.056), (-0.243, 0.058), (-0.243, 0.052), (-0.215, 0.038), (-0.19, 0.028), (-0.17, 0.022)], C_METAL_D, METAL, segs=24, M=rotM(t=(x, -0.06, z)))
        nozz.append([x, -0.06 - 0.17, z])
        # mounting yoke back to the pack
        k.rbox((sx * 0.245, 0.02, z), (0.05, 0.06, 0.07), C_SLATE, HARD, bevel=0.008)
        k.rbox((sx * 0.245, -0.14, z), (0.05, 0.05, 0.06), C_SLATE, HARD, bevel=0.008)
        # small RCS quads at the pack corners: tiny 4-way nozzle blocks
        for cy in (0.33, -0.3):
            cx, cz = sx * 0.225, pz + 0.09
            k.rbox((cx, cy, cz), (0.045, 0.045, 0.045), C_SLATE, HARD, bevel=0.006)
            for d in ((sx, 0, 0), (0, 1 if cy > 0 else -1, 0), (0, 0, 1)):
                c = (cx + d[0] * 0.03, cy + d[1] * 0.03, cz + d[2] * 0.03)
                axis = 'x' if d[0] else ('y' if d[1] else 'z')
                k.tube(c, 0.006, 0.009, 0.016, axis, C_METAL_D, METAL, segs=10, caps=False)
    J['nozzles'] = nozz
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


def build_upper_arm():
    k = P('upperArm', 7)
    # shoulder ball fills the scye bearing through the arm's range
    k.lathe([(0.075, 0.0), (0.07, 0.035), (0.05, 0.068), (0.02, 0.083), (-0.02, 0.083), (-0.05, 0.078)], C_SUIT, SUIT, segs=32, cap0=True)
    prof = [(-0.05, 0.078), (-0.065, 0.074)] + convolute(-0.07, -0.11, 0.07, 0.006, 2) + [(-0.13, 0.069), (-0.165, 0.066)] + convolute(-0.17, -0.23, 0.064, 0.008, 3) + [(-0.25, 0.062), (-0.28, 0.061), (-0.29, 0.06), (-0.31, 0.055), (-0.33, 0.042), (-0.345, 0.022), (-0.35, 0.0)]
    k.lathe(prof, C_SUIT, SUIT, segs=30, cap1=True)
    k.lathe(ring_prof(-0.118, 0.069, 0.02, 0.008), C_METAL, METAL, segs=30)       # arm bearing
    k.lathe([(-0.14, 0.0685), (-0.14, 0.0705), (-0.17, 0.0695), (-0.17, 0.0675)], C_HAZ, HAZ_M, segs=30)  # arm band
    bmesh.ops.scale(k.bm, vec=(1.04, 1, 1.04), verts=k.bm.verts[:])
    return k


def build_forearm():
    k = P('foreArm', 8)
    prof = [(0.062, 0.0), (0.058, 0.024), (0.045, 0.045), (0.025, 0.058), (0.0, 0.062), (-0.03, 0.06)] + convolute(-0.05, -0.1, 0.058, 0.007, 3) + [(-0.11, 0.057), (-0.2, 0.052), (-0.235, 0.05), (-0.25, 0.046)]
    k.lathe(prof, C_SUIT, SUIT, segs=30, cap0=True, cap1=True)
    # the glove's gauntlet rides on the forearm (the hand bends at the wrist below it): flares over the wrist
    # ring, a hazard band, then the glove's own wrist bearing right at the wrist pivot
    g = Matrix.Translation(Vector((0, -FA, 0)))
    k.lathe([(0.064, 0.0), (0.064, 0.05), (0.062, 0.0525), (0.058, 0.0535), (0.045, 0.0525), (0.02, 0.048), (0.006, 0.046), (0.006, 0.0)], C_SUIT, GLOVE, segs=28, M=g)
    k.lathe([(0.055, 0.0532), (0.055, 0.0548), (0.042, 0.054), (0.042, 0.0522)], C_HAZ, HAZ_M, segs=28, M=g)
    k.lathe(ring_prof(0.002, 0.042, 0.012, 0.006), C_METAL, METAL, segs=28, M=g)
    k.lathe(ring_prof(-0.245, 0.046, 0.026, 0.009), C_METAL, METAL, segs=30)      # wrist disconnect
    k.lathe(ring_prof(-0.228, 0.05, 0.008, 0.006), C_HAZ, HAZ_M, segs=30)
    # a cuff checklist / wrist mirror plate on the outside of the forearm (left arm reads it in reality)
    k.rbox((0.0, -0.15, -0.058), (0.05, 0.075, 0.01), C_SLATE, HARD, bevel=0.003)
    k.rbox((0.0, -0.15, -0.0635), (0.038, 0.06, 0.002), C_SHELL_D, HARD, bevel=0.0)
    bmesh.ops.scale(k.bm, vec=(1.04, 1, 1.04), verts=k.bm.verts[:])
    return k


def build_glove():
    """Right glove in its wrist frame: fingers -Y, palm normal -X, back of hand +X, thumb toward -Z."""
    parts = []
    k = P('palm', 11)
    # the glove's own wrist, a soft ball inside the gauntlet, so the cuff never shows its hollow when the wrist bends
    k.lathe([(0.05, 0.0), (0.046, 0.026), (0.03, 0.039), (0.008, 0.041), (-0.012, 0.038)], C_SUIT_D, GLOVE, segs=24, sz=1.1, cap0=True)
    # hand: superellipse loft down the palm (x = thickness, z = width)
    k.sloft([
        (-0.0, 0.0, 0.0, 0.026, 0.036, 2.2), (-0.025, 0.002, -0.002, 0.028, 0.041, 2.6), (-0.06, 0.002, -0.001, 0.025, 0.046, 3.0),
        (-0.09, 0.0, 0.0, 0.021, 0.046, 3.0), (-0.103, 0.0, 0.0, 0.017, 0.044, 2.6), (-0.108, 0.0, 0.0, 0.012, 0.04, 2.2)], C_SUIT, GLOVE, segs=28, cap1=True)
    # palm grip pad and knuckle bar (rubber), restraint strap across the back
    k.sloft([(-0.012, -0.022, 0.0, 0.006, 0.032, 3), (-0.095, -0.016, 0.0, 0.006, 0.04, 3)], C_RUB, RUBBER, segs=20, cap0=True, cap1=True)
    k.sloft([(-0.082, 0.018, 0.0, 0.007, 0.044, 3), (-0.104, 0.013, 0.0, 0.007, 0.042, 3)], C_RUB, RUBBER, segs=20, cap0=True, cap1=True)
    k.rbox((0.026, -0.03, 0.0), (0.008, 0.022, 0.08), C_SLATE, RUBBER, bevel=0.003)
    parts.append(k)
    # finger segments (shared shapes; the game instances and scales them)
    def finger(name, L, r, tip):
        f = P(name, 13)
        prof = [(0.006, 0.0), (0.004, r * 0.75), (0.0, r * 1.02), (-L * 0.5, r), (-L + 0.004, r * 0.98)]
        if tip: prof += [(-L - r * 0.3, r * 0.92), (-L - r * 0.75, r * 0.62), (-L - r * 0.98, r * 0.2), (-L - r, 0.0)]
        else: prof += [(-L, r * 0.9), (-L - 0.003, r * 0.6)]
        f.lathe(prof, C_SUIT, GLOVE, segs=16, sx=0.9, cap0=True, cap1=not tip)
        if tip:   # rubber fingertip cap on the pad side
            f.lathe([(-L * 0.35, 0.0), (-L * 0.35, r * 1.04), (-L - r * 0.4, r * 0.98), (-L - r * 0.85, r * 0.55), (-L - r * 1.03, 0.0)], C_RUB, RUBBER, segs=16, sx=0.94, sz=1.04, M=Matrix.Translation(Vector((-0.0012, 0, 0))))
        return f
    parts.append(finger('finA', 0.038, 0.0118, False))
    parts.append(finger('finB', 0.03, 0.0112, True))
    parts.append(finger('thumbA', 0.034, 0.0135, False))
    parts.append(finger('thumbB', 0.028, 0.0128, True))
    J['fingers'] = [[0.002, -0.106, z] for z in (-0.032, -0.011, 0.011, 0.031)]
    J['fingerScale'] = [1.0, 1.08, 1.02, 0.86]
    J['thumb'] = [-0.006, -0.03, -0.04]
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


def build_tool():
    """Plasma cutter / welder. Origin at the centre of the grip; barrel along -Z, grip down -Y."""
    k = P('tool', 29)
    # body: a lofted housing over the grip running forward
    k.sloft([(0.07, 0, 0.055, 0.022, 0.028, 3), (0.06, 0, 0.058, 0.025, 0.032, 3.4), (-0.06, 0, 0.06, 0.025, 0.034, 3.4), (-0.13, 0, 0.058, 0.021, 0.03, 3),
             (-0.15, 0, 0.056, 0.017, 0.024, 2.5)], C_SHELL_D, HARD, segs=28, axis='z', cap0=True, cap1=True)
    k.rbox((0, 0.092, -0.03), (0.026, 0.008, 0.14), C_HAZ, HAZ_M, bevel=0.003)               # top stripe
    # grip: slight rake, rubber
    k.sloft([(0.04, 0, -0.008, 0.017, 0.022, 2.8), (0.0, 0, 0.0, 0.019, 0.024, 2.8), (-0.05, 0, 0.012, 0.017, 0.021, 2.6), (-0.058, 0, 0.014, 0.012, 0.016, 2.2)], C_RUB, RUBBER, segs=20, cap1=True)
    k.rbox((0, -0.062, 0.016), (0.04, 0.012, 0.05), C_SLATE, HARD, bevel=0.004)
    # trigger guard and trigger
    k.sweep([(0, 0.03, -0.022), (0, 0.0, -0.05), (0, -0.045, -0.035)], 0.004, C_SLATE, HARD, segs=6)
    k.rbox((0, 0.01, -0.03), (0.008, 0.022, 0.01), C_HAZ, HAZ_M, rot=(20, 0, 0), bevel=0.002)
    # barrel: stepped, with cooling fins and an emitter shroud
    k.tube((0, 0.06, -0.19), 0.016, 0.019, 0.09, 'z', C_METAL_D, METAL, segs=20, bevel=0.002)
    for i in range(5):
        k.tube((0, 0.06, -0.165 - i * 0.012), 0.024, 0.024, 0.004, 'z', C_METAL, METAL, segs=20)
    k.lathe([(0.0, 0.017), (0.0, 0.024), (-0.006, 0.026), (-0.03, 0.026), (-0.034, 0.022), (-0.034, 0.018)], C_SLATE, METAL, segs=24, M=rotM(-90, 0, 0, (0, 0.06, -0.232)))
    # power cell on the side with a level window
    k.rbox((0.032, 0.05, 0.02), (0.022, 0.04, 0.08), C_SLATE, HARD, bevel=0.005)
    k.box((0.0435, 0.05, 0.02), (0.002, 0.008, 0.05), color=C_AMBER, mat=LAMP, wear=0)
    J['toolTip'] = [0, 0.06, -0.268]
    J['toolEmit'] = [0, 0.06, -0.264]
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
    ua, fa = build_upper_arm(), build_forearm()
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
    for p in (ua, fa, th, sh, bo, tool): bake([p], dist=0.08)
    bake([glove[0]], dist=0.05)
    for g in glove[1:]: bake([g], dist=0.02, strength=0.5)
    export([torso, helmet, ua, fa, *glove, th, sh, bo, tool], os.path.join(root, 'astronaut.glb'))
    with open(os.path.join(root, 'astronaut.json'), 'w') as f: json.dump(J, f, indent=1)
