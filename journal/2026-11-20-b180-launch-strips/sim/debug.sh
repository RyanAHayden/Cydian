#!/usr/bin/env bash
# B180: rebuild the app from main.swift and take launch-screen shots every second (one device), with the cover's
# layout log. Run after run.sh has made App.app once.
set -euo pipefail
cd "$(dirname "$0")"
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
dev=${DEV:-iPhone 17}
id=${APP_ID:-com.example.b180launch2}
xcrun -sdk iphonesimulator swiftc -parse-as-library -target arm64-apple-ios15.0-simulator main.swift -o App.app/App
codesign -s - -f App.app
xcrun simctl boot "$dev" 2>/dev/null || true
xcrun simctl bootstatus "$dev" -b >/dev/null
xcrun simctl uninstall "$dev" $id 2>/dev/null || true
xcrun simctl install "$dev" App.app
sleep 5
xcrun simctl launch "$dev" $id >/dev/null
for i in 1 2 3 4 5; do sleep 1; xcrun simctl io "$dev" screenshot "dbg-$i.png" >/dev/null 2>&1; done
xcrun simctl terminate "$dev" $id
xcrun simctl launch "$dev" $id >/dev/null
for i in 1 2 3; do sleep 1; xcrun simctl io "$dev" screenshot "dbg2-$i.png" >/dev/null 2>&1; done
xcrun simctl terminate "$dev" $id
xcrun simctl shutdown "$dev"
# The cover's layout log and SplashBoard's errors: debug2.sh.
