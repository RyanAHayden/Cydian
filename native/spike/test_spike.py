"""R3 spike: the web modules parse, the list maths holds, Info.plist is valid. The IPA build itself needs the Swift
toolchain and iOS SDK (build.sh), which the gate machine may not have, so it isn't run here."""
import os
import plistlib
import shutil
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "web")
NODE = shutil.which("node")


@unittest.skipUnless(NODE, "node not installed")
class SpikeWeb(unittest.TestCase):
    def test_modules_parse(self):
        with tempfile.TemporaryDirectory() as tmp:
            for name in sorted(os.listdir(WEB)):
                if name.endswith(".js"):
                    dst = os.path.join(tmp, name[:-3] + ".mjs")
                    shutil.copy(os.path.join(WEB, name), dst)
                    r = subprocess.run([NODE, "--check", dst], capture_output=True, text=True)
                    self.assertEqual(r.returncode, 0, f"{name}: {r.stderr}")

    def test_visible_range(self):
        src = (
            "import { visibleRange, rowData } from %r;"
            "const out = [visibleRange(0, 844, 30000), visibleRange(44 * 29990, 844, 30000),"
            " visibleRange(440, 88, 5), rowData(3, 7).name];"
            "console.log(JSON.stringify(out));" % ("file://" + os.path.join(WEB, "list.js"))
        )
        r = subprocess.run([NODE, "--input-type=module", "-e", src], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip(), '[[0,28],[29982,30000],[2,5],"package-3-7"]')


class SpikePlist(unittest.TestCase):
    def test_info_plist(self):
        with open(os.path.join(HERE, "Info.plist"), "rb") as f:
            p = plistlib.load(f)
        self.assertTrue(p["CADisableMinimumFrameDurationOnPhone"])
        self.assertIn("UIApplicationSceneManifest", p)  # iOS 27 refuses apps without the scene lifecycle


if __name__ == "__main__":
    unittest.main()
