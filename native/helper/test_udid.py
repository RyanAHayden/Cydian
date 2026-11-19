"""F236: ifizbox-helper udid, this iPhone's UDID for Settings > Signing's "This iPhone is in the profile" check
(native/Sources/PhoneID.swift). On iOS it asks MobileGestalt (a protected key, allowed by entitlements.plist); off iOS
there is none, so here it must fail cleanly (exit 74, a reason), refuse arguments, and still refuse other callers."""
import os
import plistlib
import shutil
import subprocess
import tempfile
import unittest

from test_helper import CC, HERE, build


class Entitlement(unittest.TestCase):
    def test_protected_key_is_allowed(self):
        with open(os.path.join(HERE, "entitlements.plist"), "rb") as f:
            ents = plistlib.load(f)
        self.assertIn("UniqueDeviceID", ents["com.apple.private.MobileGestalt.AllowedProtectedKeys"])

    def test_reads_unique_device_id(self):
        with open(os.path.join(HERE, "main.c")) as f:
            c = f.read()
        self.assertIn('CFSTR("UniqueDeviceID")', c)
        self.assertIn('"MGCopyAnswer"', c)


@unittest.skipUnless(CC, "no C compiler on this machine")
class Udid(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        p = cls.tmp
        os.makedirs(os.path.join(p, "Applications/iFizBox.app"))
        cls.ifizbox = os.path.join(p, "Applications/iFizBox.app/iFizBox")
        build(cls.ifizbox, ["test_driver.c", "policy.c", "spawn.c"])
        cls.helper = os.path.join(p, "ifizbox-helper")
        build(cls.helper, ["main.c", "policy.c"], [f'-DIFIZBOX_PREFIX="{p}"', f"-DIFIZBOX_ROOT_UID={os.getuid()}"])

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def spawn(self, *words):
        r = subprocess.run([self.ifizbox, "spawn", self.helper, *words], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout.splitlines()

    def test_off_ios_says_why(self):
        out = self.spawn("udid")
        self.assertEqual(out[-1], "exit: 74", out)
        self.assertTrue(any("MobileGestalt is only on iOS" in l for l in out), out)

    def test_takes_no_arguments(self):
        out = self.spawn("udid", "extra")
        self.assertEqual(out[-1], "exit: 64", out)

    def test_other_callers_refused(self):
        r = subprocess.run([self.helper, "udid"], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 77, r.stderr)


if __name__ == "__main__":
    unittest.main()
