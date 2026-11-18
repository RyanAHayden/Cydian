#!/usr/bin/env bash
# Publish a Cydian release (I7): native/build.sh's Cydian.ipa and Cydian.deb as the assets of GitHub release
# v$(native/VERSION), which the site's Install Cydian App (core/appoffer.js, releases/latest/download/...) and the
# apps' self-update (F61) download, then point Cydian's AltStore source (web/app/source.json) at the new IPA.
#
#   tools/release.sh NOTES.md     build, create the release with these notes (or replace its assets), update the source
#
# Run it by hand (it publishes): the gate never does. Commit web/app/source.json afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."
notes=${1:?usage: tools/release.sh NOTES.md}
version=$(tr -d '[:space:]' < native/VERSION)
tag="v$version"

(cd native && ./build.sh)
ipa=native/build/Cydian.ipa
deb=native/build/Cydian.deb
for f in "$ipa" "$deb"; do [ -s "$f" ] || { echo "$f missing: native/build.sh made nothing" >&2; exit 1; }; done

if gh release view "$tag" >/dev/null 2>&1; then
  gh release upload "$tag" "$ipa" "$deb" --clobber
else
  gh release create "$tag" "$ipa" "$deb" --title "Cydian $version" --notes-file "$notes"
fi

python3 tools/altsource.py update "$version" "$ipa"
python3 tools/altsource.py check
echo "Released $tag. Commit web/app/source.json."
