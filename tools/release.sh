#!/usr/bin/env bash
# Publish a Cydian release on GitHub (T6), the one F61's self-update reads (web/app/core/selfupdate.js): tag
# v<native/VERSION> on RyanAHayden/Cydian, with these assets:
#   Cydian.ipa                       the sideload build (parseRelease's `ipa`)
#   Cydian.deb                       the rootless jailbreak build (debFor's fallback, iphoneos-arm64 only)
#   <pkg>_<ver>_<arch>.deb           the same .deb under Debian's name (debFor's exact-arch match), e.g.
#                                    com.ryha.cydian_0.2.0-412_iphoneos-arm64.deb
# Then it points Cydian's AltStore source (web/app/source.json, tools/altsource.py; I7) at the new Cydian.ipa:
# commit web/app/source.json afterwards.
# Run it only when a person asks for a release. How to cut one: docs/release.md.
#
#   tools/release.sh [--dry-run] [--notes FILE] [--dist DIR] [--draft]
#     --dry-run   build (or read --dist), check and print what would be published; publish nothing, no network
#     --notes F   the release notes (Markdown; the first 4 lines show in the app's update alert). Default: the
#                 commit subjects since the last v* tag, then the standard footer about the two files
#     --dist DIR  publish DIR/Cydian.deb and DIR/Cydian.ipa as they are instead of running `make -C native package`
#     --draft     create the release as a draft (the app ignores drafts until it is published on GitHub)
#   CYDIAN_RELEASE_REPO  owner/name to publish on (default RyanAHayden/Cydian)
set -euo pipefail
cd "$(dirname "$0")/.."

repo=${CYDIAN_RELEASE_REPO:-RyanAHayden/Cydian}
dry=0 notes= dist= draft=()
while [ $# -gt 0 ]; do
  case $1 in
    --dry-run) dry=1 ;;
    --notes) notes=${2:?--notes needs a file}; shift ;;
    --dist) dist=${2:?--dist needs a directory}; shift ;;
    --draft) draft=(--draft) ;;
    -h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "release: unknown argument $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done
die() { echo "release: $*" >&2; exit 1; }

version=$(tr -d '[:space:]' < native/VERSION)
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "native/VERSION is '$version', not X.Y.Z"
tag=v$version
sha=$(git rev-parse HEAD)

# A real release comes from a clean, pushed commit, under a tag that doesn't exist yet.
if [ $dry = 0 ]; then
  command -v gh >/dev/null || die "needs the gh CLI, logged in with push rights on $repo"
  [ -z "$(git status --porcelain --untracked-files=no)" ] || die "the work tree has uncommitted changes"
  git fetch -q origin
  [ -n "$(git branch -r --contains "$sha")" ] || die "HEAD ($sha) is not on origin; push it first"
  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null || git ls-remote --exit-code --tags origin "$tag" >/dev/null 2>&1; then
    die "tag $tag already exists: bump native/VERSION (and commit and push it) first"
  fi
  if gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then die "$repo already has a release $tag"; fi
fi

if [ -z "$dist" ]; then
  make -s -C native package
  dist=native/build
fi
deb=$dist/Cydian.deb ipa=$dist/Cydian.ipa
[ -f "$deb" ] || die "no $deb"
[ -f "$ipa" ] || die "no $ipa"

# The .deb's Package/Version/Architecture (Debian's file name) and the checks both files must pass; VERSION must be
# what the app reports (CFBundleShortVersionString), or the update offer would loop.
info=$(python3 - "$deb" "$ipa" "$version" <<'PY'
import os, sys, tarfile, io, lzma, zipfile, plistlib
sys.path.insert(0, "native")
import mkdeb, mkipa
deb, ipa, version = sys.argv[1:]
with open(deb, "rb") as f:
    members = dict(mkdeb.read_ar(f.read()))
ctl = members.get("control.tar.xz") or members.get("control.tar.gz")
with tarfile.open(fileobj=io.BytesIO(ctl)) as t:
    m = next(x for x in t.getmembers() if x.name.lstrip("./") == "control")
    fields = mkdeb.control_fields(t.extractfile(m).read().decode())
problems = []
problems += ["Cydian.deb: " + p for p in mkdeb.check(deb)[0]]
problems += ["Cydian.ipa: " + p for p in mkipa.check(ipa)[0]]
if fields.get("Version", "").split("-")[0] != version:
    problems.append("Cydian.deb Version %r is not native/VERSION %s" % (fields.get("Version"), version))
try:
    z = zipfile.ZipFile(ipa)
    plist = next(n for n in z.namelist() if n.endswith(".app/Info.plist") and n.count("/") == 2)
    short = plistlib.loads(z.read(plist)).get("CFBundleShortVersionString")
except (StopIteration, zipfile.BadZipFile, plistlib.InvalidFileException):
    short = None
if short != version:
    problems.append("Cydian.ipa CFBundleShortVersionString %r is not native/VERSION %s" % (short, version))
print("%s_%s_%s.deb" % (fields.get("Package"), fields.get("Version"), fields.get("Architecture")))
for p in problems:
    print("problem: " + p)
PY
)
debname=$(head -n1 <<<"$info")
problems=$(grep '^problem: ' <<<"$info" | sed 's/^problem: //' || true)
[[ $debname =~ ^[a-z0-9][a-z0-9.+-]*_[0-9][A-Za-z0-9.+~-]*_[a-z0-9-]+\.deb$ ]] || die "bad .deb name '$debname'"
if [ -n "$problems" ]; then
  sed 's/^/release: /' <<<"$problems" >&2
  [ $dry = 1 ] || die "the build doesn't pass its checks; not publishing"
  echo "release: (dry run: a real run would stop here)" >&2
fi

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp "$ipa" "$stage/Cydian.ipa"
cp "$deb" "$stage/Cydian.deb"
cp "$deb" "$stage/$debname"

if [ -n "$notes" ]; then
  [ -f "$notes" ] || die "no notes file $notes"
  cp "$notes" "$stage/notes.md"
else
  prev=$(git describe --tags --abbrev=0 --match 'v[0-9]*' "$sha" 2>/dev/null || true)
  {
    git log --no-merges --format='- %s' ${prev:+"$prev.."}"$sha" | grep -v '^- plan:' | head -n 30 || true
    echo
    echo "Cydian.ipa is unsigned: sign it with your own certificate (Feather, AltStore, SideStore, or Cydian's own"
    echo "Settings > Signing). Cydian.deb ($debname) is the rootless jailbreak build."
  } > "$stage/notes.md"
fi

echo "release: $repo $tag at $sha"
echo "release: assets: Cydian.ipa Cydian.deb $debname"
echo "release: notes:"
sed 's/^/  /' "$stage/notes.md"
if [ $dry = 1 ]; then
  echo "release: dry run, nothing published"
  exit 0
fi

gh release create "$tag" --repo "$repo" --target "$sha" --title "Cydian $version" --notes-file "$stage/notes.md" \
  "${draft[@]}" "$stage/Cydian.ipa" "$stage/Cydian.deb" "$stage/$debname"
git fetch -q origin "refs/tags/$tag:refs/tags/$tag" || true
echo "release: published https://github.com/$repo/releases/tag/$tag"
python3 tools/altsource.py update "$version" "$ipa"
python3 tools/altsource.py check
echo "release: web/app/source.json now names $tag's Cydian.ipa: commit it"
