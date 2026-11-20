#!/usr/bin/env bash
# B180: why the Simulator's launch screen is black: SplashBoard's log around a launch, and the cover's layout log.
set -uo pipefail
cd "$(dirname "$0")"
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
dev=${DEV:-iPhone 17}
id=${APP_ID:-com.example.b180launch2}
xcrun simctl boot "$dev" 2>/dev/null
xcrun simctl bootstatus "$dev" -b >/dev/null
xcrun simctl launch "$dev" $id >/dev/null
sleep 4
xcrun simctl spawn "$dev" log show --last 30s --style compact \
  --predicate 'eventMessage CONTAINS[c] "splash" OR eventMessage CONTAINS[c] "launch image" OR eventMessage CONTAINS[c] "storyboard" OR subsystem CONTAINS[c] "SplashBoard"' \
  | grep -v "^Timestamp" | tail -40
xcrun simctl terminate "$dev" $id
xcrun simctl launch --console-pty "$dev" $id cover > cover.log 2>&1 &
pid=$!
sleep 12
xcrun simctl io "$dev" screenshot "dbg-cover.png" >/dev/null 2>&1
kill $pid
xcrun simctl terminate "$dev" $id
cat cover.log
xcrun simctl shutdown "$dev"
