#!/usr/bin/env bash
# Writes build.json (iFizBox's version, the build number, the commit, the time and the website's file list) into DIR (default
# web/app). Home's footer shows the version and commit, as Cydia's does; the website's Reload re-downloads the
# listed files so a phone never keeps a stale one. Run by the Worker deploy and the native build.
#   tools/buildinfo.sh [DIR] [--rev REV]
# --rev names the commit whose short hash and build number (its commit count) build.json carries (default HEAD):
# tools/deploy.sh passes the built commit when the release tag only adds web/app/source.json on top of it, so the
# site's build matches the release's apps.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
out=web/app rev=HEAD
while [ $# -gt 0 ]; do
  case "$1" in
    --rev) rev="${2:?--rev needs a commit}"; shift 2 ;;
    *) out="$1"; shift ;;
  esac
done
python3 - "$out" "$rev" <<'PY'
import json, os, subprocess, sys, datetime
out, rev = sys.argv[1], sys.argv[2]
run = lambda *a: subprocess.run(a, capture_output=True, text=True).stdout.strip()
files = sorted(os.path.relpath(os.path.join(d, f), "web/app") for d, _, fs in os.walk("web/app") for f in fs
               if not f.startswith(".") and not f.endswith((".test.js", ".test.mjs")) and f != "build.json")
info = {"version": open("native/VERSION").read().strip(), "commit": run("git", "rev-parse", "--short", rev),
        # the build number, counted as native/build.sh counts CFBundleVersion
        "build": run("git", "rev-list", "--count", rev) or "1",
        "date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "files": files}
with open(os.path.join(out, "build.json"), "w") as f:
    json.dump(info, f, separators=(",", ":"))
print(f"buildinfo: {info['version']} {info['commit']} ({len(files)} files) -> {out}/build.json")
PY
