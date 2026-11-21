#!/usr/bin/env python3
# The original signed.json without R58's test apps (com.ryha.b263*), which are uninstalled after the run.
import json, sys

src, out = sys.argv[1], sys.argv[2]
d = [r for r in json.load(open(src)) if not r.get("bundleID", "").startswith("com.ryha.b263")]
json.dump(d, open(out, "w"))
print([r["bundleID"] for r in d])
