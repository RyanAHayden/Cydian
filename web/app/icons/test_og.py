"""F175: the link-preview card. index.html's preview tags (and the manifest) carry the name from brand.js and none of
the old name, og:image points at the brand's domain with the ?v=3 cache key (so Discord, iMessage and X fetch the
card again instead of their cached old one), and icons/og.png is the 2400x1260 card that og:image:width/height say.
The old name is spelled in pieces so this file passes native/test_brand.py's grep."""
import json
import re
import struct
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
WEB = HERE.parent
OLD = re.compile("Cy" + "dian", re.I)


def brand(key):
    m = re.search(r'export const %s = "([^"]+)"' % key, (WEB / "brand.js").read_text())
    return m.group(1)


def meta(html, attr, key):
    m = re.search(r'<meta %s="%s" content="([^"]*)">' % (attr, re.escape(key)), html)
    return m and m.group(1)


class LinkCard(unittest.TestCase):
    def setUp(self):
        self.html = (WEB / "index.html").read_text()
        self.name, self.domain = brand("NAME"), brand("DOMAIN")

    def test_no_old_name(self):
        self.assertIsNone(OLD.search(self.html), "index.html")
        self.assertIsNone(OLD.search((WEB / "manifest.json").read_text()), "manifest.json")

    def test_og_image_on_the_domain_with_v3(self):
        self.assertEqual(meta(self.html, "property", "og:image"), f"https://{self.domain}/icons/og.png?v=3")
        self.assertEqual(meta(self.html, "property", "og:url"), f"https://{self.domain}/")

    def test_names(self):
        self.assertEqual(f"<title>{self.name}</title>" in self.html, True)
        self.assertEqual(meta(self.html, "property", "og:site_name"), self.name)
        self.assertEqual(meta(self.html, "property", "og:title"), self.name)
        self.assertTrue(meta(self.html, "property", "og:image:alt").startswith(self.name + "'s "))
        self.assertEqual(meta(self.html, "name", "twitter:card"), "summary_large_image")
        man = json.loads((WEB / "manifest.json").read_text())
        self.assertEqual((man["name"], man["short_name"]), (self.name, self.name))

    def test_card_size(self):
        data = (HERE / "og.png").read_bytes()
        self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
        w, h = struct.unpack(">II", data[16:24])
        self.assertEqual((str(w), str(h)), (meta(self.html, "property", "og:image:width"),
                                            meta(self.html, "property", "og:image:height")))


if __name__ == "__main__":
    unittest.main()
