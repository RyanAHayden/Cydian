#!/usr/bin/env bash
# Test gate for agent-runner: every test_*.py under the repo, then `node --test web/app`.
# Then the native builds (jailbreak .deb and sideload IPA) when their toolchain is there.
set -euo pipefail
cd "$(dirname "$0")/.."

# Python deps (web/requirements.txt) live in a per-checkout .venv, rebuilt when the requirements change.
PY=python3
if [ -f web/requirements.txt ]; then
  stamp=.venv/.requirements
  if ! cmp -s web/requirements.txt "$stamp" 2>/dev/null; then
    rm -rf .venv
    if command -v uv >/dev/null; then
      uv venv -q .venv && uv pip install -q --python .venv/bin/python -r web/requirements.txt
    else
      python3 -m venv .venv && .venv/bin/pip install -q -r web/requirements.txt
    fi
    cp web/requirements.txt "$stamp"
  fi
  PY=.venv/bin/python
fi

# ponytail: unittest exits 5 when it finds no tests; that's an empty dir, not a failure.
# Discover per directory: dirs like web/ are not packages, so one discover from the root would skip them.
git ls-files --cached --others --exclude-standard | grep -E '(^|/)test_[^/]*\.py$' | xargs -r -n1 dirname | sort -u |
  while read -r d; do
    "$PY" -m unittest discover -q -s "$d" -t "$d" -p 'test_*.py'
  done

node --test web/app

# Native builds (native/, N1 and I2): only where their toolchain is set up (SWIFT_TOOLCHAIN or swiftc on PATH,
# IOS_SDK, ld64.lld). build.sh builds native/build/Cydian.deb and Cydian.ipa and checks them (mkdeb.py/mkipa.py).
if native/build.sh --probe 2>/dev/null; then
  make -s -C native package
else
  echo "check: native build skipped: $(native/build.sh --probe 2>&1 | tr '\n' ' ')"
fi
