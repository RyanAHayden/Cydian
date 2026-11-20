#!/usr/bin/env bash
# R46 check on the Mac (iOS Simulator). Expects next to it: main.swift, native/launch's Launch*@?x.png,
# LaunchScreen.storyboardc/ and themes/, and web/ (web/app without app.js). See the journal's README for the copy.
#
#   bash r46.sh build          JB.app (storyboard + LaunchThemes, like the .deb) and Lite.app (empty UILaunchScreen)
#   bash r46.sh jb             jailbreak-style: Classic, then the helper's copy of Gunmetal, then OLED Black,
#                              relaunching after each, without and then with clearing the snapshot
#   bash r46.sh lite           the IPA's neutral splash in light and dark
#   bash r46.sh swap           whether the Lite app can swap its own SplashBoard snapshot for a themed one; run it as
#                              JB_ID=<a jb2 resign id> (jb's own app ends denylisted, its frames black)
#   bash r46.sh jb2 resign|symlink <fresh id>, jb3 <id>, jb4 <id>   ways around the cache (see each step)
#   bash r46.sh atx            the Lite app writes the theme cover into its own snapshots
#   bash r46.sh log [id]       SplashBoard's log around one launch
# Shots and logs land in out/. Extends B180's harness (journal/2026-11-20-b180-launch-strips/sim/run.sh).
set -uo pipefail
cd "$(dirname "$0")"
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
dev=${DEV:-iPhone 17}
JB=${JB_ID:-com.example.r46jb1}
LITE=${LITE_ID:-com.example.r46lite1}
mkdir -p out

plist() { # $1 id, $2 launch keys
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>$1</string>
<key>CFBundleExecutable</key><string>App</string>
<key>CFBundleName</key><string>R46</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>MinimumOSVersion</key><string>15.0</string>
<key>UIDeviceFamily</key><array><integer>1</integer></array>
$2
<key>UIStatusBarStyle</key><string>UIStatusBarStyleLightContent</string>
<key>UIViewControllerBasedStatusBarAppearance</key><true/>
<key>UISupportedInterfaceOrientations</key><array><string>UIInterfaceOrientationPortrait</string></array>
</dict></plist>
EOF
}

boot() {
  xcrun simctl boot "$dev" 2>/dev/null || true
  xcrun simctl bootstatus "$dev" -b >/dev/null
  xcrun simctl status_bar "$dev" override --time 9:41 --batteryState charged --batteryLevel 100 || true
}

shot() { # $1 id, $2 name, [$3 args...]: cold launch, splash shots at ~3 and ~7 s (main.swift holds it 10 s),
  # then the page or cover at ~15 s; terminate
  local id=$1 name=$2; shift 2
  xcrun simctl terminate "$dev" "$id" 2>/dev/null || true
  xcrun simctl launch "$dev" "$id" "$@" >/dev/null
  sleep 3
  xcrun simctl io "$dev" screenshot "out/$name.png" >/dev/null 2>&1
  sleep 4
  xcrun simctl io "$dev" screenshot "out/$name-b.png" >/dev/null 2>&1
  sleep 8
  xcrun simctl io "$dev" screenshot "out/$name-late.png" >/dev/null 2>&1
  xcrun simctl terminate "$dev" "$id" 2>/dev/null || true
  sleep 1
}

snaps() { # $1 id, $2 name: the data container's SplashBoard tree with xattrs
  local d
  d=$(xcrun simctl get_app_container "$dev" "$1" data)
  { echo "# $2"; find "$d/Library/SplashBoard" -exec ls -ld {} + 2>&1; find "$d/Library/SplashBoard" -type f -exec xattr -l {} + 2>&1; } >> out/snaps.txt
}

case ${1:-} in
build)
  for a in JB Lite; do
    rm -rf $a.app && mkdir $a.app
    xcrun -sdk iphonesimulator swiftc -parse-as-library -target arm64-apple-ios15.0-simulator main.swift -o $a.app/App || exit 1
    cp -R web $a.app/
    cp -R themes $a.app/LaunchThemes
  done
  cp -R LaunchScreen.storyboardc Launch*@?x.png JB.app/
  plist $JB '<key>UILaunchStoryboardName</key><string>LaunchScreen</string>' > JB.app/Info.plist
  plist $LITE '<key>UILaunchScreen</key><dict/>' > Lite.app/Info.plist
  codesign -s - -f JB.app && codesign -s - -f Lite.app
  ;;
jb)
  boot
  xcrun simctl ui "$dev" appearance light
  xcrun simctl uninstall "$dev" $JB 2>/dev/null || true
  xcrun simctl install "$dev" JB.app
  app=$(xcrun simctl get_app_container "$dev" $JB app)
  shot $JB jb-1-classic; snaps $JB jb-1-classic
  shot $JB jb-1-classic-again; snaps $JB jb-1-classic-again
  # The helper's copy (launch.h): each of the 13 files over the bundle's own.
  cp themes/gunmetal/Launch*@?x.png "$app/"
  cp themes/gunmetal/LaunchScreen.storyboardc/* "$app/LaunchScreen.storyboardc/"
  shot $JB jb-2-gunmetal-noclear; snaps $JB jb-2-gunmetal-noclear
  shot $JB jb-2-gunmetal-cover cover gunmetal
  data=$(xcrun simctl get_app_container "$dev" $JB data)
  rm -rf "$data/Library/SplashBoard/Snapshots"
  shot $JB jb-3-gunmetal-cleared; snaps $JB jb-3-gunmetal-cleared
  cp themes/oled/Launch*@?x.png "$app/"
  cp themes/oled/LaunchScreen.storyboardc/* "$app/LaunchScreen.storyboardc/"
  shot $JB jb-4-oled-noclear; snaps $JB jb-4-oled-noclear
  rm -rf "$data/Library/SplashBoard/Snapshots"
  shot $JB jb-5-oled-cleared; snaps $JB jb-5-oled-cleared
  shot $JB jb-5-oled-cover cover oled
  # After a Simulator reboot, still OLED Black?
  xcrun simctl shutdown "$dev"; boot
  shot $JB jb-6-oled-reboot; snaps $JB jb-6-oled-reboot
  cp themes/classic/Launch*@?x.png "$app/"
  cp themes/classic/LaunchScreen.storyboardc/* "$app/LaunchScreen.storyboardc/"
  shot $JB jb-7-classic-noclear; snaps $JB jb-7-classic-noclear
  # The app's own Splash.clearSnapshots path (from inside the process), then relaunch.
  shot $JB jb-8-wipe-from-app wipe
  shot $JB jb-8-classic-after-wipe; snaps $JB jb-8-classic-after-wipe
  ;;
lite)
  boot
  xcrun simctl uninstall "$dev" $LITE 2>/dev/null || true
  xcrun simctl install "$dev" Lite.app
  xcrun simctl ui "$dev" appearance light
  shot $LITE lite-1-light; snaps $LITE lite-1-light
  shot $LITE lite-1-light-cover cover gunmetal
  xcrun simctl ui "$dev" appearance dark
  shot $LITE lite-2-dark; snaps $LITE lite-2-dark
  shot $LITE lite-2-dark-cover cover oled
  xcrun simctl ui "$dev" appearance light
  ;;
swap)
  # Needs jb and lite run first: JB's current snapshot (the theme frame iOS rendered) goes over Lite's, by Lite.
  boot
  xcrun simctl ui "$dev" appearance light
  ldata=$(xcrun simctl get_app_container "$dev" $LITE data)
  jdata=$(xcrun simctl get_app_container "$dev" $JB data)
  src=${SWAP_SRC:-$(find "$jdata/Library/SplashBoard/Snapshots" -type f \( -name '*.ktx' -o -name '*.png' \) | head -1)}
  echo "source: $src" | tee -a out/swap.log
  rm -rf "$ldata/Documents/swap"
  (cd "$ldata/Library/SplashBoard/Snapshots" && find . -type f \( -name '*.ktx' -o -name '*.png' \)) | while read -r f; do
    mkdir -p "$ldata/Documents/swap/$(dirname "$f")"
    cp "$src" "$ldata/Documents/swap/$f"
  done
  xcrun simctl launch --console-pty "$dev" $LITE snap > out/swap-app.log 2>&1 &
  pid=$!
  sleep 9
  kill $pid 2>/dev/null
  xcrun simctl terminate "$dev" $LITE 2>/dev/null || true
  snaps $LITE swap-after-copy
  shot $LITE swap-1-relaunch; snaps $LITE swap-1-relaunch
  xcrun simctl shutdown "$dev"; boot
  shot $LITE swap-2-reboot; snaps $LITE swap-2-reboot
  ;;
jb2) # $2 resign|symlink, $3 a fresh id (a denylisted ID stays black). Ways around SplashBoard's seal check:
  # resign: the helper's copy, then the bundle signed again (ldid on a phone), with and without clearing.
  # symlink: the bundle's 13 launch files are sealed symlinks into a folder outside it; the switch rewrites that folder.
  boot
  xcrun simctl ui "$dev" appearance light
  mode=$2 id=$3 ext=$PWD/ext-$3
  rm -rf B.app && cp -R JB.app B.app
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $id" B.app/Info.plist
  set_theme() { # $1 theme, into $2 (a bundle or the outside folder)
    cp themes/$1/Launch*@?x.png "$2/"
    mkdir -p "$2/LaunchScreen.storyboardc"
    cp themes/$1/LaunchScreen.storyboardc/* "$2/LaunchScreen.storyboardc/"
  }
  codesign -s - -f B.app
  xcrun simctl uninstall "$dev" $id 2>/dev/null || true
  xcrun simctl install "$dev" B.app
  app=$(xcrun simctl get_app_container "$dev" $id app)
  data=$(xcrun simctl get_app_container "$dev" $id data)
  if [ "$mode" = symlink ]; then
    # installd refuses a bundle with a symlink out of it ("invalid symlink"), so make them in the installed copy
    # (as dpkg would leave them on a jailbreak) and seal them there.
    rm -rf "$ext" && mkdir -p "$ext"
    set_theme classic "$ext"
    for f in themes/classic/Launch*@?x.png; do f=${f##*/}; rm "$app/$f"; ln -s "$ext/$f" "$app/$f"; done
    n=Lvc-00-000-view-Lrt-00-000.nib
    rm "$app/LaunchScreen.storyboardc/$n"; ln -s "$ext/LaunchScreen.storyboardc/$n" "$app/LaunchScreen.storyboardc/$n"
    codesign -s - -f "$app"
  fi
  shot $id $mode-1-classic; snaps $id $mode-1-classic
  if [ "$mode" = resign ]; then
    set_theme gunmetal "$app"; codesign -s - -f "$app"
  else
    set_theme gunmetal "$ext"
  fi
  shot $id $mode-2-gunmetal-noclear; snaps $id $mode-2-gunmetal-noclear
  rm -rf "$data/Library/SplashBoard/Snapshots"
  shot $id $mode-3-gunmetal-cleared; snaps $id $mode-3-gunmetal-cleared
  if [ "$mode" = resign ]; then
    set_theme oled "$app"; codesign -s - -f "$app"
  else
    set_theme oled "$ext"
  fi
  rm -rf "$data/Library/SplashBoard/Snapshots"
  shot $id $mode-4-oled-cleared; snaps $id $mode-4-oled-cleared
  shot $id $mode-4-oled-cover cover oled
  xcrun simctl spawn "$dev" log show --last 3m --style compact --predicate 'subsystem CONTAINS[c] "SplashBoard"' \
    | grep -E "$id" | grep -E " E |denylist|validation" | cut -c1-400 > "out/log-$id.txt"
  ;;
jb3) # $2 the id jb2 resign left on OLED Black: what makes SpringBoard render the copied theme?
  id=$2
  boot
  xcrun simctl ui "$dev" appearance light
  data=$(xcrun simctl get_app_container "$dev" $id data)
  xcrun simctl shutdown "$dev"; boot
  shot $id r3-1-oled-reboot-noclear; snaps $id r3-1-oled-reboot-noclear
  rm -rf "$data/Library/SplashBoard/Snapshots"
  xcrun simctl shutdown "$dev"; boot
  shot $id r3-2-oled-cleared-reboot; snaps $id r3-2-oled-cleared-reboot
  # An app update (what uicache -p would announce on a jailbreak): install a Gunmetal copy over it, same id.
  rm -rf U.app && cp -R "$(xcrun simctl get_app_container "$dev" $id app)" U.app
  cp themes/gunmetal/Launch*@?x.png U.app/
  cp themes/gunmetal/LaunchScreen.storyboardc/* U.app/LaunchScreen.storyboardc/
  codesign -s - -f U.app
  xcrun simctl install "$dev" U.app
  shot $id r3-3-gunmetal-update; snaps $id r3-3-gunmetal-update
  ;;
jb4) # $2 the id jb3 left: an update with a new CFBundleVersion (Gunmetal -> Midnight), without then with clearing
  id=$2
  boot
  xcrun simctl ui "$dev" appearance light
  data=$(xcrun simctl get_app_container "$dev" $id data)
  rm -rf U.app && cp -R "$(xcrun simctl get_app_container "$dev" $id app)" U.app
  cp themes/midnight/Launch*@?x.png U.app/
  cp themes/midnight/LaunchScreen.storyboardc/* U.app/LaunchScreen.storyboardc/
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion 2" U.app/Info.plist
  codesign -s - -f U.app
  xcrun simctl install "$dev" U.app
  shot $id r4-1-midnight-v2; snaps $id r4-1-midnight-v2
  cp themes/sepia/Launch*@?x.png U.app/
  cp themes/sepia/LaunchScreen.storyboardc/* U.app/LaunchScreen.storyboardc/
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion 3" U.app/Info.plist
  codesign -s - -f U.app
  rm -rf "$data/Library/SplashBoard/Snapshots"
  xcrun simctl install "$dev" U.app
  shot $id r4-2-sepia-v3-cleared; snaps $id r4-2-sepia-v3-cleared
  ;;
atx) # the Lite app renders a theme's cover and writes it over its own snapshots (ImageIO, com.apple.atx);
  # Gunmetal then Classic, each checked in the same boot and Gunmetal again after a reboot
  boot
  xcrun simctl ui "$dev" appearance light
  for k in gunmetal classic; do
    xcrun simctl terminate "$dev" $LITE 2>/dev/null || true
    xcrun simctl launch --console-pty "$dev" $LITE cover $k atx > out/atx-$k.log 2>&1 &
    pid=$!
    sleep 16
    kill $pid 2>/dev/null
    xcrun simctl terminate "$dev" $LITE 2>/dev/null || true
    snaps $LITE atx-$k-written
    shot $LITE atx-$k-1-sameboot; snaps $LITE atx-$k-1-sameboot
    if [ $k = gunmetal ]; then
      xcrun simctl shutdown "$dev"; boot
      shot $LITE atx-$k-2-reboot; snaps $LITE atx-$k-2-reboot
    fi
  done
  ;;
log) # $2 id (default JB): SplashBoard's log around one cold launch
  boot
  id=${2:-$JB}
  xcrun simctl terminate "$dev" "$id" 2>/dev/null || true
  xcrun simctl launch "$dev" "$id" >/dev/null
  sleep 4
  xcrun simctl spawn "$dev" log show --last 15s --style compact \
    --predicate 'subsystem CONTAINS[c] "SplashBoard" OR process == "splashboardd" OR eventMessage CONTAINS[c] "launch image" OR eventMessage CONTAINS[c] "snapshot"' \
    | grep -v "^Timestamp" | tail -60 > "out/log-$id.txt"
  xcrun simctl terminate "$dev" "$id" 2>/dev/null || true
  ;;
*) echo "usage: r46.sh build|jb|jb2|jb3|jb4|lite|swap|atx|log"; exit 64 ;;
esac
echo done
