#!/usr/bin/env python3
# condense.py POLL OUT: poll.sh output -> one line per change: time, each row's state as the run page showed it,
# the footer. Download/copy progress alone doesn't count as a change (the bar moves every poll).
import re, sys

rows = ["B263 A", "B263 B", "B263 Big", "iFizBox"]
out, last = [], None
for block in open(sys.argv[1]).read().split("=== ")[1:]:
    lines = block.splitlines()
    t, body = lines[0], lines[1:]
    states = [f"{n}: {body[body.index(n) + 1] if body.index(n) + 1 < len(body) else '?'}" for n in rows if n in body]
    foot = [l for l in body if " of 4)" in l or "re-signed" in l or "Closing" in l or l in ("Running", "Complete")]
    line = " | ".join(states + foot) if states or foot else "(no page: " + " ".join(body)[:60] + ")"
    key = re.sub(r"[\d.]+ of 300\.0 MB, [\d.]+ MB/s|\d+%", "", line)
    if key != last:
        out.append(f"{t}  {line}")
        last = key
open(sys.argv[2], "w").write("\n".join(out) + "\n")
print(len(out))
