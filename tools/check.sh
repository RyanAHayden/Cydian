#!/usr/bin/env bash
# Test gate for agent-runner: every test_*.py under the repo. Native (Theos) and IPA builds join here once they exist.
set -euo pipefail
cd "$(dirname "$0")/.."
# ponytail: unittest exits 5 when it finds no tests; that's the empty repo, not a failure
if git ls-files --cached --others --exclude-standard | grep -q 'test_.*\.py$'; then
  python3 -m unittest discover -q -s . -p 'test_*.py'
fi
