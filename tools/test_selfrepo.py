"""tools/selfrepo.py: the Release file of iFizBox's own APT repo carries what apt, iFizBox and Sileo each need (N11)."""
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
            f.write("Package: com.ryha.ifizbox\nVersion: 0.3.8-1\nArchitecture: iphoneos-arm64\n"
                    "Maintainer: x\nDescription: test\n")
        self.deb = os.path.join(self.tmp, "com.ryha.ifizbox_0.3.8-1_iphoneos-arm64.deb")
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
        self.assertIn(b"Filename: com.ryha.ifizbox_0.3.8-1_iphoneos-arm64.deb\n", packages)

    # ---- B73: every published release, each .deb under its own tag ----

    def make_deb(self, version, where):
        root, debian = os.path.join(self.tmp, "r" + version), os.path.join(self.tmp, "d" + version)
        os.makedirs(os.path.join(root, "var/jb"))
        os.makedirs(debian)
        with open(os.path.join(debian, "control"), "w") as f:
            f.write("Package: com.ryha.ifizbox\nVersion: %s\nArchitecture: iphoneos-arm64\nMaintainer: x\n"
                    "Description: test\n" % version)
        os.makedirs(where, exist_ok=True)
        deb = os.path.join(where, "com.ryha.ifizbox_%s_iphoneos-arm64.deb" % version)
        mkdeb.build(root, debian, deb, mtime=0)
        return deb

    def stanzas(self, out):
        with open(os.path.join(out, "Packages")) as fh:
            return [dict(l.split(": ", 1) for l in s if not l[0].isspace()) for s in selfrepo.split_stanzas(fh.read())]

    def test_two_releases(self):
        """The previous release's Packages asset (bare Filename, as releases before B73 wrote it, with its own minimum)
        gives its stanza under its tag; this release's .deb sits under this tag; both versions are listed."""
        hist = os.path.join(self.tmp, "hist")
        old_out = os.path.join(self.tmp, "old")
        old = self.make_deb("0.3.7-1", os.path.join(self.tmp, "olddebs"))
        selfrepo.build(old_out, [old], minimum="0.3.0")
        os.makedirs(os.path.join(hist, "v0.3.7"))
        os.rename(os.path.join(old_out, "Packages"), os.path.join(hist, "v0.3.7", "Packages"))
        out = os.path.join(self.tmp, "out")
        selfrepo.build(out, [self.deb], tag="v0.3.8", history=hist, minimum="0.3.8")
        got = self.stanzas(out)
        self.assertEqual([s["Version"] for s in got], ["0.3.8-1", "0.3.7-1"])
        self.assertEqual(got[0]["Filename"], "v0.3.8/com.ryha.ifizbox_0.3.8-1_iphoneos-arm64.deb")
        self.assertEqual(got[1]["Filename"], "v0.3.7/com.ryha.ifizbox_0.3.7-1_iphoneos-arm64.deb")
        self.assertEqual(got[0][selfrepo.MIN_FIELD], "0.3.8")
        self.assertNotIn(selfrepo.MIN_FIELD, got[1])  # the newest release's minimum only
        import hashlib
        with open(old, "rb") as fh:
            self.assertEqual(got[1]["SHA256"], hashlib.sha256(fh.read()).hexdigest())
        # The next release reads this one's Packages: only its own stanza (under v0.3.8/), never v0.3.7's twice.
        os.makedirs(os.path.join(hist, "v0.3.8"))
        os.rename(os.path.join(out, "Packages"), os.path.join(hist, "v0.3.8", "Packages"))
        new = self.make_deb("0.3.9-1", os.path.join(self.tmp, "newdebs"))
        out2 = os.path.join(self.tmp, "out2")
        selfrepo.build(out2, [new], tag="v0.3.9", history=hist)
        self.assertEqual([(s["Version"], s["Filename"].split("/")[0]) for s in self.stanzas(out2)],
                         [("0.3.9-1", "v0.3.9"), ("0.3.8-1", "v0.3.8"), ("0.3.7-1", "v0.3.7")])

    def test_history_debs_and_cap(self):
        """A release without a Packages asset gives its Debian-named .debs; only the newest KEEP releases in all."""
        hist = os.path.join(self.tmp, "hist")
        self.make_deb("0.1.0-5", os.path.join(hist, "v0.1.0"))
        with open(os.path.join(hist, "v0.1.0", "iFizBox.deb"), "wb") as fh:  # the fixed name is never listed
            fh.write(b"x")
        os.makedirs(os.path.join(hist, "nightly"))  # not a vX.Y.Z tag
        os.makedirs(os.path.join(hist, "v0.0.9"))  # a release before the rename: another package ID, left out
        with open(os.path.join(hist, "v0.0.9", "Packages"), "w") as fh:
            fh.write("Package: com.example.oldname\nVersion: 0.0.9-1\nArchitecture: iphoneos-arm64\n"
                     "Filename: com.example.oldname_0.0.9-1_iphoneos-arm64.deb\n")
        out = os.path.join(self.tmp, "out")
        selfrepo.build(out, [self.deb], tag="v0.3.8", history=hist)
        self.assertEqual([s["Filename"] for s in self.stanzas(out)],
                         ["v0.3.8/com.ryha.ifizbox_0.3.8-1_iphoneos-arm64.deb",
                          "v0.1.0/com.ryha.ifizbox_0.1.0-5_iphoneos-arm64.deb"])
        for i in range(selfrepo.KEEP + 3):
            d = os.path.join(hist, "v0.2.%d" % i)
            os.makedirs(d)
            with open(os.path.join(d, "Packages"), "w") as fh:
                fh.write("Package: com.ryha.ifizbox\nVersion: 0.2.%d-1\nArchitecture: iphoneos-arm64\n"
                         "Filename: com.ryha.ifizbox_0.2.%d-1_iphoneos-arm64.deb\n" % (i, i))
        selfrepo.build(out, [self.deb], tag="v0.3.8", history=hist)
        got = [s["Version"] for s in self.stanzas(out)]
        self.assertEqual(len(got), selfrepo.KEEP)
        self.assertEqual(got[:3], ["0.3.8-1", "0.2.22-1", "0.2.21-1"])  # by version, not by name (0.2.9 < 0.2.22)

    def test_pick_releases(self):
        rel = lambda tag, names, **kw: {"tag_name": tag, "assets": [{"name": n} for n in names], **kw}
        picked = selfrepo.pick_releases([
            rel("v0.9.8", ["Packages", "com.ryha.ifizbox_0.9.8-1_iphoneos-arm64.deb"]),
            rel("v0.9.10", ["Packages"]),
            rel("v0.9.9", ["Packages"], draft=True),
            rel("v0.9.7", ["Packages"], prerelease=True),
            rel("v0.1.1", ["iFizBox.deb", "iFizBox.ipa"]),
            rel("v0.1.2", ["iFizBox.deb", "com.ryha.ifizbox_0.1.2-3_iphoneos-arm64.deb"]),
            rel("test", ["Packages"]),
        ], skip="v0.9.10")
        self.assertEqual(picked, [("v0.9.8", ["Packages"]), ("v0.1.2", ["com.ryha.ifizbox_0.1.2-3_iphoneos-arm64.deb"])])

    def test_fetch_downloads_with_gh(self):
        import json
        import subprocess
        calls = []

        def run(cmd, **kw):
            calls.append(cmd)
            if cmd[:2] == ["gh", "api"]:
                pages = [[{"tag_name": "v0.3.8", "assets": [{"name": "Packages"}]},
                          {"tag_name": "v0.3.7", "assets": [{"name": "Packages"}]}]]
                return subprocess.CompletedProcess(cmd, 0, json.dumps(pages), "")
            return subprocess.CompletedProcess(cmd, 0, "", "")
        dest = os.path.join(self.tmp, "hist")
        self.assertEqual(selfrepo.fetch("o/r", dest, skip="v0.3.8", run=run), ["v0.3.7"])
        self.assertEqual(calls[1], ["gh", "release", "download", "v0.3.7", "--repo", "o/r", "--dir",
                                    os.path.join(dest, "v0.3.7"), "--clobber", "--pattern", "Packages"])
        with self.assertRaises(ValueError):
            selfrepo.fetch("not a repo", dest, run=run)
        with self.assertRaises(OSError):
            selfrepo.fetch("o/r", dest, run=lambda cmd, **kw: subprocess.CompletedProcess(cmd, 1, "", "HTTP 403"))


if __name__ == "__main__":
    unittest.main()
