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


def signed_fake(entitlements):
    """fake_macho() whose LC_CODE_SIGNATURE points at a SuperBlob holding an entitlements blob."""
    xml = plistlib.dumps(entitlements)
    ent = struct.pack(">II", 0xFADE7171, 8 + len(xml)) + xml
    sb = struct.pack(">III", 0xFADE0CC0, 20 + len(ent), 1) + struct.pack(">II", 5, 20) + ent
    head = bytearray(fake_macho())
    struct.pack_into("<II", head, len(head) - 8, len(head), len(sb))
    return bytes(head) + sb


DAEMON_ENTS = {mkdeb.NOTIFY_ENTITLEMENT: ["com.ryha.ifizbox"], "platform-application": True,
               "com.apple.private.security.no-sandbox": True}
HELPER_ENTS = {"platform-application": True, "com.apple.private.security.no-container": True}


def plist(version="0.1.0", build="7"):
    with open(os.path.join(HERE, "Info.plist")) as f:
        text = f.read().replace("@VERSION@", version).replace("@BUILD@", build).replace("@MIN@", "15.0")
    return text.encode()


def copy_launch(app):
    """N10: the launch screen's loose PNGs (native/launch/) and one of the website's per-screen launch images."""
    for name in sorted(os.listdir(os.path.join(HERE, "launch"))):
        if name.endswith(".png"):
            shutil.copy(os.path.join(HERE, "launch", name), app)
    os.makedirs(os.path.join(app, "web/icons/launch"), exist_ok=True)
    with open(os.path.join(app, "web/icons/launch/launch-1179x2556.png"), "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")


class Deb(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.root = os.path.join(self.tmp, "root")
        self.app = os.path.join(self.root, "var/jb/Applications/iFizBox.app")
        self.debian = os.path.join(self.tmp, "debian")
        os.makedirs(os.path.join(self.app, "web/nav"))
        os.makedirs(self.debian)
        self.write(self.app, "iFizBox", fake_macho(), 0o755)
        self.write(self.app, "Info.plist", plist())
        self.write(self.app, "bridge.js", b"x")
        os.makedirs(os.path.join(self.root, "var/jb/usr/libexec/ifizbox"))
        self.write(self.root, mkdeb.HELPER[len("./"):], signed_fake(HELPER_ENTS), 0o755)
        self.write(self.root, mkdeb.DAEMON[len("./"):], signed_fake(DAEMON_ENTS), 0o755)
        os.makedirs(os.path.join(self.root, "var/jb/Library/LaunchDaemons"))
        shutil.copy(os.path.join(HERE, "daemon/com.ryha.ifizbox.upgrades.plist"),
                    os.path.join(self.root, mkdeb.DAEMON_JOB[len("./"):]))
        os.chmod(os.path.join(self.root, mkdeb.DAEMON_JOB[len("./"):]), 0o644)
        for name in ("AppIcon60x60@2x.png", "AppIcon60x60@3x.png"):
            shutil.copy(os.path.join(HERE, "icon", name), self.app)
        copy_launch(self.app)
        for name in ("index.html", "app.js", "style.css", "router.js", "nav/stack.js"):
            self.write(self.app, "web/" + name, b"x")
        with open(os.path.join(HERE, "deb/control")) as f:
            self.write(self.debian, "control", f.read().replace("@VERSION@", "0.1.0-7").encode())
        for name in ("postinst", "prerm"):
            shutil.copy(os.path.join(HERE, "deb", name), self.debian)
        self.deb = os.path.join(self.tmp, "iFizBox.deb")

    @staticmethod
    def write(base, rel, data, mode=0o644):
        p = os.path.join(base, rel)
        with open(p, "wb") as f:
            f.write(data)
        os.chmod(p, mode)

    def problems(self):
        mkdeb.build(self.root, self.debian, self.deb, mtime=0)
        return mkdeb.check(self.deb)[0]

    def problems_with_mode(self, name, mode):
        """problems() for a package whose entry name has mode (build() itself only writes 0755 and 0644)."""
        walk = mkdeb._walk

        def walk_with_mode(root):
            entries, size = walk(root)
            return [(n, d, mode if n == name else m) for n, d, m in entries], size
        mkdeb._walk = walk_with_mode
        self.addCleanup(setattr, mkdeb, "_walk", walk)
        return self.problems()

    def test_good_package(self):
        self.assertEqual(self.problems(), [])
        members = mkdeb.read_ar(open(self.deb, "rb").read())
        self.assertEqual([n for n, _ in members], ["debian-binary", "control.tar.xz", "data.tar.xz"])
        _, summary = mkdeb.check(self.deb)
        self.assertIn("0.1.0-7 (iphoneos-arm64)", summary)

    def test_launch_image_missing_flagged(self):
        os.remove(os.path.join(self.app, "LaunchLoading@3x.png"))
        self.assertIn("launch image LaunchLoading@3x.png missing", self.problems())

    def test_relations_flagged(self):
        """F66: install-ipa needs unzip (Depends) and wants ldid (Recommends)."""
        self.assertEqual(mkdeb.relation_names("firmware (>= 15.0), uikittools, a | b:any"),
                         ["firmware", "uikittools", "a", "b"])
        path = os.path.join(self.debian, "control")
        text = open(path).read()
        self.assertIn("unzip", text)
        self.write(self.debian, "control",
                   text.replace(", unzip\n", "\n").replace("Recommends: ldid\n", "").encode())
        p = " | ".join(self.problems())
        self.assertIn("control Depends lacks unzip", p)
        self.assertIn("control Recommends lacks ldid", p)

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
        self.write(self.app, "iFizBox", fake_macho(cpu=0x01000007, minos=(14, 0), signed=False), 0o755)
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

    def test_unsandboxed_flagged(self):
        """N6: on a rootless jailbreak the helper and daemon die at launch without no-container or no-sandbox."""
        self.assertEqual(self.problems(), [])
        self.write(self.root, mkdeb.HELPER[len("./"):], signed_fake({"platform-application": True}), 0o755)
        self.assertTrue(any("helper has neither" in p for p in self.problems()))
        self.write(self.root, mkdeb.HELPER[len("./"):], signed_fake(HELPER_ENTS), 0o755)
        self.write(self.root, mkdeb.DAEMON[len("./"):], signed_fake({mkdeb.NOTIFY_ENTITLEMENT: ["com.ryha.ifizbox"]}),
                   0o755)
        self.assertTrue(any("daemon has neither" in p for p in self.problems()))

    def test_bridge_script_flagged(self):
        os.remove(os.path.join(self.app, "bridge.js"))
        self.assertTrue(any("bridge.js" in p for p in self.problems()))


    def test_daemon_flagged(self):
        """T5: N5's daemon ships 0755, signed arm64, with the notification entitlement."""
        rel = mkdeb.DAEMON[len("./"):]
        os.remove(os.path.join(self.root, rel))
        self.assertTrue(any("no upgrade daemon" in p for p in self.problems()))
        self.write(self.root, rel, fake_macho(), 0o755)  # signed, but without entitlements
        self.assertTrue(any("usernotifications" in p for p in self.problems()))
        self.write(self.root, rel, signed_fake({mkdeb.NOTIFY_ENTITLEMENT: ["com.example"]}), 0o755)
        self.assertTrue(any("usernotifications" in p for p in self.problems()))
        self.write(self.root, rel, fake_macho(cpu=0x01000007, signed=False), 0o755)
        self.assertTrue(any("daemon is not" in p for p in self.problems()))
        self.write(self.root, rel, signed_fake(DAEMON_ENTS), 0o755)
        self.assertTrue(any("daemon mode is 4755" in p for p in self.problems_with_mode(mkdeb.DAEMON, 0o4755)))

    def test_daemon_job_flagged(self):
        rel = mkdeb.DAEMON_JOB[len("./"):]
        path = os.path.join(self.root, rel)
        os.remove(path)
        self.assertTrue(any("no launchd job" in p for p in self.problems()))
        self.write(self.root, rel, plistlib.dumps({"Label": "x", "ProgramArguments": ["/usr/bin/true"]}))
        p = " | ".join(self.problems_with_mode(mkdeb.DAEMON_JOB, 0o666))
        self.assertIn("launchd job mode is 666", p)
        self.assertIn("Label is 'x'", p)
        self.assertIn("does not run /var/jb/usr/libexec/ifizbox/ifizbox-upgrades", p)

    def test_postinst_must_load_daemon(self):
        self.write(self.debian, "postinst", b"#!/bin/sh\nuicache -p /var/jb/Applications/iFizBox.app\n", 0o755)
        self.write(self.debian, "prerm", b"#!/bin/sh\nexit 0\n", 0o755)
        p = " | ".join(self.problems())
        self.assertIn("postinst does not launchctl load", p)
        self.assertIn("launchctl unload", p)


class Plists(unittest.TestCase):
    def test_launch_screen_keys(self):
        """N10: UILaunchScreen names the three images, no asset-catalog colour, and the images are in launch/."""
        info = plistlib.loads(plist())
        import launch_check
        self.assertEqual(launch_check.problems(info, {}, "")[:1], ["launch image LaunchLoading@2x.png missing"])
        files = {}
        for name in os.listdir(os.path.join(HERE, "launch")):
            if name.endswith(".png"):
                with open(os.path.join(HERE, "launch", name), "rb") as f:
                    files[name] = f.read()
        files["web/icons/launch/launch-750x1334.png"] = b"\x89PNG"
        self.assertEqual(launch_check.problems(info, files, ""), [])
        info["UILaunchScreen"]["UIColorName"] = ""
        self.assertIn("UIColorName", launch_check.problems(info, files, "")[0])
        self.assertIn("no UILaunchScreen", launch_check.problems({}, files, "")[0])

    def test_launch_images_match_make(self):
        """native/launch/*.png are what launch/make.py makes from the website's launch images (rerun it if not)."""
        sys.path.insert(0, os.path.join(HERE, "launch"))
        import make
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp)
        make.main(tmp)
        for name in sorted(os.listdir(tmp)):
            if name.endswith(".png"):
                with open(os.path.join(tmp, name), "rb") as a, open(os.path.join(HERE, "launch", name), "rb") as b:
                    self.assertEqual(a.read(), b.read(), name)
        with open(os.path.join(HERE, "launch", "LaunchLoading@3x.png"), "rb") as f:
            w, h = struct.unpack(">II", f.read(24)[16:24])
        self.assertGreaterEqual((w, h), (1800, 3600))  # bigger than any iPhone, so centred it fills the screen

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
        self.assertTrue(e["com.apple.private.persona-mgmt"])  # N3: spawning ifizbox-helper as root

    def test_paid_entitlements(self):
        """F57 (Paid.swift): the Keychain group for payment secrets, the UDID key, and Face ID's usage string."""
        with open(os.path.join(HERE, "entitlements.plist"), "rb") as f:
            e = plistlib.load(f)
        self.assertEqual(e["keychain-access-groups"], ["com.ryha.ifizbox"])
        self.assertEqual(e["com.apple.private.MobileGestalt.AllowedProtectedKeys"], ["UniqueDeviceID"])
        with open(os.path.join(HERE, "Info.plist"), "rb") as f:
            self.assertIn("Face ID", plistlib.load(f)["NSFaceIDUsageDescription"])

    def test_daemon_entitlements(self):
        with open(os.path.join(HERE, "daemon/entitlements.plist"), "rb") as f:
            e = plistlib.load(f)
        self.assertEqual(e[mkdeb.NOTIFY_ENTITLEMENT], ["com.ryha.ifizbox"])

    def test_helper_entitlements(self):
        """N6: the helper's signing entitlements keep it out of the sandbox (else palera1n SIGKILLs it)."""
        with open(os.path.join(HERE, "helper/entitlements.plist"), "rb") as f:
            e = plistlib.load(f)
        self.assertTrue(any(e.get(k) is True for k in mkdeb.UNSANDBOXED))

    def test_local_notifications_key(self):
        """N6: without SBAppUsesLocalNotifications iOS keeps no notification permission for a /Applications app."""
        with open(os.path.join(HERE, "Info.plist"), "rb") as f:
            self.assertIs(plistlib.load(f).get("SBAppUsesLocalNotifications"), True)

    def test_version_file(self):
        with open(os.path.join(HERE, "VERSION")) as f:
            self.assertRegex(f.read().strip(), r"^\d+\.\d+\.\d+$")


if __name__ == "__main__":
    unittest.main()
