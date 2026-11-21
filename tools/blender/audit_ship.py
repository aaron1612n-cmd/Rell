"""Floating-part audit: records each primitive's bounds + source line in ship.py, then flags primitives whose
(slightly grown) bounds touch nothing in the main assembly. Run: python tools/blender/audit_ship.py"""
import sys, os, traceback
sys.path.insert(0, os.path.dirname(__file__))
import kit
prims = []
orig = kit.Kit._finish
def fin(self, before, *a, **kw):
    fs = [f for f in self.bm.faces if f not in before]
    if fs:
        vs = [v.co for f in fs for v in f.verts]
        lo = [min(v[i] for v in vs) for i in range(3)]; hi = [max(v[i] for v in vs) for i in range(3)]
        ln = next((fr.lineno for fr in reversed(traceback.extract_stack()) if fr.filename.endswith('ship.py')), 0)
        prims.append((ln, lo, hi, [tuple(v.co) for f in fs for v in f.verts], [[v.co.copy() for v in f.verts] for f in fs]))
    return orig(self, before, *a, **kw)
kit.Kit._finish = fin
kit.bake_ao = lambda *a, **k: None
kit.export_glb = lambda *a, **k: None
src = open(os.path.join(os.path.dirname(__file__), 'ship.py')).read()
g = {'__file__': os.path.join(os.path.dirname(__file__), 'ship.py'), '__name__': '__main__'}
exec(compile(src, 'ship.py', 'exec'), g)
EPS = float(os.environ.get('EPS', 0.003))
from mathutils import Vector
from mathutils.bvhtree import BVHTree
hv = []; hf = []
for tri in prims[0][4]:
    base = len(hv); hv += tri
    for k in range(1, len(tri) - 1): hf.append((base, base + k, base + k + 1))
BV = BVHTree.FromPolygons(hv, hf)
def on_hull(p):
    c = Vector(p); loc, nor, idx, d = BV.find_nearest(c)
    if d is not None and d <= EPS: return True
    hits = 0; o = c; dr = Vector((0.3, 1, 0.2)).normalized()
    while True:
        loc, nor, idx, d = BV.ray_cast(o, dr)
        if loc is None: break
        hits += 1; o = loc + dr * 1e-4
    return hits % 2 == 1
def touch(a, b):
    if a is prims[0]: return any(on_hull(v) for v in b[3])
    if b is prims[0]: return any(on_hull(v) for v in a[3])
    return all(a[1][i] - EPS <= b[2][i] and b[1][i] - EPS <= a[2][i] for i in range(3))
n = len(prims); seen = {0}; stack = [0]
while stack:
    i = stack.pop()
    for j in range(n):
        if j not in seen and touch(prims[i], prims[j]): seen.add(j); stack.append(j)
print('prims', n, 'connected', len(seen))
for j in range(n):
    if j not in seen: print('FLOATING line', prims[j][0], [round(x, 2) for x in prims[j][1]], [round(x, 2) for x in prims[j][2]])
if os.environ.get('DUMP'):
    for p in prims:
        if p[1][0] > .3 and p[2][1] < .1 and p[1][1] > -.45 and p[2][2] < 1.0 : print('P', [round(x, 2) for x in p[1]], [round(x, 2) for x in p[2]])
