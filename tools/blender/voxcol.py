"""Solid colliders that follow a model's real shape: voxelize the surface, fill everything the outside can't
reach, then merge the solid voxels greedily into as few axis-aligned boxes as possible.
Returns [{'c','h','q'}] in model space, the format the game's OBB colliders use."""
import math
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from collections import deque

def vox_boxes(bm, v=None, maxdim_div=90, vmin=0.3, vmax=2.0, skip=None, carve=None):
    """carve(centre, v) -> True drops that solid voxel (walkable rooms inside the hull)"""
    bm.verts.ensure_lookup_table(); bm.verts.index_update()
    xs = [x.co for x in bm.verts]
    mn = Vector((min(p.x for p in xs), min(p.y for p in xs), min(p.z for p in xs)))
    mx = Vector((max(p.x for p in xs), max(p.y for p in xs), max(p.z for p in xs)))
    size = mx - mn
    if v is None: v = min(vmax, max(vmin, max(size) / maxdim_div))
    o = mn - Vector((v, v, v))
    nx, ny, nz = (int(math.ceil(size[a] / v)) + 2 for a in range(3))
    faces = [f for f in bm.faces if skip is None or not skip(f)]
    bvh = BVHTree.FromPolygons([p.co for p in bm.verts], [[x.index for x in f.verts] for f in faces])
    reach = v * 0.5 * math.sqrt(3) * 1.02
    N = nx * ny * nz
    surf = bytearray(N)
    idx = lambda i, j, k: (i * ny + j) * nz + k
    for i in range(nx):
        for j in range(ny):
            for k in range(nz):
                c = Vector((o.x + (i + .5) * v, o.y + (j + .5) * v, o.z + (k + .5) * v))
                if bvh.find_nearest(c, reach)[0] is not None: surf[idx(i, j, k)] = 1
    # flood from the border through empty voxels: whatever it can't reach is inside
    out = bytearray(N); q = deque()
    for i in range(nx):
        for j in range(ny):
            for k in (0, nz - 1):
                q.append((i, j, k))
    for i in range(nx):
        for k in range(nz):
            for j in (0, ny - 1): q.append((i, j, k))
    for j in range(ny):
        for k in range(nz):
            for i in (0, nx - 1): q.append((i, j, k))
    while q:
        i, j, k = q.popleft(); n = idx(i, j, k)
        if out[n] or surf[n]: continue
        out[n] = 1
        for di, dj, dk in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)):
            a, b, c = i + di, j + dj, k + dk
            if 0 <= a < nx and 0 <= b < ny and 0 <= c < nz and not out[idx(a, b, c)] and not surf[idx(a, b, c)]: q.append((a, b, c))
    solid = bytearray(N)
    for n in range(N): solid[n] = 0 if out[n] else 1
    if carve:
        for i in range(nx):
            for j in range(ny):
                for k in range(nz):
                    n = idx(i, j, k)
                    if solid[n] and carve(Vector((o.x + (i + .5) * v, o.y + (j + .5) * v, o.z + (k + .5) * v)), v): solid[n] = 0
    # greedy merge, trying each axis order and keeping the one that needs the fewest boxes
    dims = (nx, ny, nz); stride = (ny * nz, nz, 1)
    best = None
    for order in ((0, 1, 2), (2, 1, 0), (1, 0, 2)) if N > 2e5 else ((0, 1, 2),):
        A, B, C = order   # outer loop A, then B, grow along C first, then B, then A
        sa, sb, sc = stride[A], stride[B], stride[C]; da, db, dc = dims[A], dims[B], dims[C]
        used = bytearray(N); boxes = []
        for a in range(da):
            for b in range(db):
                for c in range(dc):
                    n = a * sa + b * sb + c * sc
                    if not solid[n] or used[n]: continue
                    ok = lambda m: solid[m] and not used[m]
                    c1 = c
                    while c1 + 1 < dc and ok(a * sa + b * sb + (c1 + 1) * sc): c1 += 1
                    b1 = b
                    while b1 + 1 < db and all(ok(a * sa + (b1 + 1) * sb + cc * sc) for cc in range(c, c1 + 1)): b1 += 1
                    a1 = a
                    while a1 + 1 < da and all(ok((a1 + 1) * sa + bb * sb + cc * sc) for bb in range(b, b1 + 1) for cc in range(c, c1 + 1)): a1 += 1
                    for x in range(a, a1 + 1):
                        for y in range(b, b1 + 1):
                            for z in range(c, c1 + 1): used[x * sa + y * sb + z * sc] = 1
                    lo3 = [0, 0, 0]; hi3 = [0, 0, 0]
                    lo3[A], lo3[B], lo3[C] = a, b, c; hi3[A], hi3[B], hi3[C] = a1 + 1, b1 + 1, c1 + 1
                    lo = Vector((o.x + lo3[0] * v, o.y + lo3[1] * v, o.z + lo3[2] * v)); hi = Vector((o.x + hi3[0] * v, o.y + hi3[1] * v, o.z + hi3[2] * v))
                    cc_ = (lo + hi) / 2; h = (hi - lo) / 2
                    boxes.append({'c': [round(x, 3) for x in cc_], 'h': [round(x, 3) for x in h], 'q': [0, 0, 0, 1]})
        if best is None or len(boxes) < len(best): best = boxes
    return best, v
