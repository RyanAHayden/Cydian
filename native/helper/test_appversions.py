"""I4: ifizbox-helper app-versions, the real version of each installed app, read from a fake app-container tree
(/var/containers/Bundle/Application/<UUID>/<Name>.app/Info.plist and <UUID>/iTunesMetadata.plist). XML plists only
here: the iOS build reads any plist through CoreFoundation, which can't run on Linux (see the I4 journal)."""
import os
import shutil
import subprocess
import tempfile
import unittest

from test_helper import CC, build


def plist(**values):
    body = "".join(f"\t<key>{k}</key>\n\t<string>{v}</string>\n" for k, v in values.items())
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n'
            f"{body}\t<key>UIDeviceFamily</key>\n\t<array><integer>1</integer></array>\n</dict>\n</plist>\n")


def app(root, uuid, name, info=None, meta=None):
    box = os.path.join(root, uuid)
    os.makedirs(os.path.join(box, name), exist_ok=True)
    if info is not None:
        with open(os.path.join(box, name, "Info.plist"), "w") as f:
            f.write(info)
    if meta is not None:
        with open(os.path.join(box, "iTunesMetadata.plist"), "w") as f:
            f.write(meta)
    return box


@unittest.skipUnless(CC, "no C compiler on this machine")
class AppVersions(unittest.TestCase):
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

    def tree(self):
        root = tempfile.mkdtemp(dir=self.tmp)
        app(root, "A1", "Delta.app", plist(CFBundleIdentifier="com.rileytestut.Delta", CFBundleShortVersionString="1.6",
                                            CFBundleVersion="45"))
        # An App Store app: iTunesMetadata beside the .app says what the store sold.
        app(root, "B2", "Pages.app", plist(CFBundleIdentifier="com.apple.Pages", CFBundleShortVersionString="14.0",
                                           CFBundleVersion="7032"),
            meta=plist(bundleShortVersionString="14.0", softwareVersionBundleId="com.apple.Pages"))
        # Only a build number.
        app(root, "C3", "Build.app", plist(CFBundleIdentifier="com.example.build", CFBundleVersion="12"))
        return root

    def test_plan(self):
        self.assertEqual(self.run_driver("plan", "/var/jb", "-1", "app-versions"),
                         ["/var/containers/Bundle/Application", "app-versions"])
        self.assertEqual(self.run_driver("plan", "/var/jb", "-1", "app-versions", "x"),
                         ["error: app-versions takes no arguments"])

    def test_list(self):
        out = self.run_driver("appversions", self.tree())
        self.assertEqual(out[-1], "count: 3")
        self.assertEqual(sorted(out[:-1]), [
            "com.apple.Pages | 14.0 | 7032 | 14.0",
            "com.example.build |  | 12 | ",
            "com.rileytestut.Delta | 1.6 | 45 | ",
        ])

    def test_missing_folder(self):
        self.assertEqual(self.run_driver("appversions", os.path.join(self.tmp, "nope")), ["count: 0"])

    def test_skips_odd_entries(self):
        root = self.tree()
        app(root, "D4", "NoPlist.app")  # an app being installed: no Info.plist yet
        app(root, "E5", "BadId.app", plist(CFBundleIdentifier="bad id!", CFBundleShortVersionString="1"))
        app(root, "F6", "One.app", plist(CFBundleIdentifier="com.example.two", CFBundleShortVersionString="1"))
        app(root, "F6", "Two.app", plist(CFBundleIdentifier="com.example.two", CFBundleShortVersionString="2"))
        os.symlink(os.path.join(root, "A1"), os.path.join(root, "G7"))  # a linked container is not followed
        app(root, "H8", "Linked.app")
        os.symlink(os.path.join(root, "A1", "Delta.app", "Info.plist"), os.path.join(root, "H8", "Linked.app", "Info.plist"))
        box = app(root, "I9", "Real.app")
        os.symlink(os.path.join(root, "A1", "Delta.app"), os.path.join(box, "Fake.app"))  # one real .app, one link
        with open(os.path.join(box, "Real.app", "Info.plist"), "w") as f:
            f.write(plist(CFBundleIdentifier="com.example.real", CFBundleShortVersionString="3.0"))
        open(os.path.join(root, "stray-file"), "w").close()
        os.makedirs(os.path.join(root, ".hidden", "Hidden.app"))
        # A value with a tab or a newline would break the line format: printed empty instead.
        app(root, "J10", "Tab.app", plist(CFBundleIdentifier="com.example.tab", CFBundleShortVersionString="1\t2",
                                          CFBundleVersion="x" * 256))
        out = self.run_driver("appversions", root)
        self.assertEqual(out[-1], "count: 5", out)
        self.assertEqual(sorted(out[:-1]), [
            "com.apple.Pages | 14.0 | 7032 | 14.0",
            "com.example.build |  | 12 | ",
            "com.example.real | 3.0 |  | ",
            "com.example.tab |  |  | ",
            "com.rileytestut.Delta | 1.6 | 45 | ",
        ])

    def test_chain(self):
        """The whole chain: stand-in app spawns the helper, which prints the tree's apps and exits 0."""
        p = tempfile.mkdtemp(dir=self.tmp)
        os.makedirs(os.path.join(p, "Applications/iFizBox.app"))
        ifizbox = os.path.join(p, "Applications/iFizBox.app/iFizBox")
        shutil.copy(self.driver, ifizbox)
        apps = self.tree()
        helper = os.path.join(p, "ifizbox-helper")
        build(helper, ["main.c", "policy.c"], [f'-DIFIZBOX_PREFIX="{p}"', f"-DIFIZBOX_ROOT_UID={os.getuid()}",
                                               f'-DHELPER_APPS_DIR="{apps}"'])
        out = self.run_driver("spawn", helper, "app-versions", driver=ifizbox)
        self.assertEqual(out[-1], "exit: 0", out)
        self.assertIn("1: com.rileytestut.Delta\t1.6\t45\t", out)
        self.assertIn("1: com.apple.Pages\t14.0\t7032\t14.0", out)
        out = self.run_driver("spawn", helper, "app-versions", "--all", driver=ifizbox)
        self.assertEqual(out[-1], "exit: 64", out)
        # Unreadable folder: exit 74 with the reason.
        if os.getuid() != 0:
            os.chmod(apps, 0)
            try:
                out = self.run_driver("spawn", helper, "app-versions", driver=ifizbox)
            finally:
                os.chmod(apps, 0o755)
            self.assertEqual(out[-1], "exit: 74", out)
            self.assertTrue(any(l.startswith("2: ifizbox-helper: can't read the app containers folder") for l in out), out)


if __name__ == "__main__":
    unittest.main()
