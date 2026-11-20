"""tools/gate_unittest.py: the gate's per-directory test runner writes down every skip with its reason."""
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
RUNNER = os.path.join(HERE, "gate_unittest.py")


class GateUnittestTest(unittest.TestCase):
    def run_dir(self, source):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "test_sample.py"), "w", encoding="utf-8") as f:
                f.write(source)
            skips = os.path.join(d, "skips.txt")
            p = subprocess.run([sys.executable, RUNNER, d, skips], capture_output=True, text=True)
            lines = open(skips, encoding="utf-8").read().splitlines() if os.path.exists(skips) else []
            return p.returncode, lines, d

    def test_skip_is_listed_with_reason_and_passes(self):
        rc, lines, d = self.run_dir(
            "import unittest\n"
            "class T(unittest.TestCase):\n"
            "    def test_ok(self): pass\n"
            "    @unittest.skip('no cryptography\\n  here')\n"
            "    def test_signer(self): pass\n"
        )
        self.assertEqual(rc, 0)
        self.assertEqual(lines, [f"{d}: test_sample.T.test_signer: no cryptography here"])

    def test_class_level_skip(self):
        rc, lines, _ = self.run_dir(
            "import unittest\n"
            "class T(unittest.TestCase):\n"
            "    @classmethod\n"
            "    def setUpClass(cls): raise unittest.SkipTest('no toolchain')\n"
            "    def test_built(self): pass\n"
        )
        self.assertEqual(rc, 0)
        self.assertEqual(len(lines), 1)
        self.assertTrue(lines[0].endswith(": no toolchain"), lines)

    def test_failure_fails_and_nothing_skipped(self):
        rc, lines, _ = self.run_dir(
            "import unittest\n"
            "class T(unittest.TestCase):\n"
            "    def test_bad(self): self.fail('x')\n"
        )
        self.assertEqual(rc, 1)
        self.assertEqual(lines, [])


if __name__ == "__main__":
    unittest.main()
