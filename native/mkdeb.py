#!/usr/bin/env python3
"""Write and check Cydian's rootless .deb with the stdlib only (no dpkg-deb on the build machine).

    mkdeb.py build <root> <debian-dir> <out.deb>   root holds ./var/jb/...; debian-dir holds control, postinst, prerm
    mkdeb.py check <file.deb>                      exit 1 and list every problem if the package is not right

A .deb is an ar archive of debian-binary ("2.0\\n"), control.tar.xz and data.tar.xz, in that order.
"""
import io
import os
import plistlib
import re
import struct
import sys
import tarfile

PREFIX = "./var/jb/"
APP = PREFIX + "Applications/Cydian.app/"
HELPER = PREFIX + "usr/libexec/cydian/cydian-helper"
# N5: the background upgrade check, a launchd daemon that posts "n upgrades" as the app (jailbreak only).
DAEMON = PREFIX + "usr/libexec/cydian/cydian-upgrades"
DAEMON_JOB = PREFIX + "Library/LaunchDaemons/com.ryha.cydian.upgrades.plist"
DAEMON_LABEL = "com.ryha.cydian.upgrades"
NOTIFY_ENTITLEMENT = "com.apple.private.usernotifications.bundle-identifiers"
SCRIPTS = ("postinst", "prerm", "postrm", "preinst")


# ---------- writing ----------

def _ar_member(name, data, mtime):
    head = b"%-16s%-12d%-6d%-6d%-8o%-10d`\n" % (name.encode(), mtime, 0, 0, 0o100644, len(data))
    assert len(head) == 60
    return head + data + (b"\n" if len(data) % 2 else b"")


def _tar(entries, mtime):
    """entries: list of (arcname, bytes or None for a directory, mode). Sorted, root-owned, fixed mtime."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:xz", format=tarfile.GNU_FORMAT) as t:
        for name, data, mode in entries:
            ti = tarfile.TarInfo(name)
            ti.mtime, ti.uid, ti.gid, ti.uname, ti.gname, ti.mode = mtime, 0, 0, "root", "root", mode
            if data is None:
                ti.type = tarfile.DIRTYPE
                t.addfile(ti)
            else:
                ti.size = len(data)
                t.addfile(ti, io.BytesIO(data))
    return buf.getvalue()


def _walk(root):
    out = [("./", None, 0o755)]
    size = 0
    for d, dirs, files in os.walk(root):
        dirs.sort()
        rel = os.path.relpath(d, root)
        for name in sorted(dirs):
            out.append(("./" + os.path.normpath(os.path.join(rel, name)) + "/", None, 0o755))
        for name in sorted(files):
            p = os.path.join(d, name)
            with open(p, "rb") as f:
                data = f.read()
            size += len(data)
            mode = 0o755 if os.stat(p).st_mode & 0o111 else 0o644
            out.append(("./" + os.path.normpath(os.path.join(rel, name)), data, mode))
    return out, size


def build(root, debian, out, mtime=None):
    mtime = int(os.environ.get("SOURCE_DATE_EPOCH", "0")) if mtime is None else mtime
    data_entries, size = _walk(root)
    ctl_entries = [("./", None, 0o755)]
    for name in sorted(os.listdir(debian)):
        with open(os.path.join(debian, name), "rb") as f:
            data = f.read()
        if name == "control":
            data = data.replace(b"@SIZE@", str((size + 1023) // 1024).encode())
        ctl_entries.append(("./" + name, data, 0o755 if name in SCRIPTS else 0o644))
    deb = b"!<arch>\n" + _ar_member("debian-binary", b"2.0\n", mtime)
    deb += _ar_member("control.tar.xz", _tar(ctl_entries, mtime), mtime)
    deb += _ar_member("data.tar.xz", _tar(data_entries, mtime), mtime)
    with open(out, "wb") as f:
        f.write(deb)


# ---------- reading and checking ----------

def read_ar(blob):
    if not blob.startswith(b"!<arch>\n"):
        raise ValueError("not an ar archive")
    i, members = 8, []
    while i < len(blob):
        head = blob[i:i + 60]
        if len(head) < 60 or head[58:60] != b"`\n":
            raise ValueError("bad ar header at %d" % i)
        name = head[:16].decode().strip().rstrip("/")
        size = int(head[48:58])
        members.append((name, blob[i + 60:i + 60 + size]))
        i += 60 + size + (size % 2)
    return members


def control_fields(text):
    fields = {}
    for line in text.splitlines():
        if line and not line[0].isspace() and ":" in line:
            k, v = line.split(":", 1)
            fields[k.strip()] = v.strip()
    return fields


# What the helper runs on the phone (F66): uikittools' uicache in postinst, unzip for every install-ipa (F59),
# ldid to sign ad hoc when AppSync Unified is missing (so recommended, not required).
WANT_RELATIONS = {"Depends": ("firmware", "uikittools", "unzip"), "Recommends": ("ldid",)}


def relation_names(value):
    """Package names in a Depends-style field: "a (>= 1), b | c" gives [a, b, c]."""
    names = []
    for group in value.split(","):
        for alt in group.split("|"):
            name = re.split(r"[\s(:\[]", alt.strip(), maxsplit=1)[0]
            if name:
                names.append(name)
    return names


def macho_info(data):
    """(cputype, cpusubtype, filetype, platform, minos 'x.y', has code signature) of a thin 64-bit Mach-O."""
    magic, cpu, sub, ftype, ncmds, _ = struct.unpack_from("<IiiIII", data, 0)
    if magic != 0xFEEDFACF:
        raise ValueError("not a thin 64-bit Mach-O (magic %#x)" % magic)
    off, platform, minos, signed = 32, None, None, False
    for _ in range(ncmds):
        cmd, size = struct.unpack_from("<II", data, off)
        if cmd == 0x32:  # LC_BUILD_VERSION
            platform, v = struct.unpack_from("<II", data, off + 8)
            minos = "%d.%d" % (v >> 16, (v >> 8) & 0xFF)
        elif cmd == 0x1D:  # LC_CODE_SIGNATURE
            signed = True
        off += size
    return cpu, sub & 0xFFFFFF, ftype, platform, minos, signed


def check(path):
    """Problems with the package at path (empty list = good), and a short summary."""
    problems = []
    with open(path, "rb") as f:
        members = read_ar(f.read())
    names = [n for n, _ in members]
    if names != ["debian-binary", "control.tar.xz", "data.tar.xz"]:
        return ["ar members are %s" % names], ""
    m = dict(members)
    if m["debian-binary"] != b"2.0\n":
        problems.append("debian-binary is %r" % m["debian-binary"])

    with tarfile.open(fileobj=io.BytesIO(m["control.tar.xz"])) as t:
        ctl = {os.path.normpath(i.name): (i, t.extractfile(i).read() if i.isfile() else None) for i in t}
    if "control" not in ctl:
        return problems + ["no control file"], ""
    fields = control_fields(ctl["control"][1].decode())
    for k in ("Package", "Version", "Architecture", "Maintainer", "Description", "Installed-Size"):
        if not fields.get(k):
            problems.append("control has no %s" % k)
    if fields.get("Architecture") != "iphoneos-arm64":
        problems.append("Architecture is %r, not iphoneos-arm64" % fields.get("Architecture"))
    if not re.fullmatch(r"[a-z0-9][a-z0-9.+-]+", fields.get("Package", "")):
        problems.append("bad Package name %r" % fields.get("Package"))
    if not re.fullmatch(r"\d+\.\d+\.\d+-\d+", fields.get("Version", "")):
        problems.append("Version %r is not <VERSION>-<build>" % fields.get("Version"))
    for k, want in WANT_RELATIONS.items():
        missing = sorted(set(want) - set(relation_names(fields.get(k, ""))))
        if missing:
            problems.append("control %s lacks %s" % (k, ", ".join(missing)))
    if "@" in ctl["control"][1].decode():
        problems.append("control has an unfilled @PLACEHOLDER@")
    post = ctl.get("postinst")
    if not post or not post[0].mode & 0o111 or b"uicache -p /var/jb/Applications/Cydian.app" not in post[1]:
        problems.append("postinst missing, not executable, or not running uicache -p on the app")

    job = "/" + DAEMON_JOB[len("./"):]
    if not post or b"launchctl load " + job.encode() not in post[1]:
        problems.append("postinst does not launchctl load %s" % job)
    pre = ctl.get("prerm")
    if not pre or not pre[0].mode & 0o111 or b"launchctl unload " + job.encode() not in pre[1]:
        problems.append("prerm missing, not executable, or not running launchctl unload on %s" % job)

    with tarfile.open(fileobj=io.BytesIO(m["data.tar.xz"])) as t:
        infos = t.getmembers()
        files = {i.name: (i, t.extractfile(i).read()) for i in infos if i.isfile()}
    allowed_dirs = {".", "./", "./var/", "./var/jb/", "./var", "./var/jb"}
    for i in infos:
        if not (i.name.startswith(PREFIX) or i.name in allowed_dirs):
            problems.append("not under /var/jb: %s" % i.name)
        if i.uid or i.gid:
            problems.append("not root-owned: %s" % i.name)
        if not (i.isfile() or i.isdir()):
            problems.append("not a plain file or directory: %s" % i.name)

    plist = files.get(APP + "Info.plist")
    if not plist:
        return problems + ["no Cydian.app/Info.plist"], ""
    info = plistlib.loads(plist[1])
    exe = APP + info.get("CFBundleExecutable", "?")
    want = {"CFBundleExecutable": "Cydian", "MinimumOSVersion": "15.0", "CADisableMinimumFrameDurationOnPhone": True,
            "CFBundleShortVersionString": fields.get("Version", "").split("-")[0],
            "CFBundleVersion": fields.get("Version", "-").split("-")[-1]}
    for k, v in want.items():
        if info.get(k) != v:
            problems.append("Info.plist %s is %r, want %r" % (k, info.get(k), v))
    if "UIApplicationSceneManifest" not in info:
        problems.append("Info.plist has no UIApplicationSceneManifest")
    for name in info.get("CFBundleIcons", {}).get("CFBundlePrimaryIcon", {}).get("CFBundleIconFiles", []) or ["?"]:
        for scale in ("@2x", "@3x"):
            png = files.get(APP + name + scale + ".png")
            if not png or not png[1].startswith(b"\x89PNG"):
                problems.append("icon %s%s.png missing" % (name, scale))

    summary = ""
    if exe not in files:
        problems.append("no executable %s" % exe)
    else:
        i, data = files[exe]
        if not i.mode & 0o111:
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
            summary = "arm64 iOS %s, %d KB executable" % (minos, len(data) // 1024)
        except (ValueError, struct.error) as e:
            problems.append("executable: %s" % e)

    # N3: the root helper the app spawns with the persona attributes: plain 0755, never setuid (docs/native.md "3. Root").
    if HELPER not in files:
        problems.append("no helper at %s" % HELPER[1:])
    else:
        i, data = files[HELPER]
        if i.mode & 0o7777 != 0o755:
            problems.append("helper mode is %o, want 755 (no setuid)" % (i.mode & 0o7777))
        try:
            cpu, sub, ftype, platform, minos, signed = macho_info(data)
            if (cpu, sub, ftype, platform) != (0x0100000C, 0, 2, 2) or not signed:
                problems.append("helper is not a signed arm64 iOS executable")
        except (ValueError, struct.error) as e:
            problems.append("helper: %s" % e)
    problems += _check_daemon(files)
    if APP + "bridge.js" not in files:
        problems.append("no Cydian.app/bridge.js (the script that sets up cydianNative)")

    web = {n[len(APP + "web/"):] for n in files if n.startswith(APP + "web/")}
    for need in ("index.html", "app.js", "style.css", "router.js"):
        if need not in web:
            problems.append("web/%s missing from the bundle" % need)
    tests = sorted(n for n in web if n.endswith(".test.js"))
    if tests:
        problems.append("tests shipped in the bundle: %s" % ", ".join(tests))
    summary = "%s %s (%s): %d web files, %s" % (fields.get("Package"), fields.get("Version"),
                                               fields.get("Architecture"), len(web), summary)
    return problems, summary


def _check_daemon(files):
    """T5: N5's daemon, signed with the notification entitlement, and its launchd job pointing at it."""
    from mkipa import macho_entitlements  # mkipa imports this module; import it here, not at the top
    problems = []
    if DAEMON not in files:
        problems.append("no upgrade daemon at %s" % DAEMON[1:])
    else:
        i, data = files[DAEMON]
        if i.mode & 0o7777 != 0o755:
            problems.append("daemon mode is %o, want 755" % (i.mode & 0o7777))
        try:
            cpu, sub, ftype, platform, minos, signed = macho_info(data)
            if (cpu, sub, ftype, platform) != (0x0100000C, 0, 2, 2) or not signed:
                problems.append("daemon is not a signed arm64 iOS executable")
            else:
                ids = (macho_entitlements(data) or {}).get(NOTIFY_ENTITLEMENT)
                if not isinstance(ids, list) or "com.ryha.cydian" not in ids:
                    problems.append("daemon has no %s entitlement for com.ryha.cydian (it can't post notifications)"
                                    % NOTIFY_ENTITLEMENT)
        except (ValueError, struct.error, plistlib.InvalidFileException) as e:
            problems.append("daemon: %s" % e)
    if DAEMON_JOB not in files:
        problems.append("no launchd job at %s" % DAEMON_JOB[1:])
    else:
        i, data = files[DAEMON_JOB]
        if i.mode & 0o7777 != 0o644:
            problems.append("launchd job mode is %o, want 644 (launchd skips writable jobs)" % (i.mode & 0o7777))
        try:
            job = plistlib.loads(data)
        except plistlib.InvalidFileException as e:
            job = {}
            problems.append("launchd job: %s" % e)
        if job.get("Label") != DAEMON_LABEL:
            problems.append("launchd job Label is %r, want %r" % (job.get("Label"), DAEMON_LABEL))
        if (job.get("ProgramArguments") or [None])[0] != DAEMON[1:]:
            problems.append("launchd job does not run %s" % DAEMON[1:])
    return problems


def main(argv):
    if len(argv) == 5 and argv[1] == "build":
        build(argv[2], argv[3], argv[4])
        return 0
    if len(argv) == 3 and argv[1] == "check":
        problems, summary = check(argv[2])
        for p in problems:
            print("deb: " + p, file=sys.stderr)
        if not problems:
            print(summary)
        return 1 if problems else 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
