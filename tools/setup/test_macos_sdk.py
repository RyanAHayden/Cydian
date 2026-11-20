"""tools/setup/macos-sdk.sh on small fixture archives built here byte by byte (no Apple file needed): a Command Line
Tools .pkg (xar of component packages, each with a PackageInfo and a pbzx or gzip cpio Payload) and an Xcode .xip
(xar with one pbzx Content), the subset it keeps, the newest-SDK choice and the path guards."""
import gzip
import io
import json
import lzma
import os
import shutil
import struct
import subprocess
import tempfile
import unittest
import zipfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "macos-sdk.sh")


def cpio(entries, fmt="odc"):
    """entries: (path, kind, data) with kind 'd', 'f' or 'l'."""
    out = io.BytesIO()
    modes = {"d": 0o040755, "f": 0o100644, "l": 0o120755}
    for i, (path, kind, data) in enumerate(entries + [("TRAILER!!!", "t", b"")]):
        name = path.encode() + b"\0"
        mode = modes.get(kind, 0)
        if fmt == "odc":
            out.write(b"070707" + b"%06o%06o%06o%06o%06o%06o%06o%011o%06o%011o" % (
                0, i, mode, 0, 0, 1, 0, 0, len(name), len(data)))
            out.write(name + data)
        else:
            out.write(b"070701" + b"%08x" * 13 % (i, mode, 0, 0, 1, 0, len(data), 0, 0, 0, 0, len(name), 0))
            out.write(name + b"\0" * ((-(110 + len(name))) % 4) + data + b"\0" * ((-len(data)) % 4))
    return out.getvalue()


def pbzx(raw, chunk=4096):
    """First chunk stored (length == chunk size, as Apple does for incompressible data), the rest xz."""
    out = io.BytesIO()
    out.write(b"pbzx" + struct.pack(">Q", chunk))
    for n, off in enumerate(range(0, len(raw), chunk)):
        piece = raw[off:off + chunk]
        data = piece if n == 0 and len(piece) == chunk else lzma.compress(piece, format=lzma.FORMAT_XZ)
        out.write(struct.pack(">QQ", 1 << 24, len(data)) + data)
    return out.getvalue()


def xar(tree):
    """tree: name -> bytes (a stored member), ("zlib", bytes) (a member xar compressed) or dict (a directory)."""
    heap = bytearray()
    ids = iter(range(1, 10000))

    def files(node):
        xml = ""
        for name, v in node.items():
            i = next(ids)
            if isinstance(v, dict):
                xml += '<file id="%d"><name>%s</name><type>directory</type>%s</file>' % (i, name, files(v))
                continue
            style, data, size = "application/octet-stream", v, len(v) if isinstance(v, bytes) else 0
            if isinstance(v, tuple):
                style, data, size = "application/x-gzip", zlib.compress(v[1]), len(v[1])
            xml += ('<file id="%d"><name>%s</name><type>file</type><data><offset>%d</offset><length>%d</length>'
                    '<size>%d</size><encoding style="%s"/></data></file>'
                    % (i, name, len(heap), len(data), size, style))
            heap.extend(data)
        return xml

    toc = ('<?xml version="1.0" encoding="UTF-8"?><xar><toc>%s</toc></xar>' % files(tree)).encode()
    ztoc = zlib.compress(toc)
    return b"xar!" + struct.pack(">HHQQI", 28, 1, len(ztoc), len(toc), 0) + ztoc + bytes(heap)


BIG = bytes(range(256)) * 40  # > one pbzx chunk, so stored and xz chunks both occur
TBD = b"--- !tapi-tbd\ntargets: [ x86_64-macos, arm64-macos ]\n"
FW = "System/Library/Frameworks/"


def sdk_entries(prefix, sdk, version):
    """The entries of one SDK folder `sdk` under `prefix` (a path ending in SDKs/, or "")."""
    p = prefix + sdk
    return [
        (p, "d", b""),
        (p + "/SDKSettings.json", "f", json.dumps({"Version": version}).encode()),
        (p + "/usr", "d", b""),
        (p + "/usr/lib", "d", b""),
        (p + "/usr/lib/libSystem.tbd", "f", TBD + version.encode()),
        (p + "/usr/lib/libSystem.B.tbd", "l", b"libSystem.tbd"),
        (p + "/usr/lib/blob.a", "f", BIG),
        (p + "/usr/include/stdio.h", "f", b"int printf();"),
        (p + "/usr/share/man/x.1", "f", b"man"),
        (p + "/" + FW + "CoreFoundation.framework/CoreFoundation.tbd", "f", TBD),
        (p + "/" + FW + "CoreServices.framework/Frameworks/CarbonCore.framework/CarbonCore.tbd", "f", TBD),
        (p + "/" + FW + "IOKit.framework/Versions/A/IOKit.tbd", "f", TBD),
        (p + "/" + FW + "IOKit.framework/IOKit.tbd", "l", b"Versions/A/IOKit.tbd"),
        (p + "/" + FW + "AppKit.framework/AppKit.tbd", "f", TBD),
        (p + "/" + FW + "SecurityFoundation.framework/X.tbd", "f", TBD),
    ]


PKG_INFO = b'<pkg-info format-version="2" identifier="com.apple.pkg.%s" install-location="%s"/>'


def clt_pkg(extra=(), gz=False, loc="/Library/Developer/CommandLineTools"):
    """A CLT-like product archive: two macOS SDK packages (15.5 newest), a tools package and a distribution file."""
    rel = "" if loc.endswith(".sdk") else "SDKs/"

    def payload(entries):
        raw = cpio([("." if not e[0] else "./" + e[0], e[1], e[2]) for e in entries])
        return gzip.compress(raw) if gz else pbzx(raw)

    new = ([("SDKs", "d", b"")] if rel else []) + sdk_entries(rel, "MacOSX15.5.sdk", "15.5") + (
        [("SDKs/MacOSX15.sdk", "l", b"MacOSX15.5.sdk"), ("SDKs/MacOSX.sdk", "l", b"MacOSX15.sdk")] if rel else [])
    if not rel:  # payload relative to the SDK folder itself
        new = [(e[0][len("MacOSX15.5.sdk/"):], e[1], e[2]) for e in new if e[0] != "MacOSX15.5.sdk"]
    old = sdk_entries("SDKs/", "MacOSX14.5.sdk", "14.5") + list(extra)
    return xar({
        "Distribution": b"<installer-gui-script/>",
        "CLTools_Executables.pkg": {
            "PackageInfo": ("zlib", PKG_INFO % (b"CLTools_Executables", loc.encode())),
            "Payload": pbzx(cpio([("./usr/bin/clang", "f", b"\xcf\xfa\xed\xfe")])),
        },
        "CLTools_macOSNMOS_SDK.pkg": {
            "PackageInfo": ("zlib", PKG_INFO % (b"CLTools_macOSNMOS_SDK", loc.encode())),
            "Bom": b"BOMStore",
            "Payload": payload(new),
        },
        "CLTools_macOSLMOS_SDK.pkg": {
            "PackageInfo": ("zlib", PKG_INFO % (b"CLTools_macOSLMOS_SDK", b"/Library/Developer/CommandLineTools")),
            "Payload": payload(old),
        },
    })


def xcode_xip():
    """Xcode keeps the real folder as MacOSX.sdk, with MacOSX15.5.sdk a symlink to it, beside iPhoneOS.sdk."""
    mac = "Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/"
    ios = "Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/"
    entries = ([("Xcode.app", "d", b"")] + sdk_entries(mac, "MacOSX.sdk", "15.5")
               + [(mac + "MacOSX15.5.sdk", "l", b"MacOSX.sdk")] + sdk_entries(ios, "iPhoneOS.sdk", "18.5"))
    return xar({"Metadata": b"<meta/>", "Content": pbzx(cpio(entries, fmt="newc"))})


def run(*args, env=None):
    return subprocess.run(["bash", SCRIPT, *args], capture_output=True, text=True, env=env, timeout=60)


class MacosSdk(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        self.addCleanup(self.tmp.cleanup)

    def write(self, data, name="Command Line Tools.pkg"):
        p = os.path.join(self.dir, name)
        with open(p, "wb") as f:
            f.write(data)
        return p

    def read(self, *parts):
        with open(os.path.join(*parts), "rb") as f:
            return f.read()

    def assert_subset(self, dest, version):
        self.assertTrue(os.path.isdir(dest) and not os.path.islink(dest))
        self.assertEqual(self.read(dest, "usr/lib/libSystem.tbd"), TBD + version.encode())
        self.assertEqual(os.readlink(os.path.join(dest, "usr/lib/libSystem.B.tbd")), "libSystem.tbd")
        self.assertEqual(self.read(dest, "usr/lib/blob.a"), BIG)
        self.assertEqual(self.read(dest, "usr/include/stdio.h"), b"int printf();")
        self.assertTrue(os.path.isfile(os.path.join(dest, FW, "CoreServices.framework/Frameworks/CarbonCore.framework/CarbonCore.tbd")))
        self.assertEqual(self.read(dest, FW, "IOKit.framework/IOKit.tbd"), TBD)
        self.assertEqual(sorted(os.listdir(os.path.join(dest, FW))),
                         ["CoreFoundation.framework", "CoreServices.framework", "IOKit.framework"])
        self.assertFalse(os.path.exists(os.path.join(dest, "usr/share")))
        # nothing else, and no work folder, left beside it
        self.assertEqual(os.listdir(os.path.dirname(dest)), [os.path.basename(dest)])

    def test_clt_pkg_newest_sdk_subset(self):
        dest = os.path.join(self.dir, "out", "MacOSX.sdk")
        r = run(self.write(clt_pkg()), dest)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("export MACOS_SDK=" + dest, r.stdout)
        self.assertIn("macOS 15.5", r.stdout)
        self.assert_subset(dest, "15.5")
        self.assertFalse(os.path.exists(os.path.join(dest, "usr/bin")))

    def test_gzip_payload(self):
        dest = os.path.join(self.dir, "out", "sdk")
        r = run(self.write(clt_pkg(gz=True)), dest)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assert_subset(dest, "15.5")

    def test_payload_relative_to_sdk_folder(self):
        dest = os.path.join(self.dir, "out", "sdk")
        r = run(self.write(clt_pkg(loc="/Library/Developer/CommandLineTools/SDKs/MacOSX15.5.sdk")), dest)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assert_subset(dest, "15.5")

    def test_full_keeps_everything(self):
        dest = os.path.join(self.dir, "out", "sdk")
        r = run("--full", self.write(clt_pkg()), dest)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.read(dest, "usr/share/man/x.1"), b"man")
        self.assertTrue(os.path.isfile(os.path.join(dest, FW, "AppKit.framework/AppKit.tbd")))

    def test_xcode_xip(self):
        dest = os.path.join(self.dir, "out", "MacOSX.sdk")
        r = run(self.write(xcode_xip(), "Xcode_16.4.xip"), dest)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("macOS 15.5", r.stdout)
        self.assert_subset(dest, "15.5")

    def test_default_dest_is_ours(self):
        env = dict(os.environ, XDG_DATA_HOME=os.path.join(self.dir, "xdg"))
        r = run(self.write(clt_pkg()), env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isdir(os.path.join(self.dir, "xdg", "ifizbox", "MacOSX.sdk", "usr", "lib")))

    def test_refuses_existing_dest(self):
        dest = os.path.join(self.dir, "sdk")
        os.mkdir(dest)
        r = run(self.write(clt_pkg()), dest)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("exists", r.stderr)

    def test_rejects_path_traversal(self):
        r = run(self.write(clt_pkg([("SDKs/MacOSX14.5.sdk/usr/lib/../../../../../../evil", "f", b"x")])),
                os.path.join(self.dir, "out", "sdk"))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("unsafe path", r.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.dir, "evil")))
        self.assertEqual(os.listdir(os.path.join(self.dir, "out")), [])

    def test_rejects_write_through_symlink(self):
        r = run(self.write(clt_pkg([("SDKs/MacOSX14.5.sdk/usr/lib/esc", "l", self.dir.encode()),
                                    ("SDKs/MacOSX14.5.sdk/usr/lib/esc/planted", "f", b"x")])),
                os.path.join(self.dir, "out", "sdk"))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("symlink", r.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.dir, "planted")))

    def test_not_an_archive(self):
        r = run(self.write(b"PK\3\4 not xar", "x.pkg"), os.path.join(self.dir, "sdk"))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("not a xar", r.stderr)

    def test_pkg_without_macos_sdk(self):
        data = xar({"Foo.pkg": {"Payload": pbzx(cpio([("./usr/bin/x", "f", b"x")]))}})
        r = run(self.write(data), os.path.join(self.dir, "sdk"))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("no MacOSX", r.stderr)

    @unittest.skipUnless(shutil.which("7z"), "no 7z")
    def test_dmg_via_7z(self):
        # 7z reads by content, so a zip named .dmg stands in for Apple's UDIF image; the largest .pkg is the one
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("Command Line Developer Tools/Command Line Tools.pkg", clt_pkg() + b"\0" * (2 << 20))
            z.writestr("Command Line Developer Tools/.hidden/tiny.pkg", b"xar!")
        dest = os.path.join(self.dir, "out", "MacOSX.sdk")
        r = run(self.write(buf.getvalue(), "Command_Line_Tools_for_Xcode_16.4.dmg"), dest)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assert_subset(dest, "15.5")

    @unittest.skipUnless(shutil.which("7z"), "no 7z")
    def test_bad_dmg(self):
        r = run(self.write(b"\0" * 4096, "Command_Line_Tools.dmg"), os.path.join(self.dir, "out", "sdk"))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("7z couldn't open", r.stderr)
        self.assertEqual(os.listdir(os.path.join(self.dir, "out")), [])


class ReleaseFindsToolchains(unittest.TestCase):
    """release.sh --probe finds the two scripts' default folders without MACOS_SDK or LLVM_MINGW set."""

    def probe(self, data):
        env = {k: v for k, v in os.environ.items() if k not in ("MACOS_SDK", "LLVM_MINGW")}
        env["XDG_DATA_HOME"] = data
        r = subprocess.run(["bash", os.path.join(HERE, "release.sh"), "--probe"], capture_output=True, text=True,
                           env=env, timeout=60)
        return dict(line.split(": ", 1) for line in r.stdout.splitlines())

    def test_default_folders(self):
        with tempfile.TemporaryDirectory() as data:
            empty = self.probe(data)
            self.assertIn("tools/setup/macos-sdk.sh", empty["macos"])
            self.assertIn("tools/setup/llvm-mingw.sh", empty["windows-arm64"])
            os.makedirs(os.path.join(data, "ifizbox", "MacOSX.sdk", "usr", "lib"))
            os.makedirs(os.path.join(data, "ifizbox", "llvm-mingw", "bin"))
            clang = os.path.join(data, "ifizbox", "llvm-mingw", "bin", "aarch64-w64-mingw32-clang")
            with open(clang, "w") as f:
                f.write("#!/bin/sh\n")
            os.chmod(clang, 0o755)
            found = self.probe(data)
            self.assertNotIn("MACOS_SDK", found["macos"])
            self.assertNotIn("aarch64-w64-mingw32-clang", found["windows-arm64"])

    def test_llvm_mingw_refuses_existing_dest(self):
        with tempfile.TemporaryDirectory() as d:
            r = subprocess.run(["bash", os.path.join(HERE, "llvm-mingw.sh"), d], capture_output=True, text=True,
                               timeout=60)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("exists" if os.uname().sysname == "Linux" else "no pinned", r.stderr)


if __name__ == "__main__":
    unittest.main()
