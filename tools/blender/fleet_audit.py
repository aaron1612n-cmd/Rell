"""Audit fleet ships: loose islands that touch nothing (floating parts). Builds the designs in memory.
Run: /tmp/bv/bin/python tools/blender/fleet_audit.py [id ...]"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
import fleet
from fleet import DESIGNS
from islands import audit

ids = [a for a in sys.argv[1:]] or list(DESIGNS.keys())
tot = 0
for i in ids:
    S, H = DESIGNS[i]()
    bad = audit(S.k.bm, tol=max(0.02, S.k.maxlen * 0.04))
    tot += len(bad)
    print(f'{i}: {len(bad)} floating')
    for b in bad[:25]: print('   ', b)
print('total floating', tot)
