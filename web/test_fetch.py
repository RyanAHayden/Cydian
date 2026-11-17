"""F3 fetch proxy: the SSRF guard (each refused range, redirects, rebinding), caps, Packages compressions, cache,
rate limit, and the /api/fetch route.

A local HTTP server plays the repo. The Fetcher's resolver maps made-up hostnames to *public* IPs and its dialer
sends exactly those IPs to the local server, so the guard runs unchanged; any other name resolves for real
(localhost -> 127.0.0.1, refused).
"""
import bz2
import gzip
import ipaddress
import lzma
import socket
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch  # noqa: E402

PACKAGES = b"Package: com.example.tweak\nVersion: 1.0\nArchitecture: iphoneos-arm64\n\n"
PUBLIC = {"repo.test": "93.184.216.34", "repo6.test": "2606:2800:220:1:248:1893:25c8:1946"}


class Handler(BaseHTTPRequestHandler):
    routes = {}       # path -> (status, headers, body)
    seen = []         # (path, headers) of every request

    def do_GET(self):
        Handler.seen.append((self.path, dict(self.headers)))
        status, headers, body = Handler.routes.get(self.path, (404, {}, b"nope"))
        if callable(body):
            return body(self)
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.server.daemon_threads = True
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        Handler.routes = {}
        Handler.seen = []
        self.resolved = []
        self.dialed = []
        self.fake = dict(PUBLIC)
        self.f = fetch.Fetcher(resolve=self.resolve, dial=self.dial, timeout=5)

    def resolve(self, host, port):
        self.resolved.append(host)
        if host in self.fake:
            v = self.fake[host]
            return v if isinstance(v, list) else [v]
        return fetch.default_resolve(host, port)

    def dial(self, ip, port, timeout):
        self.dialed.append(ip)
        if ip in [v for v in PUBLIC.values()]:
            return socket.create_connection(("127.0.0.1", self.port), timeout=timeout)
        raise AssertionError(f"dialed a non-test address {ip}")

    def url(self, path, host="repo.test"):
        h = f"[{host}]" if ":" in host else host
        return f"http://{h}:{self.port}{path}"


class GuardTest(Base):
    REFUSED_V4 = ["127.0.0.1", "127.255.255.254", "10.0.0.1", "172.16.5.4", "192.168.1.1", "169.254.169.254",
                  "100.64.0.1", "100.127.255.254", "224.0.0.1", "239.255.255.250", "0.0.0.0", "240.0.0.1",
                  "255.255.255.255", "192.0.0.8", "198.18.0.1"]
    REFUSED_V6 = ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "ff0e::1", "::ffff:127.0.0.1",
                  "::ffff:10.0.0.1", "64:ff9b::a9fe:a9fe", "64:ff9b:1::1", "2002:7f00:1::1", "2002:c0a8:101::1",
                  "2001:db8::1", "2001:0:4136:e378:8000:63bf:80ff:fffe", "fec0::1"]

    def test_each_refused_range(self):
        for ip in self.REFUSED_V4 + self.REFUSED_V6:
            with self.subTest(ip=ip):
                self.assertIsNotNone(fetch.ip_blocked(ipaddress.ip_address(ip)), ip)
                self.fake["evil.test"] = ip
                with self.assertRaises(fetch.FetchError) as cm:
                    self.f.get(f"http://evil.test:{self.port}/")
                self.assertEqual(cm.exception.code, "refused")
        self.assertEqual(self.dialed, [])

    def test_ip_literals_refused(self):
        for u in ["http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data/",
                  "http://2130706433/", "http://0x7f.1/", "http://localhost/", "http://[::ffff:7f00:1]/"]:
            with self.subTest(u=u), self.assertRaises(fetch.FetchError) as cm:
                self.f.get(u)
            self.assertIn(cm.exception.code, ("refused", "network"))
            if cm.exception.code == "network":  # a resolver that rejects the odd form is fine too
                self.assertIn("resolve", str(cm.exception))
        self.assertEqual(self.dialed, [])

    def test_public_allowed(self):
        for ip in ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "64:ff9b::808:808", "2002:5db8:d822::1"]:
            with self.subTest(ip=ip):
                self.assertIsNone(fetch.ip_blocked(ipaddress.ip_address(ip)))

    def test_bad_urls(self):
        for u in ["", "ftp://repo.test/", "file:///etc/passwd", "gopher://repo.test/", "javascript:alert(1)",
                  "http://user:pw@repo.test/", "http:///nohost", "http://repo.test:99999/", "x" * 5000]:
            with self.subTest(u=u[:40]), self.assertRaises(fetch.FetchError) as cm:
                self.f.get(u)
            self.assertEqual(cm.exception.code, "bad_url")

    def test_any_bad_address_refuses(self):
        self.fake["mixed.test"] = ["93.184.216.34", "10.0.0.1"]
        with self.assertRaises(fetch.FetchError) as cm:
            self.f.get(f"http://mixed.test:{self.port}/")
        self.assertEqual(cm.exception.code, "refused")

    def test_redirect_to_localhost(self):
        for target in [f"http://localhost:{self.port}/secret", f"http://127.0.0.1:{self.port}/secret",
                       f"http://[::1]:{self.port}/secret", "http://169.254.169.254/"]:
            with self.subTest(target=target):
                Handler.routes = {"/r": (302, {"Location": target}, b""), "/secret": (200, {}, b"secret")}
                with self.assertRaises(fetch.FetchError) as cm:
                    self.f.get(self.url("/r"))
                self.assertEqual(cm.exception.code, "refused")
                self.assertNotIn("/secret", [p for p, _ in Handler.seen])

    def test_redirect_followed_and_rechecked(self):
        Handler.routes = {"/a": (301, {"Location": "/b"}, b""),
                          "/b": (307, {"Location": self.url("/c", "repo6.test")}, b""),
                          "/c": (200, {"Content-Type": "text/plain"}, b"ok")}
        r = self.f.get(self.url("/a"))
        self.assertEqual((r.status, r.body), (200, b"ok"))
        self.assertEqual(r.url, self.url("/c", "repo6.test"))
        self.assertEqual(self.resolved, ["repo.test", "repo.test", "repo6.test"])

    def test_redirect_loop(self):
        Handler.routes = {"/loop": (302, {"Location": "/loop"}, b"")}
        with self.assertRaises(fetch.FetchError) as cm:
            self.f.get(self.url("/loop"))
        self.assertEqual(cm.exception.code, "upstream")

    def test_dns_rebinding_connects_to_checked_ip(self):
        # First answer public, every later answer loopback: the one checked answer is the one dialed.
        answers = iter([["93.184.216.34"]])
        self.f.resolve = lambda host, port: (self.resolved.append(host), next(answers, ["127.0.0.1"]))[1]
        Handler.routes = {"/": (200, {}, b"hi")}
        r = self.f.get(self.url("/", "rebind.test"))
        self.assertEqual(r.body, b"hi")
        self.assertEqual(self.resolved, ["rebind.test"])
        self.assertEqual(self.dialed, ["93.184.216.34"])
        # Host header is the name, not the IP
        self.assertTrue(Handler.seen[0][1]["Host"].startswith("rebind.test"))

    def test_cydia_headers_sent(self):
        Handler.routes = {"/": (200, {}, b"hi")}
        self.f.get(self.url("/"))
        h = Handler.seen[0][1]
        self.assertEqual(h["User-Agent"], "Telesphoreo APT-HTTP/1.0.592")
        self.assertIn("X-Machine", h)
        self.assertIn("X-Firmware", h)


class CapsTest(Base):
    def test_oversize_content_length(self):
        self.f.max_bytes = 1000
        Handler.routes = {"/big": (200, {}, b"x" * 1001)}
        with self.assertRaises(fetch.FetchError) as cm:
            self.f.get(self.url("/big"))
        self.assertEqual(cm.exception.code, "too_large")

    def test_oversize_no_content_length(self):
        self.f.max_bytes = 100_000

        def stream(h):
            h.send_response(200)
            h.send_header("Connection", "close")
            h.end_headers()
            try:
                for _ in range(100):
                    h.wfile.write(b"y" * 10_000)
            except OSError:
                pass
        Handler.routes = {"/stream": (200, {}, stream)}
        with self.assertRaises(fetch.FetchError) as cm:
            self.f.get(self.url("/stream"))
        self.assertEqual(cm.exception.code, "too_large")

    def test_timeout(self):
        self.f.timeout = 0.5
        gate = threading.Event()

        def slow(h):
            gate.wait(5)
        Handler.routes = {"/slow": (200, {}, slow)}
        try:
            with self.assertRaises(fetch.FetchError) as cm:
                self.f.get(self.url("/slow"))
            self.assertEqual(cm.exception.code, "timeout")
        finally:
            gate.set()

    def test_slow_drip_hits_deadline(self):
        # Each byte comes well within a per-read timeout; only the whole-fetch deadline stops it.
        self.f.timeout = 1.0
        stop = threading.Event()

        def drip(h):
            h.send_response(200)
            h.send_header("Content-Length", "1000")
            h.end_headers()
            try:
                for _ in range(1000):
                    h.wfile.write(b"z")
                    h.wfile.flush()
                    if stop.wait(0.1):
                        return
            except OSError:
                pass
        Handler.routes = {"/drip": (200, {}, drip)}
        t0 = time.monotonic()
        try:
            with self.assertRaises(fetch.FetchError) as cm:
                self.f.get(self.url("/drip"))
            self.assertEqual(cm.exception.code, "timeout")
            self.assertLess(time.monotonic() - t0, 3.0)
        finally:
            stop.set()

    def test_decompression_bomb(self):
        bomb = gzip.compress(b"\0" * 2_000_000)
        with self.assertRaises(fetch.FetchError) as cm:
            fetch.decompress_capped(gzip.decompress, bomb, cap=1_000_000)
        self.assertEqual(cm.exception.code, "too_large")
        for fn, comp in [(lzma.decompress, lzma.compress), (bz2.decompress, bz2.compress)]:
            with self.subTest(fn=fn), self.assertRaises(fetch.FetchError):
                fetch.decompress_capped(fn, comp(b"\0" * 2_000_000), cap=1_000_000)

    def test_truncated(self):
        for fn, comp in [(lzma.decompress, lzma.compress), (bz2.decompress, bz2.compress),
                         (gzip.decompress, gzip.compress)]:
            with self.subTest(fn=fn), self.assertRaises(ValueError):
                fetch.decompress_capped(fn, comp(PACKAGES * 50)[:-20])


class PackagesTest(Base):
    COMP = {"Packages.xz": lzma.compress, "Packages.bz2": bz2.compress, "Packages.gz": gzip.compress,
            "Packages": lambda b: b}

    def test_each_compression(self):
        names = list(self.COMP)
        for i, name in enumerate(names):
            with self.subTest(name=name):
                Handler.routes = {f"/repo/{name}": (200, {}, self.COMP[name](PACKAGES))}
                source, gz, cached = fetch.fetch_packages(self.f, self.url("/repo"))
                self.assertEqual(gzip.decompress(gz), PACKAGES)
                self.assertEqual(source, self.url(f"/repo/{name}"))
                self.assertFalse(cached)
                # it tried the earlier names first, in order
                self.assertEqual([p for p, _ in Handler.seen], [f"/repo/{n}" for n in names[:i + 1]])
                Handler.seen.clear()

    def test_first_that_exists_wins(self):
        Handler.routes = {"/r/Packages.bz2": (200, {}, bz2.compress(PACKAGES)),
                          "/r/Packages.gz": (200, {}, gzip.compress(b"Package: wrong\n"))}
        _, gz, _ = fetch.fetch_packages(self.f, self.url("/r/"))
        self.assertEqual(gzip.decompress(gz), PACKAGES)

    def test_corrupt_falls_through(self):
        Handler.routes = {"/r/Packages.xz": (200, {}, b"<html>not found</html>"),
                          "/r/Packages.gz": (200, {}, gzip.compress(PACKAGES))}
        _, gz, _ = fetch.fetch_packages(self.f, self.url("/r"))
        self.assertEqual(gzip.decompress(gz), PACKAGES)

    def test_html_plain_rejected_and_none_found(self):
        Handler.routes = {"/r/Packages": (200, {}, b"<!doctype html><p>soft 404")}
        with self.assertRaises(fetch.FetchError) as cm:
            fetch.fetch_packages(self.f, self.url("/r"))
        self.assertEqual(cm.exception.code, "not_found")

    def test_refused_repo(self):
        with self.assertRaises(fetch.FetchError) as cm:
            fetch.fetch_packages(self.f, "http://127.0.0.1/repo")
        self.assertEqual(cm.exception.code, "refused")
        self.assertEqual(Handler.seen, [])

    def test_cache(self):
        now = [1000.0]
        cache = fetch.PackagesCache(clock=lambda: now[0])
        Handler.routes = {"/r/Packages.gz": (200, {}, gzip.compress(PACKAGES))}
        fetch.fetch_packages(self.f, self.url("/r"), cache)
        n = len(Handler.seen)
        _, gz, cached = fetch.fetch_packages(self.f, self.url("/r/"), cache)  # same repo, trailing slash
        self.assertTrue(cached)
        self.assertEqual(gzip.decompress(gz), PACKAGES)
        self.assertEqual(len(Handler.seen), n)
        now[0] += 31 * 60
        _, _, cached = fetch.fetch_packages(self.f, self.url("/r"), cache)
        self.assertFalse(cached)

    def test_cache_bounded(self):
        cache = fetch.PackagesCache(max_bytes=10)
        cache.put("a", "a", b"123456")
        cache.put("b", "b", b"123456")
        self.assertIsNone(cache.get("a"))
        self.assertIsNotNone(cache.get("b"))


class RateLimitTest(unittest.TestCase):
    def test_bucket(self):
        now = [0.0]
        rl = fetch.RateLimiter(rate=3, per=3.0, clock=lambda: now[0])
        self.assertEqual([rl.allow("a") for _ in range(4)], [True, True, True, False])
        self.assertTrue(rl.allow("b"))
        now[0] += 1.0
        self.assertTrue(rl.allow("a"))
        self.assertFalse(rl.allow("a"))


class RouteTest(Base):
    def setUp(self):
        super().setUp()
        import app as A
        self.A = A
        self._saved = (A.fetcher, A.rate_limiter, A.packages_cache)
        self._saved_assets = A.asset_limiter
        A.fetcher = self.f
        A.rate_limiter = fetch.RateLimiter(rate=1000)
        A.asset_limiter = fetch.RateLimiter(rate=1000)
        A.packages_cache = fetch.PackagesCache()
        self.c = A.app.test_client()

    def tearDown(self):
        self.A.fetcher, self.A.rate_limiter, self.A.packages_cache = self._saved
        self.A.asset_limiter = self._saved_assets

    def test_packages_gzip_encoded(self):
        Handler.routes = {"/r/Packages.bz2": (200, {}, bz2.compress(PACKAGES))}
        r = self.c.get("/api/fetch", query_string={"url": self.url("/r"), "kind": "packages"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers["Content-Encoding"], "gzip")
        self.assertTrue(r.headers["Content-Type"].startswith("text/plain"))
        self.assertEqual(gzip.decompress(r.data), PACKAGES)
        self.assertEqual(r.headers["X-Cache"], "MISS")
        r = self.c.get("/api/fetch", query_string={"url": self.url("/r"), "kind": "packages"})
        self.assertEqual(r.headers["X-Cache"], "HIT")

    def test_plain_fetch_is_inert(self):
        Handler.routes = {"/x.html": (200, {"Content-Type": "text/html"}, b"<script>alert(1)</script>"),
                          "/i.png": (200, {"Content-Type": "image/png"}, b"\x89PNG")}
        r = self.c.get("/api/fetch", query_string={"url": self.url("/x.html")})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers["Content-Type"], "application/octet-stream")
        self.assertEqual(r.headers["X-Content-Type-Options"], "nosniff")
        self.assertIn("sandbox", r.headers["Content-Security-Policy"])
        r = self.c.get("/api/fetch", query_string={"url": self.url("/i.png")})
        self.assertEqual(r.headers["Content-Type"], "image/png")

    def test_errors(self):
        cases = [({"url": "http://127.0.0.1/"}, 403, "refused"), ({"url": "ftp://x/"}, 400, "bad_url"),
                 ({"url": self.url("/missing")}, 502, "upstream"),
                 ({"url": self.url("/r"), "kind": "packages"}, 404, "not_found"),
                 ({"url": self.url("/r"), "kind": "bogus"}, 400, "bad_url")]
        for q, status, code in cases:
            with self.subTest(q=q):
                r = self.c.get("/api/fetch", query_string=q)
                self.assertEqual(r.status_code, status)
                self.assertEqual(r.get_json()["code"], code)
        r = self.c.get("/api/fetch", query_string={"url": self.url("/missing")})
        self.assertEqual(r.get_json()["status"], 404)

    def test_rate_limited(self):
        self.A.asset_limiter = fetch.RateLimiter(rate=2)
        Handler.routes = {"/": (200, {}, b"hi")}
        codes = [self.c.get("/api/fetch", query_string={"url": self.url("/")}).status_code for _ in range(3)]
        self.assertEqual(codes, [200, 200, 429])

    def test_assets_have_their_own_bucket(self):
        """B3: icons and depictions don't spend the Packages bucket, and Packages don't spend theirs."""
        self.A.rate_limiter = fetch.RateLimiter(rate=1)
        self.A.asset_limiter = fetch.RateLimiter(rate=3)
        Handler.routes = {"/i.png": (200, {"Content-Type": "image/png"}, b"\x89PNG"),
                          "/r/Packages": (200, {}, PACKAGES)}
        icon = {"url": self.url("/i.png")}
        pk = {"url": self.url("/r"), "kind": "packages"}
        codes = [self.c.get("/api/fetch", query_string=q).status_code for q in [icon, icon, pk, icon, pk, icon]]
        self.assertEqual(codes, [200, 200, 200, 200, 429, 429])
        self.assertEqual(self.c.get("/api/fetch", query_string={**pk, "kind": "bogus"}).status_code, 429)


if __name__ == "__main__":
    unittest.main()


def conditional(body, etag=None, last_modified=None, headers=None):
    """A route that answers 304 to a matching If-None-Match (else If-Modified-Since), like a static file server."""
    def handle(h):
        inm, ims = h.headers.get("If-None-Match"), h.headers.get("If-Modified-Since")
        hit = (inm == etag) if inm is not None and etag else bool(ims and ims == last_modified)
        h.send_response(304 if hit else 200)
        for k, v in (headers or {}).items():
            h.send_header(k, v)
        if etag:
            h.send_header("ETag", etag)
        if last_modified:
            h.send_header("Last-Modified", last_modified)
        if hit:
            h.end_headers()
            return
        h.send_header("Content-Length", str(len(body)))
        h.end_headers()
        h.wfile.write(body)
    return 200, {}, handle


class UpstreamRevalidateTest(Base):
    """F55: the fetcher keeps each URL's ETag/Last-Modified and body, asks the repo conditionally, serves 304s from
    what it kept; PackagesCache entries past their TTL are revalidated the same way."""

    def setUp(self):
        super().setUp()
        self.f.upstream_cache = fetch.UpstreamCache()

    def sent(self, path):
        return [h for p, h in Handler.seen if p == path]

    def test_etag_revalidated(self):
        Handler.routes = {"/Release": conditional(b"Origin: X\n", etag='"v1"', headers={"Content-Type": "text/plain"})}
        r = self.f.get(self.url("/Release"))
        self.assertEqual((r.status, r.body, r.revalidated), (200, b"Origin: X\n", False))
        self.assertNotIn("If-None-Match", self.sent("/Release")[0])
        r = self.f.get(self.url("/Release"))
        self.assertEqual(self.sent("/Release")[1].get("If-None-Match"), '"v1"')
        self.assertEqual((r.status, r.body, r.revalidated), (200, b"Origin: X\n", True))
        self.assertEqual(r.headers.get("content-type"), "text/plain")

    def test_last_modified_revalidated(self):
        lm = "Tue, 17 Nov 2026 10:00:00 GMT"
        Handler.routes = {"/i.png": conditional(b"\x89PNG", last_modified=lm)}
        self.f.get(self.url("/i.png"))
        r = self.f.get(self.url("/i.png"))
        self.assertEqual(self.sent("/i.png")[1].get("If-Modified-Since"), lm)
        self.assertTrue(r.revalidated)
        self.assertEqual(r.body, b"\x89PNG")

    def test_changed_body_replaces_kept(self):
        Handler.routes = {"/f": conditional(b"one", etag='"1"')}
        self.f.get(self.url("/f"))
        Handler.routes = {"/f": conditional(b"two", etag='"2"')}
        r = self.f.get(self.url("/f"))
        self.assertEqual((r.body, r.revalidated), (b"two", False))
        self.f.get(self.url("/f"))
        self.assertEqual(self.sent("/f")[2].get("If-None-Match"), '"2"')

    def test_no_validators_not_kept(self):
        Handler.routes = {"/plain": (200, {}, b"x")}
        self.f.get(self.url("/plain"))
        self.f.get(self.url("/plain"))
        self.assertEqual(len(self.f.upstream_cache), 0)
        self.assertNotIn("If-None-Match", self.sent("/plain")[1])
        self.assertNotIn("If-Modified-Since", self.sent("/plain")[1])

    def test_without_cache_nothing_sent(self):
        self.f.upstream_cache = None
        Handler.routes = {"/f": conditional(b"one", etag='"1"')}
        self.f.get(self.url("/f"))
        r = self.f.get(self.url("/f"))
        self.assertNotIn("If-None-Match", self.sent("/f")[1])
        self.assertEqual((r.status, r.body), (200, b"one"))

    def test_redirect_hops_rechecked_and_target_revalidated(self):
        Handler.routes = {"/r": (302, {"Location": "/f"}, b""), "/f": conditional(b"one", etag='"1"')}
        self.f.get(self.url("/r"))
        r = self.f.get(self.url("/r"))
        self.assertEqual(len(self.sent("/r")), 2)  # the redirect itself is always asked again
        self.assertEqual(self.sent("/f")[1].get("If-None-Match"), '"1"')
        self.assertTrue(r.revalidated)
        self.assertEqual(r.url, self.url("/f"))

    def test_cache_bounded(self):
        c = fetch.UpstreamCache(max_bytes=10, entry_max=8, max_entries=2)
        c.put("a", {"etag": '"a"'}, b"123456")
        c.put("b", {"etag": '"b"'}, b"123456")
        self.assertIsNone(c.get("a"))
        self.assertIsNotNone(c.get("b"))
        c.put("big", {"etag": '"x"'}, b"123456789")
        self.assertIsNone(c.get("big"))
        c.put("c", {"etag": '"c"'}, b"1")
        c.put("d", {"etag": '"d"'}, b"1")
        self.assertEqual(len(c), 2)

    def test_kept_body_over_call_cap_not_used(self):
        Handler.routes = {"/f": conditional(b"0123456789", etag='"1"')}
        self.f.get(self.url("/f"))
        with self.assertRaises(fetch.FetchError):
            self.f.get(self.url("/f"), max_bytes=5)
        self.assertNotIn("If-None-Match", self.sent("/f")[1])

    def test_strange_validator_not_sent(self):
        c = self.f.upstream_cache
        c.put(self.url("/f"), {"etag": '"a"\r\nX-Evil: 1'}, b"kept")
        Handler.routes = {"/f": (200, {}, b"fresh")}
        r = self.f.get(self.url("/f"))
        self.assertNotIn("X-Evil", self.sent("/f")[0])
        self.assertEqual(r.body, b"fresh")

    def test_packages_stale_revalidated(self):
        now = [1000.0]
        cache = fetch.PackagesCache(clock=lambda: now[0])
        Handler.routes = {"/r/Packages.bz2": conditional(bz2.compress(PACKAGES), etag='"p1"')}
        fetch.fetch_packages(self.f, self.url("/r"), cache)
        now[0] += 31 * 60
        n = len(Handler.seen)
        src, gz, cached = fetch.fetch_packages(self.f, self.url("/r"), cache)
        self.assertTrue(cached)
        self.assertEqual(gzip.decompress(gz), PACKAGES)
        self.assertEqual(src, self.url("/r/Packages.bz2"))
        self.assertEqual([p for p, _ in Handler.seen[n:]], ["/r/Packages.bz2"])  # no Packages.xz probe
        self.assertEqual(Handler.seen[-1][1].get("If-None-Match"), '"p1"')
        # refreshed: a fresh hit again, no request
        n = len(Handler.seen)
        self.assertTrue(fetch.fetch_packages(self.f, self.url("/r"), cache)[2])
        self.assertEqual(len(Handler.seen), n)
        # Packages bodies are kept by PackagesCache only, not twice
        self.assertIsNone(self.f.upstream_cache.get(self.url("/r/Packages.bz2")))

    def test_packages_stale_changed(self):
        now = [1000.0]
        cache = fetch.PackagesCache(clock=lambda: now[0])
        Handler.routes = {"/r/Packages.gz": conditional(gzip.compress(PACKAGES), etag='"p1"')}
        fetch.fetch_packages(self.f, self.url("/r"), cache)
        now[0] += 31 * 60
        new = PACKAGES + b"Package: com.example.two\nVersion: 2\n\n"
        Handler.routes = {"/r/Packages.gz": conditional(gzip.compress(new), etag='"p2"')}
        n = len(Handler.seen)
        _, gz, cached = fetch.fetch_packages(self.f, self.url("/r"), cache)
        self.assertFalse(cached)
        self.assertEqual(gzip.decompress(gz), new)
        self.assertEqual([p for p, _ in Handler.seen[n:]], ["/r/Packages.gz"])  # decoded, not fetched twice
        now[0] += 31 * 60
        fetch.fetch_packages(self.f, self.url("/r"), cache)
        self.assertEqual(Handler.seen[-1][1].get("If-None-Match"), '"p2"')

    def test_packages_stale_gone_searches_again(self):
        now = [1000.0]
        cache = fetch.PackagesCache(clock=lambda: now[0])
        Handler.routes = {"/r/Packages.xz": conditional(lzma.compress(PACKAGES), etag='"p1"')}
        fetch.fetch_packages(self.f, self.url("/r"), cache)
        now[0] += 31 * 60
        Handler.routes = {"/r/Packages": (200, {}, PACKAGES)}
        src, gz, cached = fetch.fetch_packages(self.f, self.url("/r"), cache)
        self.assertFalse(cached)
        self.assertEqual(src, self.url("/r/Packages"))
        self.assertEqual(gzip.decompress(gz), PACKAGES)

    def test_packages_without_validators_expire(self):
        now = [1000.0]
        cache = fetch.PackagesCache(clock=lambda: now[0])
        cache.put("k", "s", b"gz")
        now[0] += 31 * 60
        self.assertIsNone(cache.get("k"))
        self.assertIsNone(cache.stale("k"))
        cache.put("k", "s", b"gz", {"If-None-Match": '"1"'})
        self.assertIsNone(cache.stale("k"))  # fresh: not stale
        now[0] += 31 * 60
        self.assertIsNone(cache.get("k"))
        self.assertEqual(cache.stale("k"), ("s", b"gz", {"If-None-Match": '"1"'}))

    def test_route_serves_kept_body(self):
        import app as A
        saved = (A.fetcher, A.asset_limiter)
        A.fetcher, A.asset_limiter = self.f, fetch.RateLimiter(rate=1000)
        try:
            c = A.app.test_client()
            Handler.routes = {"/Release": conditional(b"Origin: X\n", etag='"v1"')}
            r1 = c.get("/api/fetch", query_string={"url": self.url("/Release")})
            r2 = c.get("/api/fetch", query_string={"url": self.url("/Release")})
            self.assertEqual((r1.status_code, r2.status_code), (200, 200))
            self.assertEqual(r2.data, b"Origin: X\n")
            self.assertEqual(r2.headers.get("X-Cache"), "REVALIDATED")
            self.assertEqual(self.sent("/Release")[1].get("If-None-Match"), '"v1"')
            # the phone's own revalidation still gets its 304 (F19), on top of the repo's
            r3 = c.get("/api/fetch", query_string={"url": self.url("/Release")},
                       headers={"If-None-Match": r2.headers["ETag"]})
            self.assertEqual((r3.status_code, r3.data), (304, b""))
        finally:
            A.fetcher, A.asset_limiter = saved

    def test_app_fetcher_has_upstream_cache(self):
        import app as A
        self.assertIsInstance(A.fetcher.upstream_cache, fetch.UpstreamCache)
