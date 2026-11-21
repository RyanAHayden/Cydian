"""tools/concept/shell.js: the in-memory IndexedDB the phone falls back to in an opaque origin (a sandboxed frame,
iPhone Safari's data: tab) keeps web/app's stores working: tools/concept/idb.test.mjs under node. (The fallback
in a sandboxed browser frame: tools/concept/check.mjs's sandboxed pass.)"""
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
NODE = shutil.which("node")


class MemoryIndexedDB(unittest.TestCase):
    @unittest.skipUnless(NODE, "needs node")
    def test_web_app_stores_on_the_stand_in(self):
        r = subprocess.run([NODE, str(HERE / "idb.test.mjs")], capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("all ok", r.stdout)


if __name__ == "__main__":
    unittest.main()
