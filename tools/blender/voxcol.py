"""Solid colliders that follow a model's real shape: voxelize the surface, fill everything the outside can't
reach, then merge the solid voxels greedily into as few axis-aligned boxes as possible.
Returns [{'c','h','q'}] in model space, the format the game's OBB colliders use."""
import math
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from collections import deque

def vox_boxes(bm, v=None, maxdim_div=90, vmin=0.3, vmax=2.0, skip=None):
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
    # greedy merge: grow along z, then y, then x
    used = bytearray(N); boxes = []
    for i in range(nx):
        for j in range(ny):
            for k in range(nz):
                n = idx(i, j, k)
                if not solid[n] or used[n]: continue
                k1 = k
                while k1 + 1 < nz and solid[idx(i, j, k1 + 1)] and not used[idx(i, j, k1 + 1)]: k1 += 1
                j1 = j
                while j1 + 1 < ny and all(solid[idx(i, j1 + 1, kk)] and not used[idx(i, j1 + 1, kk)] for kk in range(k, k1 + 1)): j1 += 1
                i1 = i
                while i1 + 1 < nx and all(solid[idx(i1 + 1, jj, kk)] and not used[idx(i1 + 1, jj, kk)] for jj in range(j, j1 + 1) for kk in range(k, k1 + 1)): i1 += 1
                for a in range(i, i1 + 1):
                    for b in range(j, j1 + 1):
                        for c in range(k, k1 + 1): used[idx(a, b, c)] = 1
                lo = Vector((o.x + i * v, o.y + j * v, o.z + k * v)); hi = Vector((o.x + (i1 + 1) * v, o.y + (j1 + 1) * v, o.z + (k1 + 1) * v))
                c = (lo + hi) / 2; h = (hi - lo) / 2
                boxes.append({'c': [round(x, 3) for x in c], 'h': [round(x, 3) for x in h], 'q': [0, 0, 0, 1]})
    return boxes, v
