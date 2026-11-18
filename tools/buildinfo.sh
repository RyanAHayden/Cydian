#!/usr/bin/env bash
# Writes build.json (Cydian's version, the commit, the time and the website's file list) into DIR (default
# web/app). Home's footer shows the version and commit, as Cydia's does; the website's Reload re-downloads the
# listed files so a phone never keeps a stale one. Run by the Worker deploy and the native build.
#   tools/buildinfo.sh [DIR]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
out="${1:-web/app}"
python3 - "$out" <<'PY'
import json, os, subprocess, sys, datetime
out = sys.argv[1]
run = lambda *a: subprocess.run(a, capture_output=True, text=True).stdout.strip()
files = sorted(os.path.relpath(os.path.join(d, f), "web/app") for d, _, fs in os.walk("web/app") for f in fs
               if not f.startswith(".") and not f.endswith((".test.js", ".test.mjs")) and f != "build.json")
info = {"version": open("native/VERSION").read().strip(), "commit": run("git", "rev-parse", "--short", "HEAD"),
        "date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "files": files}
with open(os.path.join(out, "build.json"), "w") as f:
    json.dump(info, f, separators=(",", ":"))
print(f"buildinfo: {info['version']} {info['commit']} ({len(files)} files) -> {out}/build.json")
PY
