#!/bin/sh
# Copy reference files off the iPhone 4S (gitignored). Read-only on the phone.
# Needs a working `ssh 4s` (see R1 in plan/TODO.md). Usage: tools/pull-4s.sh [dest (ref/4s)] [host (4s)]
# Pull into a new dest to keep an older snapshot (e.g. before/after a WinterBoard change).
set -eu
dest=${1:-$(dirname "$0")/../ref/4s}
host=${2:-4s}
mkdir -p "$dest"
# ponytail: no compression, the 4S CPU is slower than its Wi-Fi.
# /Library/Themes is a symlink into /var/stash: tar its target too (the phone's tar won't follow it).
ssh "$host" 'cd / && tar cf - $(readlink Library/Themes | sed s,^/,,) \
  Applications/Cydia.app \
  etc/apt/sources.list.d \
  var/lib/apt/lists \
  var/lib/dpkg/status \
  var/mobile/Library/Caches/com.saurik.Cydia \
  var/mobile/Library/Preferences/com.saurik.Cydia.plist \
  var/mobile/Library/Preferences/com.saurik.WinterBoard.plist \
  Library/Themes \
  System/Library/Frameworks/UIKit.framework/*.artwork' | tar xf - -C "$dest"
du -sh "$dest"
