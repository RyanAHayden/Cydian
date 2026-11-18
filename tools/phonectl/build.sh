#!/bin/sh
# Build phonectl for the iOS 15+ test phone and install it there.
#   tools/phonectl/build.sh [HOST]     HOST defaults to 7 (`ssh 7`); "-" builds only
# Needs IOS_SDK and ld64.lld like native/build.sh, and PHONE_SUDO_PASS to install. Signs on the phone with its ldid.
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
# The phone's sudo password comes from PHONE_SUDO_PASS (ask the user; never commit it).
printf '%s\n' "${PHONE_SUDO_PASS:?set PHONE_SUDO_PASS to the phone's sudo password}" | ssh "$host" 'sudo -S -p "" sh -c "mkdir -p /var/jb/usr/local/bin && ldid -S/tmp/entitlements.plist /tmp/phonectl &&
  install -o root -g wheel -m 4755 /tmp/phonectl /var/jb/usr/local/bin/phonectl && rm /tmp/phonectl /tmp/entitlements.plist"'
echo "installed $host:/var/jb/usr/local/bin/phonectl"
