"""Flask skeleton: `/`, the frontend's static files and `/healthz` answer 200."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as A  # noqa: E402

STATIC = ["index.html", "app.js", "router.js", "style.css",
          "screens/home.js", "screens/sources.js", "screens/changes.js",
          "screens/installed.js", "screens/search.js"]


class AppTest(unittest.TestCase):
    def setUp(self):
        self.c = A.app.test_client()

    def test_index(self):
        with self.c.get("/") as r:
            self.assertEqual(r.status_code, 200)
            self.assertIn(b'<script type="module" src="app.js">', r.data)

    def test_static(self):
        for p in STATIC:
            with self.subTest(p=p):
                with self.c.get("/" + p) as r:
                    self.assertEqual(r.status_code, 200)
                    if p.endswith(".js"):
                        self.assertEqual(r.mimetype, "text/javascript")

    def test_healthz(self):
        r = self.c.get("/healthz")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data, b"ok\n")

    def test_missing_and_traversal(self):
        for p in ["/nope.js", "/../app.py", "/%2e%2e/app.py"]:
            with self.subTest(p=p), self.c.get(p) as r:
                self.assertEqual(r.status_code, 404)


if __name__ == "__main__":
    unittest.main()
