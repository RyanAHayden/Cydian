"""tools/selfrepo.py: the Release file of Cydian's own APT repo carries what apt, Cydian and Sileo each need (N11)."""
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "native"))
import mkdeb  # noqa: E402
import selfrepo  # noqa: E402


def release_fields(text):
    """Release's top-level fields, lower-cased names as Sileo's ControlFileParser keys them."""
    out = {}
    for line in text.splitlines():
        if line and not line[0].isspace() and ":" in line:
            k, _, v = line.partition(":")
            out[k.strip().lower()] = v.strip()
    return out


class SelfRepo(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        root, debian = os.path.join(self.tmp, "root"), os.path.join(self.tmp, "DEBIAN")
        os.makedirs(os.path.join(root, "var/jb"))
        os.makedirs(debian)
        with open(os.path.join(debian, "control"), "w") as f:
            f.write("Package: com.ryha.cydian\nVersion: 0.3.8-1\nArchitecture: iphoneos-arm64\n"
                    "Maintainer: x\nDescription: test\n")
        self.deb = os.path.join(self.tmp, "com.ryha.cydian_0.3.8-1_iphoneos-arm64.deb")
        mkdeb.build(root, debian, self.deb, mtime=0)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_release_has_what_sileo_needs(self):
        """Sileo 2.5 refuses a Release without Architectures naming the phone's arch or without Components (the
        iPhone 7's Add to Sileo said "Could not parse release file" until Components was there)."""
        text = selfrepo.build(os.path.join(self.tmp, "out"), [self.deb], date="Wed, 18 Nov 2026 09:00:00 GMT")
        f = release_fields(text)
        self.assertIn("components", f)
        self.assertEqual(f["components"], "main")
        self.assertIn("iphoneos-arm64", f["architectures"].split())
        for k in ("origin", "label", "suite", "codename", "date", "md5sum", "sha256"):
            self.assertIn(k, f)

    def test_release_lists_packages_with_hashes(self):
        import hashlib
        out = os.path.join(self.tmp, "out")
        text = selfrepo.build(out, [self.deb])
        with open(os.path.join(out, "Packages"), "rb") as fh:
            packages = fh.read()
        self.assertIn(" %s %d Packages\n" % (hashlib.sha256(packages).hexdigest(), len(packages)), text)
        self.assertIn(b"Filename: com.ryha.cydian_0.3.8-1_iphoneos-arm64.deb\n", packages)


if __name__ == "__main__":
    unittest.main()
