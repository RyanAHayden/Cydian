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
from test_native import copy_launch, fake_macho, plist  # noqa: E402


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
        copy_launch(self.app)
        for name in ("index.html", "app.js", "style.css", "router.js", "mode.js", "nav/stack.js"):
            self.write("web/" + name, b"x")
        self.write("bridge.js", b"x")
        # N8: the both-modes App Intents and a widget extension without controls.
        self.intents(sorted(mkipa.SIDELOAD_INTENTS))
        self.write("PlugIns/CydianWidget.appex/CydianWidget", signed_macho({"get-task-allow": True}), 0o755)
        self.write("PlugIns/CydianWidget.appex/Info.plist", plist())
        self.ipa = os.path.join(self.tmp, "Cydian.ipa")

    def intents(self, names, where="Metadata.appintents"):
        import json
        self.write(where + "/extract.actionsdata", json.dumps({"version": 1, "actions": {n: {} for n in names}}).encode())

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

    def test_launch_screen_checked(self):
        """N10: the IPA has the launch screen's images too."""
        os.remove(os.path.join(self.app, "LaunchLoading@2x.png"))
        self.assertIn("launch image LaunchLoading@2x.png missing", self.problems())

    def test_helper_flagged(self):
        self.write("cydian-helper", b"x", 0o755)
        self.assertTrue(any("jailbreak files" in p for p in self.problems()))

    def test_daemon_flagged(self):
        """T5: N5's upgrade daemon and its launchd job belong to the .deb only."""
        self.write("cydian-upgrades", b"x", 0o755)
        self.write("Library/LaunchDaemons/com.ryha.cydian.upgrades.plist", b"x")
        p = " | ".join(self.problems())
        self.assertIn("Payload/Cydian.app/cydian-upgrades", p)
        self.assertIn("com.ryha.cydian.upgrades.plist", p)

    def test_notification_entitlement_flagged(self):
        self.write("Cydian", signed_macho({"get-task-allow": True,
                                           "com.apple.private.usernotifications.bundle-identifiers": ["x"]}), 0o755)
        self.assertTrue(any("usernotifications" in p for p in self.problems()))

    def test_intents_checked(self):
        # N8: only the both-modes intents; the widget's controls and its jailbreak entitlements are the .deb's.
        self.intents(sorted(mkipa.SIDELOAD_INTENTS) + ["RespringIntent"])
        self.assertTrue(any("App Intents" in p and "RespringIntent" in p for p in self.problems()))
        self.intents(sorted(mkipa.SIDELOAD_INTENTS))
        self.intents(["RespringIntent"], "PlugIns/CydianWidget.appex/Metadata.appintents")
        self.assertTrue(any("widget extension carries intents" in p for p in self.problems()))
        os.remove(os.path.join(self.app, "PlugIns/CydianWidget.appex/Metadata.appintents/extract.actionsdata"))
        self.write("PlugIns/CydianWidget.appex/CydianWidget", signed_macho({"com.apple.private.persona-mgmt": True}), 0o755)
        self.assertTrue(any("entitlements in the widget" in p for p in self.problems()))
        shutil.rmtree(os.path.join(self.app, "PlugIns"))
        os.remove(os.path.join(self.app, "Metadata.appintents/extract.actionsdata"))
        p = " | ".join(self.problems())
        self.assertIn("no Metadata.appintents", p)

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
        # Without the sideload overlay. N9 put the cydian:// scheme and the .ipa/.deb types in the base Info.plist (the
        # jailbreak build takes shared files and the share extension's links too), so drop them to see they're checked.
        info = plistlib.loads(plist())
        info.pop("CFBundleURLTypes", None)
        info.pop("CFBundleDocumentTypes", None)
        with open(os.path.join(self.app, "Info.plist"), "wb") as f:
            f.write(plistlib.dumps(info))
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

    def test_missing_bridge_flagged(self):
        os.remove(os.path.join(self.app, "bridge.js"))
        self.assertTrue(any("bridge.js missing" in x for x in self.problems()))


class SideloadPlists(unittest.TestCase):
    def test_entitlements_get_task_allow_only(self):
        with open(os.path.join(HERE, "entitlements-sideload.plist"), "rb") as f:
            # N8: plus the App Group the widget reads the count from (signers such as AltStore register it).
            self.assertEqual(plistlib.load(f), {"get-task-allow": True,
                                                "com.apple.security.application-groups": ["group.com.ryha.cydian"]})

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
