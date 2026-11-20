#!/usr/bin/env bash
# Test gate for agent-runner: every test_*.py under the repo, the zsign WebAssembly build (where emcc is),
# `node --test web/app` and the Worker's own tests (every worker/test*.mjs).
# The native builds (jailbreak .deb and sideload IPA) come first, when their toolchain is there.
set -euo pipefail
cd "$(dirname "$0")/.."

PY=python3

# T42: one TMPDIR on the disk for the whole gate. /tmp is a RAM tmpfs with a per-user quota on the dev machine, shared
# by every agent slot's gate at once; scratch files there (swiftc objects, zips, mktemp, node's os.tmpdir()) fail with
# "Disk quota exceeded" for reasons that have nothing to do with the code. Every tool here (mktemp, Python's tempfile,
# node, swiftc, cc) follows $TMPDIR, so this run gets its own folder under $IFIZBOX_TEST_TMP, else
# ${XDG_CACHE_HOME:-~/.cache}/ifizbox-tests (the same base as native/disktmp.py), removed when the gate ends.
# IFIZBOX_GATE_TMPDIR tells tools/test_gate_tmpdir.py which folder that is. When the base can't be made, the default.
gate_tmp=
tmp_base=${IFIZBOX_TEST_TMP:-${XDG_CACHE_HOME:-$HOME/.cache}/ifizbox-tests}
if mkdir -p "$tmp_base" 2>/dev/null && gate_tmp=$(mktemp -d "$tmp_base/gate-XXXXXX" 2>/dev/null); then
  export TMPDIR=$gate_tmp IFIZBOX_GATE_TMPDIR=$gate_tmp
else
  gate_tmp=
  echo "check: $tmp_base not writable: temp files stay in ${TMPDIR:-/tmp}"
fi

# T43: everything the gate skips (Python tests, the native and zsign builds) is listed at the end, one line each;
# IFIZBOX_GATE_STRICT=1 turns any skip into a failure.
skips=$(mktemp)
trap 'rm -f "$skips"; [ -z "$gate_tmp" ] || rm -rf "$gate_tmp"' EXIT

# T46: no new file over 1 MB in git (allowlist in the script). First, so a stray video fails in a second, not after
# the builds; the unittest run below runs the same check with its own tests.
"$PY" tools/test_sizeguard.py --list || { echo "check: size guard failed"; exit 1; }

# Native builds (native/, N1 and I2), before the tests: native/*/test_*.py's Built cases check these outputs and
# skip when they're older than the sources, so building after the tests skipped them cold and tested the last build
# warm. Only where their toolchain is set up (SWIFT_TOOLCHAIN or swiftc on PATH,
# IOS_SDK, ld64.lld). build.sh builds native/build/iFizBox.deb and iFizBox.ipa and checks them (mkdeb.py/mkipa.py).
if native/build.sh --probe 2>/dev/null; then
  make -s -C native package
else
  echo "check: native build skipped: $(native/build.sh --probe 2>&1 | tr '\n' ' ')" | tee -a "$skips"
fi

# ponytail: unittest exits 5 when it finds no tests; that's an empty dir, not a failure.
# Discover per directory: dirs like web/ are not packages, so one discover from the root would skip them.
git ls-files --cached --others --exclude-standard | grep -E '(^|/)test_[^/]*\.py$' | xargs -r -n1 dirname | sort -u |
  while read -r d; do
    "$PY" tools/gate_unittest.py "$d" "$skips"
  done

# F93: the website's zsign WebAssembly (web/app/vendor/zsign), rebuilt from its pinned sources where emcc is (emsdk on
# PATH or in ~/emsdk). With the emcc that built the committed copy (vendor/zsign/SOURCE) the build is byte for byte
# the same, so a difference means the committed files aren't from this source; another emcc only has to build.
if why=$(tools/build-zsign-wasm.sh --probe 2>&1); then
  zdir=$(mktemp -d)
  zrc=0
  tools/build-zsign-wasm.sh --out "$zdir" >"$zdir/log" 2>&1 || zrc=$?
  if [ "$zrc" = 3 ]; then
    echo "check: zsign wasm build skipped: $(tail -n1 "$zdir/log")" | tee -a "$skips"
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
  echo "check: zsign wasm build skipped: $why" | tee -a "$skips"
fi

node --test web/app
# The Worker's Node tests, each worker/test*.mjs on its own (test.mjs, test-push.mjs, test-github.mjs, ...): a new
# one runs without a wrapper test_*.py or an import at the end of test.mjs.
for t in worker/test*.mjs; do
  node "$t" || { echo "check: $t failed"; exit 1; }
done

# T43: the skip summary, after everything else so it's the last thing on screen.
if [ -s "$skips" ]; then
  echo "check: skipped ($(wc -l <"$skips")):"
  sed 's/^check: //; s/^/  /' "$skips"
  if [ "${IFIZBOX_GATE_STRICT:-}" = 1 ]; then
    echo "check: IFIZBOX_GATE_STRICT=1 and something was skipped: failing"
    exit 1
  fi
else
  echo "check: nothing skipped"
fi
