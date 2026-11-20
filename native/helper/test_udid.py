"""F236: ifizbox-helper udid, this iPhone's UDID for Settings > Signing's "This iPhone is in the profile" check
(native/Sources/PhoneID.swift). On iOS it asks MobileGestalt (a protected key, allowed by entitlements.plist); off iOS
there is none, so here it must fail cleanly (exit 74, a reason), refuse arguments, and still refuse other callers."""
import os
import plistlib
import shutil
import subprocess
import sys
import unittest
from unittest import mock

from test_helper import CC, HERE, build

sys.path.insert(0, os.path.dirname(HERE))
import disktmp  # noqa: E402


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
        # Off the shared /tmp tmpfs: the other slots' gates fill its per-user quota, and then cc can't write its
        # temporary .s/.o files there and the build fails (see native/disktmp.py). The directory is on the disk and
        # cc's TMPDIR points inside it for the two builds only.
        cls.tmp = disktmp.build_dir("ifizbox-udidtest-")
        cls.addClassCleanup(shutil.rmtree, cls.tmp, True)  # also when a build fails (tearDownClass wouldn't run)
        p = cls.tmp
        os.makedirs(os.path.join(p, "Applications/iFizBox.app"))
        cls.ifizbox = os.path.join(p, "Applications/iFizBox.app/iFizBox")
        cls.helper = os.path.join(p, "ifizbox-helper")
        with mock.patch.dict(os.environ, disktmp.swift_env({}, p)):
            build(cls.ifizbox, ["test_driver.c", "policy.c", "spawn.c"])
            build(cls.helper, ["main.c", "policy.c"], [f'-DIFIZBOX_PREFIX="{p}"', f"-DIFIZBOX_ROOT_UID={os.getuid()}"])

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
