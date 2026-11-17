#!/usr/bin/env bash
# Test gate for agent-runner: every test_*.py under the repo, then `node --test web/app`.
# Then the native jailbreak build when its toolchain is there; the sideload IPA build joins later.
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

# zsign for web/test_signer.py's SignTest (I5, T4): built into .venv/bin from the commit and tarball hash pinned in
# the Dockerfile (one source of truth), where g++, make and libssl headers are there. Any miss (no compiler, no
# network, hash mismatch, failed build) only skips: SignTest then skips and says so. A stamp holds the commit built.
zsign_build() {
  local commit sha dir
  commit=$(sed -n 's/^ARG ZSIGN_COMMIT=//p' Dockerfile)
  sha=$(sed -n 's/^ARG ZSIGN_SHA256=//p' Dockerfile)
  [ -n "$commit" ] && [ -n "$sha" ] || { echo "no ZSIGN_COMMIT/ZSIGN_SHA256 in Dockerfile"; return 1; }
  if [ -x .venv/bin/zsign ] && [ "$(cat .venv/.zsign 2>/dev/null)" = "$commit" ]; then return 0; fi
  command -v g++ >/dev/null && command -v make >/dev/null || { echo "no g++/make"; return 1; }
  pkg-config --exists openssl 2>/dev/null || [ -f /usr/include/openssl/ssl.h ] || { echo "no libssl headers"; return 1; }
  dir=$(mktemp -d)
  # shellcheck disable=SC2064
  trap "rm -rf '$dir'" RETURN
  curl -fsSL --max-time 120 -o "$dir/zsign.tgz" "https://github.com/zhlynn/zsign/archive/$commit.tar.gz" ||
    { echo "download failed"; return 1; }
  echo "$sha  $dir/zsign.tgz" | sha256sum -c --status - || { echo "tarball SHA-256 mismatch"; return 1; }
  tar xzf "$dir/zsign.tgz" -C "$dir" || { echo "untar failed"; return 1; }
  make -s -C "$dir/zsign-$commit/build/linux" -j"$(nproc)" >"$dir/build.log" 2>&1 ||
    { tail -n 20 "$dir/build.log"; echo "build failed"; return 1; }
  mkdir -p .venv/bin
  install -m 755 "$dir/zsign-$commit/bin/zsign" .venv/bin/zsign && echo "$commit" >.venv/.zsign
}
if [ -z "${CYDIAN_ZSIGN:-}" ]; then
  if why=$(zsign_build 2>&1); then
    export CYDIAN_ZSIGN="$PWD/.venv/bin/zsign"
  else
    echo "check: zsign build skipped (SignTest will skip): $(echo "$why" | tr '\n' ' ')"
  fi
fi

# ponytail: unittest exits 5 when it finds no tests; that's an empty dir, not a failure.
# Discover per directory: dirs like web/ are not packages, so one discover from the root would skip them.
git ls-files --cached --others --exclude-standard | grep -E '(^|/)test_[^/]*\.py$' | xargs -r -n1 dirname | sort -u |
  while read -r d; do
    "$PY" -m unittest discover -q -s "$d" -t "$d" -p 'test_*.py'
  done

node --test web/app

# Jailbreak build (native/, N1): only where its toolchain is set up (SWIFT_TOOLCHAIN or swiftc on PATH, IOS_SDK,
# ld64.lld). build.sh builds native/build/Cydian.deb and checks its contents (mkdeb.py check).
if native/build.sh --probe 2>/dev/null; then
  make -s -C native package
else
  echo "check: native build skipped: $(native/build.sh --probe 2>&1 | tr '\n' ' ')"
fi
