"""tools/check.sh runs the whole gate with TMPDIR in a disk folder of its own, off the shared /tmp tmpfs.

Inside the gate (IFIZBOX_GATE_TMPDIR set by check.sh) every temp file a test makes must land in that folder: Python's
tempfile, mktemp and node all follow it. Outside the gate only check.sh's own wiring is checked. Stdlib only.
"""
import os
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
GATE_TMP = os.environ.get("IFIZBOX_GATE_TMPDIR")


class GateTmpdir(unittest.TestCase):
    def test_check_sh_exports_tmpdir_before_anything_runs(self):
        # Code lines only: the comments name these commands too.
        code = [l for l in (ROOT / "tools/check.sh").read_text(encoding="utf-8").splitlines()
                if not l.lstrip().startswith("#")]

        def line_of(text):
            return next(i for i, l in enumerate(code) if text in l)

        export = line_of("export TMPDIR=")
        for first in ("skips=$(mktemp)", "test_sizeguard.py", "native/build.sh", "gate_unittest.py", "node --test"):
            self.assertLess(export, line_of(first), f"TMPDIR must be exported before {first}")

    @unittest.skipUnless(GATE_TMP, "only inside tools/check.sh")
    def test_temp_files_land_in_the_gate_folder(self):
        self.assertEqual(os.environ.get("TMPDIR"), GATE_TMP)
        self.assertTrue(os.path.isdir(GATE_TMP))
        self.assertFalse(os.path.realpath(GATE_TMP).startswith("/tmp/"), GATE_TMP)
        self.assertEqual(os.path.realpath(tempfile.gettempdir()), os.path.realpath(GATE_TMP))
        made = subprocess.run(["mktemp"], capture_output=True, text=True, check=True).stdout.strip()
        try:
            self.assertEqual(os.path.dirname(os.path.realpath(made)), os.path.realpath(GATE_TMP))
        finally:
            os.unlink(made)
        node = subprocess.run(["node", "-p", "require('os').tmpdir()"], capture_output=True, text=True)
        if node.returncode == 0:
            self.assertEqual(os.path.realpath(node.stdout.strip()), os.path.realpath(GATE_TMP))


if __name__ == "__main__":
    unittest.main()
