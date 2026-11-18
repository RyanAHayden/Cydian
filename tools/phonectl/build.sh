#!/bin/sh
# Build phonectl for the iOS 15+ test phone and install it there.
#   tools/phonectl/build.sh [HOST]     HOST defaults to 7 (`ssh 7`); "-" builds only
# Needs IOS_SDK and ld64.lld like native/build.sh. Installs with the phone's passwordless sudo (sudo -n); PHONE_SUDO_PASS
# is only a fallback for when that rule is gone. Signs on the phone with its ldid.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
host=${1:-7}
sdk=${IOS_SDK:?point IOS_SDK at an iPhoneOS.sdk}
lld=${LD64_LLD:-$(rustc --print sysroot 2>/dev/null)/lib/rustlib/x86_64-unknown-linux-gnu/bin/gcc-ld/ld64.lld}
[ -x "$lld" ] || lld=$(command -v ld64.lld)
out=$here/build; mkdir -p "$out"
clang -target arm64-apple-ios15.0 -isysroot "$sdk" -O2 -Wall -Wno-four-char-constants -fuse-ld=lld --ld-path="$lld" \
  -framework CoreFoundation -framework CoreGraphics -framework IOSurface -framework ImageIO \
  -o "$out/phonectl" "$here/phonectl.c"
echo "built $out/phonectl"
[ "$host" = - ] && exit 0
scp -q "$out/phonectl" "$here/entitlements.plist" "$host:/tmp/"
# setuid root: HID dispatch and screen capture run as root without a sudo password.
# sudo is passwordless on the phone since 2026-11-18, so -n fails fast instead of prompting if that rule is gone;
# then PHONE_SUDO_PASS, if set, is the fallback (ask the user for it; never commit it).
install='mkdir -p /var/jb/usr/local/bin && ldid -S/tmp/entitlements.plist /tmp/phonectl &&
  install -o root -g wheel -m 4755 /tmp/phonectl /var/jb/usr/local/bin/phonectl && rm /tmp/phonectl /tmp/entitlements.plist'
if ssh "$host" 'sudo -n true' 2>/dev/null; then
  ssh "$host" "sudo -n sh -c '$install'"
elif [ -n "${PHONE_SUDO_PASS:-}" ]; then
  printf '%s\n' "$PHONE_SUDO_PASS" | ssh "$host" "sudo -S -p '' sh -c '$install'"
else
  echo "sudo -n fails on $host and PHONE_SUDO_PASS is not set: ask the user (docs/iphone7.md)" >&2; exit 1
fi
echo "installed $host:/var/jb/usr/local/bin/phonectl"
