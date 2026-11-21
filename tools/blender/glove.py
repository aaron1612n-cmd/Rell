"""The EVA glove as ONE sculpted surface: a signed distance field (palm, four fingers, thumb, smooth-blended
webbing, thenar mound, knuckles, creases) polygonised with marching cubes, relaxed and decimated. The game
skins it to a bone per phalanx (src/astronaut.js buildGlove) using the joint chains written to astronaut.json.

Needs scikit-image in the Blender venv:  /tmp/bv/bin/pip install bpy scikit-image

Right glove in its wrist frame: fingers -Y, palm normal -X, back of the hand +X, thumb toward -Z, origin at
the wrist (the centre of the gauntlet's hem). Rest pose: fingers straight and slightly fanned, thumb relaxed.
"""
import math
import numpy as np
import bpy, bmesh
from mathutils import Vector
from skimage.measure import marching_cubes

# ---- skeleton --------------------------------------------------------------------------------------
# fingers: MCP joint, fan angle (rad, about X), phalanx lengths, radii at MCP / PIP / DIP / tip
FING = [
    ((-0.002, -0.097, -0.0312), -0.085, (0.035, 0.024, 0.018), (0.0118, 0.0112, 0.0105, 0.0098)),
    ((-0.002, -0.1005, -0.0104), -0.025, (0.038, 0.026, 0.019), (0.0121, 0.0115, 0.0107, 0.0100)),
    ((-0.002, -0.0985, 0.0104), 0.045, (0.036, 0.025, 0.018), (0.0116, 0.0110, 0.0103, 0.0096)),
    ((-0.001, -0.0925, 0.0302), 0.13, (0.029, 0.020, 0.016), (0.0106, 0.0100, 0.0094, 0.0088)),
]
FLAT = 0.86            # finger thickness (palm<->back) / width


def _n(v):
    v = np.asarray(v, float); return v / np.linalg.norm(v)


def chains():
    """Joint chains [{j: [p0..p3], r: [r0..r3], flex: unit vector the tips curl toward}] (fingers, then thumb)."""
    out = []
    for (b, a, L, r) in FING:
        d = np.array([0.0, -math.cos(a), math.sin(a)])
        js = [np.array(b)]
        for l in L: js.append(js[-1] + d * l)
        out.append({'j': js, 'r': list(r), 'flex': np.array([-1.0, 0, 0]), 'flat': FLAT})
    # thumb: CMC deep in the heel of the hand, metacarpal running out to the thumb-index web, two phalanges
    C = np.array([-0.0105, -0.016, -0.024]); M = np.array([-0.0215, -0.055, -0.050])
    D = _n((-0.30, -0.80, -0.52))
    I = M + D * 0.031; T = I + _n(D + np.array([-0.06, 0.0, 0.08])) * 0.025
    flex = np.array([-0.62, 0.05, 0.78]); flex = _n(flex - flex.dot(D) * D)
    out.append({'j': [C, M, I, T], 'r': [0.0165, 0.0142, 0.0130, 0.0114], 'flex': flex, 'flat': 0.9})
    return out


# ---- SDF helpers (numpy, vectorised over (..., 3)) ---------------------------------------------------
def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def seg(p, a, b, ra, rb, flat=1.0, fax=None):
    """Tapered capsule a->b, squashed along fax by `flat`. Returns (distance, t along the segment)."""
    q = p - a
    if fax is not None and flat != 1.0:
        q = q + np.einsum('...i,i->...', q, fax)[..., None] * fax * (1 / flat - 1)
    ab = b - a; L2 = ab.dot(ab)
    t = np.clip(np.einsum('...i,i->...', q, ab) / L2, 0, 1)
    d = np.linalg.norm(q - t[..., None] * ab, axis=-1) - (ra + (rb - ra) * t)
    return d * (flat if fax is not None else 1.0) ** 0.5, t


# palm sections down -Y: y, half width thumb side, little side, back depth, palm depth
# (the wrist swells to fill the gauntlet's hem: the hand never shows a gap at the cuff)
PALM = [
    (0.040, 0.041, 0.041, 0.038, 0.038),
    (0.012, 0.039, 0.040, 0.034, 0.036),
    (0.000, 0.0365, 0.038, 0.029, 0.032),
    (-0.012, 0.0335, 0.0355, 0.0235, 0.0262),
    (-0.026, 0.0385, 0.0405, 0.0210, 0.0250),
    (-0.044, 0.0450, 0.0438, 0.0205, 0.0240),
    (-0.062, 0.0470, 0.0450, 0.0198, 0.0230),
    (-0.080, 0.0470, 0.0450, 0.0186, 0.0212),
    (-0.094, 0.0455, 0.0440, 0.0170, 0.0190),
]
PY = np.array([r[0] for r in PALM][::-1])
PV = [np.array([r[i] for r in PALM][::-1]) for i in range(1, 5)]
Y0, Y1 = -0.099, 0.036       # rounded knuckle end, cut inside the gauntlet


def palm_sdf(p):
    x, y, z = p[..., 0], p[..., 1], p[..., 2]
    yc = np.clip(y, PY[0], PY[-1])
    wt, wl, db, dp = (np.interp(yc, PY, v) for v in PV)
    # the knuckle line arcs: the middle finger's knuckle sits furthest out
    yend = Y0 + 0.006 * (z / 0.045) ** 2 + 0.0015 * (z > 0)
    a = np.where(x > 0, db, dp); b = np.where(z < 0, wt, wl)
    n = 2.5
    r = (np.abs(x / a) ** n + np.abs(z / b) ** n) ** (1 / n)
    d2 = (r - 1) * np.minimum(a, b)
    rr = 0.011
    dy = np.maximum(yend - y, y - Y1)
    d = np.sqrt(np.maximum(d2 + rr, 0) ** 2 + np.maximum(dy + rr, 0) ** 2) + np.minimum(np.maximum(d2 + rr, dy + rr), 0) - rr
    # sculpt: hollow of the palm, hypothenar pad, tendons on the back, a quilted pad on the back of the hand
    G = lambda v, s: np.exp(-(v / s) ** 2)
    palmside = np.clip(-x / 0.012, 0, 1)
    d += 0.0034 * palmside * G(y + 0.064, 0.02) * G(z + 0.004, 0.018)
    d -= 0.0030 * palmside * G(y + 0.048, 0.024) * G(z - 0.034, 0.011)
    d -= 0.0018 * palmside * G(y + 0.091, 0.006) * G(z, 0.04)
    back = np.clip(x / 0.01, 0, 1)
    d -= 0.0007 * back * np.cos(np.clip(z / 0.0207, -1.5, 1.5) * math.pi) ** 2 * G(y + 0.07, 0.02)
    padr = np.maximum(np.abs(y + 0.058) / 0.027, np.abs(z + 0.002) / 0.033)
    d -= 0.0016 * back * np.clip((1 - padr) / 0.12, 0, 1)
    return d


def hand_sdf(p, CH):
    G = lambda v, s: np.exp(-(v / s) ** 2)
    d = palm_sdf(p)
    fingers = None
    for ci, c in enumerate(CH):
        js, r, flex, flat = c['j'], c['r'], c['flex'], c['flat']
        cd = None
        for k in range(3):
            dk, t = seg(p, js[k], js[k + 1], r[k], r[k + 1], flat, flex)
            # crease across the palm side of each joint, knuckle on the back
            ax = _n(js[k + 1] - js[k]); q = p - js[k]
            along = np.einsum('...i,i->...', q, ax)
            side = np.einsum('...i,i->...', q, flex)
            ps = np.clip(side / (r[k] * 0.6), 0, 1); bs = np.clip(-side / (r[k] * 0.6), 0, 1)
            if k > 0 or ci == 4:
                dk = dk + 0.0011 * ps * G(along, 0.0016) - (0.0011 if ci < 4 else 0.0006) * bs * G(along, 0.0045)
            cd = dk if cd is None else np.minimum(cd, dk)
        if ci == 4:
            d = smin(d, cd, 0.011)          # thenar mound and the web to the index finger
        else:
            fingers = cd if fingers is None else np.minimum(fingers, cd)
    d = smin(d, fingers, 0.0055)              # webbing between the finger roots
    # knuckle bumps across the back of the hand
    for c in CH[:4]:
        b = c['j'][0] + np.array([0.0125, -0.003, 0.0])
        kd = np.linalg.norm((p - b) * np.array([1.4, 1.0, 1.0]), axis=-1) - 0.0085
        d = smin(d, kd, 0.006)
    return d


def surface_point(CH, o, dirn, rmax=0.08):
    """March from o along dirn to the surface (bisection on the SDF)."""
    lo, hi = 0.0, rmax
    f = lambda s: hand_sdf((o + dirn * s)[None], CH)[0]
    for _ in range(30):
        m = (lo + hi) / 2
        if f(m) < 0: lo = m
        else: hi = m
    return o + dirn * lo


def build_hand(P, J, C):
    """C: colours / material indices dict. Returns [hand (skinned surface), handgear (rigid strap + buckle)]."""
    CH = chains()
    h = 0.00075
    lo = np.array([-0.075, -0.205, -0.115]); hi = np.array([0.05, 0.045, 0.075])
    xs, ys, zs = (np.arange(lo[i], hi[i], h) for i in range(3))
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
    vol = hand_sdf(np.stack([X, Y, Z], -1), CH)
    verts, faces, _, _ = marching_cubes(vol, 0.0, spacing=(h, h, h))
    verts += lo
    print('   hand MC', len(verts), 'verts', len(faces), 'faces')
    me = bpy.data.meshes.new('mc'); me.from_pydata([tuple(v) for v in verts], [], [tuple(f[::-1]) for f in faces]); me.update()
    ob = bpy.data.objects.new('mc', me); bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    # an even quad remesh (no slivers: the vertex colours and the baked occlusion stay clean)
    rm = ob.modifiers.new('r', 'REMESH'); rm.mode = 'VOXEL'; rm.voxel_size = 0.0026; rm.use_smooth_shade = True
    dg = bpy.context.evaluated_depsgraph_get()
    em = ob.evaluated_get(dg).to_mesh()
    k = P('hand', 41)
    k.bm.from_mesh(em)
    ob.evaluated_get(dg).to_mesh_clear(); bpy.data.objects.remove(ob); bpy.data.meshes.remove(me)
    bmesh.ops.triangulate(k.bm, faces=k.bm.faces[:], quad_method='BEAUTY')
    bmesh.ops.recalc_face_normals(k.bm, faces=k.bm.faces[:])
    # snap the relaxed, decimated vertices back onto the field (keeps the knuckles and creases crisp)
    V = np.array([v.co[:] for v in k.bm.verts])
    for _ in range(3):
        e = 2e-5
        d0 = hand_sdf(V, CH)
        g = np.stack([(hand_sdf(V + np.eye(3)[i] * e, CH) - d0) / e for i in range(3)], -1)
        g /= np.maximum(np.linalg.norm(g, axis=-1, keepdims=True), 1e-9)
        V = V - g * d0[:, None]
    for v, p in zip(k.bm.verts, V): v.co = Vector(p)
    print('   hand', len(k.bm.faces), 'tris')
    paint_hand(k, CH, C)
    J['hand'] = {'chains': [{'j': [list(map(float, p)) for p in c['j']], 'r': c['r'], 'flex': list(map(float, c['flex']))} for c in CH]}
    return [k, build_gear(P, CH, C)]


def region(p, CH):
    """(chain index or -1 for the palm, phalanx k, along, side (+ palm side), lateral) for a point."""
    best = (1e9, -1, 0, 0.0, 0.0, 0.0)
    for ci, c in enumerate(CH):
        js, r, flex = c['j'], c['r'], c['flex']
        for k in range(3):
            a, b = js[k], js[k + 1]; ab = b - a; L = np.linalg.norm(ab); ax = ab / L
            q = p - a; t = q.dot(ax)
            tc = min(max(t, 0), L)
            dd = np.linalg.norm(q - ax * tc) - r[k]
            if k == 0 and t < 0: dd += -t * 2        # behind the knuckle: the palm owns it
            if dd < best[0]:
                lat = np.cross(ax, flex)
                best = (dd, ci, k, t, q.dot(flex) / r[k], q.dot(lat) / r[k])
    return best


def paint_hand(k, CH, C):
    """Colour per vertex (soft edges between fabric and rubber), material per face by majority."""
    from kit import lin
    k.bm.normal_update()
    vc = {}
    for v in k.bm.verts:
        p = np.array(v.co[:])
        dd, ci, ph, t, side, lat = region(p, CH)
        col, mat = C['suit'], 0
        x, y, z = p
        if dd > 0.0025 or ci < 0:
            # rubber grip pads on the palm, split by a flex line; a knuckle bar; a stitched pad on the back
            if x < -0.0135 and -0.093 < y < -0.024 and abs(y + 0.058 + 0.12 * z) > 0.0022 and -0.037 < z < 0.036:
                col, mat = C['rubber'], 1
            elif x > 0.0155 and -0.106 < y < -0.089 and abs(z) < 0.043:
                col = C['guard']
            elif x > 0.008 and (abs(abs(y + 0.058) - 0.027) < 0.0013 and abs(z + 0.002) < 0.034 or abs(abs(z + 0.002) - 0.033) < 0.0013 and abs(y + 0.058) < 0.027):
                col = C['seam']
            elif x > 0.008 and abs(y + 0.058) < 0.027 and abs(z + 0.002) < 0.033:
                col = C['pad']
        else:
            L = np.linalg.norm(CH[ci]['j'][ph + 1] - CH[ci]['j'][ph])
            if ph == 2 and (t > L * 0.3 and side > -0.3 or t > L):
                col, mat = C['tip'], 1                         # silicone fingertip
            elif side > 0.5 and 0.004 < t < L - 0.004 and (ph > 0 or ci == 4 or t > 0.012):
                col, mat = C['rubber'], 1                      # grip pad on each phalanx
            elif abs(lat) > 0.92:
                col = C['seam']                                # side seams
        vc[v] = (lin(col), mat)
    for f in k.bm.faces:
        rub = sum(vc[v][1] for v in f.verts)
        f.material_index = C['RUBBER'] if rub >= 2 else C['GLOVE']
        for l in f.loops: l[k.col] = (*vc[l.vert][0], 1.0)
    # UVs for the fabric bump: a cheap box projection
    for f in k.bm.faces:
        n = f.normal
        for l in f.loops:
            p = l.vert.co
            if abs(n.x) > max(abs(n.y), abs(n.z)): uv = (p.z, p.y)
            elif abs(n.y) > abs(n.z): uv = (p.x, p.z)
            else: uv = (p.x, p.y)
            l[k.uv].uv = (uv[0] * 9, uv[1] * 9)


def build_gear(P, CH, C):
    """Rigid hardware on the palm bone: the wrist strap (hugging the surface) with its buckle."""
    k = P('handgear', 43)
    rings = []
    for y in (-0.0085, -0.0105, -0.0175, -0.0195):
        inset = 0.0 if y in (-0.0105, -0.0175) else -0.0012
        ring = []
        for j in range(48):
            th = 2 * math.pi * j / 48
            dv = np.array([math.cos(th), 0, math.sin(th)])
            sp = surface_point(CH, np.array([0.0, y, 0.0]), dv)
            ring.append(Vector(sp + dv * (0.0022 + inset)))
        rings.append(ring)
    k.rings(rings, C['slate'], C['RUBBER'], closed=True)
    xb = surface_point(CH, np.array([0.0, -0.014, 0.004]), np.array([1.0, 0, 0]))[0]
    k.rbox((xb + 0.0035, -0.014, 0.004), (0.005, 0.014, 0.019), C['metal'], C['METAL'], bevel=0.0018)
    k.rbox((xb + 0.0062, -0.014, 0.004), (0.0016, 0.0068, 0.010), C['haz'], C['HAZ'], bevel=0.0006)
    return k
