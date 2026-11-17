"""N1: the .deb writer/checker (mkdeb.py) and the shell's plists. The real build (build.sh) needs the Swift toolchain
and the iOS SDK; tools/check.sh runs it when they are set up, and mkdeb.py checks what it made."""
import os
import plistlib
import shutil
import struct
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mkdeb  # noqa: E402


def fake_macho(cpu=0x0100000C, minos=(15, 0), signed=True):
    cmds = struct.pack("<II", 0x32, 24) + struct.pack("<IIII", 2, (minos[0] << 16) | (minos[1] << 8), 0, 0)
    if signed:
        cmds += struct.pack("<IIII", 0x1D, 16, 0, 0)
    head = struct.pack("<IiiIIII", 0xFEEDFACF, cpu, 0, 2, 2 if signed else 1, len(cmds), 0) + b"\0" * 4
    return head[:32] + cmds


def plist(version="0.1.0", build="7"):
    with open(os.path.join(HERE, "Info.plist")) as f:
        text = f.read().replace("@VERSION@", version).replace("@BUILD@", build).replace("@MIN@", "15.0")
    return text.encode()


class Deb(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.root = os.path.join(self.tmp, "root")
        self.app = os.path.join(self.root, "var/jb/Applications/Cydian.app")
        self.debian = os.path.join(self.tmp, "debian")
        os.makedirs(os.path.join(self.app, "web/nav"))
        os.makedirs(self.debian)
        self.write(self.app, "Cydian", fake_macho(), 0o755)
        self.write(self.app, "Info.plist", plist())
        self.write(self.app, "bridge.js", b"x")
        os.makedirs(os.path.join(self.root, "var/jb/usr/libexec/cydian"))
        self.write(self.root, mkdeb.HELPER[len("./"):], fake_macho(), 0o755)
        for name in ("AppIcon60x60@2x.png", "AppIcon60x60@3x.png"):
            shutil.copy(os.path.join(HERE, "icon", name), self.app)
        for name in ("index.html", "app.js", "style.css", "router.js", "nav/stack.js"):
            self.write(self.app, "web/" + name, b"x")
        with open(os.path.join(HERE, "deb/control")) as f:
            self.write(self.debian, "control", f.read().replace("@VERSION@", "0.1.0-7").encode())
        for name in ("postinst", "prerm"):
            shutil.copy(os.path.join(HERE, "deb", name), self.debian)
        self.deb = os.path.join(self.tmp, "Cydian.deb")

    @staticmethod
    def write(base, rel, data, mode=0o644):
        p = os.path.join(base, rel)
        with open(p, "wb") as f:
            f.write(data)
        os.chmod(p, mode)

    def problems(self):
        mkdeb.build(self.root, self.debian, self.deb, mtime=0)
        return mkdeb.check(self.deb)[0]

    def test_good_package(self):
        self.assertEqual(self.problems(), [])
        members = mkdeb.read_ar(open(self.deb, "rb").read())
        self.assertEqual([n for n, _ in members], ["debian-binary", "control.tar.xz", "data.tar.xz"])
        _, summary = mkdeb.check(self.deb)
        self.assertIn("0.1.0-7 (iphoneos-arm64)", summary)

    def test_build_is_reproducible(self):
        mkdeb.build(self.root, self.debian, self.deb, mtime=0)
        first = open(self.deb, "rb").read()
        mkdeb.build(self.root, self.debian, self.deb, mtime=0)
        self.assertEqual(first, open(self.deb, "rb").read())

    def test_installed_size_filled(self):
        mkdeb.build(self.root, self.debian, self.deb, mtime=0)
        self.assertNotIn("@SIZE@", open(self.deb, "rb").read().decode("latin1"))

    def test_rootful_path_flagged(self):
        os.makedirs(os.path.join(self.root, "Applications"))
        self.write(self.root, "Applications/stray", b"x")
        self.assertTrue(any("not under /var/jb" in p for p in self.problems()))

    def test_tests_in_bundle_flagged(self):
        self.write(self.app, "web/router.test.js", b"x")
        self.assertTrue(any("tests shipped" in p for p in self.problems()))

    def test_wrong_binary_flagged(self):
        self.write(self.app, "Cydian", fake_macho(cpu=0x01000007, minos=(14, 0), signed=False), 0o755)
        p = " | ".join(self.problems())
        self.assertIn("not arm64", p)
        self.assertIn("minos 14.0", p)
        self.assertIn("no code signature", p)

    def test_version_mismatch_flagged(self):
        self.write(self.app, "Info.plist", plist(build="8"))
        self.assertTrue(any("CFBundleVersion" in p for p in self.problems()))


    def test_helper_flagged(self):
        """N3: the helper ships at its rootless path, 0755 and an arm64 iOS executable."""
        helper = os.path.join(self.root, mkdeb.HELPER[len("./"):])
        os.remove(helper)
        self.assertTrue(any("no helper" in p for p in self.problems()))
        self.write(self.root, mkdeb.HELPER[len("./"):], fake_macho(cpu=0x01000007), 0o755)
        self.assertTrue(any("helper is not" in p for p in self.problems()))

    def test_bridge_script_flagged(self):
        os.remove(os.path.join(self.app, "bridge.js"))
        self.assertTrue(any("bridge.js" in p for p in self.problems()))


class Plists(unittest.TestCase):
    def test_info_plist(self):
        p = plistlib.loads(plist())
        self.assertTrue(p["CADisableMinimumFrameDurationOnPhone"])
        self.assertEqual(p["MinimumOSVersion"], "15.0")
        self.assertIn("UIApplicationSceneManifest", p)  # iOS 27 refuses apps without the scene lifecycle
        self.assertEqual(p["CFBundleIcons"]["CFBundlePrimaryIcon"]["CFBundleIconFiles"], ["AppIcon60x60"])

    def test_entitlements(self):
        with open(os.path.join(HERE, "entitlements.plist"), "rb") as f:
            e = plistlib.load(f)
        self.assertTrue(e["platform-application"])
        self.assertTrue(e["com.apple.private.security.no-container"])
        self.assertTrue(e["com.apple.private.persona-mgmt"])  # N3: spawning cydian-helper as root

    def test_version_file(self):
        with open(os.path.join(HERE, "VERSION")) as f:
            self.assertRegex(f.read().strip(), r"^\d+\.\d+\.\d+$")


if __name__ == "__main__":
    unittest.main()
