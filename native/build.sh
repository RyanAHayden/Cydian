#!/usr/bin/env bash
# Build Cydian.deb on Linux (no Mac, no Theos): the Swift shell around web/app/, rootless, iphoneos-arm64, iOS 15+.
# Output: native/build/Cydian.deb, checked by mkdeb.py. `make package` runs this.
#
#   build.sh           build and check the .deb
#   build.sh --probe   exit 0 if the toolchain below is all there, else say what's missing and exit 3
#
# Needs (docs/native.md, "Building on Linux"):
#   SWIFT_TOOLCHAIN  a swift.org Linux toolchain, 6.4.x to match the SDK's compiler: the dir holding usr/bin/swiftc
#                    (default: the one swiftc on PATH belongs to)
#   IOS_SDK          iPhoneOS.sdk extracted from an Xcode .xip (required; Cydian's own extraction script is task T3)
#   LD64_LLD         an ld64.lld (default: rustup's gcc-ld/ld64.lld, else ld64.lld on PATH)
#   RCODESIGN/LDID   a signer for the entitlements (default: rcodesign or ldid on PATH, then ~/.cargo/bin/rcodesign).
#                    Without one the executable keeps lld's ad hoc signature, which has no entitlements.
# arm64 only: lld can't link arm64e, and apps run as arm64 on arm64e phones (R3).
set -euo pipefail
cd "$(dirname "$0")"

missing=()
if [ -n "${SWIFT_TOOLCHAIN:-}" ]; then
  tc=$SWIFT_TOOLCHAIN
elif command -v swiftc >/dev/null; then
  tc=$(dirname "$(dirname "$(dirname "$(readlink -f "$(command -v swiftc)")")")")
else
  tc=
fi
swiftc=$tc/usr/bin/swiftc
[ -n "$tc" ] && [ -x "$swiftc" ] || missing+=("swiftc (set SWIFT_TOOLCHAIN to a swift.org 6.4.x toolchain)")
sdk=${IOS_SDK:-}
if [ -z "$sdk" ]; then missing+=("IOS_SDK (point it at an iPhoneOS.sdk extracted from Xcode)")
elif [ ! -d "$sdk" ]; then missing+=("IOS_SDK=$sdk (not a directory)"); fi
lld=${LD64_LLD:-$(rustc --print sysroot 2>/dev/null || true)/lib/rustlib/x86_64-unknown-linux-gnu/bin/gcc-ld/ld64.lld}
[ -x "$lld" ] || lld=$(command -v ld64.lld || true)
[ -n "$lld" ] || missing+=("ld64.lld (rustup's, or set LD64_LLD)")
command -v clang >/dev/null || missing+=("clang")
if [ ${#missing[@]} -gt 0 ]; then
  printf 'native build: missing %s\n' "${missing[@]}" >&2
  exit 3
fi
[ "${1:-}" = --probe ] && exit 0

min=15.0 target=arm64-apple-ios15.0
version=$(cat VERSION)
build=$(git rev-list --count HEAD 2>/dev/null || echo 1)
export SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct 2>/dev/null || echo 0)}
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
  -Xcc -Wno-nullability-completeness -Xcc -Wno-nullability-inferred-on-nested-type \
  -module-name Cydian -c Sources/*.swift -o "$out/Cydian.o"
clang -target "$target" -isysroot "$sdk" -O2 -c Sources/availability.c -o "$out/availability.o"

root=$out/root
app=$root/var/jb/Applications/Cydian.app
rm -rf "$root" "$out/debian"
mkdir -p "$app/web" "$out/debian"
clang -target "$target" -isysroot "$sdk" -fuse-ld=lld --ld-path="$lld" "$out/Cydian.o" "$out/availability.o" \
  -L "$sdk/usr/lib/swift" -Wl,-rpath,/usr/lib/swift -Wl,-dead_strip -Wl,-adhoc_codesign -o "$app/Cydian"

# Sign with the entitlements (the jailbreak trusts ad hoc code).
ents=entitlements.plist
rcodesign=${RCODESIGN:-$(command -v rcodesign || true)}
ldid=${LDID:-$(command -v ldid || true)}
if [ -z "$rcodesign$ldid" ] && [ -x "$HOME/.cargo/bin/rcodesign" ]; then rcodesign=$HOME/.cargo/bin/rcodesign; fi
if [ -n "$ldid" ]; then
  "$ldid" -S"$ents" "$app/Cydian"
elif [ -n "$rcodesign" ]; then
  "$rcodesign" sign --entitlements-xml-file "$ents" "$app/Cydian" >/dev/null 2>"$out/rcodesign.log" ||
    { cat "$out/rcodesign.log" >&2; exit 1; }
else
  echo "native build: WARNING no ldid or rcodesign; the executable is ad hoc signed without entitlements" >&2
fi

# web/app/ goes in as it is, minus the tests.
(cd ../web/app && find . -type f ! -name '*.test.js' ! -name '.*' -print0) |
  while IFS= read -r -d '' f; do mkdir -p "$app/web/$(dirname "$f")" && cp "../web/app/$f" "$app/web/$f"; done
cp icon/AppIcon60x60@2x.png icon/AppIcon60x60@3x.png "$app/"
sed -e "s/@VERSION@/$version/" -e "s/@BUILD@/$build/" -e "s/@MIN@/$min/" Info.plist > "$app/Info.plist"
printf 'APPL????' > "$app/PkgInfo"

sed -e "s/@VERSION@/$version-$build/" deb/control > "$out/debian/control"
cp deb/postinst deb/prerm "$out/debian/"
python3 mkdeb.py build "$root" "$out/debian" "$out/Cydian.deb"
python3 mkdeb.py check "$out/Cydian.deb"
echo "$out/Cydian.deb ($(du -h "$out/Cydian.deb" | cut -f1))"
