#!/usr/bin/env python3
# B263 test apps: the fixture's Tiny binary under new bundle IDs, one padded to ~300 MB; plus an AltStore source.json.
import json, os, sys, zipfile

fixture, out, base = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
with zipfile.ZipFile(fixture) as z:
    tiny = z.read("Payload/Tiny.app/Tiny")

PLIST = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>{bid}</string>
<key>CFBundleName</key><string>{name}</string>
<key>CFBundleDisplayName</key><string>{name}</string>
<key>CFBundleExecutable</key><string>Tiny</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>{ver}</string>
<key>CFBundleVersion</key><string>{ver}</string>
<key>MinimumOSVersion</key><string>15.0</string>
<key>CFBundleSupportedPlatforms</key><array><string>iPhoneOS</string></array>
<key>UIDeviceFamily</key><array><integer>1</integer></array>
</dict></plist>
"""

apps = [("b263big", "B263 Big", 300), ("b263a", "B263 A", 0), ("b263b", "B263 B", 0)]
ver = "1.0"
entries = []
for slug, name, pad_mb in apps:
    bid = f"com.ryha.{slug}"
    path = os.path.join(out, f"{slug}.ipa")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as z:
        z.writestr(f"Payload/{slug}.app/Info.plist", PLIST.format(bid=bid, name=name, ver=ver))
        zi = zipfile.ZipInfo(f"Payload/{slug}.app/Tiny"); zi.external_attr = 0o755 << 16
        z.writestr(zi, tiny)
        if pad_mb:
            with z.open(f"Payload/{slug}.app/padding.bin", "w", force_zip64=True) as f:
                for _ in range(pad_mb):
                    f.write(os.urandom(1 << 20))
    size = os.path.getsize(path)
    entries.append({"name": name, "bundleIdentifier": bid, "developerName": "B263 test",
                    "localizedDescription": "B263 re-sign queue test app; never launched.",
                    "iconURL": "", "versions": [{"version": ver, "date": "2026-11-21",
                    "downloadURL": f"{base}/{slug}.ipa", "size": size, "minOSVersion": "15.0"}]})
    print(path, size)
with open(os.path.join(out, "source.json"), "w") as f:
    json.dump({"name": "B263 Test", "identifier": "com.ryha.b263test", "apps": entries, "news": []}, f, indent=1)
