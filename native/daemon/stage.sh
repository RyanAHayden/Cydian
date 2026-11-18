#!/usr/bin/env bash
# Build cydian-upgrades for iOS and put it, signed with entitlements.plist, and its launchd job into a .deb root
# (N5). native/build.sh calls this for the jailbreak .deb only; the sideload IPA has no daemon.
#
#   stage.sh <root> <IOS_SDK> <ld64.lld> [ldid] [rcodesign]
#
# <root>/var/jb/usr/libexec/cydian/cydian-upgrades          0755, arm64, iOS 15+
# (@available needs ../Sources/availability.c, the app's stand-in for compiler-rt's version check.)
# <root>/var/jb/Library/LaunchDaemons/com.ryha.cydian.upgrades.plist   0644 (postinst loads it, prerm unloads it)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
[ $# -ge 3 ] || { sed -n '2,10p' "$0" >&2; exit 2; }
root=$1 sdk=$2 lld=$3 ldid=${4:-} rcodesign=${5:-}
exe=$root/var/jb/usr/libexec/cydian/cydian-upgrades
jobs=$root/var/jb/Library/LaunchDaemons
mkdir -p "$(dirname "$exe")" "$jobs"
clang -target arm64-apple-ios15.0 -isysroot "$sdk" -std=gnu11 -fobjc-arc -Wall -Wextra -Werror -O2 \
  -fuse-ld=lld --ld-path="$lld" -Wl,-dead_strip -Wl,-adhoc_codesign \
  -framework Foundation -framework UserNotifications \
  -o "$exe" "$here/main.m" "$here/upgrades.c" "$here/../Sources/availability.c"
chmod 0755 "$exe"
if [ -n "$ldid" ]; then
  "$ldid" -S"$here/entitlements.plist" "$exe"
elif [ -n "$rcodesign" ]; then
  log=$(mktemp)
  "$rcodesign" sign --entitlements-xml-file "$here/entitlements.plist" "$exe" >/dev/null 2>"$log" ||
    { cat "$log" >&2; rm -f "$log"; exit 1; }
  rm -f "$log"
else
  echo "daemon: WARNING no ldid or rcodesign; cydian-upgrades has no entitlements and can't post notifications" >&2
fi
install -m 0644 "$here/com.ryha.cydian.upgrades.plist" "$jobs/com.ryha.cydian.upgrades.plist"
