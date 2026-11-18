"""I2: the app's mode check (Sources/mode.c), compiled for this Linux machine and run against a fake helper.
Jailbreak only when the helper is an executable regular file; missing, not executable or a directory is sideload."""
import os
import shutil
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
DRIVER = r"""
#include <stdio.h>
int ifizbox_mode_at(const char *helper);
int ifizbox_mode(void);
int main(int argc, char **argv) {
  printf("%d\n", argc > 1 ? ifizbox_mode_at(argv[1]) : ifizbox_mode());
  return 0;
}
"""


class Mode(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cc = shutil.which("cc") or shutil.which("clang") or shutil.which("gcc")
        if not cc:
            raise unittest.SkipTest("no C compiler")
        cls.tmp = tempfile.mkdtemp()
        drv = os.path.join(cls.tmp, "driver.c")
        with open(drv, "w") as f:
            f.write(DRIVER)
        cls.exe = os.path.join(cls.tmp, "mode")
        subprocess.run([cc, "-Wall", "-Werror", "-o", cls.exe, drv, os.path.join(HERE, "Sources/mode.c")], check=True)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def mode(self, *path):
        out = subprocess.run([self.exe, *path], check=True, capture_output=True, text=True).stdout.strip()
        return {"0": "sideload", "1": "jailbreak"}[out]

    def helper(self, mode=0o755, directory=False):
        p = os.path.join(tempfile.mkdtemp(dir=self.tmp), "var/jb/usr/libexec/ifizbox/ifizbox-helper")
        if directory:
            os.makedirs(p)
        else:
            os.makedirs(os.path.dirname(p))
            with open(p, "w") as f:
                f.write("#!/bin/sh\n")
        os.chmod(p, mode)
        return p

    def test_no_helper_is_sideload(self):
        self.assertEqual(self.mode(os.path.join(self.tmp, "nope/ifizbox-helper")), "sideload")

    def test_fake_helper_is_jailbreak(self):
        self.assertEqual(self.mode(self.helper()), "jailbreak")

    def test_helper_not_executable_is_sideload(self):
        self.assertEqual(self.mode(self.helper(0o644)), "sideload")

    def test_helper_directory_is_sideload(self):
        self.assertEqual(self.mode(self.helper(directory=True)), "sideload")

    def test_default_path_is_the_rootless_helper(self):
        with open(os.path.join(HERE, "Sources/mode.c")) as f:
            self.assertIn('"/var/jb/usr/libexec/ifizbox/ifizbox-helper"', f.read())
        if not os.path.exists("/var/jb/usr/libexec/ifizbox/ifizbox-helper"):
            self.assertEqual(self.mode(), "sideload")


if __name__ == "__main__":
    unittest.main()
