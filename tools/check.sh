#!/usr/bin/env bash
# Test gate for agent-runner: every test_*.py under the repo, the zsign WebAssembly build (where emcc is),
# `node --test web/app` and the Worker's own test.
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

# F93: the website's zsign WebAssembly (web/app/vendor/zsign), rebuilt from its pinned sources where emcc is (emsdk on
# PATH or in ~/emsdk). With the emcc that built the committed copy (vendor/zsign/SOURCE) the build is byte for byte
# the same, so a difference means the committed files aren't from this source; another emcc only has to build.
if why=$(tools/build-zsign-wasm.sh --probe 2>&1); then
  zdir=$(mktemp -d)
  zrc=0
  tools/build-zsign-wasm.sh --out "$zdir" >"$zdir/log" 2>&1 || zrc=$?
  if [ "$zrc" = 3 ]; then
    echo "check: zsign wasm build skipped: $(tail -n1 "$zdir/log")"
  elif [ "$zrc" != 0 ]; then
    tail -n 30 "$zdir/log"; echo "check: zsign wasm build failed"; rm -rf "$zdir"; exit 1
  elif [ "$(tail -n1 "$zdir/SOURCE")" = "$(tail -n1 web/app/vendor/zsign/SOURCE)" ]; then
    cmp -s "$zdir/zsign.wasm" web/app/vendor/zsign/zsign.wasm && cmp -s "$zdir/zsign.js" web/app/vendor/zsign/zsign.js ||
      { echo "check: web/app/vendor/zsign differs from its source: run tools/build-zsign-wasm.sh and commit"; rm -rf "$zdir"; exit 1; }
  else
    echo "check: zsign wasm built with another emcc than the committed copy's: not compared"
  fi
  rm -rf "$zdir"
else
  echo "check: zsign wasm build skipped: $why"
fi

node --test web/app
node worker/test.mjs

# Native builds (native/, N1 and I2): only where their toolchain is set up (SWIFT_TOOLCHAIN or swiftc on PATH,
# IOS_SDK, ld64.lld). build.sh builds native/build/iFizBox.deb and iFizBox.ipa and checks them (mkdeb.py/mkipa.py).
if native/build.sh --probe 2>/dev/null; then
  make -s -C native package
else
  echo "check: native build skipped: $(native/build.sh --probe 2>&1 | tr '\n' ' ')"
fi
