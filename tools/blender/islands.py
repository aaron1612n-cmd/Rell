"""Connectivity: split a bmesh into islands, decide which islands touch (share a near point or one's edges
cut the other's faces), and return the ones not joined to the biggest island."""
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

def islands(bm):
    bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
    comp = {}; out = []
    for v in bm.verts:
        if v in comp: continue
        cid = len(out); stack = [v]; comp[v] = cid; vs = []
        while stack:
            a = stack.pop(); vs.append(a)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b not in comp: comp[b] = cid; stack.append(b)
        out.append(vs)
    return comp, out

def audit(bm, tol=0.03):
    comp, isl = islands(bm)
    faces = [f for f in bm.faces]
    fid = [comp[f.verts[0]] for f in faces]
    bvh = BVHTree.FromPolygons([v.co for v in bm.verts], [[v.index for v in f.verts] for f in faces], epsilon=0.0)
    bm.verts.index_update()
    n = len(isl); adj = [set() for _ in range(n)]
    for cid, vs in enumerate(isl):
        # near points
        for v in vs:
            for (co, nn, fi, d) in bvh.find_nearest_range(v.co, tol):
                o = fid[fi]
                if o != cid: adj[cid].add(o); adj[o].add(cid)
        # edges crossing other faces
        es = {e for v in vs for e in v.link_edges}
        for e in es:
            a, b = e.verts[0].co, e.verts[1].co; d = b - a; L = d.length
            if L < 1e-6: continue
            d = d / L; o0 = a
            for _ in range(4):
                hit = bvh.ray_cast(o0, d, L - (o0 - a).length)
                if hit[0] is None: break
                o = fid[hit[2]]
                if o != cid: adj[cid].add(o); adj[o].add(cid); break
                o0 = hit[0] + d * 1e-4
    size = [len(v) for v in isl]
    main = max(range(n), key=lambda i: size[i])
    seen = {main}; st = [main]
    while st:
        a = st.pop()
        for b in adj[a]:
            if b not in seen: seen.add(b); st.append(b)
    bad = []
    for cid in range(n):
        if cid in seen: continue
        vs = isl[cid]; mn = Vector((min(v.co.x for v in vs), min(v.co.y for v in vs), min(v.co.z for v in vs)))
        mx = Vector((max(v.co.x for v in vs), max(v.co.y for v in vs), max(v.co.z for v in vs)))
        bad.append({'c': [round(x, 2) for x in (mn + mx) / 2], 'size': [round(x, 2) for x in mx - mn], 'nv': len(vs)})
    bad.sort(key=lambda b: -max(b['size']))
    return bad


def _groups(bm, tol):
    """islands, their adjacency, and the groups of islands joined to each other (index 0 = the main group)"""
    comp, isl = islands(bm)
    faces = [f for f in bm.faces]
    bm.verts.index_update()
    fid = [comp[f.verts[0]] for f in faces]
    bvh = BVHTree.FromPolygons([v.co for v in bm.verts], [[v.index for v in f.verts] for f in faces], epsilon=0.0)
    n = len(isl); adj = [set() for _ in range(n)]
    for cid, vs in enumerate(isl):
        for v in vs:
            for (co, nn, fi, d) in bvh.find_nearest_range(v.co, tol):
                o = fid[fi]
                if o != cid: adj[cid].add(o); adj[o].add(cid)
        es = {e for v in vs for e in v.link_edges}
        for e in es:
            a, b = e.verts[0].co, e.verts[1].co; d = b - a; L = d.length
            if L < 1e-6: continue
            d = d / L; o0 = a
            for _ in range(4):
                hit = bvh.ray_cast(o0, d, L - (o0 - a).length)
                if hit[0] is None: break
                o = fid[hit[2]]
                if o != cid: adj[cid].add(o); adj[o].add(cid); break
                o0 = hit[0] + d * 1e-4
    size = [len(v) for v in isl]
    main = max(range(n), key=lambda i: size[i])
    gid = [-1] * n; groups = []
    for start in [main] + list(range(n)):
        if gid[start] >= 0: continue
        g = len(groups); gid[start] = g; st = [start]; mem = []
        while st:
            a = st.pop(); mem.append(a)
            for b in adj[a]:
                if gid[b] < 0: gid[b] = g; st.append(b)
        groups.append(mem)
    return isl, groups


def weld(k, tol=0.03, link=None, rounds=4, log=print):
    """Make every part touch the ship: loose vertices go, small gaps close by sliding the floating group
    onto the nearest surface of the main body, wide gaps get a strut. Returns how many groups it moved."""
    bm = k.bm
    loose = [v for v in bm.verts if not v.link_faces]
    if loose: bmesh.ops.delete(bm, geom=loose, context='VERTS')
    moved = 0
    for _ in range(rounds):
        isl, groups = _groups(bm, tol)
        if len(groups) <= 1: break
        mainv = [v for i in groups[0] for v in isl[i]]
        mainset = set(mainv)
        mf = [f for f in bm.faces if f.verts[0] in mainset]
        bm.verts.index_update()
        bvh = BVHTree.FromPolygons([v.co for v in bm.verts], [[v.index for v in f.verts] for f in mf], epsilon=0.0)
        for g in groups[1:]:
            vs = [v for i in g for v in isl[i]]
            mn = Vector((min(v.co.x for v in vs), min(v.co.y for v in vs), min(v.co.z for v in vs)))
            mx = Vector((max(v.co.x for v in vs), max(v.co.y for v in vs), max(v.co.z for v in vs)))
            size = max((mx - mn).length, 1e-3)
            best = None
            for v in vs:
                co, nn, fi, d = bvh.find_nearest(v.co)
                if co is not None and (best is None or d < best[2]): best = (v.co.copy(), co.copy(), d)
            if best is None: continue
            a, b, d = best
            if d <= max(1.0, size * 2.5):
                dirv = (b - a); L = dirv.length
                sh = dirv.normalized() * (L + min(0.12, size * 0.06)) if L > 1e-6 else Vector((0, 0, 0))
                for v in vs: v.co += sh
                log(f'    slid {len(vs)}v by {L:.2f} at {[round(x, 1) for x in a]}')
            elif link:
                dirv = (b - a).normalized(); r = max(0.04, min(size * 0.06, d * 0.08))
                link(tuple(a - dirv * r), tuple(b + dirv * r * 2), r, r * 0.8)
                log(f'    strut {d:.2f} at {[round(x, 1) for x in a]}')
            moved += 1
        bm.normal_update()
    return moved
