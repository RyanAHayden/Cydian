#!/usr/bin/env bash
# N9: build the share extension into an app bundle: <app>/PlugIns/iFizBoxShare.appex, arm64, iOS 15+.
# native/build.sh calls this from bundle() with the toolchain it found:
#
#   share/build.sh <jailbreak|sideload> <iFizBox.app dir>
#   env: SWIFTC SDK RD LLD OUT VERSION BUILD [LDID] [RCODESIGN] (as widget/build.sh)
#
# The same extension in both builds (it only opens ifizbox://share?url=…); only the entitlements differ.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
native=$(dirname "$here")
[ $# -eq 2 ] || { sed -n '2,8p' "$0" >&2; exit 2; }
variant=$1 app=$2
: "${SWIFTC:?}" "${SDK:?}" "${RD:?}" "${LLD:?}" "${OUT:?}" "${VERSION:?}" "${BUILD:?}" "${BRAND_NAME:?}"
case $variant in jailbreak|sideload) ;; *) echo "share/build.sh: jailbreak or sideload, not $variant" >&2; exit 2 ;; esac
min=15.0 target=arm64-apple-ios15.0
obj=$OUT/share
appex=$app/PlugIns/iFizBoxShare.appex
mkdir -p "$obj" "$appex"

# Built once per build dir: the extension is the same for both variants.
if [ ! -f "$obj/iFizBoxShare" ] || [ "$here/Extension/ShareViewController.swift" -nt "$obj/iFizBoxShare" ] ||
   [ "$native/sign/Brand.swift" -nt "$obj/iFizBoxShare" ]; then
  "$SWIFTC" -parse-as-library -O -wmo -swift-version 5 -runtime-compatibility-version none -application-extension \
    -target "$target" -sdk "$SDK" -resource-dir "$RD" -I "$RD/shims" -module-cache-path "$OUT/modules" \
    -Xcc -Wno-nullability-completeness -Xcc -Wno-nullability-inferred-on-nested-type \
    -module-name iFizBoxShare -c "$here/Extension/ShareViewController.swift" "$native/sign/Brand.swift" -o "$obj/iFizBoxShare.o"
  clang -target "$target" -isysroot "$SDK" -O2 -c "$native/Sources/availability.c" -o "$obj/availability.o"
  # An NSExtensionPrincipalClass extension starts in Foundation's NSExtensionMain, as Xcode links it.
  clang -target "$target" -isysroot "$SDK" -fuse-ld=lld --ld-path="$LLD" -fapplication-extension "$obj/iFizBoxShare.o" \
    "$obj/availability.o" -L "$SDK/usr/lib/swift" -Wl,-rpath,/usr/lib/swift -Wl,-dead_strip -Wl,-adhoc_codesign \
    -Wl,-e,_NSExtensionMain -framework Foundation -o "$obj/iFizBoxShare"
fi
cp "$obj/iFizBoxShare" "$appex/iFizBoxShare"
sed -e "s/@VERSION@/$VERSION/" -e "s/@BUILD@/$BUILD/" -e "s/@MIN@/$min/" -e "s/\$(BRAND_NAME)/$BRAND_NAME/g" "$here/Info.plist" > "$appex/Info.plist"

ents=$here/entitlements.plist
[ "$variant" = jailbreak ] || ents=$here/entitlements-sideload.plist
if [ -n "${LDID:-}" ]; then
  "$LDID" -S"$ents" "$appex/iFizBoxShare"
elif [ -n "${RCODESIGN:-}" ]; then
  "$RCODESIGN" sign --entitlements-xml-file "$ents" "$appex/iFizBoxShare" >/dev/null 2>"$obj/rcodesign.log" ||
    { cat "$obj/rcodesign.log" >&2; exit 1; }
else
  echo "share: WARNING no ldid or rcodesign; iFizBoxShare.appex is ad hoc signed without entitlements" >&2
fi
