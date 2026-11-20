"""B203: ifizbox-helper launch-theme <key> (launch.h): copies the app's LaunchThemes/<key>/ launch files over its own,
only those files, only from there, and refuses bad keys, missing themes, symlinks and other callers."""
import os
import re
import shutil
import subprocess
import sys
import unittest
from unittest import mock

from test_helper import CC, HERE, build

sys.path.insert(0, os.path.dirname(HERE))
import disktmp  # noqa: E402
import launch_check  # noqa: E402


def c_files():
    with open(os.path.join(HERE, "launch.h")) as f:
        block = re.search(r"helper_launch_files\[\] = \{(.*?)NULL\};", f.read(), re.S).group(1)
    # HELPER_LAUNCH_STORYBOARD "/x.nib" is "LaunchScreen.storyboardc/x.nib"
    return [("LaunchScreen.storyboardc" + s) if s.startswith("/") else s for s in re.findall(r'"([^"]+)"', block)]


class Files(unittest.TestCase):
    def test_list_is_every_launch_image_and_the_view_nib(self):
        want = ["%s%s.png" % (i, s) for i in launch_check.IMAGES for s in ("@2x", "@3x")]
        want.append("LaunchScreen.storyboardc/" + launch_check.VIEW_NIB)
        self.assertEqual(sorted(c_files()), sorted(want))


@unittest.skipUnless(CC, "no C compiler on this machine")
class LaunchTheme(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Off the shared /tmp tmpfs, as test_udid.py (native/disktmp.py).
        cls.tmp = disktmp.build_dir("ifizbox-launchtest-")
        cls.addClassCleanup(shutil.rmtree, cls.tmp, True)
        p = cls.tmp
        cls.app = os.path.join(p, "Applications/iFizBox.app")
        os.makedirs(cls.app)
        cls.ifizbox = os.path.join(cls.app, "iFizBox")
        cls.helper = os.path.join(p, "ifizbox-helper")
        with mock.patch.dict(os.environ, disktmp.swift_env({}, p)):
            build(cls.ifizbox, ["test_driver.c", "policy.c", "spawn.c"])
            build(cls.helper, ["main.c", "policy.c"], [f'-DIFIZBOX_PREFIX="{p}"', f"-DIFIZBOX_ROOT_UID={os.getuid()}"])

    def setUp(self):
        self.files = ["%s%s.png" % (i, s) for i in launch_check.IMAGES for s in ("@2x", "@3x")]
        self.files.append("LaunchScreen.storyboardc/" + launch_check.VIEW_NIB)
        for d in ("LaunchThemes", "LaunchScreen.storyboardc"):
            shutil.rmtree(os.path.join(self.app, d), True)
        os.makedirs(os.path.join(self.app, "LaunchScreen.storyboardc"))
        for f in self.files:
            self.put(f, b"classic " + f.encode())
            self.put("LaunchThemes/gunmetal/" + f, b"gunmetal " + f.encode())
        self.put("LaunchScreen.storyboardc/Info.plist", b"plist")
        self.put("LaunchThemes/gunmetal/LaunchScreen.storyboardc/Info.plist", b"other plist")

    def put(self, rel, data):
        path = os.path.join(self.app, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)

    def get(self, rel):
        with open(os.path.join(self.app, rel), "rb") as f:
            return f.read()

    def spawn(self, *words):
        r = subprocess.run([self.ifizbox, "spawn", self.helper, *words], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout.splitlines()

    def test_copies_the_theme(self):
        out = self.spawn("launch-theme", "gunmetal")
        self.assertEqual(out[-1], "exit: 0", out)
        for f in self.files:
            self.assertEqual(self.get(f), b"gunmetal " + f.encode(), f)
            self.assertEqual(os.stat(os.path.join(self.app, f)).st_mode & 0o777, 0o644, f)
        self.assertEqual(self.get("LaunchScreen.storyboardc/Info.plist"), b"plist")  # not on the list
        self.assertEqual(sorted(os.listdir(os.path.join(self.app, "LaunchScreen.storyboardc"))),
                         sorted(["Info.plist", launch_check.VIEW_NIB]))  # no temp files left

    def test_missing_file_changes_nothing(self):
        os.unlink(os.path.join(self.app, "LaunchThemes/gunmetal/LaunchTabShadow@3x.png"))
        out = self.spawn("launch-theme", "gunmetal")
        self.assertEqual(out[-1], "exit: 74", out)
        for f in self.files:
            self.assertEqual(self.get(f), b"classic " + f.encode(), f)

    def test_symlink_refused(self):
        src = os.path.join(self.app, "LaunchThemes/gunmetal/LaunchStripes@2x.png")
        os.unlink(src)
        os.symlink(os.path.join(self.app, "iFizBox"), src)
        out = self.spawn("launch-theme", "gunmetal")
        self.assertEqual(out[-1], "exit: 74", out)
        self.assertEqual(self.get("LaunchStripes@2x.png"), b"classic LaunchStripes@2x.png")

    def test_bad_keys_refused(self):
        for words in (["launch-theme"], ["launch-theme", "../x"], ["launch-theme", "Gunmetal"],
                      ["launch-theme", "a" * 33], ["launch-theme", ""], ["launch-theme", "gunmetal", "x"]):
            out = self.spawn(*words)
            self.assertEqual(out[-1], "exit: 64", (words, out))

    def test_unknown_theme(self):
        out = self.spawn("launch-theme", "nosuch")
        self.assertEqual(out[-1], "exit: 74", out)

    def test_other_callers_refused(self):
        r = subprocess.run([self.helper, "launch-theme", "gunmetal"], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 77, r.stderr)
        self.assertEqual(self.get("LaunchStripes@2x.png"), b"classic LaunchStripes@2x.png")


if __name__ == "__main__":
    unittest.main()
