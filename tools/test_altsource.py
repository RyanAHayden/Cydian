"""I7: iFizBox's own AltStore source (web/app/source.json, tools/altsource.py) is well formed, names its own release's
IPA, is never ahead of native/VERSION, and is first among the site's default AltStore sources."""
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import altsource  # noqa: E402


def ver(s):
    return tuple(int(x) for x in re.findall(r"\d+", s)[:3])


class SourceTest(unittest.TestCase):
    def setUp(self):
        with open(altsource.SOURCE) as f:
            self.data = json.load(f)

    def test_well_formed(self):
        self.assertEqual(altsource.check(self.data), [])
        self.assertEqual(subprocess.run([sys.executable, os.path.join(HERE, "altsource.py"), "check"]).returncode, 0)

    def test_not_ahead_of_version(self):
        with open(os.path.join(ROOT, "native", "VERSION")) as f:
            current = f.read().strip()
        listed = self.data["apps"][0]["versions"][0]["version"]
        self.assertLessEqual(ver(listed), ver(current), "source.json names a version native/VERSION hasn't reached")

    def test_default_source(self):
        with open(os.path.join(ROOT, "web", "app", "core", "sources.js")) as f:
            js = f.read()
        block = js[js.index("DEFAULT_ALT_SOURCES = dedupeUrls(["):]
        first = re.search(r'["`](https?://[^"`]+)["`]', block).group(1)
        with open(os.path.join(ROOT, "native", "brand.env")) as f:
            repo = re.search(r"^BRAND_GITHUB_REPO=(\S+)", f.read(), re.M).group(1)
        self.assertEqual(first.replace("${GITHUB_REPO}", repo), f"https://raw.githubusercontent.com/{repo}/main/web/app/source.json")


class UpdateTest(unittest.TestCase):
    def test_update_points_at_release(self):
        with tempfile.TemporaryDirectory() as d:
            ipa = os.path.join(d, "iFizBox.ipa")
            with open(ipa, "wb") as f:
                f.write(b"PK" + b"\0" * 1000)
            out = os.path.join(d, "source.json")
            altsource.write(altsource.build("9.8.7", os.path.getsize(ipa), "2026-11-17T00:00:00Z"), out)
            with open(out) as f:
                data = json.load(f)
        v = data["apps"][0]["versions"][0]
        self.assertEqual(v["downloadURL"], "https://github.com/RyanAHayden/iFizBox/releases/download/v9.8.7/iFizBox.ipa")
        self.assertEqual(v["size"], 1002)
        self.assertEqual(altsource.check(data), [])

    def test_update_drops_old_asset_names(self):
        """F180: versions[] keeps only releases whose IPA is <NAME>.ipa; the ones under the old name go."""
        old = {"version": "0.9.3", "downloadURL": altsource.REPO + "/releases/download/v0.9.3/" + "Cy" + "dian.ipa"}
        own = {"version": "0.9.4", "downloadURL": altsource.ipa_url("0.9.4")}
        data = altsource.build("0.9.5", 10, "2026-11-18T00:00:00Z", previous=[own, old])
        self.assertEqual([v["version"] for v in data["apps"][0]["versions"]], ["0.9.5", "0.9.4"])
        self.assertTrue(all(v["downloadURL"].endswith("/" + altsource.NAME + ".ipa") for v in data["apps"][0]["versions"]))

    def test_check_refuses(self):
        data = altsource.build("1.0.0", 10, "2026-11-17T00:00:00Z")
        data["apps"][0]["versions"][0]["downloadURL"] = altsource.ipa_url("0.9.0")
        data["apps"][0]["bundleIdentifier"] = "com.example.other"
        self.assertEqual(len(altsource.check(data)), 2)

    def test_check_wants_exactly_own_ipa(self):
        """F180a: versions[0] is its release's <NAME>.ipa, not any other IPA of that release."""
        for name in ("Cy" + "dian.ipa", "Other.ipa", altsource.NAME + "-1.0.0.ipa"):
            data = altsource.build("1.0.0", 10, "2026-11-18T00:00:00Z")
            data["apps"][0]["versions"][0]["downloadURL"] = altsource.REPO + "/releases/download/v1.0.0/" + name
            self.assertEqual(len(altsource.check(data)), 1, name)

    def test_published_source_lists_only_own_ipas(self):
        """F180a: web/app/source.json lists only <NAME>.ipa entries (update dropped the old-named ones)."""
        with open(altsource.SOURCE) as f:
            versions = json.load(f)["apps"][0]["versions"]
        self.assertEqual([v["version"] for v in versions if not altsource.is_own_ipa(v)], [])


if __name__ == "__main__":
    unittest.main()
