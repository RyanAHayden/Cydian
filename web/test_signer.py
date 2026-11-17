"""The signer (I5, web/signer/): identity checks, the token store, POST /sign's guards, and a real zsign run.

The certificate, CA and profile are throwaway ones made here (signer/testkit.py); the IPA is a tiny hand-built one.
A local HTTP server plays the IPA's host behind made-up public addresses, as in test_fetch.py, so the SSRF guard
runs unchanged. The zsign test needs zsign (CYDIAN_ZSIGN or on PATH) and openssl to check the CMS signature; where
they are missing it is skipped and says so.
"""
import base64
import datetime as dt
import io
import os
import plistlib
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
from flask import Flask  # noqa: E402

import fetch  # noqa: E402
import signer  # noqa: E402
from signer import identity as I  # noqa: E402
from signer import ipa as ipa_mod  # noqa: E402
from signer import testkit as T  # noqa: E402
from signer import zsign as Z  # noqa: E402

PUBLIC = "93.184.216.34"
KEY, CERT, CA = T.identity()
P12 = T.p12(KEY, CERT, CA)
PROFILE = T.profile(KEY, CERT)
IPA = T.ipa()
ZSIGN = Z.find()
OPENSSL = shutil.which("openssl")


class Handler(BaseHTTPRequestHandler):
    routes = {}

    def do_GET(self):
        body = self.routes.get(self.path)
        if body is None:
            self.send_response(404)
            self.end_headers()
            return
        if isinstance(body, tuple) and body[0] == "redirect":
            self.send_response(302)
            self.send_header("Location", body[1])
            self.end_headers()
            return
        if isinstance(body, tuple) and body[0] == "chunked":  # no Content-Length: the cap must hold while streaming
            self.send_response(200)
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            for _ in range(body[1]):
                chunk = b"x" * 65536
                self.wfile.write(b"%x\r\n%s\r\n" % (len(chunk), chunk))
            self.wfile.write(b"0\r\n\r\n")
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        Handler.routes = {"/app.ipa": IPA}
        self.dialed = []
        self.fetcher = fetch.Fetcher(resolve=self.resolve, dial=self.dial, timeout=5)
        self.dir = tempfile.mkdtemp(prefix="cydian-sign-test-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.store = signer.Store(self.dir)
        self.limiter = fetch.RateLimiter(rate=100, per=60)
        self.app = Flask(__name__)
        self.app.register_blueprint(signer.create_blueprint(self.fetcher, self.store, self.limiter,
                                                            binary=ZSIGN or "/nonexistent/zsign"))
        self.c = self.app.test_client()

    def resolve(self, host, port):
        if host.endswith(".test"):
            return [PUBLIC]
        if host == "private.example":
            return ["10.1.2.3"]
        return fetch.default_resolve(host, port)

    def dial(self, ip, port, timeout):
        self.dialed.append(ip)
        if ip == PUBLIC:
            import socket
            return socket.create_connection(("127.0.0.1", self.port), timeout=timeout)
        raise AssertionError(f"dialed a non-test address {ip}")

    def url(self, path="/app.ipa"):
        return f"http://ipa.test:{self.port}{path}"

    def post(self, url=None, p12=P12, profile=PROFILE, password="hunter2", **extra):
        body = {"url": url or self.url(), "p12": base64.b64encode(p12).decode(),
                "profile": base64.b64encode(profile).decode(), "password": password, **extra}
        return self.c.post("/sign", json=body, environ_base={"REMOTE_ADDR": "203.0.113.9"})


class IdentityTest(unittest.TestCase):
    def test_p12_modern_and_legacy(self):
        for legacy in (False, True):
            with self.subTest(legacy=legacy):
                ident = I.load_p12(T.p12(KEY, CERT, CA, legacy=legacy), "hunter2")
                self.assertEqual(ident.name, "Apple Development: Test Person (ABCDE12345)")
                self.assertEqual(ident.team, T.TEAM)
                self.assertEqual(len(ident.cas), 1)

    def test_wrong_password_and_not_a_p12(self):
        with self.assertRaises(I.SignError) as cm:
            I.load_p12(P12, "not-the-pw-71")
        self.assertEqual(cm.exception.code, "bad_password")
        self.assertNotIn("not-the-pw-71", str(cm.exception))  # the password never shows up in a message
        with self.assertRaises(I.SignError) as cm:
            I.load_p12(b"not a certificate at all", "x")
        self.assertEqual(cm.exception.code, "bad_p12")

    def test_profile_fields(self):
        p = I.parse_profile(PROFILE)
        self.assertEqual((p.team, p.app_id, p.devices, p.name), (T.TEAM, "*", 3, "Test Profile"))
        self.assertEqual(p.certs, [I.load_p12(P12, "hunter2").der()])
        self.assertEqual(p.entitlements["com.apple.developer.team-identifier"], T.TEAM)
        with self.assertRaises(I.SignError) as cm:
            I.parse_profile(b"\x30\x82garbage")
        self.assertEqual(cm.exception.code, "bad_profile")

    def test_expiry_and_membership(self):
        ident = I.load_p12(P12, "hunter2")
        I.check(ident, I.parse_profile(PROFILE))
        later = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=30)
        with self.assertRaises(I.SignError) as cm:
            I.check(ident, I.parse_profile(PROFILE), now=later)  # the 7-day profile is out first
        self.assertEqual(cm.exception.code, "profile_expired")
        old_key, old_cert, _ = T.identity(days=10, not_before=dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=20))
        with self.assertRaises(I.SignError) as cm:
            I.check(I.load_p12(T.p12(old_key, old_cert, CA), "hunter2"), I.parse_profile(T.profile(old_key, old_cert)))
        self.assertEqual(cm.exception.code, "cert_expired")
        other_key, other_cert, _ = T.identity()
        with self.assertRaises(I.SignError) as cm:
            I.check(ident, I.parse_profile(T.profile(other_key, other_cert)))
        self.assertEqual(cm.exception.code, "cert_not_in_profile")

    def test_app_id_fit(self):
        prof = lambda app_id: I.parse_profile(T.profile(KEY, CERT, app_id=app_id))  # noqa: E731
        self.assertEqual(I.target_bundle_id(prof("*"), "dev.cydian.fixture"), "dev.cydian.fixture")
        self.assertEqual(I.target_bundle_id(prof("dev.cydian.*"), "dev.cydian.fixture"), "dev.cydian.fixture")
        self.assertEqual(I.target_bundle_id(prof("com.me.myapp"), "dev.cydian.fixture"), "com.me.myapp")
        with self.assertRaises(I.SignError) as cm:
            I.target_bundle_id(prof("com.other.*"), "dev.cydian.fixture")
        self.assertEqual(cm.exception.code, "app_id_mismatch")


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="cydian-store-test-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.now = [1000.0]
        self.store = signer.Store(self.dir, ttl=600, clock=lambda: self.now[0])

    def held(self):
        src = os.path.join(self.dir, "src.ipa")
        Path(src).write_bytes(b"signed")
        return self.store.put(src, "a.b", "A", "1")

    def test_token_expires_and_file_goes(self):
        token = self.held()
        self.assertGreaterEqual(len(token), 43)  # 32 random bytes
        self.assertNotIn(token, "".join(os.listdir(self.dir)))  # files are named by the token's hash
        self.now[0] += 599
        self.assertIsNotNone(self.store.get(token))
        self.now[0] += 2
        self.assertIsNone(self.store.get(token))
        self.assertEqual(os.listdir(self.dir), [])

    def test_first_download_only(self):
        token = self.held()
        h, f = self.store.take(token)
        self.assertEqual(os.listdir(self.dir), [])  # unlinked as the download starts
        self.assertEqual(f.read(), b"signed")
        f.close()
        self.assertEqual(self.store.take(token), (None, None))
        self.assertIsNone(self.store.get(token))

    def test_restart_clears_leftovers(self):
        self.held()
        os.mkdir(os.path.join(self.dir, "job-x"))
        signer.Store(self.dir)
        self.assertEqual(os.listdir(self.dir), [])


class GuardTest(Base):
    def test_cors(self):
        r = self.c.options("/sign")
        self.assertEqual(r.status_code, 204)
        self.assertEqual(r.headers["Access-Control-Allow-Origin"], "*")
        self.assertIn("POST", r.headers["Access-Control-Allow-Methods"])
        r = self.post(password="wrong")
        self.assertEqual(r.headers["Access-Control-Allow-Origin"], "*")
        self.assertEqual(self.c.get("/sign/status").json["ok"], True)

    def test_identity_errors_before_any_download(self):
        cases = [({"password": "wrong"}, "bad_password"), ({"p12": b"junk"}, "bad_p12"),
                 ({"profile": b"junk"}, "bad_profile")]
        for kw, code in cases:
            with self.subTest(code=code):
                r = self.post(**kw)
                self.assertEqual((r.status_code, r.json["code"]), (400, code))
        self.assertEqual(self.dialed, [])
        r = self.c.post("/sign", json={"url": self.url(), "p12": "%%%", "profile": "x", "password": ""})
        self.assertEqual(r.json["code"], "bad_p12")

    def test_ssrf_refused(self):
        for url, code in [("http://127.0.0.1/app.ipa", "refused"), ("http://private.example/app.ipa", "refused"),
                          ("http://[::1]/a.ipa", "refused"), ("file:///etc/passwd", "bad_url"),
                          ("ftp://ipa.test/a.ipa", "bad_url"), ("http://user:pw@ipa.test/a.ipa", "bad_url")]:
            with self.subTest(url=url):
                r = self.post(url=url)
                self.assertEqual(r.json["code"], code, r.json)
                self.assertIn(r.status_code, (400, 403))
        Handler.routes["/hop"] = ("redirect", "http://127.0.0.1:1/app.ipa")
        r = self.post(url=self.url("/hop"))
        self.assertEqual(r.json["code"], "refused")
        self.assertEqual(self.dialed, [PUBLIC])  # the redirect's loopback target was never dialed

    def test_size_cap(self):
        Handler.routes["/big.ipa"] = b"x" * 300_000
        Handler.routes["/stream.ipa"] = ("chunked", 8)
        with mock.patch.object(signer, "MAX_BYTES", 200_000):
            for path in ("/big.ipa", "/stream.ipa"):
                with self.subTest(path=path):
                    r = self.post(url=self.url(path))
                    self.assertEqual((r.status_code, r.json["code"]), (413, "too_large"))
        self.assertEqual([n for n in os.listdir(self.dir)], [])  # the partial download went with its job

    def test_not_an_ipa(self):
        Handler.routes["/zip.ipa"] = _zip({"hello.txt": b"hi"})
        Handler.routes["/evil.ipa"] = _zip({"../../etc/x": b"hi", "Payload/A.app/Info.plist": plistlib.dumps({"CFBundleIdentifier": "a"})})
        for path in ("/zip.ipa", "/evil.ipa"):
            with self.subTest(path=path):
                r = self.post(url=self.url(path))
                self.assertEqual(r.json["code"], "bad_ipa", r.json)

    def test_rate_limit(self):
        self.limiter.rate = 2
        self.limiter._b.clear()
        codes = [self.post(password="wrong").status_code for _ in range(3)]
        self.assertEqual(codes, [400, 400, 429])

    def test_app_id_mismatch(self):
        r = self.post(profile=T.profile(KEY, CERT, app_id="com.other.*"))  # judged before zsign runs
        self.assertEqual((r.status_code, r.json["code"]), (400, "app_id_mismatch"))

    def test_unknown_token(self):
        self.assertEqual(self.c.get("/sign/nope/manifest.plist").status_code, 404)
        self.assertEqual(self.c.get("/sign/nope/app.ipa").status_code, 404)


def _zip(files):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for k, v in files.items():
            z.writestr(k, v)
    return buf.getvalue()


def code_signature(binary: bytes):
    """(CodeDirectory bytes, CMS DER, {identifier, team, hash_type, page_size, code_limit, ok_pages}) of a thin
    64-bit Mach-O, checking every code page's hash against the file."""
    import hashlib
    magic, _, _, _, ncmds, _, _, _ = struct.unpack_from("<IiiIIIII", binary)
    assert magic == 0xFEEDFACF
    off, sig = 32, None
    for _ in range(ncmds):
        cmd, size = struct.unpack_from("<II", binary, off)
        if cmd == 0x1D:
            sig = struct.unpack_from("<II", binary, off + 8)
        off += size
    assert sig, "no LC_CODE_SIGNATURE"
    blob = binary[sig[0]:sig[0] + sig[1]]
    sb_magic, _, count = struct.unpack_from(">III", blob)
    assert sb_magic == 0xFADE0CC0
    slots = {}
    for i in range(count):
        typ, o = struct.unpack_from(">II", blob, 12 + 8 * i)
        m, length = struct.unpack_from(">II", blob, o)
        slots[typ] = blob[o:o + length]
    cd = slots[0]
    (_, _, version, _, hash_off, ident_off, n_special, n_code, code_limit, hash_size, hash_type, _, page_shift,
     _) = struct.unpack_from(">IIIIIIIIIBBBBI", cd)
    ident = cd[ident_off:cd.index(b"\0", ident_off)].decode()
    team = None
    if version >= 0x20200:
        team_off = struct.unpack_from(">I", cd, 48)[0]
        team = cd[team_off:cd.index(b"\0", team_off)].decode() if team_off else None
    algo = {1: hashlib.sha1, 2: hashlib.sha256}[hash_type]
    page = 1 << page_shift
    ok = all(cd[hash_off + i * hash_size:hash_off + (i + 1) * hash_size]
             == algo(binary[i * page:min((i + 1) * page, code_limit)]).digest()[:hash_size] for i in range(n_code))
    cms = slots.get(0x10000, b"")[8:]
    return cd, cms, {"identifier": ident, "team": team, "pages_ok": ok, "n_code": n_code}


@unittest.skipUnless(ZSIGN, "zsign not installed (set CYDIAN_ZSIGN or put zsign on PATH): signing itself not run")
class SignTest(Base):
    def sign_and_fetch(self, **post):
        r = self.post(**post)
        self.assertEqual(r.status_code, 200, r.json)
        j = r.json
        self.assertTrue(j["itms"].startswith("itms-services://?action=download-manifest&url=http%3A%2F%2F"))
        self.assertEqual(j["expiresIn"], 600)
        token = j["manifest"].split("/sign/")[1].split("/")[0]
        m = plistlib.loads(self.c.get(f"/sign/{token}/manifest.plist").data)
        item = m["items"][0]
        self.assertEqual(item["metadata"]["bundle-identifier"], j["bundleId"])
        self.assertTrue(item["assets"][0]["url"].endswith(f"/sign/{token}/app.ipa"))
        r = self.c.get(f"/sign/{token}/app.ipa")
        self.assertEqual(r.status_code, 200)
        signed = r.data
        r.close()
        # first download only: the IPA, and the manifest pointing at it, are gone
        self.assertEqual(self.c.get(f"/sign/{token}/app.ipa").status_code, 404)
        self.assertEqual(self.c.get(f"/sign/{token}/manifest.plist").status_code, 404)
        self.assertEqual(os.listdir(self.dir), [])  # no job folder, no key, no IPA left behind
        return j, signed

    def test_sign_install_once(self):
        j, signed = self.sign_and_fetch()
        self.assertEqual((j["bundleId"], j["name"], j["version"]), ("dev.cydian.fixture", "Fixture", "1.0"))
        with zipfile.ZipFile(io.BytesIO(signed)) as z:
            names = z.namelist()
            self.assertIn("Payload/Fixture.app/embedded.mobileprovision", names)
            self.assertIn("Payload/Fixture.app/_CodeSignature/CodeResources", names)
            self.assertEqual(z.read("Payload/Fixture.app/embedded.mobileprovision"), PROFILE)
            binary = z.read("Payload/Fixture.app/Fixture")
        cd, cms, info = code_signature(binary)
        self.assertEqual(info["identifier"], "dev.cydian.fixture")
        self.assertEqual(info["team"], I.parse_profile(PROFILE).team)  # signed for the profile's team
        self.assertTrue(info["pages_ok"])
        self.assertGreater(info["n_code"], 0)
        # The CMS blob is signed by our leaf over the CodeDirectory.
        from cryptography.hazmat.primitives.serialization import pkcs7
        self.assertIn(CERT, pkcs7.load_der_pkcs7_certificates(cms))
        if not OPENSSL:
            self.skipTest("openssl not on PATH: CMS signature not checked")
        with tempfile.TemporaryDirectory() as d:
            Path(d, "cms.der").write_bytes(cms)
            Path(d, "cd.bin").write_bytes(cd)
            r = subprocess.run([OPENSSL, "cms", "-verify", "-noverify", "-binary", "-inform", "DER", "-in",
                                f"{d}/cms.der", "-content", f"{d}/cd.bin", "-out", os.devnull],
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)

    def test_explicit_profile_renames(self):
        prof = T.profile(KEY, CERT, app_id="com.me.fixture")
        j, signed = self.sign_and_fetch(profile=prof)
        self.assertEqual(j["bundleId"], "com.me.fixture")
        with zipfile.ZipFile(io.BytesIO(signed)) as z:
            info = plistlib.loads(z.read("Payload/Fixture.app/Info.plist"))
            _, _, cs = code_signature(z.read("Payload/Fixture.app/Fixture"))
        self.assertEqual(info["CFBundleIdentifier"], "com.me.fixture")
        self.assertEqual(cs["identifier"], "com.me.fixture")

    def test_token_expires(self):
        r = self.post()
        token = r.json["manifest"].split("/sign/")[1].split("/")[0]
        self.store.clock = lambda: 10**12  # far past the 10 minutes
        self.assertEqual(self.c.get(f"/sign/{token}/manifest.plist").status_code, 404)
        self.assertEqual(self.c.get(f"/sign/{token}/app.ipa").status_code, 404)
        self.assertEqual(os.listdir(self.dir), [])

    def test_public_url(self):
        with mock.patch.dict(os.environ, {"CYDIAN_PUBLIC_URL": "https://sign.example.org/"}):
            j = self.post().json
        self.assertTrue(j["manifest"].startswith("https://sign.example.org/sign/"))
        self.assertIn("url=https%3A%2F%2Fsign.example.org%2Fsign%2F", j["itms"])

    def test_https_unless_localhost(self):
        # Behind a proxy the server hears plain http, but the phone only installs itms-services over https.
        r = self.c.post("/sign", base_url="http://sign.example.org", environ_base={"REMOTE_ADDR": "203.0.113.9"},
                        json={"url": self.url(), "p12": base64.b64encode(P12).decode(),
                              "profile": base64.b64encode(PROFILE).decode(), "password": "hunter2"})
        self.assertTrue(r.json["manifest"].startswith("https://sign.example.org/sign/"), r.json)

    def test_key_reaches_zsign_only_through_memory(self):
        seen = {}
        real = subprocess.run

        def spy(cmd, **kw):
            seen["cmd"], seen["fds"] = cmd, kw.get("pass_fds")
            return real(cmd, **kw)

        with mock.patch.object(Z.subprocess, "run", spy):
            self.assertEqual(self.post().status_code, 200)
        k = seen["cmd"][seen["cmd"].index("-k") + 1]
        self.assertTrue(k.startswith("/dev/fd/"), k)
        self.assertNotIn("-p", seen["cmd"])  # no password on the command line
        self.assertNotIn("hunter2", " ".join(seen["cmd"]))


if __name__ == "__main__":
    unittest.main()
