#!/bin/sh
# Build r25inst (R25's hand test) and copy it, with ifizbox-helper's entitlements, to the iPhone 7's /tmp.
# Sign it there: ssh 7 'ldid -S/tmp/r25inst-ent.plist /tmp/r25inst' (then run it with sudo -n).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(git -C "$here" rev-parse --show-toplevel)
sdk=${IOS_SDK:?point IOS_SDK at an iPhoneOS.sdk}
lld=${LD64_LLD:-$(rustc --print sysroot 2>/dev/null)/lib/rustlib/x86_64-unknown-linux-gnu/bin/gcc-ld/ld64.lld}
[ -x "$lld" ] || lld=$(command -v ld64.lld)
out=${OUT:-$here/build}; mkdir -p "$out"
clang -target arm64-apple-ios15.0 -isysroot "$sdk" -O2 -Wall -fuse-ld=lld --ld-path="$lld" \
  -framework CoreFoundation -lobjc -o "$out/r25inst" "$here/r25inst.c"
scp -q "$out/r25inst" 7:/tmp/r25inst
scp -q "$root/native/helper/entitlements.plist" 7:/tmp/r25inst-ent.plist
echo "copied to 7:/tmp/r25inst"
