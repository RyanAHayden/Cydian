#!/usr/bin/env python3
# Keep only the B263 test apps (Big first) and iFizBox's own record in signed.json, for R58's Re-sign All run.
import json, sys

src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src))
order = ["com.ryha.b263big", "com.ryha.b263a", "com.ryha.b263b", "com.ryha.ifizbox"]
keep = sorted((r for r in d if r.get("bundleID") in order), key=lambda r: order.index(r["bundleID"]))
json.dump(keep, open(out, "w"))
print([r["bundleID"] for r in keep])
