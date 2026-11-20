#!/usr/bin/env bash
# B180 check on the Mac (iOS Simulator). Expects next to it: main.swift, LaunchScreen.storyboardc/, Launch*@?x.png,
# web/ (web/app without app.js). For each simulator named in $DEVICES: screenshots of the system launch screen
# (splash-<dev>.png), the page's first frame (page-<dev>.png) and App.swift's cover path (cover-<dev>.png).
#
#   ssh mba 'bash <dir>/run.sh'      (from Linux: see the journal's README for the copy step)
set -euo pipefail
cd "$(dirname "$0")"
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
DEVICES=${DEVICES:-"iPhone 17|iPhone 16e|B180 SE"}
id=${APP_ID:-com.example.b180launch2} # SplashBoard keeps refusing an ID whose launch image once failed

rm -rf App.app && mkdir App.app
xcrun -sdk iphonesimulator swiftc -parse-as-library -target arm64-apple-ios15.0-simulator main.swift -o App.app/App
cp -R LaunchScreen.storyboardc Launch*@?x.png web App.app/
cat > App.app/Info.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>$id</string>
<key>CFBundleExecutable</key><string>App</string>
<key>CFBundleName</key><string>B180</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>MinimumOSVersion</key><string>15.0</string>
<key>UIDeviceFamily</key><array><integer>1</integer></array>
<key>UILaunchStoryboardName</key><string>LaunchScreen</string>
<key>UIStatusBarStyle</key><string>UIStatusBarStyleLightContent</string>
<key>UIViewControllerBasedStatusBarAppearance</key><true/>
<key>UISupportedInterfaceOrientations</key><array><string>UIInterfaceOrientationPortrait</string></array>
</dict></plist>
EOF
codesign -s - -f App.app

# A 20 pt status bar and no home indicator, as the iPhone 7 has (the jailbreak build's phone).
if ! xcrun simctl list devices | grep -q "B180 SE"; then
  xcrun simctl create "B180 SE" "com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-generation" >/dev/null || true
fi

IFS='|'
for dev in $DEVICES; do
  tag=${dev// /_}
  xcrun simctl boot "$dev" 2>/dev/null || true
  xcrun simctl bootstatus "$dev" -b >/dev/null
  xcrun simctl ui "$dev" appearance light
  xcrun simctl status_bar "$dev" override --time 9:41 --batteryState charged --batteryLevel 100 || true
  xcrun simctl uninstall "$dev" $id 2>/dev/null || true
  xcrun simctl install "$dev" App.app
  xcrun simctl launch "$dev" $id >/dev/null
  sleep 3
  xcrun simctl io "$dev" screenshot "splash-$tag.png" >/dev/null
  sleep 7
  xcrun simctl io "$dev" screenshot "page-$tag.png" >/dev/null
  xcrun simctl terminate "$dev" $id
  xcrun simctl launch "$dev" $id cover >/dev/null
  sleep 9
  xcrun simctl io "$dev" screenshot "cover-$tag.png" >/dev/null
  xcrun simctl terminate "$dev" $id
  xcrun simctl shutdown "$dev"
done
echo done
