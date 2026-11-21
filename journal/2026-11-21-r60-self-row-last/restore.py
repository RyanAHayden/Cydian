#!/usr/bin/env python3
# restore.py ORIG AFTER OUT: the signed.json from before R60 without the B263 test apps (uninstalled after the run),
# with iFizBox's own record taken from AFTER (the run re-signed it: new expiry, version 0.18.3).
import json, sys

out = sys.argv[3]
orig = json.load(open(sys.argv[1]))
after = {r["bundleID"]: r for r in json.load(open(sys.argv[2]))}
keep = []
for r in orig:
    bid = r.get("bundleID", "")
    if bid.startswith("com.ryha.b263"):
        continue
    keep.append(after.get(bid, r) if bid == "com.ryha.ifizbox" else r)
json.dump(keep, open(out, "w"))
print([(r["bundleID"], r.get("version")) for r in keep])
