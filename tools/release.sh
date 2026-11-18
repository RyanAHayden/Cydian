#!/usr/bin/env bash
# Publish a iFizBox release on GitHub (T6), the one F61's self-update reads (web/app/core/selfupdate.js): tag
# v<native/VERSION> on RyanAHayden/iFizBox, with these assets:
#   iFizBox.ipa                       the sideload build (parseRelease's `ipa`)
#   iFizBox.deb                       the rootless jailbreak build (debFor's fallback, iphoneos-arm64 only)
#   <pkg>_<ver>_<arch>.deb           the same .deb under Debian's name (debFor's exact-arch match), e.g.
#                                    com.ryha.ifizbox_0.2.0-412_iphoneos-arm64.deb
#   <pkg>_<ver>_<arch>.deb           any other arch build found in --dist under that name (roothide, rootful)
#   Packages, Packages.gz, Release   iFizBox's own flat APT repo over those .debs (F72, tools/selfrepo.py): the
#                                    jailbreak app's built-in source, https://cydian.dev/repo/ (the Worker
#                                    serves releases/latest/download/ of RyanAHayden/iFizBox without the redirect)
# Then it points iFizBox's AltStore source (web/app/source.json, tools/altsource.py; I7) at the new iFizBox.ipa, the
# sideload app's and the site's built-in source (F72), versions[] newest first: commit web/app/source.json afterwards.
# Run it only when a person asks for a release. How to cut one: docs/release.md.
#
#   tools/release.sh [--dry-run] [--notes FILE] [--dist DIR] [--draft] [--minimum X.Y.Z] [--out DIR]
#     --dry-run   build (or read --dist), check and print what would be published; publish nothing, no network
#     --notes F   the release notes (Markdown; the first 4 lines show in the app's update alert). Default: the
#                 commit subjects since the last v* tag, then the standard footer about the two files
#     --dist DIR  publish DIR/iFizBox.deb and DIR/iFizBox.ipa as they are instead of running `make -C native package`
#     --draft     create the release as a draft (the app ignores drafts until it is published on GitHub)
#     --minimum V the oldest iFizBox that may keep running without upgrading first (F72): X-iFizBox-Minimum-Version in
#                 the Release and iFizBox's stanza, "minimumVersion" in the AltStore source. Recorded only: since
#                 F183 the app never blocks or pops up on it. Default: none
#     --out DIR   also leave the repo files, the notes and the updated AltStore source (source.json) in DIR; a dry
#                 run writes the source there only, never into web/app/source.json
#   IFIZBOX_RELEASE_REPO  owner/name to publish on (default RyanAHayden/iFizBox)
set -euo pipefail
cd "$(dirname "$0")/.."
. native/brand.env # F170: BRAND_NAME for the release title and notes

repo=${IFIZBOX_RELEASE_REPO:-RyanAHayden/iFizBox}
dry=0 notes= dist= draft=() minimum= out=
while [ $# -gt 0 ]; do
  case $1 in
    --dry-run) dry=1 ;;
    --notes) notes=${2:?--notes needs a file}; shift ;;
    --dist) dist=${2:?--dist needs a directory}; shift ;;
    --draft) draft=(--draft) ;;
    --minimum) minimum=${2:?--minimum needs a version}; shift ;;
    --out) out=${2:?--out needs a directory}; shift ;;
    -h|--help) sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "release: unknown argument $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done
die() { echo "release: $*" >&2; exit 1; }

version=$(tr -d '[:space:]' < native/VERSION)
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "native/VERSION is '$version', not X.Y.Z"
tag=v$version
if [ -n "$minimum" ]; then
  [[ $minimum =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "--minimum is '$minimum', not X.Y.Z"
  python3 - "$minimum" "$version" <<'PY' || die "--minimum $minimum is newer than this release ($version): nobody could satisfy it"
import sys
a, b = (tuple(int(x) for x in v.split(".")) for v in sys.argv[1:])
sys.exit(0 if a <= b else 1)
PY
fi
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
deb=$dist/iFizBox.deb ipa=$dist/iFizBox.ipa
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
problems += ["iFizBox.deb: " + p for p in mkdeb.check(deb)[0]]
problems += ["iFizBox.ipa: " + p for p in mkipa.check(ipa)[0]]
if fields.get("Version", "").split("-")[0] != version:
    problems.append("iFizBox.deb Version %r is not native/VERSION %s" % (fields.get("Version"), version))
try:
    z = zipfile.ZipFile(ipa)
    plist = next(n for n in z.namelist() if n.endswith(".app/Info.plist") and n.count("/") == 2)
    short = plistlib.loads(z.read(plist)).get("CFBundleShortVersionString")
except (StopIteration, zipfile.BadZipFile, plistlib.InvalidFileException):
    short = None
if short != version:
    problems.append("iFizBox.ipa CFBundleShortVersionString %r is not native/VERSION %s" % (short, version))
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
cp "$ipa" "$stage/iFizBox.ipa"
cp "$deb" "$stage/iFizBox.deb"
cp "$deb" "$stage/$debname"
# Other arch builds named like Debian's files (com.ryha.ifizbox_<ver>_iphoneos-arm64e.deb) ride along.
extra=()
pkg=${debname%%_*}
for f in "$dist/${pkg}"_*_*.deb; do
  [ -f "$f" ] || continue
  b=$(basename "$f")
  [ "$b" = "$debname" ] && continue
  cp "$f" "$stage/$b"
  extra+=("$b")
done
# F72: iFizBox's own APT repo over the Debian-named .debs (Filename: is the asset's name beside the Release).
repodebs=("$stage/$debname")
for b in "${extra[@]}"; do repodebs+=("$stage/$b"); done
python3 tools/selfrepo.py "$stage" "${repodebs[@]}" ${minimum:+--minimum "$minimum"} >/dev/null ||
  die "couldn't write the APT repo files"
repofiles=(Packages Packages.gz Release)

if [ -n "$notes" ]; then
  [ -f "$notes" ] || die "no notes file $notes"
  cp "$notes" "$stage/notes.md"
else
  prev=$(git describe --tags --abbrev=0 --match 'v[0-9]*' "$sha" 2>/dev/null || true)
  {
    git log --no-merges --format='- %s' ${prev:+"$prev.."}"$sha" | grep -v '^- plan:' | head -n 30 || true
    echo
    echo "iFizBox.ipa is unsigned: sign it with your own certificate (Feather, AltStore, SideStore, or $BRAND_NAME's own"
    echo "Settings > Signing). iFizBox.deb ($debname) is the rootless jailbreak build."
  } > "$stage/notes.md"
fi

echo "release: $repo $tag at $sha"
echo "release: assets: iFizBox.ipa iFizBox.deb $debname ${extra[*]:+${extra[*]} }${repofiles[*]}"
if [ "$repo" = RyanAHayden/iFizBox ]; then aptrepo=https://cydian.dev/repo/; else aptrepo="https://github.com/$repo/releases/latest/download/ (a Worker with IFIZBOX_REPO=$repo serves it at /repo/)"; fi
echo "release: apt repo: $aptrepo, from https://github.com/$repo/releases/latest/download/${minimum:+ (minimum $minimum)}"
echo "release: notes:"
sed 's/^/  /' "$stage/notes.md"
altargs=(--notes "$stage/notes.md" ${minimum:+--minimum "$minimum"})
if [ -n "$out" ]; then
  mkdir -p "$out"
  cp "$stage/notes.md" "$out/notes.md"
  for f in "${repofiles[@]}"; do cp "$stage/$f" "$out/$f"; done
fi
if [ $dry = 1 ]; then
  if [ -n "$out" ]; then
    cp web/app/source.json "$out/source.json"
    python3 tools/altsource.py update "$version" "$ipa" "${altargs[@]}" --source "$out/source.json" >/dev/null
    echo "release: dry run: the AltStore source it would write is $out/source.json"
  fi
  echo "release: dry run, nothing published"
  exit 0
fi

assets=("$stage/iFizBox.ipa" "$stage/iFizBox.deb" "$stage/$debname")
for b in "${extra[@]}"; do assets+=("$stage/$b"); done
for f in "${repofiles[@]}"; do assets+=("$stage/$f"); done
gh release create "$tag" --repo "$repo" --target "$sha" --title "$BRAND_NAME $version" --notes-file "$stage/notes.md" \
  "${draft[@]}" "${assets[@]}"
git fetch -q origin "refs/tags/$tag:refs/tags/$tag" || true
echo "release: published https://github.com/$repo/releases/tag/$tag"
python3 tools/altsource.py update "$version" "$ipa" "${altargs[@]}"
python3 tools/altsource.py check
[ -z "$out" ] || cp web/app/source.json "$out/source.json"
echo "release: web/app/source.json now names $tag's iFizBox.ipa: commit it"
