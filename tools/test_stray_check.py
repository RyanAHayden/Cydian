"""T47: tools/release.sh and tools/setup/release.sh refuse to release while web/app/ holds files git doesn't track
(untracked or ignored, like a leftover web/app/dl/*.ipa), because the builds bundle web/app/ as it is on disk.
Each test checks a throwaway git checkout (IFIZBOX_STRAY_ROOT); nothing builds, nothing touches the network."""
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECK = os.path.join(ROOT, "tools", "stray-check.sh")
RELEASE = os.path.join(ROOT, "tools", "release.sh")
SETUP_RELEASE = os.path.join(ROOT, "tools", "setup", "release.sh")


@unittest.skipUnless(shutil.which("git"), "no git")
class StrayCheck(unittest.TestCase):
    def setUp(self):
        self.tree = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tree)
        self.git("init", "-q")
        self.write(".gitignore", "*.ipa\n__pycache__/\nweb/app/build.json\n")
        self.write("web/app/index.html", "<p>hi</p>\n")
        self.git("add", "-A")
        self.git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "init")

    def git(self, *args):
        subprocess.run(["git", "-C", self.tree, *args], check=True, capture_output=True)

    def write(self, rel, text):
        path = os.path.join(self.tree, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(text)

    def run_(self, cmd):
        env = dict(os.environ, IFIZBOX_STRAY_ROOT=self.tree)
        return subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, text=True, timeout=60)

    def test_clean_passes(self):
        r = self.run_([CHECK, self.tree])
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_tool_outputs_tolerated(self):
        self.write("web/app/icons/__pycache__/test_icons.cpython-314.pyc", "x")
        self.write("web/app/build.json", "{}")
        r = self.run_([CHECK, self.tree])
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_ignored_file_refused(self):
        self.write("web/app/dl/Cydian.ipa", "x")
        r = self.run_([CHECK, self.tree])
        self.assertEqual(r.returncode, 1)
        self.assertIn("web/app/dl/Cydian.ipa", r.stderr)

    def test_untracked_file_refused(self):
        self.write("web/app/new.js", "x")
        r = self.run_([CHECK, self.tree])
        self.assertEqual(r.returncode, 1)
        self.assertIn("web/app/new.js", r.stderr)

    def test_outside_web_app_ignored(self):
        self.write("native/build/iFizBox.ipa", "x")
        self.write("notes.txt", "x")
        r = self.run_([CHECK, self.tree])
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_release_dry_run_refuses(self):
        """release.sh stops before building or reading --dist."""
        self.write("web/app/dl/Cydian.ipa", "x")
        r = self.run_([RELEASE, "--dry-run", "--dist", os.path.join(self.tree, "nodist")])
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("web/app/dl/Cydian.ipa", r.stderr)
        self.assertIn("not releasing", r.stderr)
        self.assertNotIn("nodist", r.stderr)

    def test_setup_release_dry_run_refuses(self):
        """setup/release.sh stops before any cargo build."""
        self.write("web/app/dl/Cydian.ipa", "x")
        out = os.path.join(self.tree, "out")
        r = self.run_([SETUP_RELEASE, "--dry-run", "--out", out])
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("web/app/dl/Cydian.ipa", r.stderr)
        self.assertIn("not releasing", r.stderr)
        self.assertNotIn("building", r.stderr)
        self.assertFalse(os.path.exists(out))


if __name__ == "__main__":
    unittest.main()
