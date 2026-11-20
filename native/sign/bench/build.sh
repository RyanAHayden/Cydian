#!/bin/sh
# Builds signbench (native/sign/bench/main.swift + the signer, native/sign/*.swift) for the iOS 15+ test phone, or for
# Linux with `linux`. The phone copy is signed there with its ldid (docs/iphone7.md); run it over ssh:
#   native/sign/bench/build.sh [7|-|linux]   7 (default) builds and copies it to 7:/tmp/signbench; "-" builds only
#   ssh 7 /tmp/signbench in.ipa out.ipa key.der cert.der profile.mobileprovision [bundle ID]
# Needs SWIFT_TOOLCHAIN, IOS_SDK and ld64.lld like native/build.sh. Fixtures: native/sign/bench/fixtures.py.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
sign=$(dirname "$here")
host=${1:-7}
tc=${SWIFT_TOOLCHAIN:?point SWIFT_TOOLCHAIN at a swift.org toolchain}
out=$here/build; mkdir -p "$out"
# The ubuntu toolchain wants libncurses.so.6; Arch ships only the wide one (as native/build.sh does).
if [ -e /usr/lib/libncursesw.so.6 ] && [ ! -e /usr/lib/libncurses.so.6 ]; then
  mkdir -p "$out/libshim" && ln -sf /usr/lib/libncursesw.so.6 "$out/libshim/libncurses.so.6"
  export LD_LIBRARY_PATH="$out/libshim${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
if [ "$host" = linux ]; then
  exec "$tc/usr/bin/swiftc" -O -module-cache-path "$out/modules-linux" -import-objc-header "$sign/zlib-shim.h" \
    "$sign"/*.swift "$here/main.swift" -lz -o "$out/signbench-linux"
fi
sdk=${IOS_SDK:?point IOS_SDK at an iPhoneOS.sdk}
lld=${LD64_LLD:-$(rustc --print sysroot 2>/dev/null)/lib/rustlib/x86_64-unknown-linux-gnu/bin/gcc-ld/ld64.lld}
[ -x "$lld" ] || lld=$(command -v ld64.lld)
# As native/build.sh: a resource dir with only SwiftShims and clang's headers.
rd=$out/resource; mkdir -p "$rd"
rm -rf "$rd/shims" && cp -r "$tc/usr/lib/swift/shims" "$rd/shims"
ln -sfn "$tc/usr/lib/swift/clang" "$rd/clang"
target=arm64-apple-ios15.0
"$tc/usr/bin/swiftc" -O -wmo -swift-version 5 -runtime-compatibility-version none \
  -target "$target" -sdk "$sdk" -resource-dir "$rd" -I "$rd/shims" -module-cache-path "$out/modules" \
  -Xcc -Wno-nullability-completeness -import-objc-header "$sign/zlib-shim.h" -module-name signbench \
  -c "$sign"/*.swift "$here/main.swift" -o "$out/signbench.o"
clang -target "$target" -isysroot "$sdk" -fuse-ld=lld --ld-path="$lld" "$out/signbench.o" -L "$sdk/usr/lib/swift" -lz \
  -Wl,-rpath,/usr/lib/swift -Wl,-dead_strip -framework Security -o "$out/signbench"
echo "built $out/signbench"
[ "$host" = - ] && exit 0
scp -q "$out/signbench" "$here/entitlements.plist" "$host:/tmp/"
# Plain `ldid -S` leaves a binary the phone kills at once (exit 137): it needs these entitlements.
ssh "$host" 'ldid -S/tmp/entitlements.plist /tmp/signbench && rm /tmp/entitlements.plist'
echo "copied to $host:/tmp/signbench"
