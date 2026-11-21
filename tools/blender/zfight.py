"""Find z-fighting in a built ship: pairs of faces from different islands that lie in the same plane (within a
depth tolerance), face the same way and overlap. Returns the overlapping pairs' centres."""
import bmesh, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from islands import islands

def zfight(bm, eps=None, scale=1.0):
    comp, isl = islands(bm)
    bm.faces.ensure_lookup_table(); bm.verts.index_update()
    faces = list(bm.faces)
    eps = eps or max(0.004, 0.0015 * scale)
    bvh = BVHTree.FromPolygons([v.co for v in bm.verts], [[v.index for v in f.verts] for f in faces], epsilon=0.0)
    hits = []
    for i, f in enumerate(faces):
        if f.calc_area() < 1e-6: continue
        n = f.normal; c = f.calc_center_median(); ci = comp[f.verts[0]]
        # look for another island's face just in front of / behind this face's centre, along its normal
        for sgn in (1, -1):
            hit = bvh.ray_cast(c - n * eps * sgn * 1.0 + n * 1e-6 * sgn, n * sgn, eps * 2)
            if hit[0] is None: continue
            j = hit[2]; g = faces[j]
            if comp[g.verts[0]] == ci or j == i: continue
            if g.normal.dot(n) < 0.995: continue
            if abs((hit[0] - c).dot(n)) < eps: hits.append((round(c.x, 2), round(c.y, 2), round(c.z, 2), round(f.calc_area(), 3), ci, comp[g.verts[0]], n.copy()))
            break
    return hits


def zfix(bm, scale=1.0, rounds=3, log=print):
    """Separate coplanar faces: the smaller of the two parts steps forward along the shared normal, so it reads
    as a raised plate instead of flickering into the one behind it."""
    total = 0
    for _ in range(rounds):
        hits = zfight(bm, scale=scale)
        if not hits: break
        comp, isl = islands(bm)
        eps = max(0.004, 0.0015 * scale)
        moved = set()
        for h in hits:
            a, b, n = h[4], h[5], h[6]
            small = a if len(isl[a]) <= len(isl[b]) else b
            if small in moved: continue
            moved.add(small)
            for v in isl[small]: v.co += n * eps * 4
        total += len(moved)
        bm.normal_update()
    left = zfight(bm, scale=scale)
    log(f'    z-fight: moved {total} parts, {len(left)} faces left')
    return left
