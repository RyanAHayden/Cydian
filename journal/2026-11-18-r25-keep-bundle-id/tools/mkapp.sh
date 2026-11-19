#!/bin/sh
# Runs on the iPhone 7 (R25): make a fakesigned test app from the Tiny binary (copied to /tmp/r25-Tiny).
#   sh mkapp.sh DIR INFO_ID APP_ID [CD_IDENT] [VERSION]
# INFO_ID goes in Info.plist's CFBundleIdentifier, APP_ID in the application-identifier entitlement (and the
# keychain group), CD_IDENT is the code signature's identifier (default: INFO_ID, as zsign does).
set -eu
dir=$1; info=$2; appid=$3; cd_ident=${4:-$2}; ver=${5:-1}
team=S8NFX3A2LT
rm -rf "$dir"
mkdir -p "$dir/Tiny.app"
cp /tmp/r25-Tiny "$dir/Tiny.app/Tiny"
cat >"$dir/Tiny.app/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleDisplayName</key><string>R25 $info</string>
<key>CFBundleExecutable</key><string>Tiny</string>
<key>CFBundleIdentifier</key><string>$info</string>
<key>CFBundleName</key><string>Tiny</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>$ver</string>
<key>CFBundleVersion</key><string>$ver</string>
<key>MinimumOSVersion</key><string>14.0</string>
</dict></plist>
EOF
cat >"$dir/ent.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>application-identifier</key><string>$team.$appid</string>
<key>com.apple.developer.team-identifier</key><string>$team</string>
<key>keychain-access-groups</key><array><string>$team.$appid</string></array>
<key>get-task-allow</key><false/>
</dict></plist>
EOF
ldid -S"$dir/ent.plist" -I"$cd_ident" "$dir/Tiny.app/Tiny"
echo "made $dir: Info.plist $info, application-identifier $team.$appid, code identifier $cd_ident"
