"""F174: every image and local file README.md links to exists in the repo (a renamed screenshot or doc shows up here,
not as a broken picture on GitHub)."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
README = ROOT / "README.md"

# <img src="…">, ![alt](…) and [text](…); anchors, mailto: and http(s) links are not files.
IMG_HTML = re.compile(r"""<img\b[^>]*\bsrc=["']([^"']+)["']""", re.I)
MD_LINK = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
HREF = re.compile(r"""<a\b[^>]*\bhref=["']([^"']+)["']""", re.I)


def local(target):
    return not re.match(r"^(?:[a-z][a-z0-9+.-]*:|#|//)", target, re.I)


def targets(text):
    found = IMG_HTML.findall(text) + MD_LINK.findall(text) + HREF.findall(text)
    return sorted({t.split("#", 1)[0] for t in found if local(t) and t.split("#", 1)[0]})


class ReadmeLinks(unittest.TestCase):
    def test_every_image_exists(self):
        text = README.read_text(encoding="utf-8")
        images = [t for t in targets(text) if re.search(r"\.(png|jpe?g|gif|svg|webp)$", t, re.I)]
        self.assertTrue(images, "README.md links no images: the regexes no longer match it")
        missing = [t for t in images if not (ROOT / t).is_file()]
        self.assertEqual(missing, [], "images README.md links that aren't in the repo")

    def test_every_local_link_exists(self):
        missing = [t for t in targets(README.read_text(encoding="utf-8")) if not (ROOT / t).exists()]
        self.assertEqual(missing, [], "files or folders README.md links that aren't in the repo")

    def test_readme_images_are_committed_pngs_under_docs_img(self):
        """Screenshots live in docs/img/ (tools/readme_shots.py); the kit in ref/ is never linked."""
        text = README.read_text(encoding="utf-8")
        self.assertFalse([t for t in targets(text) if t.startswith("ref/")], "README.md links ref/ (not committed)")

    def test_targets_parser(self):
        sample = ('<img src="a.png" alt=""> ![x](docs/b.png) [doc](docs/c.md#part) [web](https://x.y) [top](#top) '
                  '<a href="LICENSE">l</a>')
        self.assertEqual(targets(sample), ["LICENSE", "a.png", "docs/b.png", "docs/c.md"])


if __name__ == "__main__":
    unittest.main()
