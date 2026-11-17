"""I2: the sideload IPA's writer/checker (mkipa.py) and its plists. The real build (build.sh ipa) needs the Swift
toolchain and the iOS SDK; tools/check.sh runs it when they are set up, and mkipa.py checks what it made."""
import os
import plistlib
import shutil
import struct
import sys
import tempfile
import unittest
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mkipa  # noqa: E402
from test_native import fake_macho, plist  # noqa: E402


def signed_macho(entitlements):
    """A fake arm64 executable whose LC_CODE_SIGNATURE points at a SuperBlob holding an entitlements blob."""
    xml = plistlib.dumps(entitlements)
    ent = struct.pack(">II", 0xFADE7171, 8 + len(xml)) + xml
    sb = struct.pack(">III", 0xFADE0CC0, 20 + len(ent), 1) + struct.pack(">II", 5, 20) + ent
    head = bytearray(fake_macho())
    # fake_macho's LC_CODE_SIGNATURE is its last 16 bytes: set dataoff/datasize to the blob appended after it.
    struct.pack_into("<II", head, len(head) - 8, len(head), len(sb))
    return bytes(head) + sb


class Ipa(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.app = os.path.join(self.tmp, "Cydian.app")
        os.makedirs(os.path.join(self.app, "web/nav"))
        self.write("Cydian", signed_macho({"get-task-allow": True}), 0o755)
        base = os.path.join(self.tmp, "base.plist")
        with open(base, "wb") as f:
            f.write(plist())
        mkipa.merge_plist(base, os.path.join(HERE, "Info-sideload.plist"), os.path.join(self.app, "Info.plist"))
        for name in ("AppIcon60x60@2x.png", "AppIcon60x60@3x.png"):
            shutil.copy(os.path.join(HERE, "icon", name), self.app)
        for name in ("index.html", "app.js", "style.css", "router.js", "mode.js", "nav/stack.js"):
            self.write("web/" + name, b"x")
        self.ipa = os.path.join(self.tmp, "Cydian.ipa")

    def write(self, rel, data, mode=0o644):
        p = os.path.join(self.app, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            f.write(data)
        os.chmod(p, mode)

    def problems(self):
        mkipa.build(self.app, self.ipa, mtime=0)
        return mkipa.check(self.ipa)[0]

    def test_good_ipa(self):
        self.assertEqual(self.problems(), [])
        names = zipfile.ZipFile(self.ipa).namelist()
        self.assertEqual(names[0], "Payload/")
        self.assertIn("Payload/Cydian.app/Cydian", names)
        self.assertIn("entitlements get-task-allow", mkipa.check(self.ipa)[1])

    def test_executable_bit_survives(self):
        mkipa.build(self.app, self.ipa, mtime=0)
        i = zipfile.ZipFile(self.ipa).getinfo("Payload/Cydian.app/Cydian")
        self.assertEqual((i.external_attr >> 16) & 0o777, 0o755)

    def test_build_is_reproducible(self):
        mkipa.build(self.app, self.ipa, mtime=0)
        first = open(self.ipa, "rb").read()
        os.utime(os.path.join(self.app, "Info.plist"), (12345678, 12345678))
        mkipa.build(self.app, self.ipa, mtime=0)
        self.assertEqual(first, open(self.ipa, "rb").read())

    def test_helper_flagged(self):
        self.write("cydian-helper", b"x", 0o755)
        self.assertTrue(any("jailbreak files" in p for p in self.problems()))

    def test_jailbreak_entitlements_flagged(self):
        self.write("Cydian", signed_macho({"platform-application": True, "com.apple.private.security.no-sandbox": True}),
                   0o755)
        p = " | ".join(self.problems())
        self.assertIn("platform-application", p)
        self.assertIn("no-sandbox", p)

    def test_unsigned_and_wrong_binary_flagged(self):
        self.write("Cydian", fake_macho(cpu=0x01000007, minos=(14, 0), signed=False), 0o755)
        p = " | ".join(self.problems())
        self.assertIn("not arm64", p)
        self.assertIn("no code signature", p)

    def test_jailbreak_plist_flagged(self):
        with open(os.path.join(self.app, "Info.plist"), "wb") as f:
            f.write(plist())  # without the sideload overlay
        p = " | ".join(self.problems())
        self.assertIn("UIBackgroundModes", p)
        self.assertIn("URL scheme", p)
        self.assertIn(".ipa", p)

    def test_tests_and_missing_mode_flagged(self):
        self.write("web/router.test.js", b"x")
        os.remove(os.path.join(self.app, "web/mode.js"))
        p = " | ".join(self.problems())
        self.assertIn("tests shipped", p)
        self.assertIn("web/mode.js missing", p)


class SideloadPlists(unittest.TestCase):
    def test_entitlements_get_task_allow_only(self):
        with open(os.path.join(HERE, "entitlements-sideload.plist"), "rb") as f:
            self.assertEqual(plistlib.load(f), {"get-task-allow": True})

    def test_overlay_keeps_base_keys(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp)
        base, out = os.path.join(tmp, "base.plist"), os.path.join(tmp, "out.plist")
        with open(base, "wb") as f:
            f.write(plist())
        mkipa.merge_plist(base, os.path.join(HERE, "Info-sideload.plist"), out)
        with open(out, "rb") as f:
            info = plistlib.load(f)
        self.assertTrue(info["CADisableMinimumFrameDurationOnPhone"])
        self.assertIn("UIApplicationSceneManifest", info)
        self.assertEqual(info["LSApplicationQueriesSchemes"], ["apple-magnifier"])
        self.assertNotIn("UIBackgroundModes", plistlib.loads(plist()))  # the jailbreak build stays as it was


if __name__ == "__main__":
    unittest.main()
