#!/bin/sh
# F237's iPhone 7 check: build f237sign (native/sign's IPASigner plus main.swift), as native/test_sign.py builds
# signtest. Needs SWIFT_TOOLCHAIN. Then:
#   python3 mkfx.py <repo> <dir>          throwaway identity, explicit profile com.me.f237only, test.ipa
#   ./f237sign <dir> test.ipa kept.ipa keep ; ./f237sign <dir> test.ipa old.ipa old
#   scp both to 7:/tmp/f237, then ssh 7 'sudo -n /tmp/r25inst install /tmp/f237/kept.ipa com.ryha.ifizbox.f237test'
#   (R25's tool, journal/2026-11-18-r25-keep-bundle-id/tools) and r25inst uninstall <id> afterwards.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
sign=$(git -C "$here" rev-parse --show-toplevel)/native/sign
out=${OUT:-$here/build}; mkdir -p "$out"
if [ -e /usr/lib/libncursesw.so.6 ] && [ ! -e /usr/lib/libncurses.so.6 ]; then
  mkdir -p "$out/libshim"; [ -e "$out/libshim/libncurses.so.6" ] || ln -s /usr/lib/libncursesw.so.6 "$out/libshim/libncurses.so.6"
  export LD_LIBRARY_PATH="$out/libshim"
fi
"$SWIFT_TOOLCHAIN/usr/bin/swiftc" -O -module-cache-path "$out/modules" -import-objc-header "$sign/zlib-shim.h" \
  "$sign"/*.swift "$here/main.swift" -lz -o "$out/f237sign"
echo "built $out/f237sign"
