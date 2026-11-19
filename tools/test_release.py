"""T6: tools/release.sh names the assets the way F61's self-update looks for them (web/app/core/selfupdate.js
parseRelease/debFor), and refuses a build whose version isn't native/VERSION. Dry runs only: nothing is published
and nothing touches the network."""
import json
import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "native"))
import mkdeb  # noqa: E402
import mkipa  # noqa: E402

SCRIPT = os.path.join(ROOT, "tools", "release.sh")
with open(os.path.join(ROOT, "native", "VERSION")) as f:
    VERSION = f.read().strip()


class Release(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.dist = os.path.join(self.tmp, "dist")
        os.makedirs(self.dist)

    def fake_build(self, deb_version, ipa_version):
        """A iFizBox.deb and iFizBox.ipa just real enough to name: they fail mkdeb/mkipa's checks, which a dry run
        only reports."""
        root, debian = os.path.join(self.tmp, "root"), os.path.join(self.tmp, "debian")
        os.makedirs(os.path.join(root, "var/jb/Applications/iFizBox.app"))
        os.makedirs(debian)
        with open(os.path.join(root, "var/jb/Applications/iFizBox.app/x"), "wb") as f:
            f.write(b"x")
        with open(os.path.join(debian, "control"), "w") as f:
            f.write("Package: com.ryha.ifizbox\nVersion: %s\nArchitecture: iphoneos-arm64\n"
                    "Installed-Size: @SIZE@\n" % deb_version)
        mkdeb.build(root, debian, os.path.join(self.dist, "iFizBox.deb"), mtime=0)
        app = os.path.join(self.tmp, "iFizBox.app")
        os.makedirs(app)
        with open(os.path.join(app, "Info.plist"), "wb") as f:
            plistlib.dump({"CFBundleShortVersionString": ipa_version, "CFBundleIdentifier": "com.ryha.ifizbox"}, f)
        mkipa.build(app, os.path.join(self.dist, "iFizBox.ipa"), mtime=0)

    def dry_run(self, *extra, env_extra=None):
        notes = os.path.join(self.tmp, "notes.md")
        with open(notes, "w") as f:
            f.write("- A test release\n")
        env = {k: v for k, v in os.environ.items()
               if k not in ("IFIZBOX_RELEASE_REPO", "IFIZBOX_PIRACY_SYNC_ARGS", "IFIZBOX_RELEASE_HISTORY")}
        env.update(env_extra or {})
        return subprocess.run([SCRIPT, "--dry-run", "--dist", self.dist, "--notes", notes, *extra], cwd=ROOT,
                              env=env, capture_output=True, text=True, timeout=60)

    def assets(self, out):
        line = next(l for l in out.splitlines() if l.startswith("release: assets: "))
        return line[len("release: assets: "):].split()

    def test_asset_names(self):
        self.fake_build("%s-7" % VERSION, VERSION)
        r = self.dry_run()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.assets(r.stdout),
                         ["iFizBox.ipa", "iFizBox.deb", "com.ryha.ifizbox_%s-7_iphoneos-arm64.deb" % VERSION,
                          "Packages", "Packages.gz", "Release", "source.json"])
        self.assertIn("RyanAHayden/iFizBox v%s " % VERSION, r.stdout)
        self.assertIn("nothing published", r.stdout)
        self.assertNotIn("is not native/VERSION", r.stderr)

    @unittest.skipUnless(shutil.which("node"), "no node")
    def test_selfupdate_finds_them(self):
        """The names the script prints, fed to selfupdate.js as a GitHub release, give an IPA and the arm64 .deb."""
        self.fake_build("%s-7" % VERSION, VERSION)
        names = self.assets(self.dry_run().stdout)
        release = {"tag_name": "v" + VERSION, "body": "- x", "html_url": "https://example.invalid/r",
                   "assets": [{"name": n, "browser_download_url": "https://example.invalid/" + n} for n in names]}
        js = ("import { parseRelease, debFor } from %s;\n"
              "const r = parseRelease(%s);\n"
              "console.log(JSON.stringify({ v: r.version, ipa: r.ipa, arm64: debFor(r, 'iphoneos-arm64'),"
              " none: debFor(r, 'iphoneos-arm64e') }));"
              % (json.dumps("file://" + os.path.join(ROOT, "web/app/core/selfupdate.js")), json.dumps(release)))
        out = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        got = json.loads(out.stdout)
        base = "https://example.invalid/"
        self.assertEqual(got["v"], VERSION)
        self.assertEqual(got["ipa"], base + "iFizBox.ipa")
        self.assertEqual(got["arm64"], base + "com.ryha.ifizbox_%s-7_iphoneos-arm64.deb" % VERSION)
        self.assertIsNone(got["none"])  # the rootless build is never offered to a roothide (arm64e) phone

    def test_version_mismatch_reported(self):
        self.fake_build("0.0.1-7", "0.0.1")
        r = self.dry_run()
        self.assertEqual(r.returncode, 0, r.stderr)  # a dry run reports; a real run would stop
        self.assertIn("is not native/VERSION %s" % VERSION, r.stderr)
        self.assertIn("a real run would stop here", r.stderr)


    def test_repo_and_source(self):
        """F72: the APT repo files (Packages naming the Debian-named .deb beside it, hashes that match, the minimum
        field) and the AltStore source with the new version first and the old ones kept."""
        import gzip
        import hashlib
        self.fake_build("%s-7" % VERSION, VERSION)
        out = os.path.join(self.tmp, "out")
        r = self.dry_run("--minimum", VERSION, "--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        debname = "com.ryha.ifizbox_%s-7_iphoneos-arm64.deb" % VERSION
        with open(os.path.join(out, "Packages")) as f:
            packages = f.read()
        self.assertIn("Package: com.ryha.ifizbox\n", packages)
        self.assertIn("Filename: v%s/%s\n" % (VERSION, debname), packages)  # B73: the release's own asset
        self.assertIn("X-iFizBox-Minimum-Version: %s\n" % VERSION, packages)
        with open(os.path.join(self.dist, "iFizBox.deb"), "rb") as f:
            deb = f.read()
        self.assertIn("SHA256: %s\n" % hashlib.sha256(deb).hexdigest(), packages)
        with open(os.path.join(out, "Packages.gz"), "rb") as f:
            self.assertEqual(gzip.decompress(f.read()).decode(), packages)
        with open(os.path.join(out, "Release")) as f:
            release = f.read()
        self.assertIn("Origin: iFizBox\n", release)
        self.assertIn("Architectures: iphoneos-arm64\n", release)
        self.assertIn("X-iFizBox-Minimum-Version: %s\n" % VERSION, release)
        self.assertIn(" %s %d Packages\n" % (hashlib.sha256(packages.encode()).hexdigest(), len(packages)), release)
        self.assertIn("releases/latest/download/", r.stdout)
        self.assertIn("apt repo: https://ifizbox.com/repo/", r.stdout)  # B17
        with open(os.path.join(out, "source.json")) as f:
            src = json.load(f)
        with open(os.path.join(ROOT, "web", "app", "source.json")) as f:
            before = json.load(f)
        app = src["apps"][0]
        self.assertEqual(app["minimumVersion"], VERSION)
        self.assertEqual(app["versions"][0]["version"], VERSION)
        self.assertTrue(app["versions"][0]["localizedDescription"].startswith("A test release\n"))
        # altsource.KEEP caps versions[]: once the source is full, the oldest entry drops off. F180: entries whose IPA
        # isn't <NAME>.ipa (the releases before it) drop off too.
        sys.path.insert(0, os.path.join(ROOT, "tools"))
        import altsource
        old = [v["version"] for v in before["apps"][0]["versions"]
               if v["version"] != VERSION and altsource.is_own_ipa(v)][:altsource.KEEP - 1]
        self.assertEqual([v["version"] for v in app["versions"][1:]], old)
        # A dry run never writes the repo's own source.json.
        with open(os.path.join(ROOT, "web", "app", "source.json")) as f:
            self.assertEqual(json.load(f), before)

    def test_minimum_checked(self):
        self.fake_build("%s-7" % VERSION, VERSION)
        self.assertNotEqual(self.dry_run("--minimum", "1.2").returncode, 0)
        self.assertNotEqual(self.dry_run("--minimum", "99.0.0").returncode, 0)

    def test_other_arch_rides_along(self):
        self.fake_build("%s-7" % VERSION, VERSION)
        other = "com.ryha.ifizbox_%s-7_iphoneos-arm64e.deb" % VERSION
        shutil.copy(os.path.join(self.dist, "iFizBox.deb"), os.path.join(self.dist, other))
        out = os.path.join(self.tmp, "out")
        r = self.dry_run("--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(other, self.assets(r.stdout))
        with open(os.path.join(out, "Packages")) as f:
            self.assertIn("Filename: v%s/%s\n" % (VERSION, other), f.read())

    def test_repo_keeps_older_releases(self):
        """B73: Packages names the older releases' .debs too (from IFIZBOX_RELEASE_HISTORY here, GitHub in a real run),
        each under its own tag, so Downgrade lists them; a dry run without it says it read none."""
        self.fake_build("%s-7" % VERSION, VERSION)
        hist = os.path.join(self.tmp, "hist", "v0.0.1")
        os.makedirs(hist)
        with open(os.path.join(hist, "Packages"), "w") as f:
            f.write("Package: com.ryha.ifizbox\nVersion: 0.0.1-3\nArchitecture: iphoneos-arm64\n"
                    "Filename: com.ryha.ifizbox_0.0.1-3_iphoneos-arm64.deb\nSize: 3\nSHA256: ab\n")
        out = os.path.join(self.tmp, "out")
        r = self.dry_run("--out", out, env_extra={"IFIZBOX_RELEASE_HISTORY": os.path.join(self.tmp, "hist")})
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(os.path.join(out, "Packages")) as f:
            packages = f.read()
        self.assertIn("Filename: v%s/com.ryha.ifizbox_%s-7_iphoneos-arm64.deb\n" % (VERSION, VERSION), packages)
        self.assertIn("Filename: v0.0.1/com.ryha.ifizbox_0.0.1-3_iphoneos-arm64.deb\n", packages)
        self.assertIn("apt repo versions: %s-7 0.0.1-3\n" % VERSION, r.stdout)
        r = self.dry_run("--out", out)
        self.assertIn("older releases not read", r.stdout)

    def piracy_answers(self, sha, hosts):
        """Saved cnstr/manifests API answers for tools/sync-piracy-list.py: the list's tree and its newest commit."""
        tree = os.path.join(self.tmp, "tree.json")
        commits = os.path.join(self.tmp, "commits.json")
        with open(tree, "w") as f:
            json.dump({"truncated": False,
                       "tree": [{"path": "configs/piracy-list/" + h, "type": "blob"} for h in hosts]}, f)
        with open(commits, "w") as f:
            json.dump([{"sha": sha, "commit": {"committer": {"date": "2099-01-02T00:00:00Z"}}}], f)
        return {"IFIZBOX_PIRACY_SYNC_ARGS": "--tree %s --commits %s" % (tree, commits)}

    def test_piracy_list_not_fetched_by_default(self):
        """T11: a plain dry run makes no network call; it names the committed copy's Canister commit."""
        self.fake_build("%s-7" % VERSION, VERSION)
        r = self.dry_run()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertRegex(r.stdout, r"release: piracy list: Canister [0-9a-f]{12} \(\d{4}-\d\d-\d\d\), not checked")

    def test_piracy_list_older_warned(self):
        """T11: --sync-piracy compares with Canister's newest commit and warns; the repo's copy stays as it is."""
        import re
        piracy = os.path.join(ROOT, "web", "app", "core", "piracy-list.js")
        with open(piracy) as f:
            before = f.read()
        hosts = re.findall(r'^  "([^"]+)",$', before, re.M)
        self.fake_build("%s-7" % VERSION, VERSION)
        r = self.dry_run("--sync-piracy", env_extra=self.piracy_answers("ab" * 20, hosts + ["new.example.org"]))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("older than its newest piracy-list commit abababababab (2099-01-02)", r.stderr)
        self.assertIn("a real run would refresh", r.stderr)
        with open(piracy) as f:
            self.assertEqual(f.read(), before)

    def test_piracy_list_current(self):
        """T11: the same commit and hosts as the committed copy: no warning."""
        import re
        with open(os.path.join(ROOT, "web", "app", "core", "piracy-list.js")) as f:
            js = f.read()
        sha, date = re.search(r'commit: "([0-9a-f]{40})", date: "([0-9-]+)"', js).groups()
        env = self.piracy_answers(sha, re.findall(r'^  "([^"]+)",$', js, re.M))
        with open(env["IFIZBOX_PIRACY_SYNC_ARGS"].split()[-1], "w") as f:
            json.dump([{"sha": sha, "commit": {"committer": {"date": date + "T00:00:00Z"}}}], f)
        self.fake_build("%s-7" % VERSION, VERSION)
        r = self.dry_run("--sync-piracy", env_extra=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("warning", r.stderr)
        self.assertIn("release: piracy list: Canister %s (%s), current" % (sha[:12], date), r.stdout)


if __name__ == "__main__":
    unittest.main()
