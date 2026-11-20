#!/usr/bin/env python3
"""C44: compare two shots.mjs runs. For every <name>.png, the count of differing pixels; for every <name>.json, the
elements and computed properties that differ (custom properties, which name tokens rather than draw, are skipped).
Exit 0 when nothing differs.  Usage: diff.py <before dir> <after dir>  (needs Pillow)"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops

a, b = Path(sys.argv[1]), Path(sys.argv[2])
bad = 0
for pa in sorted(a.glob("*.png")):
    pb = b / pa.name
    if not pb.exists():
        print(f"{pa.stem}: missing in {b}")
        bad += 1
        continue
    ia, ib = Image.open(pa).convert("RGB"), Image.open(pb).convert("RGB")
    if ia.size != ib.size:
        print(f"{pa.stem}: size {ia.size} vs {ib.size}")
        bad += 1
        continue
    diff = ImageChops.difference(ia, ib)
    n = diff.convert("L").point(lambda v: 255 if v else 0).histogram()[255]
    ja, jb = json.loads(pa.with_suffix(".json").read_text()), json.loads(pb.with_suffix(".json").read_text())
    props = []
    for el in sorted(set(ja) | set(jb)):
        if el not in ja or el not in jb:
            props.append(f"  {'only after' if el not in ja else 'only before'}: {el[-120:]}")
            continue
        for k in sorted(set(ja[el]) | set(jb[el])):
            if k.startswith("--"):
                continue
            if ja[el].get(k) != jb[el].get(k):
                props.append(f"  {el[-90:]} {k}: {ja[el].get(k)!r} -> {jb[el].get(k)!r}")
    print(f"{pa.stem}: {n} px, {len(props)} style differences")
    for p in props[:40]:
        print(p)
    if n or props:
        bad += 1
print("same" if not bad else f"{bad} shots differ")
sys.exit(1 if bad else 0)
