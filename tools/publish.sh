#!/usr/bin/env bash
# One command for a iFizBox release, every step in order (docs/release.md):
#
#   tools/publish.sh X.Y.Z [--notes FILE] [--minimum X.Y.Z] [--dry-run]
#
#   1. checks: on main, no uncommitted changes, up to date with origin, X.Y.Z newer than the last v* tag
#   2. writes native/VERSION, commits "Version X.Y.Z" and pushes it
#   3. builds that commit in a clean temporary worktree and publishes it with tools/release.sh: tag vX.Y.Z,
#      Cydian.ipa, the .debs and iFizBox's own APT repo, as the repo owner's GitHub account
#   4. commits the updated AltStore source (web/app/source.json, the built-in source) and pushes it
#   5. checks that releases/latest/download/Cydian.ipa is X.Y.Z
#
# Needs SWIFT_TOOLCHAIN and IOS_SDK in the environment (the native build: native/README.md) and gh logged in to the
# repo owner's account. --dry-run builds and prints what would be published, and changes nothing.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
. native/brand.env # F170: BRAND_NAME
die() { echo "publish: $*" >&2; exit 1; }

version="${1:-}"; shift || true
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "usage: tools/publish.sh X.Y.Z [--notes FILE] [--minimum X.Y.Z] [--dry-run]"
pass=() dry=0
while [ $# -gt 0 ]; do
  case "$1" in
    --notes) [ -f "${2:-}" ] || die "--notes needs a file"; pass+=(--notes "$(realpath "$2")"); shift 2 ;;
    --minimum) pass+=(--minimum "${2:-}"); shift 2 ;;
    --dry-run) dry=1; pass+=(--dry-run); shift ;;
    *) die "unknown option $1" ;;
  esac
done
repo="${CYDIAN_RELEASE_REPO:-RyanAHayden/Cydian}"
owner="${repo%%/*}"

# 1. checks
[ "$(git branch --show-current)" = main ] || die "check out main first"
[ -z "$(git status --porcelain --untracked-files=no)" ] || die "commit or stash your changes first"
[ -n "${SWIFT_TOOLCHAIN:-}" ] && [ -n "${IOS_SDK:-}" ] || die "SWIFT_TOOLCHAIN and IOS_SDK aren't set (an interactive shell's ~/.bashrc sets them)"
git pull -q --ff-only origin main || die "main can't fast-forward to origin/main"
last=$(git tag -l 'v[0-9]*' | sed 's/^v//' | sort -V | tail -n1)
newest=$(printf '%s\n%s\n' "${last:-0.0.0}" "$version" | sort -V | tail -n1)
[ "$version" != "${last:-}" ] && [ "$newest" = "$version" ] || die "$version isn't newer than the last release (${last:-none})"
if [ $dry = 0 ]; then
  command -v gh >/dev/null || die "needs the gh CLI"
  # The release goes up as the repo's owner, whichever gh account is active.
  GH_TOKEN=$(gh auth token -u "$owner" 2>/dev/null) || die "gh has no login for $owner (gh auth login)"
  export GH_TOKEN
  [ "$(gh api user -q .login)" = "$owner" ] || die "the token isn't $owner's"
fi

# 2. the version commit
if [ "$(cat native/VERSION)" != "$version" ]; then
  echo "$version" > native/VERSION
  if [ $dry = 0 ]; then
    git commit -q -m "Version $version" native/VERSION
    git push -q origin main
  fi
fi

# 3. build and publish from a clean worktree of exactly that commit (the runner may merge into main meanwhile)
tmp=$(mktemp -d)
trap 'git worktree remove --force "$tmp/w" >/dev/null 2>&1 || true; rm -rf "$tmp"; [ $dry = 1 ] && git checkout -q -- native/VERSION' EXIT
git worktree add -q --detach "$tmp/w" HEAD
[ $dry = 1 ] && echo "$version" > "$tmp/w/native/VERSION"
(cd "$tmp/w" && tools/release.sh "${pass[@]}" --out "$tmp/out")
[ $dry = 1 ] && { echo "publish: dry run done; nothing was committed or published"; exit 0; }

# 4. the built-in AltStore source, now naming this release
git pull -q --ff-only origin main
cp "$tmp/out/source.json" web/app/source.json
python3 tools/altsource.py check >/dev/null
if ! git diff --quiet web/app/source.json; then
  git commit -q -m "$BRAND_NAME's AltStore source: $version" web/app/source.json
  git push -q origin main
fi

# 5. what the app and the site will download now
got=$(curl -fsSL "https://github.com/$repo/releases/latest/download/Cydian.ipa" | python3 -c '
import io, plistlib, sys, zipfile
z = zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
print(plistlib.loads(z.read(next(n for n in z.namelist() if n.endswith(".app/Info.plist"))))["CFBundleShortVersionString"])')
[ "$got" = "$version" ] || die "latest/download/Cydian.ipa is $got, not $version"
echo "publish: $BRAND_NAME $version is out: https://github.com/$repo/releases/tag/v$version"
