#!/usr/bin/env bash
# Compiles LaunchScreen.storyboard into LaunchScreen.storyboardc (Info.plist's UILaunchStoryboardName). Only Apple's
# ibtool compiles a storyboard, so this runs on a Mac with Xcode; build.sh copies the committed .storyboardc on Linux.
# Rerun it after changing LaunchScreen.storyboard or launch/make.py's images, and commit what it writes.
#
#   native/launch/storyboard.sh          on the Mac
#   native/launch/storyboard.sh <host>   from Linux: copies the sources to <host> over ssh, runs ibtool there,
#                                        copies the .storyboardc back
#
# storyboard.sources holds the hashes of what it was compiled from, so native/test_native.py notices a change that
# wasn't recompiled.
set -euo pipefail
cd "$(dirname "$0")"

if [ "$(uname)" != Darwin ]; then
  host=${1:?"launch storyboard: run on a Mac, or give a Mac's ssh host"}
  dir=$(ssh "$host" mktemp -d)
  scp -q storyboard.sh LaunchScreen.storyboard Launch*.png "$host:$dir/"
  ssh "$host" "bash $dir/storyboard.sh"
  rm -rf LaunchScreen.storyboardc
  scp -q -r "$host:$dir/LaunchScreen.storyboardc" .
  ssh "$host" rm -rf "$dir"
  sha256sum LaunchScreen.storyboard Launch*.png > storyboard.sources
  echo "launch storyboard: wrote native/launch/LaunchScreen.storyboardc and storyboard.sources"
  exit 0
fi

export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
rm -rf LaunchScreen.storyboardc
xcrun ibtool --compile LaunchScreen.storyboardc --target-device iphone --minimum-deployment-target 15.0 \
  --errors --warnings --notices --output-format human-readable-text LaunchScreen.storyboard
shasum -a 256 LaunchScreen.storyboard Launch*.png > storyboard.sources
