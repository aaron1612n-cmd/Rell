"""The fleet: every ship you can buy at the yard or find adrift, plus the Ironwake (a 1.1 km derelict
carrier you can walk into). Nose -Z, up +Y, metres. One object per ship in src/assets/fleet.glb and its
anchors/colliders in src/assets/fleet.json.

Run:  /tmp/bv/bin/python tools/blender/fleet.py [id ...]   then  node tools/optimize.mjs fleet

Hulls are lofts through superellipse rings, wings and fins are airfoil lofts, engines and tanks are
revolved solids (double skinned, so bells are hollow), livery is painted per face, AO is baked.
"""
import sys, os, json, math, random
sys.path.insert(0, os.path.dirname(__file__))
from kit import *
import bmesh
from mathutils import Vector, Matrix, Quaternion

LOD = {'step': 1.15, 'segs': 1.0, 'rev': .9, 'greeble': .62}
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'assets')

# ---- small maths -----------------------------------------------------------------------------
def sgp(v, e): return math.copysign(abs(v) ** e, v)
def hsh(*a):
    h = 2166136261
    for v in a: h = ((h ^ (int(v) & 0xffffffff)) * 16777619) & 0xffffffff
    return h / 0xffffffff
def shade(c, f):
    r, g, b = (c >> 16) & 255, (c >> 8) & 255, c & 255
    return (min(255, int(r * f)) << 16) | (min(255, int(g * f)) << 8) | min(255, int(b * f))
def mix(a, b, t):
    ca = [(a >> s) & 255 for s in (16, 8, 0)]; cb = [(b >> s) & 255 for s in (16, 8, 0)]
    c = [int(x + (y - x) * t) for x, y in zip(ca, cb)]
    return (c[0] << 16) | (c[1] << 8) | c[2]
def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)

def hermite(tab, x):
    """Monotone cubic through tab [(x, v...)], tangents clamped so it never overshoots."""
    n = len(tab)
    if x <= tab[0][0]: return tuple(tab[0][1:])
    if x >= tab[-1][0]: return tuple(tab[-1][1:])
    i = 0
    while tab[i + 1][0] < x: i += 1
    x0, x1 = tab[i][0], tab[i + 1][0]; t = (x - x0) / (x1 - x0); h = x1 - x0
    out = []
    for c in range(1, len(tab[0])):
        v0, v1 = tab[i][c], tab[i + 1][c]
        def slope(j):
            if j <= 0 or j >= n - 1:
                a, b = (tab[0], tab[1]) if j <= 0 else (tab[-2], tab[-1])
                return (b[c] - a[c]) / (b[0] - a[0])
            return (tab[j + 1][c] - tab[j - 1][c]) / (tab[j + 1][0] - tab[j - 1][0])
        s0, s1 = slope(i), slope(i + 1); d = (v1 - v0) / h
        if d == 0: s0 = s1 = 0
        else: s0 = max(0, min(s0 / d, 3)) * d; s1 = max(0, min(s1 / d, 3)) * d
        t2, t3 = t * t, t * t * t
        out.append((2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * h * s0 + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * h * s1)
    return tuple(out)

def skin_rot(n):
    """Euler for a box sitting on the skin: local z = normal, local y follows the hull's length"""
    zz = Vector(n).normalized(); yy = Vector((0, 0, 1)) - zz * zz.z
    if yy.length < 1e-3: yy = Vector((0, 1, 0)) - zz * zz.y
    yy.normalize(); xx = yy.cross(zz)
    return Matrix((xx, yy, zz)).transposed().to_euler()

def rot_to(n, spin=0.0):
    """Euler that turns +Z onto n (then spins about it)."""
    q = Vector((0, 0, 1)).rotation_difference(Vector(n).normalized())
    if spin: q = q @ Quaternion((0, 0, 1), spin)
    return q.to_euler()


# ---- the ship being built --------------------------------------------------------------------
class Ship:
    def __init__(self, id, seed=1, maxlen=0.5):
        self.id = id; self.k = Kit(id, seed); self.k.maxlen = maxlen
        self.rng = random.Random(seed)
        self.obbs = []; self.probes = []; self.nozzles = []; self.lights = []
        self.anchor = {}
    def box_col(self, c, h, q=(0, 0, 0, 1)):
        self.obbs.append({'c': list(c), 'h': list(h), 'q': list(q)})


# ---- hull loft ---------------------------------------------------------------------------------
class Hull:
    """Superellipse cross sections along z. tab rows: (z, half width, half height, exponent, y centre).
    `bot` squashes the lower half, `shoulder` narrows the deck, hump(z, x) adds height on top."""
    def __init__(self, tab, segs=40, bot=1.0, shoulder=0.08, hump=None, keel=0.0, chine=0.0, ridge=0.0):
        segs = max(16, int(segs * LOD['segs']) // 4 * 4)
        self.tab, self.segs, self.bot, self.shoulder, self.hump, self.keel = tab, segs, bot, shoulder, hump, keel
        self.chine, self.ridge = chine, ridge
        self.z0, self.z1 = tab[0][0], tab[-1][0]
    def at(self, z):
        w, h, n, yc = hermite(self.tab, z); return max(w, 0.01), max(h, 0.01), max(n, 1.6), yc
    def pt(self, t, z):
        w, h, n, yc = self.at(z); c, s = math.cos(t), math.sin(t)
        x = w * sgp(c, 2 / n); y = h * sgp(s, 2 / n) * (1.0 if s > 0 else self.bot)
        if s > 0: x *= 1 - self.shoulder * s
        if self.chine: x *= 1 + self.chine * max(0, 1 - abs(s) * 2.2) ** 3        # a hard crease along the flanks
        if self.ridge and s > 0: y += self.ridge * h * max(0, 1 - abs(c) * 5) ** 2  # a spine ridge down the back
        if s < 0 and self.keel: y -= self.keel * h * max(0, -s) ** 6
        if self.hump and s > 0: y += self.hump(z, x)
        return Vector((x, y + yc, z))
    def normal(self, t, z):
        e = 1e-3; a = self.pt(t + e, z) - self.pt(t - e, z); b = self.pt(t, z + e * 10) - self.pt(t, z - e * 10)
        n = b.cross(a)
        if n.length < 1e-9: return Vector((0, 1, 0))
        n.normalize()
        p = self.pt(t, z); _, _, _, yc = self.at(z)
        if n.dot(Vector((p.x, p.y - yc, 0))) < 0: n = -n
        return n
    def t_of(self, z):
        """an angle grid, so features can find themselves on the surface"""
        return [2 * math.pi * j / self.segs for j in range(self.segs)]

def skin(S, H, zs, livery, cap0=True, cap1=True, skip=None):
    """loft rings at stations zs. skip(z, t, p) -> True leaves a face out (an opening)."""
    k = S.k; H.paint = livery
    rings = [[H.pt(2 * math.pi * j / H.segs, z) for j in range(H.segs)] for z in zs]
    skip = skip or (lambda z, t, p: False)
    before = set(k.bm.faces)
    n = H.segs
    V = [[k.bm.verts.new(tuple(p)) for p in r] for r in rings]
    faces = []
    for i in range(len(V) - 1):
        for j in range(n):
            jj = (j + 1) % n
            zc = (zs[i] + zs[i + 1]) / 2; tc = 2 * math.pi * (j + .5) / n
            if skip(zc, tc, H.pt(tc, zc)): continue
            try: faces.append(k.bm.faces.new((V[i][j], V[i + 1][j], V[i + 1][jj], V[i][jj])))
            except ValueError: pass
    for flag, ring in ((cap0, V[0]), (cap1, V[-1])):
        if flag:
            try: faces.append(k.bm.faces.new(ring))
            except ValueError: pass
    k.bm.normal_update()
    # outward: face normal agrees with the radial direction
    flip = []
    for f in faces:
        c = f.calc_center_median(); _, _, _, yc = H.at(c.z)
        r = Vector((c.x, c.y - yc, 0))
        if r.length > 1e-6 and f.normal.dot(r) < 0 and len(f.verts) == 4: flip.append(f)
        elif len(f.verts) > 4:
            if (f.normal.z > 0) != (c.z > (H.z0 + H.z1) / 2): flip.append(f)
    bmesh.ops.reverse_faces(k.bm, faces=flip)
    k.bm.normal_update()
    k._finish(before, livery, HULL, 0)
    return faces

def stations(z0, z1, step, extra=()):
    step *= LOD['step']
    zs = []; z = z0
    while z < z1 - 1e-6: zs.append(round(z, 4)); z += step
    zs.append(z1); zs += list(extra)
    zs = sorted(set(round(z, 4) for z in zs if z0 <= z <= z1))
    out = [zs[0]]
    for z in zs[1:]:
        if z - out[-1] > 1e-3: out.append(z)
    return out

def livery(H, base, belly=None, accent=HAZ, cell=1.0, seams=(), seamw=0.03, stripe=None, band=None, tip=SLATE_D, tipz=None,
           wear=0.12, dark=None, windows=None):
    """per-face colour: panel cells, seam lines, a dark belly, an accent stripe, optional window band"""
    belly = belly if belly is not None else shade(base, .72)
    def f(p, n):
        w, h, nn, yc = H.at(p.z); yn = (p.y - yc) / max(h, 1e-3)
        if tipz is not None and p.z < tipz: return tip
        if windows and windows(p, yn): return 0x0b1118
        if any(abs(p.z - s) < seamw for s in seams): return shade(base, .52)
        if stripe and stripe(p, yn): return accent
        if band and band(p, yn): return band(p, yn) if isinstance(band(p, yn), int) and band(p, yn) > 1 else accent
        cellk = (int((p.z + 4000) / cell), int((math.atan2(p.y - yc, p.x) + 4) / (cell / max(w, h) * 1.3 + .05)))
        r = hsh(*cellk)
        if yn < -.45: return shade(belly, .9 + .14 * r)
        c = shade(base, 1 - wear / 2 + wear * r)
        if dark and dark(p, r): c = shade(c, .55)
        return c
    return f


# ---- revolved solids ---------------------------------------------------------------------------
def revolve(k, prof, c=(0, 0, 0), n=(0, 0, 1), segs=24, color=BONE, mat=HULL, closed=True, wear=0, spin=0.0):
    """revolve a profile [(z, r)] about local z, oriented along n at c. closed=True joins the last profile
    point back to the first (a double skin or a solid ring); otherwise the ends are capped if r > 0."""
    before = set(k.bm.faces)
    segs = max(8, int(segs * LOD['rev']))
    R = Matrix.Translation(Vector(c)) @ rot_to(n, spin).to_matrix().to_4x4()
    M = k.stack[-1] @ R
    V = []
    for z, r in prof:
        V.append([k.bm.verts.new(M @ Vector((r * math.cos(2 * math.pi * j / segs), r * math.sin(2 * math.pi * j / segs), z))) for j in range(segs)])
    np_ = len(prof); faces = []
    rng = range(np_) if closed else range(np_ - 1)
    for i in rng:
        a, b = V[i], V[(i + 1) % np_]
        for j in range(segs):
            jj = (j + 1) % segs
            try: faces.append(k.bm.faces.new((a[j], a[jj], b[jj], b[j])))
            except ValueError: pass
    if not closed:
        for ring, rr in ((V[0], prof[0][1]), (V[-1], prof[-1][1])):
            if rr > 1e-4:
                try: faces.append(k.bm.faces.new(ring))
                except ValueError: pass
    k.bm.normal_update()
    bmesh.ops.recalc_face_normals(k.bm, faces=faces)
    k._finish(before, color, mat, wear)
    return faces

def bell(k, c, r_throat, r_exit, length, n=(0, 0, 1), segs=24, color=SLATE_D, glow=None):
    """an engine bell: hollow double skin from the throat (at c) out to the exit (c + n*length)"""
    t = .05 * r_exit + .02
    prof = []
    for i in range(9):
        u = i / 8; prof.append((u * length, r_throat + (r_exit - r_throat) * (u ** .7)))
    inner = [(z, r - t) for z, r in reversed(prof)]
    revolve(k, prof + inner, c, n, segs, color)
    # ribs round the outside
    for u in (.3, .62, .9):
        z = u * length; r = r_throat + (r_exit - r_throat) * (u ** .7)
        revolve(k, [(z - .03 * length, r + .002), (z - .03 * length, r + .045 * r_exit + .01), (z + .03 * length, r + .045 * r_exit + .01), (z + .03 * length, r + .002)], c, n, segs, shade(color, 1.25))
    if glow is not None:
        revolve(k, [(.06 * length, 0), (.06 * length, r_throat * .98), (.08 * length, r_throat * .98), (.08 * length, 0)], c, n, segs, glow, mat=LAMP, closed=False)

def cap_tank(k, c, r, length, n=(0, 0, 1), color=BONE, bands=3, band=SLATE, segs=24):
    """a pressure tank: cylinder with elliptical domes, banded"""
    prof = [(-length / 2 - r * .6, 0)]
    for i in range(1, 5):
        a = i / 4 * math.pi / 2; prof.append((-length / 2 - r * .6 * math.cos(a), r * math.sin(a)))
    for i in range(0, 5):
        a = i / 4 * math.pi / 2; prof.append((length / 2 + r * .6 * math.sin(a), r * math.cos(a)))
    revolve(k, prof, c, n, segs, color, closed=False)
    for i in range(bands):
        z = -length / 2 + length * (i + .5) / bands
        revolve(k, [(z - .04 * r, r * .99), (z - .04 * r, r * 1.04), (z + .04 * r, r * 1.04), (z + .04 * r, r * .99)], c, n, segs, band)

def ring_tube(k, c, R, r, n=(0, 0, 1), segs=28, color=SLATE_L, sides=8):
    """torus as a revolved circle"""
    prof = [(r * math.sin(2 * math.pi * i / sides), R + r * math.cos(2 * math.pi * i / sides)) for i in range(sides)]
    revolve(k, prof, c, n, segs, color)


# ---- wings and fins ----------------------------------------------------------------------------
def foil(chord, thick, n=10):
    """symmetric NACA-ish section, points round from the trailing edge, upper first. (u along chord, v up)"""
    pts = []
    for i in range(n + 1):
        x = 1 - (i / n) ** 1.6; pts.append((x, 1))
    up = []
    for i in range(n + 1):
        x = (1 - math.cos(math.pi * i / n)) / 2
        yt = 5 * thick * (.2969 * math.sqrt(x) - .126 * x - .3516 * x * x + .2843 * x ** 3 - .1036 * x ** 4)
        up.append((x * chord, yt * chord))
    lo = [(x, -y) for x, y in up]
    ring = list(reversed(up[1:])) + lo[:-1]   # TE..LE on top, LE..TE underneath
    return ring

def wing(S, root, span, c_root, c_tip, sweep, dihedral, thick, color, side=1, n=10, steps=6, vertical=False, twist=0.0):
    """root = leading edge at the root. Chord along +z (aft). span along +-x (or +y for a fin)."""
    k = S.k; rings = []; M = k.stack[-1]
    for i in range(steps + 1):
        u = i / steps
        ch = c_root + (c_tip - c_root) * u
        s = span * u
        le = Vector(root) + Vector((0, 0, s * math.tan(sweep)))
        sec = foil(ch, thick * (1 - .25 * u), n)
        ring = []
        for a, b in sec:
            if vertical: p = le + Vector((b, s, a))
            else: p = le + Vector((side * s, s * math.tan(dihedral) + b, a))
            ring.append(M @ p)
        rings.append(ring)
    k.rings(rings, color, cap0=True, cap1=True, wear=0)
    # colliders: a thin box per half span
    for i in range(2):
        u0, u1 = i / 2, (i + 1) / 2; um = (u0 + u1) / 2
        ch = c_root + (c_tip - c_root) * um; s = span * um
        le = Vector(root) + Vector((0, 0, s * math.tan(sweep)))
        if vertical: S.box_col(M @ (le + Vector((0, s, ch / 2))), (thick * ch * .7 + .05, span / 4, ch / 2))
        else: S.box_col(M @ (le + Vector((side * s, s * math.tan(dihedral), ch / 2))), (span / 4, thick * ch * .7 + .05, ch / 2))
    tip = Vector(root) + (Vector((0, span, span * math.tan(sweep) + c_tip * .5)) if vertical else Vector((side * span, span * math.tan(dihedral), span * math.tan(sweep) + c_tip * .5)))
    return M @ tip

def wing_color(base, accent, tipband=.12, span=1.0, root_x=0.0, edge=None):
    def f(p, n):
        r = hsh(int(p.x * 3), int(p.z * 3))
        s = (abs(p.x) - root_x) / max(span, 1e-3)
        if s > 1 - tipband: return accent
        return shade(base, .94 + .1 * r)
    return f


# ---- bits ----------------------------------------------------------------------------------------
def canopy(S, z, y, w, h, l, frame=SLATE_D):
    """bubble canopy: half ellipsoid of glass with a frame lip and a centre bow"""
    k = S.k
    # glass: revolve a quarter-ellipse profile into a dome, then squash
    before = set(k.bm.faces)
    segs = 24; prof = [(math.cos(a) * 1.0, math.sin(a) * 1.0) for a in [i / 8 * math.pi / 2 for i in range(9)]]
    # dome over the xz footprint, apex up
    V = []
    for zz, rr in prof:
        V.append([k.bm.verts.new((rr * w * math.cos(2 * math.pi * j / segs), zz * h + y - h * .02, rr * l * math.sin(2 * math.pi * j / segs) + z)) for j in range(segs)])
    faces = []
    for i in range(len(V) - 1):
        for j in range(segs):
            jj = (j + 1) % segs
            try: faces.append(k.bm.faces.new((V[i][j], V[i][jj], V[i + 1][jj], V[i + 1][j])))
            except ValueError: pass
    k.bm.normal_update()
    flip = [f for f in faces if f.normal.y < -0.05 or (f.calc_center_median() - Vector((0, y, z))).dot(f.normal) < 0]
    bmesh.ops.reverse_faces(k.bm, faces=flip)
    k._finish(before, 0x0c1218, GLASS, 0)
    # frame: a lip round the base and a bow across the top
    for j in range(16):
        a0, a1 = 2 * math.pi * j / 16, 2 * math.pi * (j + 1) / 16
        p0 = Vector((w * math.cos(a0), y, z + l * math.sin(a0))); p1 = Vector((w * math.cos(a1), y, z + l * math.sin(a1)))
        beam(k, p0, p1, .07 * max(w, .6), frame)
    for i in range(6):
        a0, a1 = math.pi * i / 6, math.pi * (i + 1) / 6
        p0 = Vector((0, y + h * math.sin(a0), z + l * math.cos(a0) * 1.0)); p1 = Vector((0, y + h * math.sin(a1), z + l * math.cos(a1)))
        beam(k, p0, p1, .06 * max(w, .6), frame)

def window_row(S, H, z0, z1, yn, step, size, side=(1, -1), color=0xffd9a0, lit=.5, dark=0x161a20):
    """little windows along the flank at height yn (fraction of half height); some lit"""
    k = S.k; z = z0
    while z <= z1:
        for sd in side:
            t = math.asin(max(-1, min(1, yn))) if sd > 0 else math.pi - math.asin(max(-1, min(1, yn)))
            p = H.pt(t, z); n = H.normal(t, z)
            on = S.rng.random() < lit
            k.box(tuple(p + n * .01), (size, size * 1.6, .06), color if on else dark, rot=skin_rot(n), mat=LAMP if on else HULL, wear=0)
        z += step

def greeble_hull(S, H, n, z0, z1, tmin=.2, tmax=2.9, size=.5, cols=None, both=True):
    """service detail on the hull skin, each piece seated on the surface along its normal: flush access hatches
    with a dark frame and a handle, louvred vents, and a few equipment housings"""
    k = S.k
    for _ in range(int(n * LOD['greeble'])):
        z = S.rng.uniform(z0, z1); t = S.rng.uniform(tmin, tmax)
        if both and S.rng.random() < .5: t = math.pi - t
        p = H.pt(t, z); nn = H.normal(t, z)
        sw, sl, sh = size * S.rng.uniform(.5, 1.6), size * S.rng.uniform(.6, 2.4), size * S.rng.uniform(.12, .5)
        rot = skin_rot(nn)
        col = S.rng.choice(cols) if cols else None
        base = H.paint(p, nn) if hasattr(H, 'paint') else BONE_D
        if col is None: col = shade(base, S.rng.choice((.78, .86, 1.08)))
        kind = S.rng.random()
        with k.at(tuple(p), rot):
            if kind < .45:
                # access hatch: dark recess frame, a plate just proud of it, a grab handle
                fh = max(.02, size * .05)
                k.box((0, 0, fh * .5 - .02 * size), (sw * 1.08, sl * 1.08, fh), shade(base, .42), wear=0)
                k.box((0, 0, fh * 1.2 - .02 * size), (sw * .94, sl * .94, fh), shade(base, 1.04), bevel=fh * .3)
                k.box((0, sl * .3, fh * 1.9 - .02 * size), (sw * .3, size * .06, size * .06), SLATE_D, wear=0)
            elif kind < .75:
                # vent: a shallow housing with a row of louvres
                vh = sh * .45
                k.box((0, 0, vh / 2 - .02 * size), (sw, sl, vh), col, bevel=min(.04, vh * .3) * size)
                nl = max(3, min(6, int(sl / (size * .26))))
                for i in range(nl):
                    y = -sl * .4 + sl * .8 * (i + .5) / nl
                    k.box((0, y, vh + size * .01), (sw * .8, sl * .8 / nl * .45, size * .05), shade(base, .35), rot=(30, 0, 0), wear=0)
            else:
                # equipment housing with a cap plate
                k.box((0, 0, sh / 2 - .02 * size), (sw, sl, sh), col, bevel=min(.04, sh * .3) * size)
                k.box((0, 0, sh), (sw * .7, sl * .6, size * .05), shade(col, .8), wear=0)

def ribs_and_conduits(S, H, bands=0, conduit_sides=(1, -1), skipz=None):
    """structure on the skin: raised frame bands round the hull at intervals, and a pair of conduits with
    clamps running down the upper flanks. Everything follows the loft's own surface."""
    k = S.k; L = H.z1 - H.z0
    mid = H.at((H.z0 + H.z1) / 2); Rm = max(.3, min(mid[0], mid[1]))
    nb = bands or max(3, min(9, int(L / (Rm * 2.4))))
    paint = getattr(H, 'paint', None)
    col = (lambda c, n: shade(paint(c, n), .66)) if paint else shade(BONE_D, .7)
    for i in range(nb):
        z = H.z0 + L * (.18 + .7 * i / max(1, nb - 1))
        if skipz and skipz(z): continue
        if H.hump and (H.hump(z - L * .02, 0) > .01 or H.hump(z + L * .02, 0) > .01): continue
        w, h, _, yc = H.at(z); R = min(w, h); th = max(.025, R * .022); bw = max(.06, R * .05)
        rs = []
        for dz, off in ((-bw, -th * .6), (-bw * .6, th), (bw * .6, th), (bw, -th * .6)):
            ring = []
            for j in range(H.segs):
                t = 2 * math.pi * j / H.segs
                ring.append(H.pt(t, z + dz) + H.normal(t, z + dz) * off)
            rs.append(ring)
        k.rings(rs, col, wear=0)
    for sd in conduit_sides:
        t = .42 if sd > 0 else math.pi - .42
        z0, z1 = H.z0 + L * .22, H.z1 - L * .12
        n = max(8, int((z1 - z0) / max(.6, Rm * .5)))
        w, h, _, _ = H.at((z0 + z1) / 2); r = max(.035, min(w, h) * .03)
        pts = [H.pt(t, z0 + (z1 - z0) * i / n) + H.normal(t, z0 + (z1 - z0) * i / n) * (r * 1.2) for i in range(n + 1)]
        for i in range(n):
            if skipz and skipz((pts[i].z + pts[i + 1].z) / 2): continue
            k.link(tuple(pts[i]), tuple(pts[i + 1] + (pts[i + 1] - pts[i]).normalized() * r * .5), r, r, SLATE)
            if i % 3 == 0:
                nn = H.normal(t, pts[i].z)
                k.box(tuple(pts[i] - nn * r * .3), (r * 3.2, r * 3.2, r * 1.4), SLATE_D, rot=skin_rot(nn), wear=0)

def rcs_quad(S, c, n, s=.25, color=SLATE_L):
    k = S.k; k.box(tuple(c), (s, s, s * .8), color, rot=rot_to(n), bevel=s * .1)
    nn = Vector(n).normalized()
    for d in ((1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, -1)):
        dv = Vector(d) - nn * nn.dot(Vector(d))
        if dv.length < .2: continue
        dv.normalize(); k.cyl(tuple(Vector(c) + dv * s * .6), s * .14, s * .2, s * .35, 'z', 8, SLATE_D, rot=rot_to(dv))

def nav(S, c, color, size=.15):
    S.k.lamp(tuple(c), (size, size, size), color); S.lights.append({'p': list(c), 'c': color})

def collar(S, c, n=(0, 1, 0), r=1.3, kind='collar'):
    """docking collar: a ring with an orange band, clamp pads and guide lamps. The jet docks on it."""
    k = S.k; nn = Vector(n).normalized(); c = Vector(c)
    revolve(k, [(0, r * .7), (0, r * 1.15), (.35, r * 1.15), (.45, r * 1.0), (.45, r * .78), (.1, r * .7)], c, nn, 28, SLATE)
    revolve(k, [(.2, r * 1.16), (.2, r * 1.2), (.34, r * 1.2), (.34, r * 1.16)], c, nn, 28, HAZ)
    revolve(k, [(.02, 0), (.02, r * .72), (.06, r * .72), (.06, 0)], c, nn, 20, SLATE_D, closed=False)
    for j in range(4):
        a = j * math.pi / 2 + math.pi / 4
        u = (Vector((1, 0, 0)) if abs(nn.x) < .9 else Vector((0, 0, 1))); u = (u - nn * nn.dot(u)).normalized(); v = nn.cross(u)
        d = u * math.cos(a) + v * math.sin(a)
        k.box(tuple(c + d * r * 1.05 + nn * .5), (.28 * r, .28 * r, .3 * r), BONE_D, rot=rot_to(nn), bevel=.03)
        k.lamp(tuple(c + d * r * 1.22 + nn * .3), (.12, .12, .12), AMBER)
    S.anchor[kind] = {'p': list(c + nn * .45), 'n': list(nn)}

def dish(S, c, r, n, color=BONE):
    k = S.k; prof = []
    for i in range(8):
        u = i / 7; prof.append((r * .35 * u * u, r * u))
    inner = [(z + r * .03, rr * .97) for z, rr in reversed(prof)]
    revolve(k, prof + inner, c, n, 24, color)
    nn = Vector(n).normalized(); k.link(tuple(Vector(c)), tuple(Vector(c) + nn * r * .7), r * .03, r * .02, SLATE_D)
    k.link(tuple(Vector(c) - nn * r * .6), tuple(Vector(c)), r * .06, r * .05, SLATE)

def container(S, c, s, color, stripe=HAZ, col=True):
    k = S.k
    k.box(c, s, color, bevel=min(s) * .04)
    # corrugation and end frames
    n = max(2, int(s[2] / (min(s[0], s[1]) * .35)))
    for i in range(n):
        z = c[2] - s[2] / 2 + s[2] * (i + .5) / n
        k.box((c[0], c[1], z), (s[0] * 1.015, s[1] * 1.015, s[2] / n * .18), shade(color, .8), wear=0)
    for sz in (-1, 1):
        k.box((c[0], c[1], c[2] + sz * s[2] / 2), (s[0] * 1.05, s[1] * 1.05, s[2] * .03), SLATE_D, wear=0)
    k.box((c[0], c[1] + s[1] * .505, c[2]), (s[0] * .25, s[1] * .01, s[2] * .9), stripe, wear=0)
    if col: S.box_col(c, (s[0] / 2, s[1] / 2, s[2] / 2))

def truss(S, z0, z1, W, yc=0, xc=0, bay=None, color=BONE_D, t=None):
    k = S.k; L = z1 - z0; bay = bay or W * 1.6; t = t or W * .14
    n = max(1, int(L / bay))
    for sx in (-1, 1):
        for sy in (-1, 1): k.box((xc + sx * W, yc + sy * W, (z0 + z1) / 2), (t, t, L), color, bevel=t * .1)
    for i in range(n + 1):
        z = z0 + i * L / n
        for a, b in (((-W, -W), (W, -W)), ((-W, W), (W, W)), ((-W, -W), (-W, W)), ((W, -W), (W, W))):
            beam(k, (xc + a[0], yc + a[1], z), (xc + b[0], yc + b[1], z), t * .8, color)
    for i in range(n):
        za, zb = z0 + i * L / n, z0 + (i + 1) * L / n; s = 1 if i % 2 else -1
        for sx in (-1, 1): beam(k, (xc + sx * W, yc - s * W, za), (xc + sx * W, yc + s * W, zb), t * .6, RUST)
        for sy in (-1, 1): beam(k, (xc - s * W, yc + sy * W, za), (xc + s * W, yc + sy * W, zb), t * .6, SLATE_L)
    S.box_col((xc, yc, (z0 + z1) / 2), (W + t, W + t, L / 2))

def radiator(S, root, length, width, side=1, n=8, color=0x8c8f92, rib=SLATE_D, axis='x', hot=False):
    """a thin radiator fin out from root along +-x (axis x) or +y: panels between dark ribs"""
    k = S.k; r = Vector(root)
    d = Vector((side, 0, 0)) if axis == 'x' else Vector((0, side, 0))
    thick = max(.04, width * .012)
    for i in range(n):
        u0, u1 = i / n, (i + 1) / n
        c = r + d * length * (u0 + u1) / 2
        sz = (length / n * .94, thick, width) if axis == 'x' else (thick * 1.0, length / n * .94, width)
        k.box(tuple(c), sz, shade(color, .92 + .12 * S.rng.random()), wear=.05)
        rc = r + d * length * u1
        k.box(tuple(rc), ((length / n * .06, thick * 2.4, width * 1.02) if axis == 'x' else (thick * 2.4, length / n * .06, width * 1.02)), rib)
    k.link(tuple(r), tuple(r + d * length), width * .03, width * .02, SLATE)
    c = r + d * length / 2
    S.box_col(tuple(c), ((length / 2, thick * 2, width / 2) if axis == 'x' else (thick * 2, length / 2, width / 2)))

def turret(S, c, r, n=(0, 1, 0), barrels=2, color=SLATE_L):
    k = S.k; nn = Vector(n).normalized(); c = Vector(c)
    revolve(k, [(0, r), (r * .5, r * .95), (r * .7, r * .7), (r * .78, 0)], c, nn, 20, color, closed=False)
    revolve(k, [(-r * .15, r * 1.1), (0, r * 1.1), (0, r * .9)], c, nn, 20, SLATE_D, closed=False)
    for b in range(barrels):
        x = (b - (barrels - 1) / 2) * r * .45
        p = c + nn * r * .45 + Vector((x, 0, 0))
        k.link(tuple(p), tuple(p + Vector((0, 0, -r * 2.2))), r * .12, r * .09, SLATE_D)
        k.cyl(tuple(p + Vector((0, 0, -r * 2.2))), r * .14, r * .14, r * .3, 'z', 10, SLATE_D)


def shell(S, H, z0, z1, dz, sectors, thick, rooms=()):
    """colliders hugging the skin: one box per (slab, sector), outer face on the surface. Boxes whose centre is
    inside a room are dropped, so walkable interiors stay clear."""
    z = z0
    while z < z1 - 1e-6:
        za, zb = z, min(z1, z + dz); zm = (za + zb) / 2
        for j in range(sectors):
            t0, t1 = 2 * math.pi * j / sectors, 2 * math.pi * (j + 1) / sectors; tm = (t0 + t1) / 2
            p = H.pt(tm, zm); n = H.normal(tm, zm)
            a, b = H.pt(t0, zm), H.pt(t1, zm)
            wdt = (a - b).length * 1.12 + 1
            c = p - n * thick / 2
            if any(r[0][0] - .5 < c.x < r[1][0] + .5 and r[0][1] - .5 < c.y < r[1][1] + .5 and r[0][2] - .5 < c.z < r[1][2] + .5 for r in rooms): continue
            # box frame: local z = normal, x = along the section, y = along the hull
            tang = (b - a).normalized(); ax = Vector((0, 0, 1)); nz = n.normalized()
            xx = (tang - nz * tang.dot(nz)).normalized(); yy = nz.cross(xx)
            m = Matrix((xx, yy, nz)).transposed(); q = m.to_quaternion()
            S.box_col(tuple(c), (wdt / 2, min(dz * 2, (zb - za) / 2 * 1.05 / max(.3, abs(yy.z))), thick / 2), (q.x, q.y, q.z, q.w))
        z += dz

# Ironwake rooms (min, max), the same numbers as src/ironwake.js: hull colliders keep out of these
T_ = .35
ROOMS = [((29.65, -16.35, -470.35), (75.35, 16.35, -409.65)),      # bay (with its walls)
         ((25.1, -15.2, -442.2), (29.9, -10.8, -437.8)),           # airlock
         ((5.0, -15, -442), (25.5, -11, -438)),                    # corridor
         ((-5.4, -15.4, -445.4), (5.4, -10.6, -434.6)),             # junction
         ((-7.4, -15.9, -435), (7.4, -9.1, -420.3)),               # mess
         ((-8.4, -15.9, -459.7), (8.4, -9.1, -445)),               # engineering
         ((-2.1, -11, -442.1), (2.1, 58.4, -437.9)),               # shaft
         ((-4.4, 57.6, -444.4), (4.4, 62.4, -435.6)),              # lobby
         ((-1.9, 58.1, -455), (1.9, 61.9, -444)),                  # bridge corridor
         ((-14.4, 56.6, -475.1), (14.4, 65.4, -454.3))]            # bridge

# ============================================================================================
# The designs
# ============================================================================================
DESIGNS = {}
def design(fn): DESIGNS[fn.__name__] = fn; return fn

def finish_common(S, H, zs_probe=None):
    """hull colliders as boxes along its length, plus probe spheres for ship-vs-world contacts"""
    z = H.z0; L = H.z1 - H.z0; n = max(4, int(L / max(1.0, max(H.at((H.z0 + H.z1) / 2)[0], H.at((H.z0 + H.z1) / 2)[1]) * 1.6)))
    for i in range(n):
        za, zb = H.z0 + L * i / n, H.z0 + L * (i + 1) / n; zm = (za + zb) / 2
        w, h, nn, yc = H.at(zm)
        hy = h + (H.hump(zm, 0) if H.hump else 0) * .5
        S.box_col((0, yc + (H.hump(zm, 0) * .5 if H.hump else 0) * .5, zm), (w * .93, hy * .93, (zb - za) / 2))
        S.probes.append([0, yc, zm, max(.4, min(w, h) * 1.0)])
        if w > h * 1.6:
            for sx in (-1, 1): S.probes.append([sx * (w - h * .9), yc, zm, max(.4, h * .9)])


# ---- 1. Wren: two-seat shuttle (yard) ------------------------------------------------------------
@design
def wren():
    S = Ship('wren', 11, .45); k = S.k
    tab = [(-7, .18, .16, 2.2, .1), (-6.2, .7, .6, 2.4, .05), (-4.6, 1.25, 1.05, 2.8, 0), (-1.5, 1.55, 1.3, 3.4, 0), (2.5, 1.6, 1.3, 3.6, 0), (5.6, 1.35, 1.1, 3.2, .05), (6.6, 1.05, .9, 3.0, .08)]
    H = Hull(tab, 36, bot=.85, shoulder=.12, chine=.16, ridge=.06)
    seams = [-4.6, -1.5, 1.2, 4.2]
    liv = livery(H, 0xd9d2c0, belly=0x5b6670, accent=0x2f8fb0, cell=1.2, seams=seams, tipz=-6.7, tip=SLATE_D,
                 stripe=lambda p, yn: abs(yn) < .12 and -3.2 < p.z < 5.2, windows=lambda p, yn: .25 < yn < .55 and -1.2 < p.z < 2.6 and int((p.z + 9) / .65) % 2 == 0)
    skin(S, H, stations(-7, 6.6, .25, [s + d for s in seams for d in (-.03, .03)]), liv)
    canopy(S, -3.4, .78, .95, .62, 1.5)
    # stub wings with engine pods
    for sd in (-1, 1):
        wing(S, (sd * 1.2, -.35, .6), 2.1, 2.4, 1.2, math.radians(28), math.radians(-4), .12, wing_color(0xc8c0ae, 0x2f8fb0, span=2.1, root_x=1.2), sd)
        pc = Vector((sd * 3.1, -.5, 2.6))
        revolve(k, [(-1.4, 0), (-1.3, .25), (-.8, .42), (1.1, .44), (1.5, .38)], pc, (0, 0, 1), 20, 0xbab3a1, closed=False)
        bell(k, pc + Vector((0, 0, 1.45)), .26, .36, .55, segs=18, glow=0x5a2a10)
        S.nozzles.append({'p': list(pc + Vector((0, 0, 2.0))), 'r': .34})
        nav(S, (sd * 3.35, -.5, 1.1), GREEN if sd > 0 else RED, .1)
    bell(k, (0, 0, 6.55), .45, .62, .7, segs=20, glow=0x5a2a10); S.nozzles.append({'p': [0, 0, 7.25], 'r': .6})
    for sz in (-5.4, 4.8):
        for sd in (-1, 1): rcs_quad(S, H.pt(math.pi / 2 - sd * 1.1, sz) + Vector((0, 0, 0)), H.normal(math.pi / 2 - sd * 1.1, sz), .2)
    greeble_hull(S, H, 26, -4, 6, .4, 1.4, .3)
    collar(S, (0, H.pt(math.pi / 2, 2.6).y - .05, 2.6), (0, 1, 0), 1.0)
    k.link((0, 1.3, 4.6), (0, 2.4, 5.2), .03, .02, SLATE_D); nav(S, (0, 2.42, 5.22), WHITE, .08)
    S.anchor['eye'] = {'p': [0, 1.15, -3.6]}
    ribs_and_conduits(S, H, 3, (), lambda z: z < -1.6 or 1.4 < z < 3.8)
    finish_common(S, H); return S, H


# ---- 2. Kite: fast courier (yard) -----------------------------------------------------------------
@design
def kite():
    S = Ship('kite', 12, .5); k = S.k
    tab = [(-10, .1, .08, 2.0, 0), (-8.6, .55, .38, 2.2, 0), (-5.5, 1.2, .78, 2.6, 0), (-1, 1.5, .95, 3.0, 0), (4, 1.45, .9, 3.0, 0), (8.5, 1.1, .75, 2.8, 0), (10, .95, .7, 2.6, 0)]
    H = Hull(tab, 36, bot=.7, shoulder=.18, chine=.22, ridge=.08)
    seams = [-5.5, -2, 2, 6]
    liv = livery(H, 0x2e3a44, belly=0x1b232a, accent=0xe8c24a, cell=1.1, seams=seams, tipz=-9.6, tip=0x111418, stripe=lambda p, yn: .05 < yn < .2 and p.z > -6)
    skin(S, H, stations(-10, 10, .3, [s + d for s in seams for d in (-.03, .03)]), liv)
    canopy(S, -5.2, .62, .7, .5, 1.7)
    for sd in (-1, 1):
        tip = wing(S, (sd * 1.0, -.15, -2.5), 5.2, 6.5, 1.1, math.radians(48), math.radians(3), .08, wing_color(0x34424e, 0xe8c24a, span=5.2, root_x=1.0), sd, steps=7)
        nav(S, tip, GREEN if sd > 0 else RED, .12)
        # canted tail fins
        with k.at((sd * .8, .5, 6.0), (0, 0, -sd * 25)):
            wing(S, (0, 0, 0), 1.9, 2.3, .8, math.radians(42), 0, .09, wing_color(0x34424e, 0xe8c24a, span=1.9), 1, vertical=True)
    for sd in (-1, 1):
        bell(k, (sd * .55, 0, 9.95), .36, .5, .7, segs=18, glow=0x6a3a18); S.nozzles.append({'p': [sd * .55, 0, 10.65], 'r': .48})
    greeble_hull(S, H, 30, -6, 9, .3, 1.2, .3)
    collar(S, (0, H.pt(math.pi / 2, 2.0).y - .05, 2.0), (0, 1, 0), .9)
    S.anchor['eye'] = {'p': [0, 1.0, -5.5]}
    ribs_and_conduits(S, H, 3, (), lambda z: z < -3.2 or 0.8 < z < 3.2)
    finish_common(S, H); return S, H


# ---- 3. Hornet: interceptor (yard) ------------------------------------------------------------------
@design
def hornet():
    S = Ship('hornet', 13, .55); k = S.k
    tab = [(-12, .1, .1, 2, 0), (-10, .6, .5, 2.2, 0), (-6, 1.3, .95, 2.6, 0), (-1, 1.7, 1.15, 3.2, 0), (5, 1.6, 1.1, 3.4, 0), (10, 1.5, 1.05, 3.2, 0), (12, 1.35, 1.0, 3.0, 0)]
    H = Hull(tab, 40, bot=.8, shoulder=.15, keel=.25, chine=.2, ridge=.1)
    seams = [-6, -2.5, 1.5, 5.5, 9]
    liv = livery(H, 0x8d4a32, belly=0x2a2624, accent=0xe2dac4, cell=1.2, seams=seams, tipz=-11.6, tip=0x111418, stripe=lambda p, yn: yn > .82 and abs(p.x) < .35)
    skin(S, H, stations(-12, 12, .3, [s + d for s in seams for d in (-.03, .03)]), liv)
    canopy(S, -6.2, .8, .78, .58, 1.9)
    for sd in (-1, 1):
        tip = wing(S, (sd * 1.4, -.1, -3.5), 6.5, 9.0, 1.4, math.radians(55), math.radians(-6), .07, wing_color(0x7d4230, 0xe2dac4, span=6.5, root_x=1.4), sd, steps=8)
        nav(S, tip, GREEN if sd > 0 else RED, .14)
        # wingtip cannon
        k.link(tuple(tip + Vector((0, 0, -2.6))), tuple(tip + Vector((0, 0, 1.0))), .14, .11, SLATE_D)
        # intakes
        revolve(k, [(-1.2, .55), (-1.2, .62), (1.8, .66), (2.2, .5), (2.2, .2), (-1.0, .45)], (sd * 1.75, -.35, -1.0), (0, 0, 1), 18, 0x6f3a28)
        # twin fins
        with k.at((sd * 1.25, .6, 7.5), (0, 0, -sd * 12)):
            wing(S, (0, 0, 0), 2.6, 3.4, 1.0, math.radians(45), 0, .08, wing_color(0x7d4230, 0xe2dac4, span=2.6), 1, vertical=True)
    for sd in (-1, 1):
        bell(k, (sd * .75, -.1, 11.9), .5, .66, .9, segs=20, glow=0x6a3a18); S.nozzles.append({'p': [sd * .75, -.1, 12.8], 'r': .64})
    greeble_hull(S, H, 40, -7, 11, .3, 1.3, .35)
    collar(S, (0, H.pt(math.pi / 2, 2.5).y - .05, 2.5), (0, 1, 0), 1.0)
    S.anchor['eye'] = {'p': [0, 1.25, -6.5]}
    ribs_and_conduits(S, H, 4, (), lambda z: z < -4 or 1.2 < z < 3.8)
    finish_common(S, H); return S, H


# ---- 4. Mule: deep-space tug (yard) ---------------------------------------------------------------
@design
def mule():
    S = Ship('mule', 14, 1.1); k = S.k
    tab = [(-21, 1.0, 1.0, 2.0, 1), (-19.5, 3.4, 3.0, 3.0, 1), (-16, 4.6, 3.9, 4.0, 1), (-9, 4.8, 4.1, 4.4, .8), (-4, 3.4, 3.2, 3.4, .5), (6, 3.3, 3.1, 3.2, .5), (14, 5.2, 4.6, 4.6, .5), (19, 5.4, 4.8, 4.6, .5), (21, 4.8, 4.3, 4.0, .5)]
    H = Hull(tab, 44, bot=.9, shoulder=.08, chine=.06)
    seams = [-16, -12, -9, -4, 1, 6, 10, 14, 18]
    liv = livery(H, 0xe1a73a, belly=0x3b3732, accent=0x15171b, cell=2.0, seams=seams, seamw=.05, tipz=-20.6, tip=SLATE_D,
                 stripe=lambda p, yn: (-9 < p.z < -4.5 and int((p.z + p.y * .8) / .9) % 2 == 0) or (-3.5 < p.z < 6 and abs(yn) < .2),
                 windows=lambda p, yn: .3 < yn < .62 and -19.6 < p.z < -16.6 and abs(p.x) < 3.2)
    skin(S, H, stations(-21, 21, .5, [s + d for s in seams for d in (-.05, .05)]), liv)
    # big push plate on the nose with bumpers
    revolve(k, [(0, 0), (0, 3.2), (.4, 3.4), (1.2, 3.4), (1.6, 2.8), (1.6, 0)], (0, 1, -21.2), (0, 0, -1), 32, SLATE_D, closed=False)
    for j in range(8):
        a = j * math.pi / 4; c = Vector((math.cos(a) * 2.6, 1 + math.sin(a) * 2.6, -22.9))
        k.box(tuple(c), (.9, .9, .5), 0x15171b, bevel=.08)
    # grapple arms under the nose
    for sd in (-1, 1):
        a0 = Vector((sd * 2.6, -2.6, -14)); a1 = Vector((sd * 3.6, -3.4, -22)); a2 = Vector((sd * 1.6, -3.0, -26))
        k.link(tuple(a0), tuple(a1), .5, .42, SLATE_L); k.link(tuple(a1), tuple(a2), .4, .3, SLATE_L)
        k.box(tuple(a2 + Vector((0, 0, -.4))), (1.2, .9, 1.2), HAZ, bevel=.1)
        k.cyl(tuple(a1), .55, .55, .9, 'x', 14, SLATE_D)
    # engine block: four big bells, tanks either side
    for sx in (-1, 1):
        for sy in (-1, 1):
            bell(k, (sx * 2.3, .5 + sy * 2.1, 20.9), .95, 1.45, 2.4, segs=22, glow=0x6a3a18)
            S.nozzles.append({'p': [sx * 2.3, .5 + sy * 2.1, 23.3], 'r': 1.4})
        cap_tank(S.k, (sx * 6.6, .5, 12), 2.0, 9, (0, 0, 1), 0xd4c8b0, 3, SLATE)
        k.link((sx * 5.0, .5, 9), (sx * 4.6, .5, 9), .5, .5, SLATE_D); k.link((sx * 5.0, .5, 15), (sx * 4.8, .5, 15), .5, .5, SLATE_D)
        S.box_col((sx * 6.6, .5, 12), (2.0, 2.0, 6.3))
        nav(S, (sx * 8.7, .5, 12), GREEN if sx > 0 else RED, .25)
    # winch drum on the back
    k.cyl((0, 5.2, 15), 1.1, 1.1, 4.2, 'x', 20, SLATE_L); k.cyl((0, 5.2, 15), 1.25, 1.25, .25, 'x', 20, HAZ)
    for sx in (-1, 1): k.box((sx * 2.2, 4.6, 15), (.3, 1.8, 2.4), SLATE_D)
    for z in (-12, 0, 8):
        for sd in (-1, 1): rcs_quad(S, H.pt(math.pi / 2 - sd * .7, z), H.normal(math.pi / 2 - sd * .7, z), .5)
    greeble_hull(S, H, 70, -15, 19, .2, 1.5, .7)
    window_row(S, H, -15, -10, .55, 1.2, .25, lit=.3)
    k.link((0, 4.4, -12), (0, 7.5, -12), .08, .05, SLATE_D); nav(S, (0, 7.55, -12), WHITE, .2)
    dish(S, (2.4, 4.3, -6), 1.1, (0.3, 1, -.3))
    collar(S, (0, H.pt(math.pi / 2, 2).y - .1, 2), (0, 1, 0), 1.4)
    S.anchor['eye'] = {'p': [0, 4.4, -19.8]}
    ribs_and_conduits(S, H, 0, (1, -1), lambda z: z < -15.5 or 0 < z < 4)
    finish_common(S, H); return S, H


# ---- 5. Packhorse: light freighter (yard) ------------------------------------------------------------
@design
def packhorse():
    S = Ship('packhorse', 15, 1.6); k = S.k
    tab = [(-29, .5, .5, 2.0, 2), (-27, 3.0, 2.6, 2.8, 2), (-22, 4.4, 3.6, 3.6, 2), (-17, 4.4, 3.6, 3.6, 2), (-14, 2.4, 2.2, 3.0, 1.2), (24, 2.4, 2.2, 3.0, 1.2), (26, 4.2, 3.8, 3.6, 1.2), (29, 4.0, 3.6, 3.6, 1.2)]
    H = Hull(tab, 36, bot=.9, shoulder=.1)
    seams = [-22, -17, 24]
    liv = livery(H, 0xb7c0bd, belly=0x46505a, accent=0x2a6b74, cell=2.2, seams=seams, seamw=.06, tipz=-28.7, tip=SLATE_D,
                 stripe=lambda p, yn: abs(yn) < .16 and p.z < -17, windows=lambda p, yn: .3 < yn < .6 and -27.4 < p.z < -24.2)
    skin(S, H, stations(-29, 29, .7, [s + d for s in seams for d in (-.06, .06)]), liv)
    # cargo frame: two rows of containers each side of the spine, four along
    cols = [0x8a3b2a, 0x2a6b74, 0xc9b98f, 0x50606c, 0xb05a2a, 0x7c8a5a]
    for i in range(5):
        z = -9 + i * 6.8
        for sx in (-1, 1):
            for sy in (-1, 1):
                if hsh(i, sx, sy, 3) < .12: continue
                container(S, (sx * 3.3, 1.2 + sy * 2.1, z), (3.6, 3.6, 6.2), cols[int(hsh(i, sx, sy) * len(cols))])
        for sx in (-1, 1): k.box((sx * 3.3, 1.2, z - 3.35), (8.0, .35, .35), SLATE_D)
        k.box((0, 1.2, z - 3.35), (.35, 8.6, .35), SLATE_D)
    for sx in (-1, 1):
        for sy in (-1, 1): k.box((sx * 5.5, 1.2 + sy * 4.3, 7.5), (.4, .4, 38), BONE_D, bevel=.05)
    for sx in (-1, 1):
        bell(k, (sx * 1.8, 1.2, 28.9), 1.1, 1.6, 2.6, segs=22, glow=0x6a3a18); S.nozzles.append({'p': [sx * 1.8, 1.2, 31.5], 'r': 1.55})
        radiator(S, (sx * 4.0, 1.2, 26.5), 7, 3.0, sx, n=6)
        nav(S, (sx * 11.2, 1.2, 26.5), GREEN if sx > 0 else RED, .25)
    canopy(S, -23.5, 4.9, 1.6, 1.1, 2.6)
    greeble_hull(S, H, 40, -26, -15, .3, 1.5, .6)
    greeble_hull(S, H, 25, 24, 29, .3, 1.5, .6)
    window_row(S, H, -21.5, -17.5, .1, 1.0, .3, lit=.5)
    for z in (-24, 27):
        for sd in (-1, 1): rcs_quad(S, H.pt(math.pi / 2 - sd * .8, z), H.normal(math.pi / 2 - sd * .8, z), .5)
    dish(S, (0, 6.8, -15.5), 1.3, (0, 1, .3))
    collar(S, (0, H.pt(math.pi / 2, -19).y - .1, -19.6), (0, 1, 0), 1.4)
    S.anchor['eye'] = {'p': [0, 6.4, -24.8]}
    ribs_and_conduits(S, H, 0, (), lambda z: z < -16 or z > 23)
    finish_common(S, H); return S, H


# ---- 6. Prospector: mining ship (yard) ---------------------------------------------------------------
@design
def prospector():
    S = Ship('prospector', 16, 1.8); k = S.k
    tab = [(-35, 3.5, 3.5, 2.0, 0), (-33, 6.5, 5.5, 2.6, 0), (-26, 8.5, 6.6, 3.0, 0), (-12, 8.8, 6.8, 3.4, -.5), (10, 8.0, 6.4, 3.6, -.5), (26, 6.6, 5.8, 3.4, 0), (35, 5.6, 5.0, 3.0, 0)]
    H = Hull(tab, 44, bot=.85, shoulder=.1, keel=.2, hump=lambda z, x: 3.6 * smooth(4, 7, -abs(x) + 9) * smooth(-24, -20, z) * smooth(-2, -6, z))
    seams = [-26, -18, -10, -2, 6, 14, 22, 30]
    liv = livery(H, 0x7d6f5c, belly=0x3a3530, accent=0xf2b33d, cell=2.6, seams=seams, seamw=.07, tipz=-34.6, tip=0x1b1b1b, wear=.22,
                 stripe=lambda p, yn: (p.z < -28 and int((p.x + p.y + 40) / 1.2) % 2 == 0),
                 windows=lambda p, yn: yn > .62 and -20.5 < p.z < -18.2)
    skin(S, H, stations(-35, 35, .9, [s + d for s in seams for d in (-.07, .07)]), liv)
    # drill head: a rotating-looking cone with teeth, on a collar
    revolve(k, [(0, 3.4), (1.5, 3.3), (5, 2.0), (7.5, .6), (8, 0)], (0, 0, -35), (0, 0, -1), 28, 0x5a5650, closed=False)
    for j in range(14):
        a = j / 14 * math.pi * 2; z = -38 - (j % 3) * 1.2; r = 2.6 - (j % 3) * .55
        k.box((math.cos(a) * r, math.sin(a) * r, z), (.5, .5, 1.1), 0xd0cdc5, rot=rot_to((math.cos(a) * .4, math.sin(a) * .4, -1)), bevel=.06)
    ring_tube(k, (0, 0, -35.2), 3.7, .5, (0, 0, 1), 32, HAZ)
    # ore arms and hoppers
    for sd in (-1, 1):
        base = Vector((sd * 8.0, -3, -22)); el = Vector((sd * 11.5, -5.5, -32)); claw = Vector((sd * 7, -6, -40))
        k.link(tuple(base), tuple(el), 1.0, .85, 0xf2b33d); k.link(tuple(el), tuple(claw), .8, .6, 0xf2b33d)
        k.cyl(tuple(el), 1.1, 1.1, 1.6, 'x', 16, SLATE_D)
        for j in range(3): k.box(tuple(claw + Vector((sd * (j - 1) * .6, -.5, -1.0))), (.35, .5, 2.2), SLATE_D, rot=(15 * (j - 1), 0, 0))
        S.box_col(tuple((base + el) / 2), (1.2, 1.2, 5.5)); S.box_col(tuple((el + claw) / 2), (1.0, 1.0, 4.6))
    for i in range(4):
        z = -6 + i * 7.5
        for sd in (-1, 1): container(S, (sd * 10.2, -1.5, z), (3.4, 6.5, 6.5), 0x5d5348, stripe=0xf2b33d)
    for sx in (-1, 1):
        for sy in (-1, 1):
            bell(k, (sx * 2.8, sy * 2.6, 34.8), 1.2, 1.9, 3.0, segs=22, glow=0x6a3a18); S.nozzles.append({'p': [sx * 2.8, sy * 2.6, 37.8], 'r': 1.85})
        radiator(S, (sx * 6.2, 2.0, 20), 12, 6, sx, n=7)
        nav(S, (sx * 18.4, 2.0, 20), GREEN if sx > 0 else RED, .3)
    greeble_hull(S, H, 90, -30, 33, .2, 1.4, 1.0)
    window_row(S, H, -24, -14, .35, 1.6, .35, lit=.4)
    for z in (-28, 0, 30):
        for sd in (-1, 1): rcs_quad(S, H.pt(math.pi / 2 - sd * .8, z), H.normal(math.pi / 2 - sd * .8, z), .7)
    dish(S, (4, 9.5, -8), 1.8, (.2, 1, .1))
    k.link((-3, 9.6, -12), (-3, 15, -12), .12, .07, SLATE_D); nav(S, (-3, 15.1, -12), WHITE, .25)
    collar(S, (0, H.pt(math.pi / 2, 4).y - .1, 4), (0, 1, 0), 1.6)
    S.anchor['eye'] = {'p': [0, 11.0, -21.0]}
    ribs_and_conduits(S, H, 0, (1, -1), lambda z: z < -13 or 2 < z < 6)
    finish_common(S, H); return S, H


# ---- 7. Lance: corvette (yard) --------------------------------------------------------------------------
@design
def lance():
    S = Ship('lance', 17, 2.2); k = S.k
    tab = [(-48, .2, .2, 2.0, 0), (-44, 2.6, 1.6, 2.2, 0), (-30, 6.0, 3.6, 2.6, 0), (-10, 7.6, 4.6, 3.0, 0), (14, 7.8, 4.7, 3.2, 0), (34, 7.0, 4.6, 3.2, 0), (46, 6.2, 4.4, 3.0, 0), (48, 5.6, 4.0, 2.8, 0)]
    hump = lambda z, x: 4.2 * smooth(3.5, 6.5, -abs(x) + 8) * smooth(-14, -6, z) * smooth(22, 12, z)
    H = Hull(tab, 48, bot=.8, shoulder=.22, hump=hump, keel=.35, chine=.14, ridge=.05)
    seams = [-30, -20, -10, 0, 10, 20, 30, 40]
    liv = livery(H, 0x5d676f, belly=0x2b3036, accent=0xd8452a, cell=2.4, seams=seams, seamw=.07, tipz=-47.4, tip=0x111418,
                 stripe=lambda p, yn: (-44 < p.z < -36 and abs(yn) < .3) or (yn > .2 and abs(p.x) < .5 and p.z < -14),
                 windows=lambda p, yn: yn > .3 and -12.6 < p.z < -10.4 and abs(p.x) < 5.5)
    skin(S, H, stations(-48, 48, .9, [s + d for s in seams for d in (-.07, .07)]), liv)
    turret(S, (0, 4.4, -24), 2.0, (0, 1, 0), 2); turret(S, (0, 9.8, 20), 1.8, (0, 1, 0), 2)
    for sd in (-1, 1):
        turret(S, (sd * 6.4, -2.6, -6), 1.2, (sd * .7, -.7, 0), 1)
        tip = wing(S, (sd * 6.5, -.5, 18), 8, 18, 6, math.radians(40), math.radians(-8), .07, wing_color(0x56616a, 0xd8452a, span=8, root_x=6.5), sd, steps=6)
        nav(S, tip, GREEN if sd > 0 else RED, .3)
        with k.at((sd * 4.5, 3.5, 34), (0, 0, -sd * 18)):
            wing(S, (0, 0, 0), 6.5, 9, 3.5, math.radians(40), 0, .07, wing_color(0x56616a, 0xd8452a, span=6.5), 1, vertical=True)
    for (sx, sy) in ((-1, 1), (1, 1), (-1, -1), (1, -1)):
        bell(k, (sx * 3.2, sy * 2.0, 47.8), 1.3, 2.0, 3.4, segs=22, glow=0x6a3a18); S.nozzles.append({'p': [sx * 3.2, sy * 2.0, 51.2], 'r': 1.95})
    bell(k, (0, 0, 47.8), 1.6, 2.4, 3.8, segs=24, glow=0x6a3a18); S.nozzles.append({'p': [0, 0, 51.6], 'r': 2.35})
    greeble_hull(S, H, 120, -40, 46, .15, 1.5, .9)
    window_row(S, H, -30, 10, .3, 2.0, .3, lit=.35)
    for z in (-38, 0, 40):
        for sd in (-1, 1): rcs_quad(S, H.pt(math.pi / 2 - sd * .75, z), H.normal(math.pi / 2 - sd * .75, z), .8)
    k.link((0, 9.5, -2), (0, 16, -2), .15, .08, SLATE_D); nav(S, (0, 16.1, -2), WHITE, .3)
    dish(S, (3.5, 9.4, 4), 1.6, (.3, 1, 0))
    collar(S, (0, H.pt(math.pi / 2, 30).y - .1, 30), (0, 1, 0), 1.6)
    S.anchor['eye'] = {'p': [0, 9.6, -12.4]}
    ribs_and_conduits(S, H, 0, (), lambda z: z < -14 or 28 < z < 32)
    finish_common(S, H); return S, H


# ---- 8. Atlas: bulk hauler (yard) ---------------------------------------------------------------------------
@design
def atlas():
    S = Ship('atlas', 18, 4); k = S.k
    # cab forward, spine, drive aft. The hull loft is only the cab; spine is a truss
    tab = [(-90, 2, 2, 2, 0), (-87, 8, 7, 2.6, 0), (-78, 11.5, 9.5, 3.4, 0), (-64, 11.5, 9.5, 3.6, 0), (-58, 7, 6.5, 3.0, 0)]
    H = Hull(tab, 44, bot=.9, shoulder=.1, hump=lambda z, x: 4 * smooth(5, 9, -abs(x) + 11) * smooth(-84, -80, z) * smooth(-62, -68, z))
    seams = [-80, -72, -64]
    liv = livery(H, 0xc9c4b6, belly=0x4a4f55, accent=0x1f4f8f, cell=3.0, seams=seams, seamw=.1, tipz=-89.4, tip=SLATE_D,
                 stripe=lambda p, yn: abs(yn) < .2, windows=lambda p, yn: yn > .55 and -84.2 < p.z < -81.6)
    skin(S, H, stations(-90, -58, 1.0, [s + d for s in seams for d in (-.1, .1)]), liv)
    truss(S, -58, 62, 3.2, 0, 0, 6.4, BONE_D, .9)
    # ten container ranks along the spine, 2x2 around it
    cols = [0x8a3b2a, 0x1f4f8f, 0xc9b98f, 0x50606c, 0xb05a2a, 0x7c8a5a, 0x3d6a52]
    for i in range(10):
        z = -50 + i * 11
        for sx in (-1, 1):
            for sy in (-1, 1):
                if hsh(i, sx, sy, 7) < .1: continue
                container(S, (sx * 6.6, sy * 6.6, z), (6.2, 6.2, 10.4), cols[int(hsh(i, sx, sy, 2) * len(cols))])
        k.box((0, 0, z - 5.5), (17, 1.0, 1.0), SLATE_D); k.box((0, 0, z - 5.5), (1.0, 17, 1.0), SLATE_D)
    # drive section: lofted block + reactor + bells
    H2 = Hull([(62, 6, 6, 3, 0), (66, 13, 12, 3.6, 0), (84, 14, 13, 3.8, 0), (90, 13, 12, 3.4, 0)], 44, bot=1)
    liv2 = livery(H2, 0xb8b2a2, belly=0x4a4f55, accent=0x1f4f8f, cell=3.0, seams=[70, 78, 86], seamw=.1, stripe=lambda p, yn: abs(yn) < .14)
    skin(S, H2, stations(62, 90, 1.0, [s + d for s in (70, 78, 86) for d in (-.1, .1)]), liv2)
    for (sx, sy) in ((-1, 1), (1, 1), (-1, -1), (1, -1)):
        bell(k, (sx * 5.8, sy * 5.6, 89.8), 2.6, 3.9, 6, segs=24, glow=0x6a3a18); S.nozzles.append({'p': [sx * 5.8, sy * 5.6, 95.8], 'r': 3.8})
    for sx in (-1, 1):
        radiator(S, (sx * 13.5, 0, 74), 26, 12, sx, n=9)
        nav(S, (sx * 40, 0, 74), GREEN if sx > 0 else RED, .5)
    cap_tank(k, (0, 13.5, 74), 4.5, 12, (0, 0, 1), 0xd8d0bc, 3, SLATE); S.box_col((0, 13.5, 74), (4.5, 4.5, 9))
    greeble_hull(S, H, 70, -86, -60, .2, 1.6, 1.6)
    greeble_hull(S, H2, 70, 64, 88, .2, 1.6, 1.6)
    window_row(S, H, -82, -66, .2, 2.4, .5, lit=.45)
    k.link((0, 14, -72), (0, 24, -72), .25, .14, SLATE_D); nav(S, (0, 24.2, -72), WHITE, .5)
    dish(S, (6, 13, -64), 3, (.2, 1, .2))
    collar(S, (0, H.pt(math.pi / 2, -70).y - .1, -70), (0, 1, 0), 1.8)
    S.anchor['eye'] = {'p': [0, 14.6, -84.6]}
    finish_common(S, H)
    for z in range(-50, 66, 12): S.probes.append([0, 0, z, 9.0])
    ribs_and_conduits(S, H2, 3, (1, -1))
    finish_common(S, H2); return S, H


# ---- 9. Old Gull: ancient survey craft (derelict) ---------------------------------------------------------
@design
def gull():
    S = Ship('gull', 21, 1.0); k = S.k
    tab = [(-17, .3, .3, 2, 0), (-15.5, 2.0, 1.8, 2.0, 0), (-11, 3.0, 2.6, 2.0, 0), (-2, 3.0, 2.6, 2.0, 0), (2, 2.0, 1.8, 2.0, 0), (14, 2.0, 1.8, 2.0, 0), (17, 2.4, 2.2, 2.0, 0)]
    H = Hull(tab, 32, bot=1, shoulder=0)
    seams = [-11, -7, -2, 2, 6, 10, 14]
    liv = livery(H, 0x9a8f78, belly=0x5c5246, accent=0x3b6e5a, cell=1.6, seams=seams, seamw=.05, tipz=-16.6, tip=0x2b2a26, wear=.35,
                 stripe=lambda p, yn: -1 < p.z < 13 and abs(yn) < .14, windows=lambda p, yn: .2 < yn < .55 and -14.8 < p.z < -12.9,
                 dark=lambda p, r: r < .18)
    skin(S, H, stations(-17, 17, .45, [s + d for s in seams for d in (-.05, .05)]), liv)
    # the long sensor boom and a big dish, a rotating science ring (stopped)
    k.link((0, 0, -17), (0, 0, -27), .25, .12, SLATE_L)
    for z in (-20, -23, -26): k.cyl((0, 0, z), .5, .5, .3, 'z', 12, 0x3b6e5a)
    dish(S, (0, 3.2, -5), 3.0, (0, 1, -.5))
    ring_tube(k, (0, 0, 6), 6.5, .55, (0, 0, 1), 36, 0xa69c86)
    for j in range(4):
        a = j * math.pi / 2 + .4; k.link((math.cos(a) * 2.0, math.sin(a) * 1.8, 6), (math.cos(a) * 6.2, math.sin(a) * 6.2, 6), .22, .18, SLATE)
    for j in range(8):
        a = j * math.pi / 4; k.box((math.cos(a) * 6.5, math.sin(a) * 6.5, 6), (1.4, 1.4, 1.8), 0x8a7f6a, rot=(0, 0, math.degrees(a)), bevel=.1)
    for j in range(16): S.probes.append([math.cos(j / 16 * 6.283) * 6.5, math.sin(j / 16 * 6.283) * 6.5, 6, 1.0])
    for sx in (-1, 1):
        radiator(S, (sx * 2, 0, 11), 7, 3.5, sx, n=5, color=0x6e6656)
    bell(k, (0, 0, 16.9), .9, 1.25, 1.6, segs=20, glow=0x2a1408); S.nozzles.append({'p': [0, 0, 18.5], 'r': 1.2})
    greeble_hull(S, H, 50, -12, 15, .2, 1.5, .5)
    window_row(S, H, -10, -3, .3, 1.0, .25, lit=.0)
    collar(S, (0, H.pt(math.pi / 2, 0).y - .05, -.5), (0, 1, 0), 1.2)
    S.anchor['eye'] = {'p': [0, 2.6, -14.2]}
    ribs_and_conduits(S, H, 0, (1, -1), lambda z: z < -9 or 3.5 < z < 8.5 or -2.5 < z < 1.5)
    finish_common(S, H); return S, H


# ---- 10. Sable: stealth runner (derelict) ---------------------------------------------------------------
@design
def sable():
    S = Ship('sable', 22, 1.0); k = S.k
    tab = [(-20, .1, .05, 1.6, 0), (-16, 2.2, .7, 1.7, 0), (-8, 5.0, 1.4, 1.8, 0), (2, 7.5, 1.8, 1.9, 0), (12, 8.5, 1.6, 2.0, 0), (18, 7.0, 1.2, 2.0, 0), (20, 6.0, 1.0, 2.0, 0)]
    H = Hull(tab, 32, bot=.75, shoulder=0, hump=lambda z, x: 1.1 * smooth(2.0, 3.5, -abs(x) + 4) * smooth(-14, -8, z) * smooth(10, 2, z))
    seams = [-12, -6, 0, 6, 12]
    def facets(p, n):
        # faceted dark skin: each facet a slightly different tone, with thin bright seams
        f = hsh(int((p.z + 30) / 2.4), int((p.x + 30) / 1.8), int(p.y > 0))
        if any(abs(p.z - s) < .04 for s in seams): return 0x2c3036
        if .3 < (p.y) and -11 < p.z < -7.5 and abs(p.x) < 1.6: return 0x0b1118
        return shade(0x1d2126, .85 + .3 * f)
    H.segs = 24
    skin(S, H, stations(-20, 20, .5, [s + d for s in seams for d in (-.04, .04)]), facets)
    for sd in (-1, 1):
        with k.at((sd * 5, .6, 12), (0, 0, -sd * 40)):
            wing(S, (0, 0, 0), 4, 6, 2.5, math.radians(50), 0, .05, lambda p, n: 0x23272c, 1, vertical=True)
        k.box((sd * 3.5, -.2, 19.8), (5, .9, .6), 0x15171b)        # slot exhausts
        k.lamp((sd * 3.5, -.2, 20.12), (4.6, .5, .05), 0x5a2a10)
        S.nozzles.append({'p': [sd * 3.5, -.2, 20.6], 'r': .9})
        nav(S, (sd * 8.4, 0, 12), 0x401010 if sd < 0 else 0x104010, .12)
    greeble_hull(S, H, 20, -10, 18, .3, 1.0, .4)
    collar(S, (0, H.pt(math.pi / 2, 4).y - .05, 4), (0, 1, 0), 1.1)
    S.anchor['eye'] = {'p': [0, 2.3, -9.6]}
    finish_common(S, H); return S, H


# ---- 11. Vigil: research vessel (derelict) ---------------------------------------------------------------
@design
def vigil():
    S = Ship('vigil', 23, 2.4); k = S.k
    tab = [(-60, 1.5, 1.5, 2, 0), (-57, 6, 6, 2.2, 0), (-48, 9, 8.5, 2.4, 0), (-36, 9, 8.5, 2.4, 0), (-30, 4.5, 4.5, 2.0, 0), (40, 4.5, 4.5, 2.0, 0), (46, 8.5, 8.5, 2.6, 0), (60, 8, 8, 2.6, 0)]
    H = Hull(tab, 40, bot=1, shoulder=.04)
    seams = [-48, -42, -36, -30, 40, 46, 53]
    liv = livery(H, 0xe6e3da, belly=0x8a8d90, accent=0x1f7a8c, cell=3.0, seams=seams, seamw=.09, tipz=-59.4, tip=0x1f7a8c, wear=.16,
                 stripe=lambda p, yn: abs(yn) < .1 and p.z < -30, windows=lambda p, yn: .25 < yn < .55 and -56 < p.z < -52)
    skin(S, H, stations(-60, 60, 1.0, [s + d for s in seams for d in (-.09, .09)]), liv)
    # two habitat rings (one torn), the long lab spine with pods
    for zc, torn in ((-12, False), (14, True)):
        R = 22; prof = [(math.sin(a) * 3.0, R + math.cos(a) * 4.2) for a in [i / 10 * 2 * math.pi for i in range(10)]]
        if not torn: revolve(k, prof, (0, 0, zc), (0, 0, 1), 48, 0xd8d4c8)
        else:
            # a ring missing a third: build segments
            for j in range(24):
                if 15 <= j <= 22: continue
                a0, a1 = j / 24 * 2 * math.pi, (j + 1) / 24 * 2 * math.pi
                c = Vector((math.cos((a0 + a1) / 2) * R, math.sin((a0 + a1) / 2) * R, zc))
                k.box(tuple(c), (R * 2 * math.pi / 24 * 1.02, 7.5, 6.0), 0xc8c3b6, rot=(0, 0, math.degrees((a0 + a1) / 2) + 90), bevel=.4)
        for j in range(4):
            a = j * math.pi / 2 + .785
            k.link((math.cos(a) * 4.4, math.sin(a) * 4.4, zc), (math.cos(a) * 18, math.sin(a) * 18, zc), 1.0, .8, SLATE)
        for j in range(24):
            if torn and 15 <= j <= 22: continue
            a = j / 24 * 2 * math.pi; S.probes.append([math.cos(a) * R, math.sin(a) * R, zc, 4.6])
            if j % 3 == 0: S.box_col((math.cos(a) * R, math.sin(a) * R, zc), (4.2, 4.2, 3.2))
    for i in range(6):
        z = -25 + i * 11
        for sd in (-1, 1): cap_tank(k, (sd * 6.5, 0, z), 2.0, 5, (0, 0, 1), 0xc0bbae, 2, 0x1f7a8c)
    dish(S, (0, 10, -44), 5, (0, 1, -.4)); dish(S, (0, -10, -44), 4, (0, -1, -.3))
    for (sx, sy) in ((-1, 0), (1, 0), (0, 1), (0, -1)):
        bell(k, (sx * 4.0, sy * 4.0, 59.8), 1.6, 2.4, 4, segs=22, glow=0x2a1408); S.nozzles.append({'p': [sx * 4, sy * 4, 63.8], 'r': 2.35})
    for sx in (-1, 1): radiator(S, (sx * 8.5, 0, 52), 16, 8, sx, n=8, color=0xd0d2d4)
    greeble_hull(S, H, 70, -56, -30, .2, 2.9, 1.0)
    greeble_hull(S, H, 50, 40, 58, .2, 2.9, 1.0)
    window_row(S, H, -54, -38, .2, 2.0, .45, lit=.05)
    collar(S, (0, H.pt(math.pi / 2, -40).y - .1, -40), (0, 1, 0), 1.6)
    S.anchor['eye'] = {'p': [0, 9.0, -56.6]}
    ribs_and_conduits(S, H, 0, (1, -1), lambda z: z < -50 or -42 < z < -38 or abs(z + 12) < 5 or abs(z - 14) < 5)
    finish_common(S, H); return S, H


# ---- 12. Cinder: burned-out frigate (derelict) --------------------------------------------------------------
@design
def cinder():
    S = Ship('cinder', 24, 2.8); k = S.k
    tab = [(-70, .5, .5, 2, 0), (-64, 6, 4, 2.4, 0), (-46, 11, 6.5, 2.8, 0), (-20, 13, 7.5, 3.0, 0), (20, 13.5, 7.6, 3.2, 0), (50, 12, 7.2, 3.2, 0), (70, 10, 6.5, 3.0, 0)]
    hump = lambda z, x: 6 * smooth(5, 9, -abs(x) + 12) * smooth(-10, -2, z) * smooth(34, 22, z)
    H = Hull(tab, 52, bot=.85, shoulder=.2, hump=hump, keel=.3, chine=.12)
    seams = [-46, -33, -20, -7, 6, 20, 35, 50, 60]
    def burn(p, r):
        # scorch spreads from a blast at the port flank
        d = (p - Vector((-12, 2, 8))).length
        return d < 30 + 10 * r
    liv = livery(H, 0x6f665c, belly=0x2b2826, accent=0x9a2b1f, cell=3.2, seams=seams, seamw=.1, tipz=-69.4, tip=0x111111, wear=.3,
                 stripe=lambda p, yn: (-64 < p.z < -52 and abs(yn) < .35) or (abs(p.x) < .6 and yn > .5 and p.z < -10), dark=burn,
                 windows=lambda p, yn: yn > .3 and -8.8 < p.z < -6.2 and abs(p.x) < 8)
    # a breach: the port flank is holed
    def hole(z, t, p): return -2 < z < 12 and p.x < -9 and abs(p.y) < 3.4
    skin(S, H, stations(-70, 70, 1.2, [s + d for s in seams for d in (-.1, .1)] + [-2, 12]), liv, skip=hole)
    # inner bulkhead behind the breach, ribs across it, torn plates
    k.box((-8.6, 0, 5), (.4, 7.6, 14.5), 0x2a2522)
    for z in range(-1, 12, 2): k.box((-10.6, 0, z), (4, .5, .5), 0x3a332e, rot=(0, 0, 20 * hsh(z) - 10))
    for i in range(10):
        p = Vector((-12.6 - S.rng.random(), S.rng.uniform(-3, 3), S.rng.uniform(-2, 12)))
        k.box(tuple(p), (S.rng.uniform(.6, 2.5), .12, S.rng.uniform(.8, 2.8)), 0x3a332e, rot=(S.rng.uniform(-60, 60), S.rng.uniform(-40, 40), S.rng.uniform(-80, 80)))
    for z in (-36, 30):
        turret(S, (0, H.pt(math.pi / 2, z).y + .2, z), 2.6, (0, 1, 0), 3)
    for sd in (-1, 1):
        turret(S, (sd * 11, -4.5, -26), 1.6, (sd * .6, -.8, 0), 2)
        tip = wing(S, (sd * 12.5, -1, 30), 12, 26, 9, math.radians(42), math.radians(-6), .07, wing_color(0x625a50, 0x9a2b1f, span=12, root_x=12.5), sd, steps=6)
        nav(S, tip, 0x401010, .3)
    for (sx, sy) in ((-1, 1), (1, 1), (-1, -1), (1, -1), (0, 0)):
        bell(k, (sx * 5.2, sy * 3.2, 69.8), 2.0, 3.0, 5.2, segs=24, glow=0x1a0a04); S.nozzles.append({'p': [sx * 5.2, sy * 3.2, 75], 'r': 2.9})
    for sx in (-1, 1): radiator(S, (sx * 9.5, 5.5, 52), 14, 8, sx, n=8, color=0x5a524a)
    greeble_hull(S, H, 160, -60, 66, .15, 2.9, 1.3)
    window_row(S, H, -50, 40, .25, 2.4, .35, lit=.0)
    collar(S, (0, H.pt(math.pi / 2, 42).y - .1, 42), (0, 1, 0), 1.8)
    S.anchor['eye'] = {'p': [0, 15.6, -9.2]}
    ribs_and_conduits(S, H, 0, (1,), lambda z: -4 < z < 14 or 40 < z < 44 or abs(z + 36) < 4 or abs(z - 30) < 4)
    finish_common(S, H); return S, H


# ---- 13. Ironwake: 1.1 km derelict ore carrier, walkable ---------------------------------------------------
# Interior (built in code, src/ironwake.js) sits in the command section: hangar bay on the starboard flank
# x 30..75, y -16..16, z -470..-410; airlock, corridor and junction at y -13 heading to x=0; a lift shaft at
# (0, y, -440) up to the bridge deck at y 58..65; bridge z -454.7..-474.7, x +-14. The command hull is one
# closed loft with a dorsal hump that encloses the shaft and bridge, and a notch for the bay mouth.
@design
def ironwake():
    S = Ship('ironwake', 31, 24); k = S.k
    head = [(-560, 12, 10, 2.0, 0), (-548, 36, 26, 2.4, 0), (-525, 58, 40, 3.2, 0), (-490, 74, 47, 4.0, 0), (-440, 76, 48, 4.4, 0), (-385, 72, 46, 4.0, 0), (-350, 52, 36, 3.2, 0), (-335, 30, 26, 2.6, 0)]
    def hump(z, x):
        # the bridge tower: a swept fin on the back of the head
        return 30 * smooth(15, 26, -abs(x) + 36) * smooth(-492, -476, z) * smooth(-400, -426, z)
    H = Hull(head, 72, bot=.92, shoulder=.12, hump=hump)
    seams = [-525, -505, -490, -470, -440, -410, -385, -360]
    def bay(z, t, p): return -470.5 < z < -409.5 and p.x > 40 and -16.2 < p.y < 16.2
    def winband(p, yn): return 60.6 < p.y < 64.4 and p.z < -472 and abs(p.x) < 15
    liv = livery(H, 0x8f8a80, belly=0x3d3a36, accent=0xc8501e, cell=14, seams=seams, seamw=.8, tipz=-557, tip=0x2a2a2a, wear=.28,
                 stripe=lambda p, yn: (-540 < p.z < -500 and -.08 < yn < .08) or (-476 < p.z < -466 and abs(yn) < .5 and p.x < 0),
                 windows=winband, dark=lambda p, r: r < .12)
    zs = stations(-560, -335, 3.0, [s + d for s in seams for d in (-.8, .8)] + [-470.5, -409.5, -492, -476, -426, -400, -476 + 1.5, -472])
    skin(S, H, zs, liv, skip=bay)
    # bay mouth frame (covers the seam between the notch and the bay box), hazard lips, floods
    for y in (-16.9, 16.9): k.box((75.2, y, -440), (3, 1.8, 63), SLATE_D, bevel=.3)
    for z in (-471.4, -408.6): k.box((75.2, 0, z), (3, 35.6, 1.8), SLATE_D, bevel=.3)
    for y in (-15.8, 15.8): k.box((76.8, y, -440), (.4, .5, 58), HAZ)
    for z in (-460, -440, -420):
        for y in (-17.7, 17.7): k.lamp((76.9, y, z), (.6, .5, 2.2), AMBER)
    # bridge brow and fin details on the hump
    for i in range(7):
        x = (i - 3) * 4.2; k.box((x, 64.6 + 1.2 * math.cos(i), -473.0), (.5, 4.6, 1.0), SLATE_D, rot=(-25, 0, 0))
    k.link((0, 76, -440), (0, 98, -440), 1.2, .6, SLATE_L); nav(S, (0, 98.6, -440), WHITE, 1.4)
    for z in (-430, -446): k.link((6, 74, z), (6, 86, z), .4, .25, SLATE_D)
    dish(S, (-14, 70, -420), 9, (-.2, 1, .3))
    dish(S, (22, 50, -380), 6, (.5, 1, .2))
    window_row(S, H, -520, -360, .3, 9, 1.4, lit=.06)
    window_row(S, H, -515, -365, .05, 9, 1.4, lit=.04)
    greeble_hull(S, H, 260, -540, -340, .1, 3.0, 6)
    nav(S, (-76, 0, -480), RED, 1.4); nav(S, (76.4, 18.6, -480), GREEN, 1.4)
    S.anchor['bay'] = {'p': [45, -12.9, -440], 'n': [0, 1, 0]}
    S.anchor['eye'] = {'p': [0, 61.4, -469.6]}
    shell(S, H, -556, -336, 8, 24, 7, ROOMS)
    for zc in range(-540, -330, 14): S.probes.append([0, 0, zc, 30])
    # neck into the spine
    revolve(k, [(0, 30), (20, 22), (40, 18)], (0, 0, -340), (0, 0, 1), 48, 0x7a766d, closed=False)
    # the spine: a massive truss with ore cans round it in five ranks
    truss(S, -300, 300, 16, 0, 0, 30, 0x8c867a, 4.0)
    k.cyl((0, 0, 0), 9, 9, 640, 'z', 24, 0x5c5a55)     # core conduit
    for i in range(5):
        zc = -250 + i * 116
        for j in range(6):
            a = j / 6 * 2 * math.pi + .52
            c = (math.cos(a) * 46, math.sin(a) * 46, zc)
            cap_tank(k, c, 24, 62, (0, 0, 1), [0xa3998a, 0x8f8676, 0xb2a897][(i + j) % 3], 2, 0x3d3a36, segs=24)
            k.link((math.cos(a) * 16, math.sin(a) * 16, zc - 20), (math.cos(a) * 24, math.sin(a) * 24, zc - 20), 3, 3, SLATE)
            k.link((math.cos(a) * 16, math.sin(a) * 16, zc + 20), (math.cos(a) * 24, math.sin(a) * 24, zc + 20), 3, 3, SLATE)
            S.box_col(c, (24, 24, 45))
            for dz in (-30, 0, 30): S.probes.append([c[0], c[1], zc + dz, 24])
        for j in range(6):
            a = j / 6 * 2 * math.pi + .52
            if hsh(i, j) < .25: k.lamp((math.cos(a) * 71, math.sin(a) * 71, zc), (2, 2, 2), AMBER)
    for z in range(-300, 301, 30): S.probes.append([0, 0, z, 18])
    # drive section
    D = Hull([(300, 30, 30, 2.6, 0), (320, 62, 58, 3.6, 0), (420, 70, 64, 4.2, 0), (500, 66, 60, 4.0, 0), (540, 54, 50, 3.4, 0)], 64, bot=1, shoulder=.05)
    dseams = [330, 360, 390, 420, 450, 480, 510]
    livD = livery(D, 0x837e74, belly=0x3d3a36, accent=0xc8501e, cell=14, seams=dseams, seamw=.8, wear=.26, stripe=lambda p, yn: abs(yn) < .06 or (330 < p.z < 336), dark=lambda p, r: r < .1)
    skin(S, D, stations(300, 540, 3.0, [s + d for s in dseams for d in (-.8, .8)]), livD)
    for zc in range(306, 540, 18):
        w, h, n, yc = D.at(zc); S.box_col((0, 0, zc), (w * .92, h * .92, 9)); S.probes.append([0, 0, zc, min(w, h)])
        S.probes.append([w * .55, 0, zc, h * .7]); S.probes.append([-w * .55, 0, zc, h * .7])
    # six drive bells in a ring and a central one
    for j in range(6):
        a = j / 6 * 2 * math.pi
        c = (math.cos(a) * 34, math.sin(a) * 32, 538)
        bell(k, c, 12, 19, 34, segs=32, glow=0x1a0a04); S.nozzles.append({'p': [c[0], c[1], 572], 'r': 18.5})
        S.box_col((c[0], c[1], 555), (16, 16, 17))
    bell(k, (0, 0, 538), 9, 14, 26, segs=28, glow=0x1a0a04); S.nozzles.append({'p': [0, 0, 564], 'r': 13.6})
    # radiator wings: four big fins in an X
    for (sx, sy) in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
        root = Vector((sx * 40, sy * 40, 430))
        d = Vector((sx, sy, 0)).normalized()
        for i in range(10):
            u0, u1 = i / 10, (i + 1) / 10
            c = root + d * 150 * (u0 + u1) / 2
            ang = math.degrees(math.atan2(d.y, d.x))
            k.box(tuple(c), (150 / 10 * .95, 1.0, 70), shade(0x9c968a, .9 + .15 * hsh(i, sx, sy)), rot=(0, 0, ang), wear=.04)
            rc = root + d * 150 * u1
            k.box(tuple(rc), (1.4, 2.4, 71), SLATE_D, rot=(0, 0, ang))
        k.link(tuple(root), tuple(root + d * 152), 2.2, 1.4, SLATE)
        qq = Quaternion((0, 0, 1), math.atan2(d.y, d.x))
        for i in range(5):
            c = root + d * 150 * (i + .5) / 5
            S.box_col(tuple(c), (15, 1.5, 35), (qq.x, qq.y, qq.z, qq.w))
        nav(S, tuple(root + d * 154), GREEN if sx > 0 else RED, 1.6)
    # reactor domes on the drive's back
    for z in (360, 440):
        revolve(k, [(0, 22), (8, 20), (14, 12), (16, 0)], (0, D.pt(math.pi / 2, z).y - 3, z), (0, 1, 0), 32, 0xb5ad9c, closed=False)
        ring_tube(k, (0, D.pt(math.pi / 2, z).y - 1, z), 22, 1.4, (0, 1, 0), 40, 0xc8501e)
    greeble_hull(S, D, 220, 310, 535, .1, 3.0, 6, cols=(0x7e7a70, SLATE_D, RUST, 0x5c5a55))
    for z in (-500, 380, 500):
        for sd in (-1, 1):
            hh = H if z < 0 else D
            rcs_quad(S, hh.pt(math.pi / 2 - sd * .8, z), hh.normal(math.pi / 2 - sd * .8, z), 5)
    return S, H


# ============================================================================================
def bake_ao_v(k, rays=16, dist=2.0, strength=.8, seed=3):
    """kit.bake_ao, but per vertex (vertex normal), so faces sharing a vertex and a paint colour share it in
    the export: about half the vertices of the per-loop bake"""
    from mathutils.bvhtree import BVHTree
    bmesh.ops.dissolve_degenerate(k.bm, dist=1e-5, edges=k.bm.edges[:])
    k.subdivide()
    k.bm.normal_update(); k.bm.verts.ensure_lookup_table(); k.bm.verts.index_update()
    bvh = BVHTree.FromBMesh(k.bm)
    rnd = random.Random(seed); dirs = []
    for i in range(rays):
        u1 = (i + rnd.random()) / rays; u2 = rnd.random(); r = math.sqrt(u1); th = 2 * math.pi * u2
        dirs.append(Vector((r * math.cos(th), r * math.sin(th), math.sqrt(max(0, 1 - u1)))))
    ao = {}
    for v in k.bm.verts:
        n = v.normal if v.normal.length > .5 else Vector((0, 0, 1))
        t = n.cross(Vector((0, 0, 1)) if abs(n.z) < .9 else Vector((1, 0, 0))).normalized(); b = n.cross(t)
        o = v.co + n * .02; occ = 0
        for d in dirs:
            w = t * d.x + b * d.y + n * d.z
            hit = bvh.ray_cast(o, w, dist)
            if hit[0] is not None: occ += 1 - hit[3] / dist
        ao[v.index] = 1 - strength * occ / rays
    for f in k.bm.faces:
        if f.material_index == LAMP: continue
        for l in f.loops:
            a = ao[l.vert.index]; c = l[k.col]; l[k.col] = (c[0] * a, c[1] * a, c[2] * a, 1.0)

def build(ids):
    data = {}
    path = os.path.join(OUT, 'fleet.json')
    if os.path.exists(path):
        try: data = json.load(open(path))
        except Exception: data = {}
    kits = []
    for i in ids:
        print('building', i)
        S, H = DESIGNS[i]()
        kits.append(S.k)
        xs = [v.co for v in S.k.bm.verts]
        mn = [min(v[a] for v in xs) for a in range(3)]; mx = [max(v[a] for v in xs) for a in range(3)]
        # nothing may float: slide loose parts onto the hull, strut the ones too far out
        from islands import weld
        weld(S.k, tol=max(0.02, S.k.maxlen * 0.04), link=lambda a, b, r0, r1: S.k.link(a, b, r0, r1, SLATE_D))
        from islands import audit
        left = audit(S.k.bm, tol=max(0.02, S.k.maxlen * 0.04)); print(f'  {i}: {len(left)} parts not joined to the hull')
        if i != 'ironwake':
            # solid colliders from the finished model itself, so nothing on it can be flown, walked or drifted through
            from voxcol import vox_boxes
            S.obbs, vv = vox_boxes(S.k.bm); print('  colliders', len(S.obbs), 'voxel', round(vv, 2))
        data[i] = {'obbs': S.obbs, 'probes': [[round(x, 3) for x in p] for p in S.probes], 'nozzles': S.nozzles, 'lights': S.lights,
                   'anchor': S.anchor, 'min': mn, 'max': mx}
    return kits, data

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    ids = args or list(DESIGNS.keys())
    kits, data = build(ids)
    import time; t0 = time.time()
    for kk in kits:
        # big ships occlude over longer distances
        d = max(1.5, kk.maxlen * 4); kk.maxlen *= 2.2
        kk.bm.verts.index_update(); bake_ao_v(kk, rays=16, dist=d, strength=.8)
    print('ao', round(time.time() - t0, 1), 's')
    # one glb with every ship: re-read the ones not rebuilt this run
    out = os.path.join(os.path.dirname(__file__), '.parts')
    os.makedirs(out, exist_ok=True)
    for kk in kits:
        export_glb([kk], os.path.join(out, kk.name + '.glb'))
    json.dump(data, open(os.path.join(OUT, 'fleet.json'), 'w'))
