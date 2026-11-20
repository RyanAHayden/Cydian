"""F288: fixtures for core/tweaks.test.js, made with the standard library only: small .debs (data.tar.xz, .lzma, .gz,
and a .zst one that must be refused) holding tiny Mach-O dylibs, a zipped .framework and an app executable.

    python3 web/app/core/fixtures/tweaks/make.py          write them here
    python3 web/app/core/fixtures/tweaks/make.py --check  exit 1 when the committed files differ (test_fixtures.py)

Everything is deterministic (fixed mtimes, gzip mtime 0), so --check compares bytes."""
import gzip
import io
import lzma
import os
import struct
import sys
import tarfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))

LC_ID_DYLIB, LC_LOAD_DYLIB, LC_LOAD_WEAK_DYLIB, LC_REEXPORT_DYLIB, LC_RPATH = 0xD, 0xC, 0x80000018, 0x8000001F, 0x8000001C
MH_EXECUTE, MH_DYLIB = 2, 6


def dylib_cmd(cmd, name):
    s = name.encode() + b"\0"
    size = (24 + len(s) + 7) // 8 * 8
    return struct.pack("<IIIIII", cmd, size, 24, 2, 0x10000, 0x10000) + s.ljust(size - 24, b"\0")


def rpath_cmd(path):
    s = path.encode() + b"\0"
    size = (12 + len(s) + 7) // 8 * 8
    return struct.pack("<III", 0x8000001C, size, 12) + s.ljust(size - 12, b"\0")


def macho(filetype, cmds, text_off=0x4000, cpu=(0x0100000C, 0)):
    """A thin arm64 Mach-O: __TEXT with one __text section at `text_off`, then `cmds` (bytes each)."""
    sect = struct.pack("<16s16sQQIIIIIIII", b"__text", b"__TEXT", 0x100000000 + text_off, 16, text_off, 2, 0, 0,
                       0x80000400, 0, 0, 0)
    seg = struct.pack("<II16sQQQQiiII", 0x19, 72 + 80, b"__TEXT", 0x100000000, text_off + 0x4000, 0, text_off + 16,
                      5, 5, 1, 0) + sect
    body = seg + b"".join(cmds)
    head = struct.pack("<IiiIIIII", 0xFEEDFACF, cpu[0], cpu[1], filetype, 1 + len(cmds), len(body), 0x85, 0)
    out = head + body
    assert len(out) <= text_off
    return out.ljust(text_off, b"\0") + b"\x1f\x20\x03\xd5" * 4


def fat(*thins):
    """A fat file of thin slices at 16 KB boundaries."""
    off = 0x4000
    head = struct.pack(">II", 0xCAFEBABE, len(thins))
    body = b""
    for t in thins:
        cpu, sub = struct.unpack_from("<ii", t, 4)
        head += struct.pack(">iiIII", cpu, sub, off + len(body), len(t), 14)
        body += t.ljust((len(t) + 0x3FFF) // 0x4000 * 0x4000, b"\0")
    return head.ljust(off, b"\0") + body


def tar(files, mode="w"):
    b = io.BytesIO()
    with tarfile.open(fileobj=b, mode=mode, format=tarfile.GNU_FORMAT) as t:
        dirs = set()
        for path, data in files:
            parts = path.split("/")
            for i in range(1, len(parts)):
                d = "/".join(parts[:i])
                if d not in dirs:
                    dirs.add(d)
                    ti = tarfile.TarInfo(d)
                    ti.type, ti.mode, ti.mtime = tarfile.DIRTYPE, 0o755, 1794960000
                    t.addfile(ti)
            if isinstance(data, tuple):  # ("symlink", target)
                ti = tarfile.TarInfo(path)
                ti.type, ti.linkname, ti.mtime = tarfile.SYMTYPE, data[1], 1794960000
                t.addfile(ti)
                continue
            ti = tarfile.TarInfo(path)
            ti.size, ti.mode, ti.mtime = len(data), 0o755 if path.endswith(".dylib") else 0o644, 1794960000
            t.addfile(ti, io.BytesIO(data))
    return b.getvalue()


def compress(data, kind):
    if kind == "gz":
        return gzip.compress(data, mtime=0)
    if kind == "xz":
        return lzma.compress(data, format=lzma.FORMAT_XZ)
    if kind == "lzma":
        return lzma.compress(data, format=lzma.FORMAT_ALONE)
    if kind == "zst":
        return b"\x28\xb5\x2f\xfd" + data[:64]  # not real zstd: it must be refused before anything reads it
    return data


def ar(members):
    out = b"!<arch>\n"
    for name, data in members:
        out += f"{name:<16}{0:<12}{0:<6}{0:<6}{'100644':<8}{len(data):<10}`\n".encode() + data
        if len(data) % 2:
            out += b"\n"
    return out


def deb(control, files, kind):
    ctl = tar([("./control", control.encode())])
    return ar([("debian-binary", b"2.0\n"), ("control.tar.gz", compress(ctl, "gz")),
               (f"data.tar.{kind}", compress(tar(files), kind))])


SUBSTRATE_ROOTFUL = "/Library/Frameworks/CydiaSubstrate.framework/CydiaSubstrate"
LIBSYSTEM = "/usr/lib/libSystem.B.dylib"


def fixtures():
    tweak = macho(MH_DYLIB, [dylib_cmd(LC_ID_DYLIB, "/Library/MobileSubstrate/DynamicLibraries/Fixture.dylib"),
                             dylib_cmd(LC_LOAD_DYLIB, LIBSYSTEM), dylib_cmd(LC_LOAD_DYLIB, SUBSTRATE_ROOTFUL)])
    tweak_fat = fat(tweak, macho(MH_DYLIB, [dylib_cmd(LC_ID_DYLIB, "/Library/MobileSubstrate/DynamicLibraries/Fixture.dylib"),
                                            dylib_cmd(LC_LOAD_DYLIB, LIBSYSTEM), dylib_cmd(LC_LOAD_DYLIB, SUBSTRATE_ROOTFUL)],
                                     cpu=(0x0100000C, 2)))
    other = macho(MH_DYLIB, [dylib_cmd(LC_ID_DYLIB, "/Library/MobileSubstrate/DynamicLibraries/Other.dylib"),
                             dylib_cmd(LC_LOAD_DYLIB, "/usr/lib/libsubstrate.dylib"),
                             dylib_cmd(LC_LOAD_DYLIB, "/usr/lib/libFixtureKit.dylib")])
    kit = macho(MH_DYLIB, [dylib_cmd(LC_ID_DYLIB, "/usr/lib/libFixtureKit.dylib"), dylib_cmd(LC_LOAD_DYLIB, LIBSYSTEM)])
    ellekit = macho(MH_DYLIB, [dylib_cmd(LC_ID_DYLIB, "/var/jb/usr/lib/libellekit.dylib"), dylib_cmd(LC_LOAD_DYLIB, LIBSYSTEM)])
    substrate = macho(MH_DYLIB, [dylib_cmd(LC_ID_DYLIB, SUBSTRATE_ROOTFUL),
                                 dylib_cmd(LC_REEXPORT_DYLIB, "/var/jb/usr/lib/libellekit.dylib")])
    plain = macho(MH_DYLIB, [dylib_cmd(LC_ID_DYLIB, "@rpath/Plain.dylib"), dylib_cmd(LC_LOAD_DYLIB, LIBSYSTEM)])
    kitfw = macho(MH_DYLIB, [dylib_cmd(LC_ID_DYLIB, "@rpath/FixtureUI.framework/FixtureUI"), dylib_cmd(LC_LOAD_DYLIB, LIBSYSTEM)])
    app = macho(MH_EXECUTE, [dylib_cmd(LC_LOAD_DYLIB, LIBSYSTEM)])
    app_rpath = macho(MH_EXECUTE, [dylib_cmd(LC_LOAD_DYLIB, LIBSYSTEM), rpath_cmd("@executable_path/Frameworks")])
    app_full = macho(MH_EXECUTE, [dylib_cmd(LC_LOAD_DYLIB, LIBSYSTEM)], text_off=0x100)  # no room for more
    fw_zip = io.BytesIO()
    with zipfile.ZipFile(fw_zip, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in [("FixtureUI.framework/FixtureUI", kitfw), ("FixtureUI.framework/Info.plist", b"<plist/>"),
                           ("__MACOSX/FixtureUI.framework/._FixtureUI", b"junk")]:
            zi = zipfile.ZipInfo(name, date_time=(2026, 11, 20, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(zi, data)
    control = "Package: com.example.fixture\nName: Fixture Tweak\nVersion: 1.0\nArchitecture: iphoneos-arm64\n"
    return {
        "tweak-xz.deb": deb(control, [
            ("./var/jb/Library/MobileSubstrate/DynamicLibraries/Fixture.dylib", tweak_fat),
            ("./var/jb/Library/MobileSubstrate/DynamicLibraries/Fixture.plist", b"{ Filter = { Bundles = ( \"com.me.fixture\" ); }; }"),
            ("./var/jb/Library/Application Support/Fixture.bundle/Info.plist", b"<plist/>"),
            ("./var/jb/Library/PreferenceLoader/Preferences/Fixture.plist", b"<plist/>"),
        ], "xz"),
        "tweak-lzma.deb": deb(control.replace("fixture", "other").replace("Name: Fixture Tweak\n", ""), [
            ("./Library/MobileSubstrate/DynamicLibraries/Other.dylib", other),
            ("./usr/lib/libFixtureKit.dylib", kit),
        ], "lzma"),
        "ellekit.deb": deb("Package: ellekit\nName: ElleKit\nVersion: 1.0\n", [
            ("./var/jb/usr/lib/libellekit.dylib", ellekit),
            ("./var/jb/usr/lib/libsubstrate.dylib", ("symlink", "libellekit.dylib")),
            ("./var/jb/Library/Frameworks/CydiaSubstrate.framework/CydiaSubstrate", substrate),
            ("./var/jb/Library/Frameworks/CydiaSubstrate.framework/Info.plist", b"<plist/>"),
        ], "gz"),
        "tweak-zst.deb": deb(control, [("./Library/MobileSubstrate/DynamicLibraries/Z.dylib", plain)], "zst"),
        "Plain.dylib": plain,
        "FixtureUI.framework.zip": fw_zip.getvalue(),
        "app.macho": app,
        "app-rpath.macho": app_rpath,
        "app-full.macho": app_full,
    }


def main():
    check = "--check" in sys.argv
    bad = []
    for name, data in fixtures().items():
        path = os.path.join(HERE, name)
        if check:
            try:
                with open(path, "rb") as f:
                    if f.read() != data:
                        bad.append(name)
            except FileNotFoundError:
                bad.append(name)
        else:
            with open(path, "wb") as f:
                f.write(data)
    if bad:
        print("differ from make.py:", ", ".join(bad))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
