"""F180: the build outputs and release assets are <BRAND_NAME>.ipa, <BRAND_NAME>.deb and <BRAND_NAME>.app (and the
extensions <BRAND_NAME>Share.appex, <BRAND_NAME>Widget.appex), named from native/brand.env, never the old name.

- No tracked file outside plan/ and journal/ names an old-named build output or asset (the .ipa, .deb, .app, the
  extensions, the icon, the test source's IPAs). F180a: web/app/source.json too, versions[] included (the 0.9.4
  release's update dropped the entries for releases published under the old name).
- The build and release scripts take the names from BRAND_NAME: none spells <BRAND_NAME>.ipa/.deb/.app in its code.
The old name is spelled in pieces so this file passes its own grep."""
import json
import os
import re
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import brand  # noqa: E402

OLD = "Cy" + "dian"
OLD_ASSET = re.compile(OLD + r"(?:\.(?:ipa|deb|app)\b|Share|Widget|Icon)|test-fixtures/" + OLD.lower() + r"-", re.I)
SKIP = ("plan/", "journal/")


class NoOldAssetNames(unittest.TestCase):
    def test_no_old_asset_names(self):
        files = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True).stdout.decode().split("\0")
        bad = []
        for rel in files:
            if not rel or rel.startswith(SKIP):
                continue
            if OLD_ASSET.search(rel):
                bad.append(f"{rel}: the file name")
            p = os.path.join(ROOT, rel)
            if os.path.islink(p) or not os.path.isfile(p):
                continue
            with open(p, "rb") as f:
                data = f.read()
            if b"\0" in data[:8192]:
                continue
            for n, line in enumerate(data.decode("utf-8", "replace").splitlines(), 1):
                if OLD_ASSET.search(line):
                    bad.append(f"{rel}:{n}: {line.strip()[:100]}")
        self.assertEqual(bad, [], "old-named build outputs or release assets (F180: use BRAND_NAME)")

    def test_source_json_only_own_ipas(self):
        """F180a: every versions[] entry of the built-in source is its release's <BRAND_NAME>.ipa."""
        with open(os.path.join(ROOT, "web", "app", "source.json")) as f:
            data = json.load(f)
        self.assertIsNone(OLD_ASSET.search(json.dumps(data)))
        for app in data["apps"]:
            for v in app["versions"]:
                self.assertRegex(v["downloadURL"], r"/releases/download/v%s/%s\.ipa$" % (re.escape(v["version"]), re.escape(brand.NAME)))


class NamesFromBrand(unittest.TestCase):
    SCRIPTS = ("native/build.sh", "native/share/build.sh", "native/widget/build.sh", "native/Makefile",
               "native/mkipa.py", "native/mkdeb.py", "native/deb/postinst", "native/deb/prerm",
               "tools/release.sh", "tools/publish.sh", "tools/altsource.py")
    TEMPLATES = ("native/Info.plist", "native/share/Info.plist", "native/widget/Info.plist")

    def code_lines(self, rel):
        with open(os.path.join(ROOT, rel)) as f:
            text = f.read()
        if rel.endswith(".py"):
            text = re.sub(r'"""(?:.|\n)*?"""', "", text)
        for n, line in enumerate(text.splitlines(), 1):
            if not line.lstrip().startswith("#"):
                yield n, line

    def test_scripts_do_not_spell_the_names(self):
        spelled = re.compile(re.escape(brand.NAME) + r"(?:\.(?:ipa|deb|app)\b|Share\b|Widget\b)")
        bad = [f"{rel}:{n}: {line.strip()[:100]}" for rel in self.SCRIPTS for n, line in self.code_lines(rel)
               if spelled.search(line)]
        self.assertEqual(bad, [], "build/release scripts that spell the asset names (use $BRAND_NAME / brand.NAME)")

    def test_templates_use_the_variable(self):
        for rel in self.TEMPLATES:
            with open(os.path.join(ROOT, rel)) as f:
                text = re.sub(r"<!--.*?-->", "", f.read(), flags=re.S)
            self.assertIn("<key>CFBundleExecutable</key><string>$(BRAND_NAME)", text, rel)
            self.assertNotIn(brand.NAME, text, rel)


if __name__ == "__main__":
    unittest.main()
