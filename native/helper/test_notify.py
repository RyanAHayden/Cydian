"""F65: cydian-helper notifications on|off, Settings' Upgrade Notifications for N5's daemon. The plan (policy.c) and
the whole chain app -> helper -> <prefix>/var/lib/cydian/upgrades.off, built with the host's C compiler."""
import os
import shutil
import subprocess
import tempfile
import unittest

from test_helper import CC, build

HERE = os.path.dirname(os.path.abspath(__file__))


@unittest.skipUnless(CC, "no C compiler on this machine")
class Notifications(unittest.TestCase):
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
        off = "/var/jb/var/lib/cydian/upgrades.off"
        self.assertEqual(self.run_driver("plan", "/var/jb", "3", "notifications", "off"), [off, "notifications", "off"])
        self.assertEqual(self.run_driver("plan", "/var/jb", "-1", "notifications", "on"), [off, "notifications", "on"])
        for words in (["notifications"], ["notifications", "yes"], ["notifications", "on", "off"],
                      ["notifications", "ON"], ["notifications", "../x"]):
            with self.subTest(words=words):
                out = self.run_driver("plan", "/var/jb", "3", *words)
                self.assertEqual(out, ["error: notifications takes on or off"])

    def chain(self):
        p = tempfile.mkdtemp(dir=self.tmp)
        os.makedirs(os.path.join(p, "Applications/Cydian.app"))
        os.makedirs(os.path.join(p, "var/lib"))
        app = os.path.join(p, "Applications/Cydian.app/Cydian")
        shutil.copy(self.driver, app)
        helper = os.path.join(p, "cydian-helper")
        build(helper, ["main.c", "policy.c"], [f'-DCYDIAN_PREFIX="{p}"', f"-DCYDIAN_ROOT_UID={os.getuid()}"])
        return p, app, helper

    def test_chain(self):
        p, app, helper = self.chain()
        f = os.path.join(p, "var/lib/cydian/upgrades.off")
        out = self.run_driver("spawn", helper, "notifications", "off", driver=app)
        self.assertEqual(out, ["1: Upgrade notifications off", "exit: 0"])
        self.assertTrue(os.path.isfile(f))  # the cydian folder made too
        self.assertEqual(os.stat(f).st_mode & 0o777, 0o644)
        self.assertEqual(os.stat(os.path.dirname(f)).st_mode & 0o777, 0o755)
        self.assertEqual(self.run_driver("spawn", helper, "notifications", "off", driver=app)[-1], "exit: 0")  # twice
        self.assertTrue(os.path.isfile(f))
        out = self.run_driver("spawn", helper, "notifications", "on", driver=app)
        self.assertEqual(out, ["1: Upgrade notifications on", "exit: 0"])
        self.assertFalse(os.path.exists(f))
        self.assertEqual(self.run_driver("spawn", helper, "notifications", "on", driver=app)[-1], "exit: 0")  # none: fine
        # the caller check comes first
        self.assertEqual(self.run_driver("spawn", helper, "notifications", "off", driver=self.driver)[-1], "exit: 77")
        self.assertFalse(os.path.exists(f))
        self.assertEqual(self.run_driver("spawn", helper, "notifications", "maybe", driver=app)[-1], "exit: 64")

    def test_chain_refuses_links(self):
        """Root never writes through, or deletes, something that isn't a plain file at the path."""
        p, app, helper = self.chain()
        d = os.path.join(p, "var/lib/cydian")
        os.makedirs(d)
        target = os.path.join(p, "elsewhere")
        open(target, "w").close()
        f = os.path.join(d, "upgrades.off")
        os.symlink(target, f)
        for word in ("off", "on"):
            with self.subTest(word=word):
                out = self.run_driver("spawn", helper, "notifications", word, driver=app)
                self.assertEqual(out[-1], "exit: 74", out)
                self.assertTrue(os.path.islink(f))
        os.unlink(f)
        os.mkdir(f)
        self.assertEqual(self.run_driver("spawn", helper, "notifications", "on", driver=app)[-1], "exit: 74")
        self.assertTrue(os.path.isdir(f))
        os.rmdir(f)
        shutil.rmtree(d)
        os.symlink(os.path.join(p, "Applications"), d)  # the folder itself a link
        self.assertEqual(self.run_driver("spawn", helper, "notifications", "off", driver=app)[-1], "exit: 74")
        self.assertFalse(os.path.exists(os.path.join(p, "Applications/upgrades.off")))


if __name__ == "__main__":
    unittest.main()
