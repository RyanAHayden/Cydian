#!/usr/bin/env bash
# N8: build the widget extension into an app bundle: <app>/PlugIns/CydianWidget.appex, arm64, iOS 17+.
# native/build.sh calls this from bundle() with the toolchain it found:
#
#   widget/build.sh <jailbreak|sideload> <Cydian.app dir>
#   env: SWIFTC SDK RD LLD OUT VERSION BUILD [LDID] [RCODESIGN] (build.sh's swiftc, IOS_SDK, resource dir, ld64.lld,
#        build dir, version, build number, signers)
#
# jailbreak: -D CYDIAN_JAILBREAK: the widget plus the Respring and Userspace Reboot controls and their intents (with
#            the helper spawn and the mode check from the app's C), Metadata.appintents for them, entitlements.plist.
# sideload:  the widget alone (no intents, no helper), entitlements-sideload.plist.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
native=$(dirname "$here")
[ $# -eq 2 ] || { sed -n '2,12p' "$0" >&2; exit 2; }
variant=$1 app=$2
: "${SWIFTC:?}" "${SDK:?}" "${RD:?}" "${LLD:?}" "${OUT:?}" "${VERSION:?}" "${BUILD:?}" "${BRAND_NAME:?}"
min=17.0 target=arm64-apple-ios17.0
obj=$OUT/widget-$variant
appex=$app/PlugIns/CydianWidget.appex
mkdir -p "$obj" "$appex"

sources=("$here/Widget.swift" "$native/intents/Core.swift" "$native/sign/Updates.swift" "$native/sign/Brand.swift")
flags=()
cobjs=("$obj/availability.o")
if [ "$variant" = jailbreak ]; then
  sources+=("$here/Controls.swift" "$native/intents/App/Host.swift")
  flags+=(-D CYDIAN_JAILBREAK -import-objc-header "$here/Widget-Bridging-Header.h"
          -emit-const-values-path "$obj/CydianWidget.swiftconstvalues"
          -Xfrontend -const-gather-protocols-file -Xfrontend "$native/intents/protocols.json")
  clang -target "$target" -isysroot "$SDK" -O2 -c "$native/Sources/mode.c" -o "$obj/mode.o"
  clang -target "$target" -isysroot "$SDK" -std=c11 -Wall -Wextra -Werror -O2 -c "$native/helper/spawn.c" -o "$obj/spawn.o"
  cobjs+=("$obj/mode.o" "$obj/spawn.o")
elif [ "$variant" != sideload ]; then
  echo "widget/build.sh: jailbreak or sideload, not $variant" >&2; exit 2
fi
"$SWIFTC" -parse-as-library -O -wmo -swift-version 5 -runtime-compatibility-version none -application-extension \
  -target "$target" -sdk "$SDK" -resource-dir "$RD" -I "$RD/shims" -module-cache-path "$OUT/modules" \
  -Xcc -Wno-nullability-completeness -Xcc -Wno-nullability-inferred-on-nested-type \
  "${flags[@]}" -module-name CydianWidget -c "${sources[@]}" -o "$obj/CydianWidget.o"
clang -target "$target" -isysroot "$SDK" -O2 -c "$native/Sources/availability.c" -o "$obj/availability.o"
clang -target "$target" -isysroot "$SDK" -fuse-ld=lld --ld-path="$LLD" -fapplication-extension "$obj/CydianWidget.o" \
  "${cobjs[@]}" -L "$SDK/usr/lib/swift" -Wl,-rpath,/usr/lib/swift -Wl,-dead_strip -Wl,-adhoc_codesign \
  -o "$appex/CydianWidget"

sed -e "s/@VERSION@/$VERSION/" -e "s/@BUILD@/$BUILD/" -e "s/@MIN@/$min/" -e "s/\$(BRAND_NAME)/$BRAND_NAME/g" "$here/Info.plist" > "$appex/Info.plist"
rm -rf "$appex/Metadata.appintents"
if [ "$variant" = jailbreak ]; then
  python3 "$native/intents/metadata.py" build "$obj/CydianWidget.swiftconstvalues" "$appex/Metadata.appintents" >/dev/null
fi

ents=$here/entitlements.plist
[ "$variant" = jailbreak ] || ents=$here/entitlements-sideload.plist
if [ -n "${LDID:-}" ]; then
  "$LDID" -S"$ents" "$appex/CydianWidget"
elif [ -n "${RCODESIGN:-}" ]; then
  "$RCODESIGN" sign --entitlements-xml-file "$ents" "$appex/CydianWidget" >/dev/null 2>"$obj/rcodesign.log" ||
    { cat "$obj/rcodesign.log" >&2; exit 1; }
else
  echo "widget: WARNING no ldid or rcodesign; CydianWidget.appex is ad hoc signed without entitlements" >&2
fi
