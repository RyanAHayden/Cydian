#!/usr/bin/env python3
"""Write and check Cydian's sideload IPA (task I2) with the stdlib only.

    mkipa.py plist <Info.plist> <overlay.plist> <out>   Info.plist with the overlay's keys added (Info-sideload.plist)
    mkipa.py build <Cydian.app> <out.ipa>               zip the app as Payload/Cydian.app, reproducibly
    mkipa.py check <file.ipa>                           exit 1 and list every problem if the IPA is not right

The IPA is the same Swift shell as the .deb, without the root helper and with sideload entitlements. It is ad hoc
signed (or unsigned past lld's ad hoc signature): the user signs it with their own tool (Feather, AltStore,
SideStore, TrollStore), as with Feather's own IPA (docs/sideload.md, "What I2 needs").
"""
import os
import plistlib
import struct
import sys
import time
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mkdeb import macho_info  # noqa: E402
import launch_check  # noqa: E402

APP = "Payload/Cydian.app/"
# Entitlements only a jailbreak (or TrollStore) build may carry; a sideload signer would refuse or strip them.
PRIVATE = ("platform-application", "com.apple.private.")


# ---------- writing ----------

def merge_plist(base, overlay, out):
    with open(base, "rb") as f:
        info = plistlib.load(f)
    with open(overlay, "rb") as f:
        info.update(plistlib.load(f))
    with open(out, "wb") as f:
        plistlib.dump(info, f, sort_keys=True)


def build(app, out, mtime=None):
    """Zip app (a Cydian.app directory) as Payload/Cydian.app/, sorted and with one timestamp: same input, same bytes."""
    if mtime is None:
        mtime = int(os.environ.get("SOURCE_DATE_EPOCH", "0"))
    stamp = time.gmtime(max(mtime, 315532800))[:6]  # zip can't go before 1980
    entries = []
    for dirpath, dirnames, filenames in os.walk(app):
        dirnames.sort()
        rel = os.path.relpath(dirpath, app)
        base = APP if rel == "." else APP + rel.replace(os.sep, "/") + "/"
        entries.append((base, None, 0o755))
        for name in sorted(filenames):
            p = os.path.join(dirpath, name)
            entries.append((base + name, p, 0o755 if os.stat(p).st_mode & 0o111 else 0o644))
    tmp = out + ".tmp"
    with zipfile.ZipFile(tmp, "w") as z:
        z.writestr(_info("Payload/", stamp, 0o755, True), b"")
        for name, path, mode in sorted(entries):
            if path is None:
                z.writestr(_info(name, stamp, mode, True), b"")
            else:
                with open(path, "rb") as f:
                    z.writestr(_info(name, stamp, mode, False), f.read(), zipfile.ZIP_DEFLATED)
    os.replace(tmp, out)


def _info(name, stamp, mode, is_dir):
    i = zipfile.ZipInfo(name, stamp)
    i.create_system = 3  # Unix, so the mode bits below count (the executable must stay executable)
    i.external_attr = ((0o040000 if is_dir else 0o100000) | mode) << 16 | (0x10 if is_dir else 0)
    return i


# ---------- checking ----------

def macho_entitlements(data):
    """The entitlements dict embedded in a thin 64-bit Mach-O's code signature, or None when it has none."""
    _, _, _, ncmds, _ = struct.unpack_from("<iiIII", data, 4)
    off = 32
    for _ in range(ncmds):
        cmd, size = struct.unpack_from("<II", data, off)
        if cmd == 0x1D:  # LC_CODE_SIGNATURE: the SuperBlob, big-endian
            dataoff, datasize = struct.unpack_from("<II", data, off + 8)
            if not datasize:
                return None
            magic, _, count = struct.unpack_from(">III", data, dataoff)
            if magic != 0xFADE0CC0:
                raise ValueError("code signature magic %#x" % magic)
            for k in range(count):
                slot, boff = struct.unpack_from(">II", data, dataoff + 12 + 8 * k)
                if slot == 5:  # CSSLOT_ENTITLEMENTS
                    bmagic, blen = struct.unpack_from(">II", data, dataoff + boff)
                    if bmagic != 0xFADE7171:
                        raise ValueError("entitlements blob magic %#x" % bmagic)
                    return plistlib.loads(data[dataoff + boff + 8:dataoff + boff + blen])
            return None
        off += size
    return None


def check(path):
    """Problems with the IPA at path (empty list = good), and a short summary."""
    problems = []
    with zipfile.ZipFile(path) as z:
        infos = z.infolist()
        files = {i.filename: (i, z.read(i)) for i in infos if not i.is_dir()}
    for i in infos:
        if not i.filename.startswith("Payload/") or ".." in i.filename.split("/"):
            problems.append("not under Payload/: %s" % i.filename)
    apps = {n.split("/")[1] for n in files if n.startswith("Payload/") and n.count("/") >= 2}
    if apps != {"Cydian.app"}:
        problems.append("Payload holds %s, want just Cydian.app" % sorted(apps))

    plist = files.get(APP + "Info.plist")
    if not plist:
        return problems + ["no Cydian.app/Info.plist"], ""
    info = plistlib.loads(plist[1])
    want = {"CFBundleExecutable": "Cydian", "MinimumOSVersion": "15.0", "CADisableMinimumFrameDurationOnPhone": True}
    for k, v in want.items():
        if info.get(k) != v:
            problems.append("Info.plist %s is %r, want %r" % (k, info.get(k), v))
    for k in ("CFBundleIdentifier", "CFBundleShortVersionString", "CFBundleVersion", "UIApplicationSceneManifest"):
        if not info.get(k):
            problems.append("Info.plist has no %s" % k)
    if any("@" in str(info.get(k, "")) for k in ("CFBundleShortVersionString", "CFBundleVersion", "MinimumOSVersion")):
        problems.append("Info.plist has an unfilled @PLACEHOLDER@")
    if "audio" not in info.get("UIBackgroundModes", []):
        problems.append("Info.plist UIBackgroundModes has no audio")
    schemes = [s for t in info.get("CFBundleURLTypes", []) for s in t.get("CFBundleURLSchemes", [])]
    if "cydian" not in schemes:
        problems.append("Info.plist has no cydian:// URL scheme")
    types = [u for d in info.get("CFBundleDocumentTypes", []) for u in d.get("LSItemContentTypes", [])]
    if "com.apple.itunes.ipa" not in types:
        problems.append("Info.plist does not open .ipa files")
    for name in info.get("CFBundleIcons", {}).get("CFBundlePrimaryIcon", {}).get("CFBundleIconFiles", []) or ["?"]:
        for scale in ("@2x", "@3x"):
            png = files.get(APP + name + scale + ".png")
            if not png or not png[1].startswith(b"\x89PNG"):
                problems.append("icon %s%s.png missing" % (name, scale))
    # N10: the launch screen's keys and images (launch_check.py).
    problems += launch_check.problems(info, {n: d for n, (_, d) in files.items()}, APP)

    # The root helper and N5's upgrade daemon and its launchd job are the .deb's alone (T5).
    jailbreak_only = ("cydian-helper", "cydian-upgrades", "com.ryha.cydian.upgrades.plist")
    helpers = sorted(n for n in files if n.rsplit("/", 1)[-1] in jailbreak_only or "/var/jb/" in n
                     or "/LaunchDaemons/" in n)
    if helpers:
        problems.append("jailbreak files in the IPA: %s" % ", ".join(helpers))

    summary = ""
    exe = APP + info.get("CFBundleExecutable", "?")
    if exe not in files:
        problems.append("no executable %s" % exe)
    else:
        i, data = files[exe]
        if not (i.external_attr >> 16) & 0o111:
            problems.append("executable is not executable")
        try:
            cpu, sub, ftype, platform, minos, signed = macho_info(data)
            if (cpu, sub) != (0x0100000C, 0):
                problems.append("executable is cpu %#x/%d, not arm64" % (cpu, sub))
            if ftype != 2:
                problems.append("executable filetype %d is not MH_EXECUTE" % ftype)
            if platform != 2 or minos != "15.0":
                problems.append("executable platform %s minos %s, want iOS (2) 15.0" % (platform, minos))
            if not signed:
                problems.append("executable has no code signature")
            ents = macho_entitlements(data) or {}
            bad = sorted(k for k in ents if k.startswith(PRIVATE))
            if bad:
                problems.append("jailbreak entitlements in the IPA: %s" % ", ".join(bad))
            summary = "arm64 iOS %s, %d KB executable, entitlements %s" % (
                minos, len(data) // 1024, ", ".join(sorted(ents)) or "none")
        except (ValueError, struct.error, plistlib.InvalidFileException) as e:
            problems.append("executable: %s" % e)

    problems += intents_problems(files)

    if APP + "bridge.js" not in files:
        problems.append("bridge.js missing (cydianNative and the mode come from it)")
    web = {n[len(APP + "web/"):] for n in files if n.startswith(APP + "web/")}
    for need in ("index.html", "app.js", "style.css", "router.js"):
        if need not in web:
            problems.append("web/%s missing from the bundle" % need)
    tests = sorted(n for n in web if n.endswith(".test.js"))
    if tests:
        problems.append("tests shipped in the bundle: %s" % ", ".join(tests))
    summary = "%s %s (%s): %d web files, %s" % (info.get("CFBundleIdentifier"), info.get("CFBundleShortVersionString"),
                                               info.get("CFBundleVersion"), len(web), summary)
    return problems, summary


# N8: the IPA carries the intents that work without a jailbreak (native/build.sh SIDELOAD_INTENTS), and a widget
# extension without controls (no intents of its own) and without jailbreak entitlements.
SIDELOAD_INTENTS = {"CheckForUpdatesIntent", "AddSourceIntent", "RestorePackagesIntent"}
WIDGET = APP + "PlugIns/CydianWidget.appex/"


def intents_problems(files):
    import json
    problems = []
    meta = files.get(APP + "Metadata.appintents/extract.actionsdata")
    if not meta:
        return ["no Metadata.appintents/extract.actionsdata (App Intents, N8)"]
    try:
        actions = set(json.loads(meta[1]).get("actions", {}))
    except ValueError as e:
        return ["Metadata.appintents: %s" % e]
    if actions != SIDELOAD_INTENTS:
        problems.append("App Intents %s, want the both-modes %s" % (sorted(actions), sorted(SIDELOAD_INTENTS)))
    if WIDGET + "Metadata.appintents/extract.actionsdata" in files:
        problems.append("the widget extension carries intents (the controls are the .deb's)")
    exe = files.get(WIDGET + "CydianWidget")
    if not exe or WIDGET + "Info.plist" not in files:
        problems.append("no widget extension (PlugIns/CydianWidget.appex)")
    else:
        ents = macho_entitlements(exe[1]) or {}
        bad = sorted(k for k in ents if k.startswith(PRIVATE))
        if bad:
            problems.append("jailbreak entitlements in the widget extension: %s" % ", ".join(bad))
    return problems


def main(argv):
    if len(argv) == 5 and argv[1] == "plist":
        merge_plist(argv[2], argv[3], argv[4])
        return 0
    if len(argv) == 4 and argv[1] == "build":
        build(argv[2], argv[3])
        return 0
    if len(argv) == 3 and argv[1] == "check":
        problems, summary = check(argv[2])
        for p in problems:
            print("ipa: " + p, file=sys.stderr)
        if not problems:
            print(summary)
        return 1 if problems else 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
