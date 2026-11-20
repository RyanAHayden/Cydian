#!/usr/bin/env bash
# Compiles the app icon into an asset catalog (Assets.car) for each build: native/icon/Assets.car (the .deb's plain
# icon) and native/icon/AssetsLite.car (the sideload IPA's LITE icon). Only Apple's actool writes Assets.car, so this
# runs on a Mac with Xcode; build.sh copies the committed .car files on Linux. Rerun it after tools/icons.sh changes
# the icons, and commit what it writes.
#
#   native/icon/assets.sh          on the Mac
#   native/icon/assets.sh <host>   from Linux: copies the PNGs to <host> over ssh, runs actool there, copies back
#
# iOS reads Info.plist's CFBundleIconName (AppIcon) from Assets.car for notifications, Settings and Spotlight; with the
# name set and no catalog it shows a blank placeholder there. native/test_icons.py checks every size is in each .car.
set -euo pipefail
cd "$(dirname "$0")"
sizes="20 29 40 60"

if [ "$(uname)" != Darwin ]; then
  host=${1:?"icon assets: run on a Mac, or give a Mac's ssh host"}
  dir=$(ssh "$host" mktemp -d)
  scp -q assets.sh AppIcon*.png "$host:$dir/"
  ssh "$host" "bash $dir/assets.sh"
  scp -q "$host:$dir/Assets.car" "$host:$dir/AssetsLite.car" .
  ssh "$host" rm -rf "$dir"
  # The PNGs the .car files were compiled from, so native/test_icons.py notices icons changed without a rerun.
  sha256sum AppIcon*.png > assets.sources
  echo "icon assets: wrote native/icon/Assets.car, AssetsLite.car and assets.sources"
  exit 0
fi

export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# catalog <prefix> <out.car>: an AppIcon set of <prefix>*.png at every iPhone size, compiled to <out.car>
catalog() {
  local set=$work/$1/Assets.xcassets/AppIcon.appiconset images=""
  mkdir -p "$set" "$work/$1/out"
  printf '{"info":{"author":"xcode","version":1}}' > "$work/$1/Assets.xcassets/Contents.json"
  for pt in $sizes; do
    for s in 2 3; do
      cp "$1${pt}x${pt}@${s}x.png" "$set/"
      images="$images{\"idiom\":\"iphone\",\"size\":\"${pt}x${pt}\",\"scale\":\"${s}x\",\"filename\":\"$1${pt}x${pt}@${s}x.png\"},"
    done
  done
  cp "${1}1024.png" "$set/"
  images="$images{\"idiom\":\"ios-marketing\",\"size\":\"1024x1024\",\"scale\":\"1x\",\"filename\":\"${1}1024.png\"}"
  printf '{"images":[%s],"info":{"author":"xcode","version":1}}' "$images" > "$set/Contents.json"
  xcrun actool --compile "$work/$1/out" --platform iphoneos --minimum-deployment-target 15.0 \
    --target-device iphone --app-icon AppIcon --output-partial-info-plist "$work/$1/partial.plist" \
    --notices --warnings --errors --output-format human-readable-text "$work/$1/Assets.xcassets"
  cp "$work/$1/out/Assets.car" "$2"
}
catalog AppIcon Assets.car
catalog AppIconLite AssetsLite.car
shasum -a 256 AppIcon*.png > assets.sources
