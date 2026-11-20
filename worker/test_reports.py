"""F291: Report as Malicious (src/reports.js), tested in Node (test-reports.mjs) like worker/test.mjs."""
import pathlib
import shutil
import subprocess
import unittest

HERE = pathlib.Path(__file__).resolve().parent


class ReportsTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_reports(self):
        r = subprocess.run(["node", str(HERE / "test-reports.mjs")], capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("worker reports: ok", r.stdout)


if __name__ == "__main__":
    unittest.main()
