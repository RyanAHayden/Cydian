#!/usr/bin/env bash
# Test gate for agent-runner: every test_*.py under the repo, then `node --test web/app`.
# Native (Theos) and IPA builds join here once they exist.
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
