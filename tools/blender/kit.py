"""Tiny hard-surface kit for Low Orbit assets, run with the `bpy` pip module (no GUI).

Everything is built as bmesh geometry with per-face linear vertex colours (palette from
docs/identity.md), chamfered edges, then ambient occlusion is baked into the colours by ray
casting. No textures: the .glb stays small and loads fast on phones.

Material slots: 0 hull (vertex colours, lit), 1 lamp (vertex colours, unlit/bloomed), 2 glass.
"""
import bpy, bmesh, math, random, json
from mathutils import Vector, Matrix, Euler
from mathutils.bvhtree import BVHTree

HULL, LAMP, GLASS = 0, 1, 2


def lin(h):
    """sRGB hex -> linear rgb tuple."""
    c = [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
    return tuple((x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c)


# Identity palette (docs/identity.md): bone, rust, slate, one hazard accent.
BONE, BONE_D, BONE_L = 0xcfc6b0, 0xa89f8a, 0xe2dac4
RUST, RUST_D = 0x6b5446, 0x4a3a30
SLATE, SLATE_D, SLATE_L = 0x2b3a44, 0x1b2a33, 0x445560
HAZ, BLACK = 0xff5a1f, 0x15171b
AMBER, RED, GREEN, WHITE = 0xffb066, 0xff3a2a, 0x5affb0, 0xdfeaff


def R(x=0, y=0, z=0):
    return Euler((math.radians(x), math.radians(y), math.radians(z)), 'XYZ')


def _clip_x(poly, lo, hi):
    def clip(pts, keep, inter):
        out = []
        for i, p in enumerate(pts):
            q = pts[(i + 1) % len(pts)]
            pi, qi = keep(p), keep(q)
            if pi: out.append(p)
            if pi != qi: out.append(inter(p, q))
        return out
    def ix(v):
        return lambda p, q: (v, p[1] + (q[1] - p[1]) * (v - p[0]) / (q[0] - p[0]))
    poly = clip(poly, lambda p: p[0] >= lo, ix(lo))
    if not poly: return poly
    return clip(poly, lambda p: p[0] <= hi, ix(hi))


def beam(k, p0, p1, t=0.3, color=None, t2=None, bevel=0.0, collide=False):
    """Box strut between two points."""
    a, b = Vector(p0), Vector(p1)
    d = b - a; ln = d.length
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_euler()
    k.box(tuple((a + b) / 2), (t, t2 or t, ln), color if color is not None else BONE_D, rot=rot, bevel=bevel, collide=collide)


class Kit:
    def __init__(self, name, seed=1):
        self.name = name
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new("Col")
        self.stack = [Matrix.Identity(4)]
        self.rng = random.Random(seed)
        self.obbs = []          # [{c, h, q}] colliders in kit space
        self.maxlen = 0.5       # AO subdivision size
        self.meta = {}

    # ---- transform stack -------------------------------------------------------------
    class _Ctx:
        def __init__(s, k, m): s.k, s.m = k, m
        def __enter__(s): s.k.stack.append(s.k.stack[-1] @ s.m)
        def __exit__(s, *a): s.k.stack.pop()

    def at(self, pos=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
        if not isinstance(rot, Euler): rot = R(*rot)
        m = Matrix.Translation(Vector(pos)) @ rot.to_matrix().to_4x4() @ Matrix.Diagonal(Vector((*scale, 1)))
        return Kit._Ctx(self, m)

    # ---- internals -------------------------------------------------------------------
    def _finish(self, before, color, mat, wear, bev_faces=None):
        """Colour every new face; bevel faces get lighter 'edge wear'."""
        c = lin(color) if isinstance(color, int) else color
        for f in self.bm.faces:
            if f in before: continue
            if callable(color):   # per-face livery: color(centre, normal) -> hex
                cc = color(f.calc_center_median(), f.normal)
                c = lin(cc) if isinstance(cc, int) else cc
            base = c
            if bev_faces is not None and f in bev_faces and mat == HULL:
                base = tuple(min(1, x * 1.28 + 0.012) for x in c)
            elif mat == HULL and wear:
                j = 1 + (self.rng.random() - 0.5) * wear
                base = tuple(x * j for x in c)
            f.material_index = mat
            for l in f.loops: l[self.col] = (*base, 1.0)

    def _xf(self, verts, local):
        m = self.stack[-1] @ local
        bmesh.ops.transform(self.bm, matrix=m, verts=verts)

    def _bevel(self, geom_edges, w, seg=1):
        if w <= 0: return set()
        r = bmesh.ops.bevel(self.bm, geom=geom_edges, offset=w, segments=seg, affect='EDGES', profile=0.5)
        return set(r['faces'])

    def _obb(self, local, half):
        m = self.stack[-1] @ local
        loc, rot, sc = m.decompose()
        self.obbs.append({'c': list(loc), 'h': [abs(half[i] * sc[i]) for i in range(3)], 'q': [rot.x, rot.y, rot.z, rot.w]})

    # ---- primitives ------------------------------------------------------------------
    def box(self, c=(0, 0, 0), s=(1, 1, 1), color=BONE, rot=(0, 0, 0), bevel=0.0, seg=1, collide=False, mat=HULL, wear=0.12):
        before = set(self.bm.faces)
        r = bmesh.ops.create_cube(self.bm, size=1.0)
        vs = r['verts']
        if not isinstance(rot, Euler): rot = R(*rot)
        local = Matrix.Translation(Vector(c)) @ rot.to_matrix().to_4x4() @ Matrix.Diagonal(Vector((*s, 1)))
        self._xf(vs, local)
        edges = list({e for v in vs for e in v.link_edges})
        bf = self._bevel(edges, bevel, seg)
        self._finish(before, color, mat, wear, bf)
        if collide: self._obb(Matrix.Translation(Vector(c)) @ rot.to_matrix().to_4x4(), (s[0] / 2, s[1] / 2, s[2] / 2))

    def cyl(self, c=(0, 0, 0), r1=0.5, r2=None, h=1.0, axis='z', segs=12, color=BONE, rot=(0, 0, 0), bevel=0.0,
            caps=True, mat=HULL, wear=0.1, collide=False, smooth=True):
        """Cylinder / cone along `axis`; r1 at -h/2, r2 at +h/2."""
        r2 = r1 if r2 is None else r2
        before = set(self.bm.faces)
        r = bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=h)
        vs = r['verts']
        ax = {'z': Matrix.Identity(4), 'x': Matrix.Rotation(math.radians(90), 4, 'Y'), 'y': Matrix.Rotation(math.radians(-90), 4, 'X')}[axis]
        if not isinstance(rot, Euler): rot = R(*rot)
        local = Matrix.Translation(Vector(c)) @ rot.to_matrix().to_4x4() @ ax
        self._xf(vs, local)
        bf = set()
        if bevel > 0 and caps:
            edges = [e for e in {e for v in vs for e in v.link_edges}
                     if any(len(f.verts) == segs for f in e.link_faces)]
            bf = self._bevel(edges, bevel)
        self._finish(before, color, mat, wear, bf)
        if collide:
            R_ = max(r1, r2)
            self._obb(local, (R_, R_, h / 2))  # local frame already includes the axis rotation

    def sphere(self, c=(0, 0, 0), r=0.5, scale=(1, 1, 1), color=BONE, segs=12, rings=8, half=False, rot=(0, 0, 0), mat=HULL, wear=0.1):
        before = set(self.bm.faces)
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=segs, v_segments=rings, radius=r)
        vs = res['verts']
        if half:  # keep z >= 0 (dome facing +z)
            geom = list(self.bm.verts) and [g for g in vs] + list({e for v in vs for e in v.link_edges}) + list({f for v in vs for f in v.link_faces})
            bmesh.ops.bisect_plane(self.bm, geom=geom, plane_co=(0, 0, 0), plane_no=(0, 0, 1), clear_inner=True)
            vs = [v for v in vs if v.is_valid]
            # cap the cut
            rim = [e for e in {e for v in vs for e in v.link_edges} if e.is_boundary]
            if rim: bmesh.ops.edgeloop_fill(self.bm, edges=rim)
        if not isinstance(rot, Euler): rot = R(*rot)
        local = Matrix.Translation(Vector(c)) @ rot.to_matrix().to_4x4() @ Matrix.Diagonal(Vector((*scale, 1)))
        self._xf([v for v in self.bm.verts if v.is_valid and any(f not in before for f in v.link_faces)], local)
        self._finish(before, color, mat, wear)

    def poly(self, pts, depth, c=(0, 0, 0), color=BONE, plane='xy', rot=(0, 0, 0), bevel=0.0, mat=HULL, wear=0.1, collide_box=None):
        """Extrude a 2D polygon (counter-clockwise) symmetrically by `depth`. plane xy extrudes along z, xz along y, yz along x."""
        before = set(self.bm.faces)
        vs = [self.bm.verts.new((p[0], p[1], 0)) for p in pts]
        f = self.bm.faces.new(vs)
        ext = bmesh.ops.extrude_face_region(self.bm, geom=[f])
        nv = [g for g in ext['geom'] if isinstance(g, bmesh.types.BMVert)]
        bmesh.ops.translate(self.bm, vec=(0, 0, depth), verts=nv)
        allv = vs + nv
        bmesh.ops.translate(self.bm, vec=(0, 0, -depth / 2), verts=allv)
        bmesh.ops.recalc_face_normals(self.bm, faces=list({f for v in allv for f in v.link_faces}))
        pm = {'xy': Matrix.Identity(4), 'xz': Matrix.Rotation(math.radians(90), 4, 'X'), 'yz': Matrix.Rotation(math.radians(90), 4, 'Y') @ Matrix.Rotation(math.radians(90), 4, 'Z')}[plane]
        if not isinstance(rot, Euler): rot = R(*rot)
        local = Matrix.Translation(Vector(c)) @ rot.to_matrix().to_4x4() @ pm
        self._xf(allv, local)
        edges = list({e for v in allv for e in v.link_edges})
        bf = self._bevel(edges, bevel)
        self._finish(before, color, mat, wear, bf)
        if collide_box: self._obb(Matrix.Translation(Vector(c)) @ rot.to_matrix().to_4x4(), collide_box)

    def loft(self, sections, color=BONE, c=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, mat=HULL, wear=0.1, cap=True, colors=None, closed=True, recalc=True):
        """sections: list of (z, [(x,y)...]) with equal point counts. Faces connect consecutive sections.
        closed=False leaves the ring open between the last and first point (a shell, e.g. a cockpit tub);
        recalc=False keeps the winding as given (sections in +z order, points clockwise seen from +z = normals inward)."""
        before = set(self.bm.faces)
        rings = [[self.bm.verts.new((x, y, z)) for (x, y) in pts] for z, pts in sections]
        n = len(rings[0])
        for a, b in zip(rings, rings[1:]):
            for i in range(n if closed else n - 1):
                j = (i + 1) % n
                try: self.bm.faces.new((a[i], a[j], b[j], b[i]))
                except ValueError: pass
        if cap:
            for ring in (rings[0], rings[-1]):
                try: self.bm.faces.new(ring)
                except ValueError: pass
        allv = [v for r_ in rings for v in r_]
        faces = list({f for v in allv for f in v.link_faces if f not in before})
        if recalc: bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        if not isinstance(rot, Euler): rot = R(*rot)
        self._xf(allv, Matrix.Translation(Vector(c)) @ rot.to_matrix().to_4x4())
        edges = list({e for v in allv for e in v.link_edges})
        bf = self._bevel(edges, bevel)
        self._finish(before, color, mat, wear, bf)

    def rings(self, rings, color=BONE, mat=HULL, cap0=False, cap1=False, closed=True, wear=0.06):
        """Skin through rings of 3D points (same count each, ascending around). Winding is fixed to face outward.
        `color` may be a hex or a callable (centre, normal) -> hex for painted livery."""
        before = set(self.bm.faces)
        n = len(rings[0])
        V = [[self.bm.verts.new(tuple(p)) for p in r] for r in rings]
        faces = []
        for i in range(len(V) - 1):
            for j in range(n if closed else n - 1):
                k_ = (j + 1) % n
                try: faces.append(self.bm.faces.new((V[i][j], V[i + 1][j], V[i + 1][k_], V[i][k_])))
                except ValueError: pass
        caps = []
        # the two caps face opposite ways: the last ring's cap is wound backwards so that, after the outward
        # check below, both caps face out (with the same order both, the last one always pointed inward)
        for flag, ring in ((cap0, V[0]), (cap1, V[-1][::-1])):
            if flag:
                try: caps.append(self.bm.faces.new(ring))
                except ValueError: pass
        allf = faces + caps
        self.bm.normal_update()
        cen = sum((v.co for r_ in V for v in r_), Vector()) / (len(V) * n)
        if sum((f.calc_center_median() - cen).dot(f.normal) for f in faces) < 0:
            bmesh.ops.reverse_faces(self.bm, faces=allf)
        self.bm.normal_update()
        self._finish(before, color, mat, wear)
        return allf

    def lathe_z(self, prof, c=(0, 0, 0), color=BONE, mat=HULL, segs=20, rot=(0, 0, 0), sx=1.0, sy=1.0, cap0=True, cap1=True, wear=0.06):
        """Revolve [(z, r)] around the z axis at c (r may be 0 at the ends)."""
        if not isinstance(rot, Euler): rot = R(*rot)
        M = Matrix.Translation(Vector(c)) @ rot.to_matrix().to_4x4()
        rs = [[M @ Vector((r * sx * math.cos(2 * math.pi * j / segs), r * sy * math.sin(2 * math.pi * j / segs), z)) for j in range(segs)] for z, r in prof]
        return self.rings(rs, color, mat, cap0, cap1, wear=wear)

    def link(self, p0, p1, r0, r1, color=SLATE_L, segs=10, mat=HULL, caps=True):
        """Tapered round strut from p0 to p1."""
        a, b = Vector(p0), Vector(p1); d = b - a
        rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_euler()
        self.cyl(tuple((a + b) / 2), r0, r1, d.length, 'z', segs, color, rot=rot, mat=mat, wear=0.04, caps=caps)

    def lamp(self, c, s=(0.2, 0.2, 0.05), color=AMBER, rot=(0, 0, 0)):
        self.box(c, s, color=color, rot=rot, mat=LAMP, wear=0)

    def panels(self, c, size, nx, ny, plane='z', sign=1, gap=0.06, lift=0.035, color=BONE, vary=0.18, bevel=0.012, skip=0.0):
        """Grid of thin plates on a face: panel seams + subtle shade variation. `c` is the face centre, size=(a,b) in the face plane."""
        a, b = size
        pw, ph = (a - gap * (nx + 1)) / nx, (b - gap * (ny + 1)) / ny
        for i in range(nx):
            for j in range(ny):
                if self.rng.random() < skip: continue
                u = -a / 2 + gap * (i + 1) + pw * (i + 0.5)
                v = -b / 2 + gap * (j + 1) + ph * (j + 0.5)
                sh = 1 + (self.rng.random() - 0.5) * vary
                col = tuple(min(1, x * sh) for x in lin(color))
                if plane == 'z': self.box((c[0] + u, c[1] + v, c[2] + sign * lift / 2), (pw, ph, lift), col, bevel=bevel, wear=0)
                elif plane == 'y': self.box((c[0] + u, c[1] + sign * lift / 2, c[2] + v), (pw, lift, ph), col, bevel=bevel, wear=0)
                else: self.box((c[0] + sign * lift / 2, c[1] + u, c[2] + v), (lift, pw, ph), col, bevel=bevel, wear=0)

    def stripes(self, c, size, n, axis='z', color=HAZ, base=BLACK, thick=0.05, slant=1.0, base_box=True):
        """Hazard band on a face whose normal is +axis. Slanted bars clipped exactly to the band."""
        a, b = size
        plane = {'z': 'xy', 'y': 'xz', 'x': 'yz'}[axis]
        w = a / n
        sl = b * slant
        off = {'z': (0, 0, thick / 2), 'y': (0, thick / 2, 0), 'x': (thick / 2, 0, 0)}[axis]
        cc = (c[0] + off[0], c[1] + off[1], c[2] + off[2])
        if base_box:
            self.poly([(-a / 2, -b / 2), (a / 2, -b / 2), (a / 2, b / 2), (-a / 2, b / 2)], thick, cc, base, plane, wear=0)
        for i in range(-2, n + 2, 2):
            x0 = -a / 2 + i * w
            pts = [(x0, -b / 2), (x0 + w, -b / 2), (x0 + w + sl, b / 2), (x0 + sl, b / 2)]
            pts = _clip_x(pts, -a / 2, a / 2)
            if len(pts) >= 3: self.poly(pts, thick * 1.2, cc, color, plane, wear=0)

    def greebles(self, c, size, n, plane='z', sign=1, hmax=0.25, smax=0.7, smin=0.15, colors=(BONE_D, BONE, RUST, SLATE_L), lampfrac=0.0):
        a, b = size
        for _ in range(n):
            sw, sh = self.rng.uniform(smin, smax), self.rng.uniform(smin, smax)
            hh = self.rng.uniform(0.05, hmax)
            u, v = self.rng.uniform(-a / 2 + sw, a / 2 - sw), self.rng.uniform(-b / 2 + sh, b / 2 - sh)
            col = self.rng.choice(colors)
            if plane == 'z': self.box((c[0] + u, c[1] + v, c[2] + sign * hh / 2), (sw, sh, hh), col, bevel=min(0.03, hh * 0.3))
            elif plane == 'y': self.box((c[0] + u, c[1] + sign * hh / 2, c[2] + v), (sw, hh, sh), col, bevel=min(0.03, hh * 0.3))
            else: self.box((c[0] + sign * hh / 2, c[1] + u, c[2] + v), (hh, sw, sh), col, bevel=min(0.03, hh * 0.3))

    # ---- finishing ------------------------------------------------------------------
    def smooth_by_angle(self, deg=38):
        lim = math.radians(deg)
        self.bm.normal_update()
        for e in self.bm.edges:
            fs = e.link_faces
            ok = len(fs) == 2 and fs[0].normal.length > 0 and fs[1].normal.length > 0
            e.smooth = ok and fs[0].normal.angle(fs[1].normal) <= lim
        for f in self.bm.faces: f.smooth = True

    def subdivide(self, maxlen=None, rounds=5):
        maxlen = maxlen or self.maxlen
        for _ in range(rounds):
            long_e = [e for e in self.bm.edges if e.calc_length() > maxlen and e.link_faces and e.link_faces[0].material_index != LAMP]
            if not long_e: break
            bmesh.ops.subdivide_edges(self.bm, edges=long_e, cuts=1, use_grid_fill=True)
        bmesh.ops.triangulate(self.bm, faces=self.bm.faces[:])


def bake_ao(kits, rays=20, dist=2.0, strength=0.85, seed=3, other=None):
    """Bake ambient occlusion into every kit's vertex colours; kits occlude each other."""
    for k in kits:
        bmesh.ops.dissolve_degenerate(k.bm, dist=1e-5, edges=k.bm.edges[:])
        k.subdivide()
    bms = [k.bm for k in kits] + [o.bm for o in (other or [])]
    # combined BVH
    comb = bmesh.new()
    for bm in bms:
        me = bpy.data.meshes.new('t'); bm.to_mesh(me); comb.from_mesh(me); bpy.data.meshes.remove(me)
    bvh = BVHTree.FromBMesh(comb)
    rnd = random.Random(seed)
    dirs = []
    for i in range(rays):  # cosine-weighted hemisphere (z up), stratified-ish
        u1 = (i + rnd.random()) / rays; u2 = rnd.random()
        r = math.sqrt(u1); th = 2 * math.pi * u2
        dirs.append(Vector((r * math.cos(th), r * math.sin(th), math.sqrt(max(0, 1 - u1)))))
    for k in kits:
        for f in k.bm.faces:
            if f.material_index == LAMP: continue
            n = f.normal
            t = n.cross(Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))).normalized(); b = n.cross(t)
            ws = [(t * d.x + b * d.y + n * d.z) for d in dirs]
            for l in f.loops:
                o = l.vert.co + n * 0.01
                occ = 0.0
                for w in ws:
                    hit = bvh.ray_cast(o, w, dist)
                    if hit[0] is not None: occ += 1 - hit[3] / dist
                ao = 1 - strength * occ / rays
                c = l[k.col]
                l[k.col] = (c[0] * ao, c[1] * ao, c[2] * ao, 1.0)
    comb.free()


def to_objects(kits):
    objs = []
    mats = []
    for name, kw in (('hull', dict(rough=0.82, metal=0.18)), ('lamp', dict(rough=1, metal=0)), ('glass', dict(rough=0.12, metal=0.7))):
        m = bpy.data.materials.new(name); m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Roughness'].default_value = kw['rough']; bsdf.inputs['Metallic'].default_value = kw['metal']
        mats.append(m)
    for k in kits:
        k.smooth_by_angle()
        me = bpy.data.meshes.new(k.name)
        k.bm.to_mesh(me)
        for m in mats: me.materials.append(m)
        ob = bpy.data.objects.new(k.name, me)
        bpy.context.scene.collection.objects.link(ob)
        for key, v in k.meta.items(): ob[key] = v
        objs.append(ob)
    return objs


def export_glb(kits, path, extra_objects=()):
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    objs = to_objects(kits)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=False, export_yup=False, export_vertex_color='NAME', export_vertex_color_name='Col', export_all_vertex_colors=False,
                              export_active_vertex_color_when_no_material=True, export_extras=True, export_cameras=False, export_lights=False,
                              export_normals=True, export_texcoords=False, export_materials='EXPORT')
    tris = sum(len(o.data.polygons) for o in objs)
    for o in objs:
        if len(o.data.polygons) > 4000: print("  ", o.name, len(o.data.polygons))
    print(f'{path}: {len(objs)} objects, {tris} tris')
