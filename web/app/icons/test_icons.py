"""Cydian's icons (F31): every PNG tools/icons.sh writes is there at its size, the glossy variant still holds the
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
    HERE / "icon-glossy-76.png": 76,
    HERE / "icon-glossy-152.png": 152,
    HERE / "icon-glossy-228.png": 228,
    ROOT / "native/icon/AppIcon60x60.png": 60,
    ROOT / "native/icon/AppIcon60x60@2x.png": 120,
    ROOT / "native/icon/AppIcon60x60@3x.png": 180,
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
        self.assertIn("icons/icon-192.png", srcs)
        self.assertIn("icons/icon-512.png", srcs)
        for s in srcs:
            self.assertTrue((app / s).is_file(), s)
        self.assertIn('href="icons/icon-180.png?v=', (app / "index.html").read_text())
        self.assertIn('"icons/icon-glossy-76.png"', (app / "screens/home.js").read_text())  # Home header: 1x/2x/3x PNGs


if __name__ == "__main__":
    unittest.main()
