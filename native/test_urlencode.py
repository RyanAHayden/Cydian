"""B149: URL strings from sources made ones URL(string:) takes before iOS 17 (a raw space in an AltStore iconURL).
native/tests/urlencode/main.swift is built with native/Sources/URLEncode.swift alone (Foundation only) by the Swift
toolchain, as native/test_updates.py builds Updates.swift; Apt.httpURL calling it is checked as text, since Apt.swift
needs the iOS SDK. Without a Swift toolchain the Swift part skips and says so."""
import os
import re
import shutil
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from test_sign import toolchain  # noqa: E402
import disktmp  # noqa: E402

SWIFTC = toolchain()


@unittest.skipUnless(SWIFTC, "no Swift toolchain (SWIFT_TOOLCHAIN or swiftc on PATH): native/Sources/URLEncode.swift not tested")
class SwiftURLEncode(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = disktmp.build_dir("ifizbox-urlencodetest-")  # off the shared /tmp tmpfs: see native/disktmp.py
        binary = os.path.join(cls.tmp, "urlencodetest")
        env = disktmp.swift_env(dict(os.environ), cls.tmp)
        shim = os.path.join(cls.tmp, "libshim")
        if os.path.exists("/usr/lib/libncursesw.so.6") and not os.path.exists("/usr/lib/libncurses.so.6"):
            os.makedirs(shim)
            os.symlink("/usr/lib/libncursesw.so.6", os.path.join(shim, "libncurses.so.6"))
            env["LD_LIBRARY_PATH"] = shim + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
        r = subprocess.run([SWIFTC, "-module-cache-path", os.path.join(cls.tmp, "modules"),
                            os.path.join(HERE, "Sources", "URLEncode.swift"),
                            os.path.join(HERE, "tests", "urlencode", "main.swift"),
                            "-o", binary], capture_output=True, text=True, env=env, timeout=600)
        cls.build_error = None if r.returncode == 0 else (r.stdout + r.stderr)[-4000:]
        cls.out = None if cls.build_error else subprocess.run([binary], capture_output=True, text=True, timeout=120)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_swift(self):
        self.assertIsNone(self.build_error, self.build_error)
        self.assertEqual(self.out.returncode, 0, self.out.stdout + self.out.stderr)
        self.assertIn("ok   raw space", self.out.stdout)
        self.assertIn("all passed", self.out.stdout)


class Wiring(unittest.TestCase):
    def test_http_url_encodes_first(self):
        with open(os.path.join(HERE, "Sources", "Apt.swift")) as f:
            src = f.read()
        body = re.search(r"static func httpURL\(_ v: Any\?\) -> URL\? \{(.*?)\n    \}", src, re.S)
        self.assertIsNotNone(body, "Apt.httpURL not found")
        self.assertIn("URLText.encoded(", body.group(1))


if __name__ == "__main__":
    unittest.main()
