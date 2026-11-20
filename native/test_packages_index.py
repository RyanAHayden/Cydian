"""net.packages' checks on a repo's answer (native/Sources/PackagesIndex.swift): Packages.bz2 unpacked by libbz2,
and a plain Packages that is really a web page with blank lines before its "<" (BigBoss's redirect) refused.
tests/packagesindex/main.swift is built with PackagesIndex.swift alone by the Swift toolchain and run on fixtures
written here with Python's bz2. Apt.swift (iOS SDK only) is checked as text for the wiring. Without a Swift
toolchain or the host's bzlib the Swift part skips and says so."""
import bz2
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
BZLIB = os.path.exists("/usr/include/bzlib.h")

INDEX = b"".join(
    b"Package: com.example.p%d\nVersion: 1.%d\nArchitecture: iphoneos-arm64\nFilename: debs/p%d.deb\n"
    b"Description: package %d <b>bold</b>\n\n" % (i, i, i, i) for i in range(200))


def fixtures(d):
    big = os.urandom(1 << 17).hex().encode() + INDEX  # ~400 KB, over the 64 KB chunk
    packed = bz2.compress(INDEX)
    files = {
        "Packages": INDEX,
        "Packages.bz2": packed,
        "multi.bz2": packed + bz2.compress(INDEX),
        "padded.bz2": packed + b"\0" * 64,
        "truncated.bz2": packed[: len(packed) // 2],
        "damaged.bz2": packed[:40] + bytes(b ^ 0xFF for b in packed[40:80]) + packed[80:],
        "big": big,
        "big.bz2": bz2.compress(big),
    }
    for name, data in files.items():
        with open(os.path.join(d, name), "wb") as f:
            f.write(data)


@unittest.skipUnless(SWIFTC and BZLIB, "no Swift toolchain (SWIFT_TOOLCHAIN or swiftc on PATH) or no "
                     "/usr/include/bzlib.h: native/Sources/PackagesIndex.swift not tested")
class SwiftPackagesIndex(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = disktmp.build_dir("ifizbox-packagesindex-")  # off the shared /tmp tmpfs: see native/disktmp.py
        binary = os.path.join(cls.tmp, "packagesindextest")
        data = os.path.join(cls.tmp, "fixtures")
        os.makedirs(data)
        fixtures(data)
        env = disktmp.swift_env(dict(os.environ), cls.tmp)
        shim = os.path.join(cls.tmp, "libshim")
        if os.path.exists("/usr/lib/libncursesw.so.6") and not os.path.exists("/usr/lib/libncurses.so.6"):
            os.makedirs(shim)
            os.symlink("/usr/lib/libncursesw.so.6", os.path.join(shim, "libncurses.so.6"))
            env["LD_LIBRARY_PATH"] = shim + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
        r = subprocess.run([SWIFTC, "-module-cache-path", os.path.join(cls.tmp, "modules"),
                            "-import-objc-header", os.path.join(HERE, "tests", "packagesindex", "bridge.h"),
                            os.path.join(HERE, "Sources", "PackagesIndex.swift"),
                            os.path.join(HERE, "tests", "packagesindex", "main.swift"),
                            "-lbz2", "-o", binary], capture_output=True, text=True, env=env, timeout=600)
        cls.build_error = None if r.returncode == 0 else (r.stdout + r.stderr)[-4000:]
        cls.out = None if cls.build_error else subprocess.run([binary, data], capture_output=True, text=True,
                                                              timeout=120)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_swift(self):
        self.assertIsNone(self.build_error, self.build_error)
        self.assertEqual(self.out.returncode, 0, self.out.stdout + self.out.stderr)
        self.assertIn("ok   html after blank lines", self.out.stdout)
        self.assertIn("ok   concatenated streams", self.out.stdout)
        self.assertIn("all passed", self.out.stdout)


class Wiring(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(HERE, "Sources", "Apt.swift")) as f:
            self.apt = f.read()

    def test_net_packages_tries_bz2(self):
        m = re.search(r'b\.on\("net\.packages"\).*?packages\(dir, \[(.*?)\]\)', self.apt, re.S)
        self.assertIsNotNone(m, "net.packages' name list not found")
        self.assertEqual(re.findall(r'"([^"]+)"', m.group(1)),
                         ["Packages.xz", "Packages.bz2", "Packages.gz", "Packages"])

    def test_decompress_uses_the_checks(self):
        body = re.search(r"static func decompress\(.*?\n    \}", self.apt, re.S).group(0)
        self.assertIn("PackagesIndex.bunzip2(", body)
        self.assertIn("PackagesIndex.looksLikeHTML(", body)
        self.assertNotIn('data.first == UInt8(ascii: "<")', body)

    def test_app_links_libbz2(self):
        with open(os.path.join(HERE, "Sources", "iFizBox-Bridging-Header.h")) as f:
            self.assertIn("#include <bzlib.h>", f.read())
        with open(os.path.join(HERE, "build.sh")) as f:
            self.assertRegex(f.read(), r"-lz -lbz2\b")


if __name__ == "__main__":
    unittest.main()
