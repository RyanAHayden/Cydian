#!/usr/bin/env bash
# Builds the re-sign probe (probe.m) as an IPA whose "original" signature asks for an app group and a keychain group
# of another team, as a store app does (Instagram: group.com.burbn.instagram, its own team's keychain group). The
# signers see those, as with any store app, and add the group fix.
#   tools/resignprobe/build.sh [ID-SUFFIX [WIPE]]  -> tools/resignprobe/build/probe[-SUFFIX].ipa
# ID-SUFFIX: the bundle ID is the brand's ID + ".probe" (+ ".SUFFIX"), never the brand's own (that would replace the app).
# WIPE=1 sets ProbeWipe (probe.m): at its first launch the copy deletes every keychain item it can reach.
# Needs IOS_SDK, clang, ld64.lld (as native/groupfix/build.sh) and the rig's zsign (docs/iphone15.md) for the
# original ad hoc signature.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/../../native/brand.env"
sdk=${IOS_SDK:?set IOS_SDK to an iPhoneOS.sdk}
lld=${LD64_LLD:-$(rustc --print sysroot 2>/dev/null || true)/lib/rustlib/x86_64-unknown-linux-gnu/bin/gcc-ld/ld64.lld}
[ -x "$lld" ] || lld=$(command -v ld64.lld)
zsign=${ZSIGN:-${IFIZBOX_15_RIG:-$HOME/.local/share/ifizbox-rig}/zsign}
suffix=${1:-}
wipe=${2:-0}
id=$BRAND_BUNDLE_ID.probe${suffix:+.$suffix}
name=probe${suffix:+-$suffix}
out=$here/build/$name
rm -rf "$out" && mkdir -p "$out/Payload/Probe.app"
app=$out/Payload/Probe.app
clang -target arm64-apple-ios15.0 -isysroot "$sdk" -fobjc-arc -O2 -Wall -Werror -fuse-ld=lld --ld-path="$lld" \
  -Wl,-rpath,@executable_path/Frameworks -framework UIKit -framework Foundation -framework Security -o "$app/Probe" "$here/probe.m"
python3 -I - "$app/Info.plist" "$id" "$wipe" <<'EOF'
import plistlib, sys
path, bid, wipe = sys.argv[1:4]
plistlib.dump({"CFBundleIdentifier": bid, "CFBundleExecutable": "Probe", "CFBundleName": "Probe",
               "CFBundleDisplayName": "Probe" + bid.removeprefix(bid.rsplit(".probe", 1)[0] + ".probe"),
               "CFBundlePackageType": "APPL", "CFBundleShortVersionString": "1.0", "CFBundleVersion": "1",
               "CFBundleInfoDictionaryVersion": "6.0", "CFBundleSupportedPlatforms": ["iPhoneOS"], "MinimumOSVersion": "15.0",
               "LSRequiresIPhoneOS": True, "UIDeviceFamily": [1], "UILaunchScreen": {}, "UIFileSharingEnabled": True,
               "UIRequiredDeviceCapabilities": ["arm64"], "ProbeWipe": wipe == "1",
               "UIApplicationSceneManifest": {"UIApplicationSupportsMultipleScenes": False, "UISceneConfigurations": {
                   "UIWindowSceneSessionRoleApplication": [{"UISceneConfigurationName": "Default", "UISceneDelegateClassName": "SceneDelegate"}]}}},
              open(path, "wb"))
EOF
# The original signature: another team's App ID, keychain group and app group (probe.m's ORIG_TEAM, ORIG_GROUP).
python3 -I - "$out/orig.plist" "$id" <<'EOF'
import plistlib, sys
path, bid = sys.argv[1:3]
plistlib.dump({"application-identifier": f"ABCDE12345.{bid}", "com.apple.developer.team-identifier": "ABCDE12345",
               "keychain-access-groups": [f"ABCDE12345.{bid}"],
               "com.apple.security.application-groups": ["group.org.example.probe.original"]}, open(path, "wb"))
EOF
(cd "$out" && "$zsign" -q -a -e orig.plist "$app" >/dev/null)  # zsign leaves .zsign_cache/ in the current folder
(cd "$out" && rm -f "../$name.ipa" && zip -qr "../$name.ipa" Payload)
echo "$here/build/$name.ipa ($id)"
