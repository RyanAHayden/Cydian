"""T3: tools/ios-sdk.sh on a small fixture .xip (xar > pbzx > cpio), its .tbd fix, and the native build's refusal
when $IOS_SDK is unset. The fixture is built here, byte by byte, so no Apple file is needed."""
import io
import lzma
import os
import struct
import subprocess
import tempfile
import unittest
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCRIPT = os.path.join(HERE, "ios-sdk.sh")
BUILD = os.path.join(ROOT, "native", "spike", "build.sh")
SDKS = "Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/"

TBD = """--- !tapi-tbd
tbd-version:     4
targets:         [ arm64e-ios, arm64e.x1-ios ]
install-name:    '/usr/lib/libfoo.dylib'
exports:
  - targets:         [ arm64e-ios, arm64e.x1-ios ]
    symbols:         [ _foo, _bar ]
  - targets:         [ arm64-ios, arm64e-ios, arm64e.x1-ios ]
    symbols:         [ _baz ]
...
"""
TBD_FIXED = (TBD.replace("[ arm64e-ios, arm64e.x1-ios ]", "[ arm64e-ios, arm64-ios ]")
             .replace("[ arm64-ios, arm64e-ios, arm64e.x1-ios ]", "[ arm64-ios, arm64e-ios ]"))


def cpio_odc(entries):
    """entries: (path, kind, data) with kind 'd', 'f' or 'l'."""
    out = io.BytesIO()
    modes = {"d": 0o040755, "f": 0o100644, "l": 0o120755, "x": 0o100755}
    for i, (path, kind, data) in enumerate(entries + [("TRAILER!!!", "t", b"")]):
        name = path.encode() + b"\0"
        mode = modes.get(kind, 0)
        out.write(b"070707" + b"%06o%06o%06o%06o%06o%06o%06o%011o%06o%011o" % (
            0, i, mode, 0, 0, 1, 0, 0, len(name), len(data)))
        out.write(name + data)
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


def xar(members):
    """members: name -> bytes, stored raw. A Metadata member first, as in a real .xip."""
    heap, files, off = b"", [], 0
    for i, (name, data) in enumerate(members.items(), 1):
        files.append(
            '<file id="%d"><name>%s</name><type>file</type><data><offset>%d</offset><length>%d</length>'
            '<size>%d</size><encoding style="application/octet-stream"/></data></file>'
            % (i, name, off, len(data), len(data)))
        heap += data
        off += len(data)
    toc = ('<?xml version="1.0" encoding="UTF-8"?><xar><toc>%s</toc></xar>' % "".join(files)).encode()
    ztoc = zlib.compress(toc)
    return b"xar!" + struct.pack(">HHQQI", 28, 1, len(ztoc), len(toc), 0) + ztoc + heap


def fixture(extra=()):
    big = bytes(range(256)) * 40  # > one pbzx chunk, so stored and xz chunks both occur
    entries = [
        ("Xcode.app", "d", b""),
        ("Xcode.app/Contents/Info.plist", "f", b"<plist/>"),
        (SDKS[:-1], "d", b""),
        (SDKS + "iPhoneOS27.1.sdk", "d", b""),
        (SDKS + "iPhoneOS27.1.sdk/usr/lib", "d", b""),
        (SDKS + "iPhoneOS27.1.sdk/usr/lib/libfoo.tbd", "f", TBD.encode()),
        (SDKS + "iPhoneOS27.1.sdk/usr/lib/blob.a", "f", big),
        (SDKS + "iPhoneOS27.1.sdk/usr/lib/libfoo2.tbd", "l", b"libfoo.tbd"),
        (SDKS + "iPhoneOS.sdk", "l", b"iPhoneOS27.1.sdk"),
        ("Xcode.app/Contents/Developer/Platforms/MacOSX.platform/x", "f", b"mac"),
    ] + list(extra)
    return xar({"Metadata": b"<meta/>", "Content": pbzx(cpio_odc(entries))}), big


def run(*args, env=None):
    return subprocess.run(["bash", SCRIPT, *args], capture_output=True, text=True, env=env, timeout=60)


class Extract(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        self.addCleanup(self.tmp.cleanup)

    def write_xip(self, data):
        p = os.path.join(self.dir, "Xcode.xip")
        with open(p, "wb") as f:
            f.write(data)
        return p

    def test_extracts_sdk_and_fixes_tbd(self):
        data, big = fixture()
        dest = os.path.join(self.dir, "out", "iPhoneOS.sdk")
        r = run(self.write_xip(data), dest)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("export IOS_SDK=" + dest, r.stdout)
        self.assertTrue(os.path.isdir(dest) and not os.path.islink(dest))
        with open(os.path.join(dest, "usr/lib/libfoo.tbd")) as f:
            self.assertEqual(f.read(), TBD_FIXED)
        with open(os.path.join(dest, "usr/lib/blob.a"), "rb") as f:
            self.assertEqual(f.read(), big)
        self.assertEqual(os.readlink(os.path.join(dest, "usr/lib/libfoo2.tbd")), "libfoo.tbd")
        # Nothing outside SDKs/ and no work dir left behind.
        self.assertEqual(sorted(os.listdir(os.path.dirname(dest))), ["iPhoneOS.sdk"])

    def test_default_dest_is_ours(self):
        data, _ = fixture()
        env = dict(os.environ, XDG_DATA_HOME=os.path.join(self.dir, "xdg"))
        r = run(self.write_xip(data), env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isdir(os.path.join(self.dir, "xdg", "ifizbox", "iPhoneOS.sdk", "usr", "lib")))

    def test_refuses_existing_dest(self):
        data, _ = fixture()
        dest = os.path.join(self.dir, "sdk")
        os.mkdir(dest)
        r = run(self.write_xip(data), dest)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("exists", r.stderr)

    def test_rejects_path_traversal(self):
        data, _ = fixture([(SDKS + "../../../../../../evil", "f", b"x")])
        r = run(self.write_xip(data), os.path.join(self.dir, "sdk"))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("unsafe path", r.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.dir, "evil")))
        self.assertEqual(os.listdir(self.dir), ["Xcode.xip"])

    def test_rejects_write_through_symlink(self):
        data, _ = fixture([(SDKS + "esc", "l", self.dir.encode()),
                           (SDKS + "esc/planted", "f", b"x")])
        r = run(self.write_xip(data), os.path.join(self.dir, "sdk"))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("symlink", r.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.dir, "planted")))

    def test_not_a_xip(self):
        r = run(self.write_xip(b"PK\3\4 not xar"), os.path.join(self.dir, "sdk"))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("not a xar", r.stderr)

    def test_fix_tbd_on_extracted_sdk(self):
        sdk = os.path.join(self.dir, "sdk")
        os.makedirs(os.path.join(sdk, "System"))
        p = os.path.join(sdk, "System", "Foo.tbd")
        with open(p, "w") as f:
            f.write(TBD)
        r = run("fix-tbd", sdk)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("fixed 1 ", r.stdout)
        with open(p) as f:
            self.assertEqual(f.read(), TBD_FIXED)
        r = run("fix-tbd", sdk)  # idempotent
        self.assertIn("fixed 0 ", r.stdout)


class BuildNeedsSdk(unittest.TestCase):
    def test_unset_ios_sdk_is_a_clear_error(self):
        env = {k: v for k, v in os.environ.items() if k != "IOS_SDK"}
        r = subprocess.run(["bash", BUILD], capture_output=True, text=True, env=env, timeout=60)
        self.assertEqual(r.returncode, 1)
        self.assertIn("IOS_SDK is not set", r.stderr)
        self.assertIn("tools/ios-sdk.sh", r.stderr)

    def test_no_default_into_other_projects(self):
        with open(BUILD) as f:
            text = f.read()
        self.assertNotIn("hst-ios", text)
        self.assertNotIn("opentennis", text)


if __name__ == "__main__":
    unittest.main()
