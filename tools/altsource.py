#!/usr/bin/env python3
"""Cydian's own AltStore source (I7): web/app/source.json, the package page Cydian's default sources show for the
app itself (core/sources.js DEFAULT_ALT_SOURCES, core/appoffer.js APP_SOURCE_URL).

  tools/altsource.py update VERSION IPA [DATE]   point the source at release vVERSION's Cydian.ipa (its size from IPA)
  tools/altsource.py check                       the source is well formed and names a release tag of its own version

tools/release.sh runs `update` when it publishes a release, so the source keeps naming the newest IPA.
"""
import json
import os
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "web", "app", "source.json")
REPO = "https://github.com/RyanAHayden/Cydian"
RAW = "https://raw.githubusercontent.com/RyanAHayden/Cydian/main"
BUNDLE_ID = "com.ryha.cydian"
MIN_OS = "15.0"  # native/mkipa.py's MinimumOSVersion


def ipa_url(version):
    return f"{REPO}/releases/download/v{version}/Cydian.ipa"


def build(version, size, date):
    return {
        "name": "Cydian",
        "identifier": BUNDLE_ID,
        "subtitle": "A package manager with the iOS 6 look",
        "description": "Cydian's own source: the Cydian app for iPhones without a jailbreak.",
        "iconURL": f"{RAW}/web/app/icons/icon-180.png",
        "website": REPO,
        "tintColor": "#37a94a",
        "apps": [{
            "name": "Cydian",
            "bundleIdentifier": BUNDLE_ID,
            "developerName": "Ryan Hayden",
            "subtitle": "Packages and apps with the iOS 6 look",
            "localizedDescription": (
                "Cydian lists apps from AltStore-style sources and, on a jailbroken iPhone, tweaks and themes from "
                "APT repos, with the iOS 6 look. The app signs apps on your iPhone with your own certificate (no "
                "server) and scrolls at 120Hz. Free and open source (GPL-3.0-or-later)."),
            "iconURL": f"{RAW}/web/app/icons/icon-180.png",
            "tintColor": "#37a94a",
            "category": "utilities",
            "versions": [{
                "version": version,
                "date": date,
                "localizedDescription": f"Cydian {version}. Release notes: {REPO}/releases/tag/v{version}",
                "downloadURL": ipa_url(version),
                "size": size,
                "minOSVersion": MIN_OS,
            }],
        }],
        "news": [],
    }


def check(data):
    """Problems with a loaded source, as a list of strings (empty when it's fine)."""
    problems = []
    apps = data.get("apps") if isinstance(data, dict) else None
    if not isinstance(apps, list) or len(apps) != 1:
        return ["one app expected"]
    app = apps[0]
    if app.get("bundleIdentifier") != BUNDLE_ID:
        problems.append(f"bundleIdentifier is not {BUNDLE_ID}")
    versions = app.get("versions") or []
    if not versions:
        return problems + ["no versions"]
    v = versions[0]
    if v.get("downloadURL") != ipa_url(v.get("version")):
        problems.append(f"downloadURL is not release v{v.get('version')}'s Cydian.ipa")
    if not isinstance(v.get("size"), int) or v["size"] <= 0:
        problems.append("size is not a positive number of bytes")
    if v.get("minOSVersion") != MIN_OS:
        problems.append(f"minOSVersion is not {MIN_OS}")
    return problems


def write(data, path=SOURCE):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def main(argv):
    if len(argv) >= 3 and argv[0] == "update":
        version, ipa = argv[1], argv[2]
        date = argv[3] if len(argv) > 3 else datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        write(build(version, os.path.getsize(ipa), date))
        print(f"{SOURCE}: v{version}")
        return 0
    if argv == ["check"]:
        with open(SOURCE) as f:
            problems = check(json.load(f))
        for p in problems:
            print(p, file=sys.stderr)
        return 1 if problems else 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
