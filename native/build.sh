#!/usr/bin/env bash
# Build Cydian on Linux (no Mac, no Theos): the Swift shell around web/app/, arm64, iOS 15+, as two artifacts from
# one executable (task I2; the app picks its mode at launch, native/Sources/mode.c):
#   native/build/Cydian.deb  jailbreak: rootless, iphoneos-arm64, jailbreak entitlements; checked by mkdeb.py
#   native/build/Cydian.ipa  sideload: no helper, get-task-allow only, ad hoc signed; checked by mkipa.py.
#                            The user signs it with their own tool (docs/sideload.md, "What I2 needs").
#
#   build.sh [all|deb|ipa]  build and check both (default) or one; `make package|deb|ipa` run this
#   build.sh --probe        exit 0 if the toolchain below is all there, else say what's missing and exit 3
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
what=${1:-all}
case $what in all|deb|ipa) ;; *) echo "usage: build.sh [all|deb|ipa|--probe]" >&2; exit 2 ;; esac

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
  -import-objc-header Sources/Cydian-Bridging-Header.h \
  -module-name Cydian -c Sources/*.swift -o "$out/Cydian.o"
clang -target "$target" -isysroot "$sdk" -O2 -c Sources/availability.c -o "$out/availability.o"
clang -target "$target" -isysroot "$sdk" -O2 -c Sources/mode.c -o "$out/mode.o"
# The app's half of the root helper (cydian_helper_spawn), and the helper itself (N2's native/helper/).
hflags=(-target "$target" -isysroot "$sdk" -std=c11 -Wall -Wextra -Werror -O2)
clang "${hflags[@]}" -c helper/spawn.c -o "$out/spawn.o"
clang -target "$target" -isysroot "$sdk" -fuse-ld=lld --ld-path="$lld" "$out/Cydian.o" "$out/availability.o" \
  "$out/mode.o" "$out/spawn.o" -L "$sdk/usr/lib/swift" -Wl,-rpath,/usr/lib/swift -Wl,-dead_strip -Wl,-adhoc_codesign \
  -o "$out/Cydian"

rcodesign=${RCODESIGN:-$(command -v rcodesign || true)}
ldid=${LDID:-$(command -v ldid || true)}
if [ -z "$rcodesign$ldid" ] && [ -x "$HOME/.cargo/bin/rcodesign" ]; then rcodesign=$HOME/.cargo/bin/rcodesign; fi

# bundle <Cydian.app dir> <entitlements> <Info.plist overlay or "">: the executable signed ad hoc with the
# entitlements (the jailbreak trusts ad hoc code; a sideload signer re-signs it), web/app/, icons, Info.plist.
bundle() {
  local app=$1 ents=$2 overlay=$3
  mkdir -p "$app/web"
  cp "$out/Cydian" "$app/Cydian"
  if [ -n "$ldid" ]; then
    "$ldid" -S"$ents" "$app/Cydian"
  elif [ -n "$rcodesign" ]; then
    "$rcodesign" sign --entitlements-xml-file "$ents" "$app/Cydian" >/dev/null 2>"$out/rcodesign.log" ||
      { cat "$out/rcodesign.log" >&2; exit 1; }
  else
    echo "native build: WARNING no ldid or rcodesign; $app/Cydian is ad hoc signed without entitlements" >&2
  fi
  # web/app/ goes in as it is, minus the tests.
  (cd ../web/app && find . -type f ! -name '*.test.js' ! -name '.*' -print0) |
    while IFS= read -r -d '' f; do mkdir -p "$app/web/$(dirname "$f")" && cp "../web/app/$f" "$app/web/$f"; done
  cp icon/AppIcon60x60@2x.png icon/AppIcon60x60@3x.png "$app/"
  cp bridge.js "$app/bridge.js"
  sed -e "s/@VERSION@/$version/" -e "s/@BUILD@/$build/" -e "s/@MIN@/$min/" Info.plist > "$app/Info.plist"
  [ -z "$overlay" ] || python3 mkipa.py plist "$app/Info.plist" "$overlay" "$app/Info.plist"
  printf 'APPL????' > "$app/PkgInfo"
}

if [ "$what" != ipa ]; then
  root=$out/root
  rm -rf "$root" "$out/debian"
  mkdir -p "$out/debian"
  bundle "$root/var/jb/Applications/Cydian.app" entitlements.plist ""
  # cydian-helper: plain 0755, no setuid (the app spawns it as root through the persona attributes); ad hoc signed.
  # Only the .deb has it: the IPA's app finds no helper and runs in sideload mode (Sources/mode.c).
  libexec=$root/var/jb/usr/libexec/cydian
  mkdir -p "$libexec"
  clang "${hflags[@]}" -fuse-ld=lld --ld-path="$lld" -Wl,-adhoc_codesign -o "$libexec/cydian-helper" helper/main.c helper/policy.c
  chmod 0755 "$libexec/cydian-helper"
  if [ -n "$ldid" ]; then "$ldid" -S "$libexec/cydian-helper"; fi
  sed -e "s/@VERSION@/$version-$build/" deb/control > "$out/debian/control"
  cp deb/postinst deb/prerm "$out/debian/"
  python3 mkdeb.py build "$root" "$out/debian" "$out/Cydian.deb"
  python3 mkdeb.py check "$out/Cydian.deb"
  echo "$out/Cydian.deb ($(du -h "$out/Cydian.deb" | cut -f1))"
fi

if [ "$what" != deb ]; then
  ipa=$out/ipa
  rm -rf "$ipa"
  bundle "$ipa/Cydian.app" entitlements-sideload.plist Info-sideload.plist
  python3 mkipa.py build "$ipa/Cydian.app" "$out/Cydian.ipa"
  python3 mkipa.py check "$out/Cydian.ipa"
  echo "$out/Cydian.ipa ($(du -h "$out/Cydian.ipa" | cut -f1))"
fi
