#!/usr/bin/env bash
# Refuse a release when web/app/ holds files git doesn't track (T47): both builds bundle web/app/ as it is on disk
# (native/build.sh copies every file), so an ignored leftover (web/app/dl/<something>.ipa) or a forgotten new file
# would ship in the .deb and the IPA. tools/release.sh and tools/setup/release.sh run this first, dry runs included.
#
#   tools/stray-check.sh [ROOT]   ROOT: the checkout to look in (default: this one). Exit 0 when web/app/ is clean,
#                                 1 with the stray files listed when it isn't.
#
# Tolerated, because the tools write them and nothing reads them from there: __pycache__/*.pyc (the gate's Python
# tests) and web/app/build.json (tools/buildinfo.sh; the builds write their own).
set -euo pipefail
root=${1:-$(cd "$(dirname "$0")/.." && pwd)}
git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "stray check: $root is not a git checkout" >&2; exit 1; }
# --others without --exclude-standard: untracked files, the ignored ones included
list=$(git -C "$root" ls-files --others -- web/app | grep -vE '(^|/)__pycache__/[^/]*\.pyc$|^web/app/build\.json$' || true)
[ -z "$list" ] && exit 0
n=$(wc -l <<<"$list")
echo "stray check: web/app/ has $n file(s) git doesn't track, which the builds would ship:" >&2
head -n 20 <<<"$list" | sed 's/^/  /' >&2
[ "$n" -le 20 ] || echo "  ... and $((n - 20)) more" >&2
echo "stray check: delete them (or commit the ones that belong), then run again" >&2
exit 1
