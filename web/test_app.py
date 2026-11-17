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

    def test_add_link(self):
        # F8: the share link serves the app, which opens Add Source with the query's url.
        with self.c.get("/add?url=https%3A%2F%2Frepo.example.com%2F") as r:
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



class ConditionalFetchTest(unittest.TestCase):
    """F19: /api/fetch answers with an ETag and the repo's Last-Modified, and 304 when the visitor has the body."""
    RELEASE = b"Origin: Test\nDate: Sat, 14 Nov 2026 10:00:00 UTC\n"

    def setUp(self):
        self.c = A.app.test_client()
        self.calls = []
        self.orig = A.fetcher.get

        def fake_get(url, *a, **k):
            self.calls.append(url)
            return A.fetch.Response(url, 200, {"content-type": "text/plain",
                                               "last-modified": "Sat, 14 Nov 2026 10:00:00 GMT"}, self.RELEASE)
        A.fetcher.get = fake_get

    def tearDown(self):
        A.fetcher.get = self.orig

    def get(self, **headers):
        return self.c.get("/api/fetch?url=https%3A%2F%2Frepo.example.com%2FRelease", headers=headers,
                          environ_base={"REMOTE_ADDR": "203.0.113.19"})

    def test_etag_then_304(self):
        r = self.get()
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data, self.RELEASE)
        etag = r.headers["ETag"]
        self.assertTrue(etag.startswith('"'))
        self.assertEqual(r.headers["Last-Modified"], "Sat, 14 Nov 2026 10:00:00 GMT")
        r = self.get(**{"If-None-Match": etag})
        self.assertEqual(r.status_code, 304)
        self.assertEqual(r.data, b"")
        self.assertEqual(r.headers["ETag"], etag)
        self.assertEqual(r.headers["X-Content-Type-Options"], "nosniff")

    def test_changed_body_is_200(self):
        etag = self.get().headers["ETag"]
        self.RELEASE = b"Origin: Test\nDate: Sun, 15 Nov 2026 10:00:00 UTC\n"
        r = self.get(**{"If-None-Match": etag})
        self.assertEqual(r.status_code, 200)
        self.assertNotEqual(r.headers["ETag"], etag)

    def test_if_modified_since(self):
        r = self.get(**{"If-Modified-Since": "Sat, 14 Nov 2026 10:00:00 GMT"})
        self.assertEqual(r.status_code, 304)
        r = self.get(**{"If-Modified-Since": "Fri, 13 Nov 2026 10:00:00 GMT"})
        self.assertEqual(r.status_code, 200)


if __name__ == "__main__":
    unittest.main()
