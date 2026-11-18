"""B46: ifizbox-helper uninstall-app <bundle id>, Installed's Delete in the jailbreak app. The app must be one installd
put in the app containers (a fake /var/containers/Bundle/Application tree here); off iOS ipa.c's installd step is a
stand-in that prints "uninstall <id>" (an id ending in ".refused" fails), so the real uninstall is checked on the
iPhone 7 only (see the B46 journal)."""
import os
import shutil
import subprocess
import tempfile
import unittest

from test_appversions import app, plist
from test_helper import CC, build


@unittest.skipUnless(CC, "no C compiler on this machine")
class UninstallApp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.driver = os.path.join(cls.tmp, "test_driver")
        build(cls.driver, ["test_driver.c", "policy.c", "spawn.c"])

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def run_driver(self, *args, driver=None):
        r = subprocess.run([driver or self.driver, *args], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout.splitlines()

    def test_plan(self):
        self.assertEqual(self.run_driver("plan", "/var/jb", "-1", "uninstall-app", "com.example.app"),
                         ["/var/containers/Bundle/Application", "uninstall-app", "com.example.app"])
        for words, err in (
            (("uninstall-app",), "uninstall-app takes one bundle id"),
            (("uninstall-app", "a.b", "c.d"), "uninstall-app takes one bundle id"),
            (("uninstall-app", "-a"), "bad bundle id"),
            (("uninstall-app", "../x"), "bad bundle id"),
            (("uninstall-app", "a b"), "bad bundle id"),
            (("uninstall-app", ""), "bad bundle id"),
        ):
            out = self.run_driver("plan", "/var/jb", "-1", *words)
            self.assertEqual(len(out), 1, out)
            self.assertTrue(out[0].startswith("error: " + err), (words, out))

    def chain(self):
        p = tempfile.mkdtemp(dir=self.tmp)
        os.makedirs(os.path.join(p, "Applications/iFizBox.app"))
        ifizbox = os.path.join(p, "Applications/iFizBox.app/iFizBox")
        shutil.copy(self.driver, ifizbox)
        apps = tempfile.mkdtemp(dir=self.tmp)
        app(apps, "A1", "Delta.app", plist(CFBundleIdentifier="com.rileytestut.Delta", CFBundleShortVersionString="1.6"))
        app(apps, "B2", "No.app", plist(CFBundleIdentifier="com.example.refused", CFBundleShortVersionString="1"))
        os.makedirs(os.path.join(apps, "C3"))
        os.symlink(os.path.join(apps, "A1", "Delta.app"), os.path.join(apps, "C3", "Linked.app"))
        helper = os.path.join(p, "ifizbox-helper")
        build(helper, ["main.c", "policy.c"], [f'-DIFIZBOX_PREFIX="{p}"', f"-DIFIZBOX_ROOT_UID={os.getuid()}",
                                               f'-DHELPER_APPS_DIR="{apps}"'])
        return ifizbox, helper, apps

    def test_chain(self):
        ifizbox, helper, apps = self.chain()
        out = self.run_driver("spawn", helper, "uninstall-app", "com.rileytestut.Delta", driver=ifizbox)
        self.assertEqual(out[-1], "exit: 0", out)
        self.assertIn("1: uninstall com.rileytestut.Delta", out)
        self.assertIn("1: Uninstalled com.rileytestut.Delta", out)
        self.assertIn("3: pmstatus:com.rileytestut.Delta:10:Removing", out)
        self.assertIn("3: pmstatus:com.rileytestut.Delta:100:Removed", out)

    def test_chain_refuses(self):
        ifizbox, helper, apps = self.chain()
        # Not in the containers (a system app, iFizBox itself in the jailbreak's /Applications): never uninstalled.
        for bid in ("com.apple.mobilesafari", "com.ryha.ifizbox"):
            out = self.run_driver("spawn", helper, "uninstall-app", bid, driver=ifizbox)
            self.assertEqual(out[-1], "exit: 64", out)
            self.assertFalse(any(l.startswith("1: uninstall ") for l in out), out)
            self.assertTrue(any("not an app installed in the app containers" in l for l in out), out)
        # installd says no: exit 1 with its reason.
        out = self.run_driver("spawn", helper, "uninstall-app", "com.example.refused", driver=ifizbox)
        self.assertEqual(out[-1], "exit: 1", out)
        self.assertIn("2: ifizbox-helper: test installd refused it", out)
        self.assertFalse(any(l.startswith("1: Uninstalled") for l in out), out)
        out = self.run_driver("spawn", helper, "uninstall-app", "--all", driver=ifizbox)
        self.assertEqual(out[-1], "exit: 64", out)

    def test_find_skips_links(self):
        ifizbox, helper, apps = self.chain()
        shutil.rmtree(os.path.join(apps, "A1"))
        os.makedirs(os.path.join(apps, "A1", "Delta.app"))  # the only real Delta is gone; C3's link must not count
        out = self.run_driver("spawn", helper, "uninstall-app", "com.rileytestut.Delta", driver=ifizbox)
        self.assertEqual(out[-1], "exit: 64", out)


if __name__ == "__main__":
    unittest.main()
