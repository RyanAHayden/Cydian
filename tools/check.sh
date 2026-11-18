#!/usr/bin/env bash
# Test gate for agent-runner: every test_*.py under the repo, `node --test web/app` and the Worker's own test.
# Then the native builds (jailbreak .deb and sideload IPA) when their toolchain is there.
set -euo pipefail
cd "$(dirname "$0")/.."

PY=python3

# ponytail: unittest exits 5 when it finds no tests; that's an empty dir, not a failure.
# Discover per directory: dirs like web/ are not packages, so one discover from the root would skip them.
git ls-files --cached --others --exclude-standard | grep -E '(^|/)test_[^/]*\.py$' | xargs -r -n1 dirname | sort -u |
  while read -r d; do
    "$PY" -m unittest discover -q -s "$d" -t "$d" -p 'test_*.py'
  done

node --test web/app
node worker/test.mjs

# Native builds (native/, N1 and I2): only where their toolchain is set up (SWIFT_TOOLCHAIN or swiftc on PATH,
# IOS_SDK, ld64.lld). build.sh builds native/build/Cydian.deb and Cydian.ipa and checks them (mkdeb.py/mkipa.py).
if native/build.sh --probe 2>/dev/null; then
  make -s -C native package
else
  echo "check: native build skipped: $(native/build.sh --probe 2>&1 | tr '\n' ' ')"
fi
