#!/usr/bin/env bash
# Build the R3 navigation spike as an unsigned IPA on Linux (no Mac, no Theos), for sideloading on a stock
# ProMotion iPhone: the measurement needs no jailbreak. Output: native/spike/build/CydianSpike.ipa.
#
# Needs:
#   SWIFT_TOOLCHAIN  a swift.org Linux toolchain (6.4.x to match the SDK's compiler), the dir holding usr/bin/swiftc
#                    (default: the one swiftc on PATH belongs to)
#   IOS_SDK          iPhoneOS.sdk pulled from an Xcode .xip (opentennis tools/ios-sdk.py does it on Linux)
#                    (default ~/.local/share/hst-ios/iPhoneOS.sdk)
#   LD64_LLD         an ld64.lld (default: rustup's gcc-ld/ld64.lld, else ld64.lld on PATH)
# What docs/native.md "Building on Linux" explains: arm64 only (lld can't link arm64e), Swift 5.6 back-deploy shim
# off (-runtime-compatibility-version none), SwiftShims from the toolchain via -I.
set -euo pipefail
cd "$(dirname "$0")"
tc=${SWIFT_TOOLCHAIN:-$(dirname "$(dirname "$(dirname "$(readlink -f "$(command -v swiftc)")")")")}
swiftc=$tc/usr/bin/swiftc
sdk=${IOS_SDK:-$HOME/.local/share/hst-ios/iPhoneOS.sdk}
lld=${LD64_LLD:-$(rustc --print sysroot 2>/dev/null)/lib/rustlib/x86_64-unknown-linux-gnu/bin/gcc-ld/ld64.lld}
[ -x "$lld" ] || lld=$(command -v ld64.lld)
[ -x "$swiftc" ] || { echo "no swiftc: set SWIFT_TOOLCHAIN" >&2; exit 1; }
[ -d "$sdk" ] || { echo "no SDK at $sdk: set IOS_SDK" >&2; exit 1; }
min=15.0 target=arm64-apple-ios15.0
out=build
mkdir -p "$out"
# The ubuntu24.04 toolchain wants libncurses.so.6; Arch ships only the wide one.
if ldd "$swiftc" | grep -q 'libncurses.so.6 => not found'; then
  mkdir -p "$out/libshim" && ln -sf /usr/lib/libncursesw.so.6 "$out/libshim/libncurses.so.6"
  export LD_LIBRARY_PATH=$PWD/$out/libshim${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
fi
# A resource dir with only SwiftShims and clang's headers: the toolchain's own (Linux) one brings Glibc-flavoured
# CoreFoundation/dispatch module maps that clash with the SDK's.
rd=$out/resource
mkdir -p "$rd"
rm -rf "$rd/shims" && cp -r "$tc/usr/lib/swift/shims" "$rd/shims"
ln -sfn "$tc/usr/lib/swift/clang" "$rd/clang"
"$swiftc" -parse-as-library -O -wmo -swift-version 5 -runtime-compatibility-version none \
  -target "$target" -sdk "$sdk" -resource-dir "$rd" -I "$rd/shims" -module-cache-path "$out/modules" \
  -module-name CydianSpike -c Sources/*.swift -o "$out/CydianSpike.o"
app=$out/ipa/Payload/CydianSpike.app
rm -rf "$out/ipa"
mkdir -p "$app/web"
clang -target "$target" -isysroot "$sdk" -O2 -c Sources/availability.c -o "$out/availability.o"
clang -target "$target" -isysroot "$sdk" -fuse-ld=lld --ld-path="$lld" "$out/CydianSpike.o" "$out/availability.o" \
  -L "$sdk/usr/lib/swift" -Wl,-rpath,/usr/lib/swift -Wl,-dead_strip -o "$app/CydianSpike"
cp web/* "$app/web/"
build=$(git rev-list --count HEAD 2>/dev/null || echo 1)
sed -e "s/@BUILD@/$build/" -e "s/@MIN@/$min/" Info.plist > "$app/Info.plist"
rm -f "$out/CydianSpike.ipa"
(cd "$out/ipa" && zip -qr -X ../CydianSpike.ipa Payload)
echo "$out/CydianSpike.ipa ($(du -h "$out/CydianSpike.ipa" | cut -f1))"
