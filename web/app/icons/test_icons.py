"""iFizBox's icons (F31): every PNG tools/icons.sh writes is there at its size, the glossy variant still holds the
master's drawing, and the manifest, page and native app point at files that exist."""
import json
import re
import struct
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent.parent

SIZES = {
    HERE / "icon-180.png": 180,
    HERE / "icon-192.png": 192,
    HERE / "icon-512.png": 512,
    HERE / "icon-web-180.png": 180,
    HERE / "icon-web-192.png": 192,
    HERE / "icon-web-512.png": 512,
    HERE / "icon-web-1024.png": 1024,
    HERE / "icon-web-glossy-76.png": 76,
    HERE / "icon-web-glossy-152.png": 152,
    HERE / "icon-web-glossy-228.png": 228,
    HERE / "icon-glossy-76.png": 76,
    HERE / "icon-glossy-152.png": 152,
    HERE / "icon-glossy-228.png": 228,
    HERE / "sash-lite.png": 1024,  # F329a: the LITE sash alone, over your own icon in the Lite app
    ROOT / "native/icon/AppIcon60x60.png": 60,
    ROOT / "native/icon/AppIcon60x60@2x.png": 120,
    ROOT / "native/icon/AppIcon60x60@3x.png": 180,
    ROOT / "native/icon/AppIconLite60x60@2x.png": 120,
    ROOT / "native/icon/AppIconLite60x60@3x.png": 180,
}


def png_size(path):
    b = path.read_bytes()[:24]
    assert b[:8] == b"\x89PNG\r\n\x1a\n" and b[12:16] == b"IHDR", f"{path} is not a plain PNG"
    return struct.unpack(">II", b[16:24])


def body(svg):
    """An SVG's content between its <svg> tags, comments and blank space dropped (as tools/icons.sh copies it)."""
    svg = re.sub(r"<!--.*?-->", "", svg, flags=re.S)
    svg = re.sub(r"^.*?<svg[^>]*>", "", svg, flags=re.S)
    svg = re.sub(r"</svg>.*", "", svg, flags=re.S)
    return re.sub(r"\s+", " ", svg).strip()


class Icons(unittest.TestCase):
    def test_png_sizes(self):
        for path, n in SIZES.items():
            with self.subTest(path=path.name):
                self.assertEqual(png_size(path), (n, n))

    def test_glossy_holds_the_master(self):
        master = body((HERE / "icon.svg").read_text())
        glossy = re.sub(r"\s+", " ", (HERE / "icon-glossy.svg").read_text())
        self.assertIn(master, glossy, "icon-glossy.svg is stale: run tools/icons.sh")
        self.assertIn('rx="180"', glossy)
        self.assertIn("ios6-gloss", glossy)

    def test_master_has_no_gloss(self):
        # iOS 7+ home screens take the flat icon; the gloss only lives in the glossy variant.
        self.assertNotIn("gloss", body((HERE / "icon.svg").read_text()))

    def test_references_exist(self):
        app = HERE.parent
        manifest = json.loads((app / "manifest.json").read_text())
        srcs = [i["src"].split("?")[0] for i in manifest["icons"]]  # ?v=N makes iOS fetch a changed icon afresh
        self.assertIn("icons/icon-web-192.png", srcs)  # the website's home-screen icon has the WEB sash
        self.assertIn("icons/icon-web-512.png", srcs)
        for s in srcs:
            self.assertTrue((app / s).is_file(), s)
        self.assertIn('href="icons/icon-web-180.png?v=', (app / "index.html").read_text())
        home = (app / "screens/home.js").read_text()  # Home header: 1x/2x/3x PNGs: WEB on the website, LITE in the sideload app
        self.assertIn('"icon-web-glossy"', home)
        self.assertIn('"icon-lite-glossy"', home)
        for n in (76, 152, 228):
            self.assertTrue((HERE / f"icon-lite-glossy-{n}.png").is_file(), n)
        self.assertNotIn("(Web)", home)
        self.assertIn('rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png', (app / "index.html").read_text())

    def test_ipa_takes_the_lite_icon(self):
        # The sideload IPA has the LITE sash; the .deb keeps the plain icon (native/build.sh bundle()).
        build = (ROOT / "native/build.sh").read_text()
        self.assertIn("icon=AppIconLite60x60", build)
        self.assertIn("icon=AppIcon60x60;", build)


def theme_names():
    """theme-boot.js's dark and light theme names (tools/icon_themes.py checks its table against the same lists)."""
    js = (ROOT / "web/app/theme-boot.js").read_text()
    names = []
    for var in ("darks", "lights"):
        m = re.search(var + r"\s*=\s*\[([^\]]*)\]", js)
        names += re.findall(r'"([a-z0-9-]+)"', m.group(1))
    return names


class ThemeIcons(unittest.TestCase):
    """F322: tools/icons.sh renders the icon in every theme's colours, plain and LITE-sashed."""

    def test_every_theme_plain_and_lite_at_every_size(self):
        names = theme_names()
        self.assertGreaterEqual(len(names), 9)
        for t in names:
            for kind in ("icon", "icon-lite"):
                for n in (180, 192, 512):
                    with self.subTest(theme=t, file=f"{kind}-{n}.png"):
                        self.assertEqual(png_size(HERE / "themes" / t / f"{kind}-{n}.png"), (n, n))
                for n in (76, 152, 228):
                    with self.subTest(theme=t, file=f"{kind}-glossy-{n}.png"):
                        self.assertEqual(png_size(HERE / "themes" / t / f"{kind}-glossy-{n}.png"), (n, n))

    def test_no_stray_theme(self):
        # a theme dropped from theme-boot.js leaves no icons behind
        self.assertEqual(sorted(p.name for p in (HERE / "themes").iterdir() if p.is_dir()), sorted(theme_names()))

    def test_classic_is_the_real_icon(self):
        for f in ("icon-180.png", "icon-192.png", "icon-512.png", "icon-glossy-152.png", "icon-lite-glossy-228.png"):
            self.assertEqual((HERE / "themes/classic" / f).read_bytes(), (HERE / f).read_bytes(), f)

    def test_themes_differ(self):
        seen = {}
        for t in theme_names():
            b = (HERE / "themes" / t / "icon-180.png").read_bytes()
            self.assertNotIn(b, seen, f"{t} has the same icon as {seen.get(b)}")
            seen[b] = t

    def test_generator_table_matches_theme_boot(self):
        import sys
        sys.path.insert(0, str(ROOT / "tools"))
        import icon_themes  # stdlib at import; numpy/Pillow only when rendering
        self.assertEqual(icon_themes.names(), theme_names())
        self.assertEqual(sorted(icon_themes.THEMES), sorted(theme_names()))


if __name__ == "__main__":
    unittest.main()
