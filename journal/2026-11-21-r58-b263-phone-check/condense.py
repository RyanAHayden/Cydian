#!/usr/bin/env python3
# poll.sh output -> one line per snapshot: time, then each row's name and state as the run page showed them.
import sys

rows = ["B263 A", "B263 B", "B263 Big", "iFizBox"]
out, last = [], None
for block in open(sys.argv[1]).read().split("=== ")[1:]:
    lines = block.splitlines()
    t, body = lines[0], lines[1:]
    states = []
    for name in rows:
        if name in body:
            i = body.index(name)
            states.append(f"{name}: {body[i + 1] if i + 1 < len(body) else '?'}")
    footer = next((l for l in body if l.endswith(" of 4)") or l.endswith("failed") or l.endswith("installed")), "")
    line = " | ".join(states + ([footer] if footer else []))
    if line != last:
        out.append(f"{t}  {line}")
        last = line
open(sys.argv[2], "w").write("\n".join(out) + "\n")
print(len(out))
