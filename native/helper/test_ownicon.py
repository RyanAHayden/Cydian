"""F329: ifizbox-helper own-icon <a|b> <dir> (ownicon.h): copies the app's picture over one own-icon set's two PNGs,
only those files, only PNGs, and refuses bad slots and folders, symlinks, missing files and other callers."""
import os
import shutil
import subprocess
import sys
import time
import unittest
from unittest import mock

from test_helper import CC, HERE, build

sys.path.insert(0, os.path.dirname(HERE))
import disktmp  # noqa: E402

sys.path.insert(0, os.path.join(os.path.dirname(HERE), "icon"))
import alternates  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n"


class Names(unittest.TestCase):
    def test_slots_and_files_match_alternates(self):
        with open(os.path.join(HERE, "ownicon.h")) as f:
            c = f.read()
        self.assertEqual(alternates.OWN_SLOTS, ("a", "b"))
        self.assertIn('"%s/IconOwn%c60x60%s.png"', c)
        self.assertEqual(alternates.own_stem("a"), "IconOwnA60x60")
        self.assertEqual(alternates.own_set("b"), "Icon-ownb")


@unittest.skipUnless(CC, "no C compiler on this machine")
class OwnIcon(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = disktmp.build_dir("ifizbox-ownicontest-")
        cls.addClassCleanup(shutil.rmtree, cls.tmp, True)
        p = cls.tmp
        cls.app = os.path.join(p, "Applications/iFizBox.app")
        os.makedirs(cls.app)
        cls.ifizbox = os.path.join(cls.app, "iFizBox")
        cls.helper = os.path.join(p, "ifizbox-helper")
        cls.src = os.path.join(p, "container", "Apply")
        with mock.patch.dict(os.environ, disktmp.swift_env({}, p)):
            build(cls.ifizbox, ["test_driver.c", "policy.c", "spawn.c"])
            build(cls.helper, ["main.c", "policy.c"], [f'-DIFIZBOX_PREFIX="{p}"', f"-DIFIZBOX_ROOT_UID={os.getuid()}"])

    def setUp(self):
        shutil.rmtree(self.src, True)
        os.makedirs(self.src)
        for slot in "AB":
            for s in ("@2x", "@3x"):
                self.write(os.path.join(self.app, "IconOwn%s60x60%s.png" % (slot, s)), PNG + b"primary")
        for s in ("@2x", "@3x"):
            self.write(os.path.join(self.src, "IconOwn60x60%s.png" % s), PNG + b"mine " + s.encode())

    def write(self, path, data):
        with open(path, "wb") as f:
            f.write(data)

    def get(self, name):
        with open(os.path.join(self.app, name), "rb") as f:
            return f.read()

    def spawn(self, *words):
        r = subprocess.run([self.ifizbox, "spawn", self.helper, *words], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout.splitlines()

    def test_copies_into_the_slot(self):
        out = self.spawn("own-icon", "b", self.src)
        self.assertEqual(out[-1], "exit: 0", out)
        for s in ("@2x", "@3x"):
            self.assertEqual(self.get("IconOwnB60x60%s.png" % s), PNG + b"mine " + s.encode())
            self.assertEqual(self.get("IconOwnA60x60%s.png" % s), PNG + b"primary")  # the other slot stays
            self.assertEqual(os.stat(os.path.join(self.app, "IconOwnB60x60%s.png" % s)).st_mode & 0o777, 0o644)
        self.assertFalse([f for f in os.listdir(self.app) if f.endswith(".launch-theme")])  # no temp files left

    def test_not_a_png_changes_nothing(self):
        self.write(os.path.join(self.src, "IconOwn60x60@3x.png"), b"<html>")
        out = self.spawn("own-icon", "a", self.src)
        self.assertEqual(out[-1], "exit: 74", out)
        self.assertEqual(self.get("IconOwnA60x60@2x.png"), PNG + b"primary")

    def test_missing_file_changes_nothing(self):
        os.unlink(os.path.join(self.src, "IconOwn60x60@3x.png"))
        out = self.spawn("own-icon", "a", self.src)
        self.assertEqual(out[-1], "exit: 74", out)
        self.assertEqual(self.get("IconOwnA60x60@2x.png"), PNG + b"primary")

    def test_symlink_refused(self):
        src = os.path.join(self.src, "IconOwn60x60@2x.png")
        os.unlink(src)
        os.symlink(self.ifizbox, src)
        out = self.spawn("own-icon", "a", self.src)
        self.assertEqual(out[-1], "exit: 74", out)
        self.assertEqual(self.get("IconOwnA60x60@2x.png"), PNG + b"primary")

    def test_bad_words_refused(self):
        for words in (["own-icon"], ["own-icon", "a"], ["own-icon", "c", self.src], ["own-icon", "A", self.src],
                      ["own-icon", "a", "relative/dir"], ["own-icon", "a", self.src + "/../x"],
                      ["own-icon", "a", self.src, "x"]):
            out = self.spawn(*words)
            self.assertEqual(out[-1], "exit: 64", (words, out))

    def test_refresh_starts_uicache_for_the_app_and_does_not_wait(self):
        bin_dir = os.path.join(self.tmp, "usr", "bin")
        os.makedirs(bin_dir, exist_ok=True)
        log, go = os.path.join(self.tmp, "uicache.log"), os.path.join(self.tmp, "uicache.go")
        for p in (log, go):
            if os.path.exists(p):
                os.unlink(p)
        fake = os.path.join(bin_dir, "uicache")
        # uicache waits until the test says go: the helper must have returned before that, or spawn() never ends
        with open(fake, "w") as f:
            f.write('#!/bin/sh\nn=0\nwhile [ ! -e "%s" ] && [ $n -lt 600 ]; do sleep 0.05; n=$((n+1)); done\n'
                    'echo "$@" > "%s"\n' % (go, log))
        os.chmod(fake, 0o755)
        self.addCleanup(os.unlink, fake)
        out = self.spawn("own-icon-refresh")
        self.assertEqual(out[-1], "exit: 0", out)
        self.assertFalse(os.path.exists(log))
        open(go, "w").close()
        deadline = time.monotonic() + 30
        while not os.path.exists(log) and time.monotonic() < deadline:
            time.sleep(0.05)
        time.sleep(0.1)
        with open(log) as f:
            self.assertEqual(f.read().split(), ["-p", self.app])
        self.assertEqual(self.spawn("own-icon-refresh", "x")[-1], "exit: 64")

    def test_refresh_without_uicache(self):
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "usr", "bin", "uicache")))
        self.assertEqual(self.spawn("own-icon-refresh")[-1], "exit: 126")

    def test_other_callers_refused(self):
        r = subprocess.run([self.helper, "own-icon", "a", self.src], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 77, r.stderr)
        self.assertEqual(self.get("IconOwnA60x60@2x.png"), PNG + b"primary")


if __name__ == "__main__":
    unittest.main()
