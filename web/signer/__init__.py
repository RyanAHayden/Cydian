"""Cydian's signer (I5): POST /sign signs an IPA with the visitor's own certificate and answers with an
itms-services:// link the phone installs from. docs/signing.md is the long version.

  POST /sign                      JSON {url, p12, profile (both base64), password}
                                  -> {itms, manifest, expiresIn, bundleId, name, version}
  POST /sign  with "async": true  -> 202 {job, status, poll} at once, once the certificate checks pass (F47)
  GET  /sign/job/<job>            {status: downloading | signing | done (+ the fields above) | error (+ error, code,
                                  httpStatus)}: the phone polls it, so no one request outlasts a proxy's timeout
  GET  /sign/<token>/manifest.plist   the install manifest iOS reads (until the token expires)
  GET  /sign/manifest?bundleid=&version=&title=&port=&path=   a manifest for an IPA the phone serves at 127.0.0.1:<port>/<path>
  GET  /sign/<token>/app.ipa          the signed IPA (HEAD and Range too), until the token expires
  GET  /sign/status                   {ok, zsign, maxBytes, ttl, jobs}: Settings > Signing asks if this server signs

The certificate, its key, the password and the profile live in this request's memory and go to zsign through
memfd (signer/zsign.py): never a file, never a log line. The downloaded and the signed IPA are on disk in
CYDIAN_SIGN_DIR (a private temp folder by default): the download only while the job runs, the signed one under a
random 256-bit token for TTL seconds. CORS is open on /sign so
any copy of the page can use any signing server (the user's own, docs/signing.md).

The store is this process's memory: run one gunicorn worker (threads are fine), as the Dockerfile does.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import os
import plistlib
import re
import secrets
import shutil
import tempfile
import threading
import time
from dataclasses import dataclass
from urllib.parse import urlsplit, quote

from flask import Blueprint, Response, jsonify, request, send_file

import fetch

from . import ipa as ipa_mod
from . import zsign
from .identity import SignError, app_entitlements, check, load_p12, parse_profile, target_bundle_id

TTL = int(os.environ.get("CYDIAN_SIGN_TTL", "600"))                         # seconds a signed IPA is kept
MAX_BYTES = int(os.environ.get("CYDIAN_SIGN_MAX_BYTES", str(1024 * 2**20)))  # IPA download cap
MAX_UNZIPPED = int(os.environ.get("CYDIAN_SIGN_MAX_UNZIPPED", str(4 * MAX_BYTES)))
STORE_BYTES = int(os.environ.get("CYDIAN_SIGN_STORE_BYTES", str(8 * 2**30)))  # all signed IPAs held at once
JOBS = int(os.environ.get("CYDIAN_SIGN_JOBS", "2"))                          # signing jobs at once
DOWNLOAD_TIMEOUT = float(os.environ.get("CYDIAN_SIGN_DOWNLOAD_TIMEOUT", "300"))
SIGN_TIMEOUT = float(os.environ.get("CYDIAN_SIGN_TIMEOUT", "300"))
MAX_BODY = 4 * 2**20  # the JSON: a p12 and a profile, base64, are a few kB to a few hundred kB

CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600"}


@dataclass
class Held:
    path: str
    expires: float
    bundle_id: str
    name: str
    version: str
    size: int


@dataclass
class Job:
    status: str                 # downloading, signing, done, error
    finished: float | None = None
    answer: dict | None = None  # done: what a synchronous POST answers; error: {error, code, httpStatus}


class Jobs:
    """job id -> Job, for asynchronous signing (F47). Ids are secrets.token_urlsafe(32), like the tokens: a done job
    holds the install link. A finished job is kept for `ttl` seconds (the signed IPA's own lifetime) so a poll that
    missed the end still reads it; a running one is kept until it ends."""

    def __init__(self, ttl: float = TTL, clock=time.monotonic):
        self.ttl, self.clock = ttl, clock
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def new(self) -> str:
        job_id = secrets.token_urlsafe(32)
        with self._lock:
            self._jobs[job_id] = Job("downloading")
        return job_id

    def set(self, job_id: str, status: str, answer: dict | None = None):
        with self._lock:
            j = self._jobs.get(job_id)
            if not j:
                return
            j.status, j.answer = status, answer
            if status in ("done", "error"):
                j.finished = self.clock()

    def get(self, job_id: str) -> Job | None:
        self.sweep()
        with self._lock:
            j = self._jobs.get(job_id)
            return Job(j.status, j.finished, j.answer) if j else None

    def sweep(self):
        now = self.clock()
        with self._lock:
            for k in [k for k, j in self._jobs.items() if j.finished is not None and j.finished + self.ttl <= now]:
                del self._jobs[k]

    def __len__(self):
        with self._lock:
            return len(self._jobs)


class Store:
    """token -> signed IPA on disk. Tokens are secrets.token_urlsafe(32); files are named by the token's hash, so a
    directory listing gives no token away."""

    def __init__(self, root: str | None = None, ttl: float = TTL, max_bytes: int = STORE_BYTES, clock=time.monotonic):
        self.root = root or os.environ.get("CYDIAN_SIGN_DIR") or os.path.join(tempfile.gettempdir(), "cydian-sign")
        os.makedirs(self.root, mode=0o700, exist_ok=True)
        os.chmod(self.root, 0o700)
        self.ttl, self.max_bytes, self.clock = ttl, max_bytes, clock
        self._held: dict[str, Held] = {}
        self._lock = threading.Lock()
        self._clean_leftovers()

    def _clean_leftovers(self):
        # A restart forgets every token, so whatever is in the folder can never be fetched again.
        for name in os.listdir(self.root):
            p = os.path.join(self.root, name)
            shutil.rmtree(p, ignore_errors=True) if os.path.isdir(p) else _unlink(p)

    def workdir(self) -> str:
        return tempfile.mkdtemp(prefix="job-", dir=self.root)

    def room(self) -> bool:
        self.sweep()
        with self._lock:
            return sum(h.size for h in self._held.values()) < self.max_bytes

    def put(self, src: str, bundle_id: str, name: str, version: str) -> str:
        token = secrets.token_urlsafe(32)
        path = os.path.join(self.root, hashlib.sha256(token.encode()).hexdigest() + ".ipa")
        os.replace(src, path)
        with self._lock:
            self._held[token] = Held(path, self.clock() + self.ttl, bundle_id, name, version, os.path.getsize(path))
        return token

    def get(self, token: str) -> Held | None:
        self.sweep()
        with self._lock:
            h = self._held.get(token)
            return h

    def take(self, token: str):
        """The open file of a token's IPA, once: the file is unlinked at once (the open handle still reads it) and the
        token forgotten, so a second download, or anyone who learns the link later, gets nothing."""
        self.sweep()
        with self._lock:
            h = self._held.pop(token, None)
            if not h:
                return None, None
        try:
            f = open(h.path, "rb")
        except OSError:
            return None, None
        _unlink(h.path)
        return h, f

    def sweep(self):
        now = self.clock()
        with self._lock:
            old = [t for t, h in self._held.items() if h.expires <= now]
            gone = [self._held.pop(t) for t in old]
        for h in gone:
            _unlink(h.path)

    def __len__(self):
        with self._lock:
            return len(self._held)


def _unlink(p):
    try:
        os.unlink(p)
    except OSError:
        pass


def _b64(value, what: str) -> bytes:
    if not isinstance(value, str) or not value:
        raise SignError(f"bad_{what}", f"No {'certificate (.p12)' if what == 'p12' else 'provisioning profile'} was sent.")
    try:
        return base64.b64decode(value.split(",", 1)[-1] if value.startswith("data:") else value, validate=True)
    except (binascii.Error, ValueError):
        raise SignError(f"bad_{what}", "A file arrived garbled (not base64).") from None


def create_blueprint(fetcher: fetch.Fetcher, store: Store | None = None, limiter: fetch.RateLimiter | None = None,
                     binary: str | None = None, jobs_registry: Jobs | None = None) -> Blueprint:
    bp = Blueprint("signer", __name__)
    state = {"store": store}
    registry = jobs_registry or Jobs()
    limiter = limiter or fetch.RateLimiter(rate=int(os.environ.get("CYDIAN_SIGN_RATE", "10")), per=600.0)
    jobs = threading.BoundedSemaphore(JOBS)

    def db() -> Store:
        if state["store"] is None:
            state["store"] = Store()
        return state["store"]

    def zsign_path():
        return binary or zsign.find()

    def answer(body, status=200, **headers):
        r = jsonify(body)
        r.status_code = status
        r.headers.update(CORS)
        r.headers["Cache-Control"] = "no-store"
        r.headers.update(headers)
        return r

    def err(e: SignError):
        return answer({"error": str(e), "code": e.code}, e.status)

    def base_url() -> str:
        """Where the phone reaches this server: CYDIAN_PUBLIC_URL, else the request's own host over https (iOS only
        installs itms-services over https, and a proxy in front usually speaks plain http to us); plain http only
        for localhost, where nothing installs anyway but tests and curl look."""
        pub = os.environ.get("CYDIAN_PUBLIC_URL", "").strip()
        if pub:
            return pub.rstrip("/")
        root = request.url_root.rstrip("/")
        host = request.host.rsplit(":", 1)[0].strip("[]")
        if host in ("localhost", "::1") or host.startswith("127."):
            return root
        return "https" + root[root.index(":"):]

    @bp.route("/sign", methods=["OPTIONS"])
    @bp.route("/sign/status", methods=["OPTIONS"])
    @bp.route("/sign/job/<job_id>", methods=["OPTIONS"])
    def preflight(job_id=None):
        return Response(status=204, headers=CORS)

    @bp.get("/sign/status")
    def status():
        return answer({"ok": True, "zsign": bool(zsign_path()), "maxBytes": MAX_BYTES, "ttl": int(db().ttl),
                       "jobs": True})

    @bp.get("/sign/manifest")
    def loopback_manifest():
        """Feather's "Semi Local", done with our own server: the itms-services manifest for an IPA the phone serves
        itself over plain HTTP at 127.0.0.1 (the sideload app's install server). iOS insists on HTTPS only for the
        manifest, so no certificate has to be trusted on the phone. Only loopback IPA URLs are accepted (this is
        no open redirect), and nothing is stored or logged."""
        q = request.args
        # port + path is what the app sends: a query holding "http://127.0.0.1" is refused as an exploit by common
        # proxy filters (Nginx Proxy Manager's "Block Common Exploits" answered iOS's installer 403). url= still works.
        url = q.get("url", "")
        if not url and q.get("port", "").isdigit() and re.fullmatch(r"[A-Za-z0-9/._-]{1,200}", q.get("path", "")):
            url = f"http://127.0.0.1:{int(q['port'])}/{q['path'].lstrip('/')}"
        try:
            u = urlsplit(url)
            port = u.port
        except ValueError:
            u, port = None, None
        if not u or u.scheme != "http" or u.hostname not in ("127.0.0.1", "localhost") or not port or u.username or u.password:
            return answer({"error": "Only an IPA on this iPhone (http://127.0.0.1:<port>/...) can be installed this way.",
                           "code": "bad_url"}, 400)
        bundle_id, version, title = q.get("bundleid", ""), q.get("version", "") or "1.0", q.get("title", "")
        if not re.fullmatch(r"[A-Za-z0-9.\-]{1,155}", bundle_id) or len(version) > 64 or len(title) > 200:
            return answer({"error": "Bad bundle ID, version or title.", "code": "bad_request"}, 400)
        doc = {"items": [{"assets": [{"kind": "software-package", "url": url}],
                          "metadata": {"bundle-identifier": bundle_id, "bundle-version": version, "kind": "software",
                                       "title": title or bundle_id}}]}
        return Response(plistlib.dumps(doc), 200, {"Content-Type": "application/xml", "Cache-Control": "no-store",
                                                    "X-Content-Type-Options": "nosniff"})

    @bp.post("/sign")
    def sign():
        if not limiter.allow(request.remote_addr or "?"):
            return answer({"error": "Too many signing requests from this address: wait a few minutes.",
                           "code": "rate_limited"}, 429, **{"Retry-After": "60"})
        if (request.content_length or 0) > MAX_BODY:
            return err(SignError("too_large", "The request is too large: a .p12 and a profile are a few kB.", 413))
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return err(SignError("bad_request", "Send JSON: {url, p12, profile, password}."))
        try:
            url = body.get("url")
            if not isinstance(url, str) or not url:
                raise SignError("bad_url", "No IPA URL was sent.")
            identity = load_p12(_b64(body.get("p12"), "p12"), body.get("password") or "")
            profile_bytes = _b64(body.get("profile"), "profile")
            profile = parse_profile(profile_bytes)
            check(identity, profile)
            binary_path = zsign_path()
            if not binary_path:
                raise SignError("unsupported", "This server has no zsign, so it can't sign.", 501)
            if not db().room():
                raise SignError("busy", "This server is holding too many signed apps: try again in a few minutes.", 503)
            if not jobs.acquire(blocking=False):
                raise SignError("busy", "This server is signing other apps: try again in a minute.", 503)
            base = base_url()
            if body.get("async") is True:
                # F47: answer now and sign in a thread, so a big IPA's download and zsign outlast no proxy's
                # timeout (Cloudflare 100 s, Nginx 60 s). The checks above already ran, so a bad pair still fails
                # in this response. The thread owns the job slot from here.
                job_id = registry.new()
                args = (db(), fetcher, binary_path, url, identity, profile, profile_bytes, base, job_id)
                try:
                    threading.Thread(target=background, args=args, name="cydian-sign-job", daemon=True).start()
                except BaseException:
                    jobs.release()
                    registry.set(job_id, "error", {"error": "The server couldn't start the job.", "code": "busy",
                                                   "httpStatus": 503})
                    raise
                return answer({"job": job_id, "status": "downloading", "poll": 1}, 202,
                              Location=f"{base}/sign/job/{job_id}")
            try:
                token, app = _run(db(), fetcher, binary_path, url, identity, profile, profile_bytes)
            finally:
                jobs.release()
        except SignError as e:
            return err(e)
        finally:
            body = identity = None  # noqa: F841 - drop the references to the key and password at once
        return answer(_done(base, token, app, db().ttl))

    def background(store_, fetcher_, binary_path, url, identity, profile, profile_bytes, base, job_id):
        end = ("error", {"error": "The signing server failed while signing this app.", "code": "internal",
                         "httpStatus": 500})  # a crash must still end the job, without echoing anything secret
        try:
            token, app = _run(store_, fetcher_, binary_path, url, identity, profile, profile_bytes,
                              on_phase=lambda phase: registry.set(job_id, phase))
            end = ("done", _done(base, token, app, store_.ttl))
        except SignError as e:
            end = ("error", {"error": str(e), "code": e.code, "httpStatus": e.status})
        except Exception:  # noqa: BLE001
            pass
        finally:
            identity = None  # noqa: F841
            jobs.release()  # before the job says it ended: a poll that sees "done" may sign again at once
            registry.set(job_id, *end)

    @bp.get("/sign/job/<job_id>")
    def job_status(job_id):
        j = registry.get(job_id)
        if not j:
            return answer({"error": "This signing job is unknown or expired: sign the app again.", "code": "gone"}, 404)
        return answer({"job": job_id, "status": j.status, **(j.answer or {})})

    @bp.get("/sign/<token>/manifest.plist")
    def manifest(token):
        h = db().get(token)
        if not h:
            return answer({"error": "This install link has expired: sign the app again.", "code": "gone"}, 404)
        doc = {"items": [{
            "assets": [{"kind": "software-package", "url": f"{base_url()}/sign/{token}/app.ipa"}],
            "metadata": {"bundle-identifier": h.bundle_id, "bundle-version": h.version, "kind": "software",
                         "title": h.name},
        }]}
        return Response(plistlib.dumps(doc), 200, {"Content-Type": "application/xml", "Cache-Control": "no-store",
                                                    "X-Content-Type-Options": "nosniff", **CORS})

    @bp.get("/sign/<token>/app.ipa")
    def download(token):
        # Every request until the token expires: iOS's installer asks more than once (a HEAD, then the download,
        # sometimes in ranges), and a link that answered only the first request made every install fail with
        # "Unable to Install". send_file answers HEAD and Range itself.
        h = db().get(token)
        if not h:
            return answer({"error": "This install link has expired: sign the app again.", "code": "gone"}, 404)
        try:
            r = send_file(h.path, mimetype="application/octet-stream", conditional=True, max_age=0,
                          as_attachment=True, download_name="app.ipa")
        except FileNotFoundError:  # swept just now
            return answer({"error": "This install link has expired: sign the app again.", "code": "gone"}, 404)
        r.headers["Cache-Control"] = "no-store"
        r.headers["X-Content-Type-Options"] = "nosniff"
        return r

    return bp


def _done(base: str, token: str, app, ttl: float) -> dict:
    manifest = f"{base}/sign/{token}/manifest.plist"
    return {"itms": "itms-services://?action=download-manifest&url=" + quote(manifest, safe=""),
            "manifest": manifest, "expiresIn": int(ttl), "bundleId": app.bundle_id,
            "name": app.name, "version": app.version}


def _run(store: Store, fetcher, binary, url, identity, profile, profile_bytes, on_phase=lambda phase: None):
    work = store.workdir()
    try:
        src, out = os.path.join(work, "in.ipa"), os.path.join(work, "out.ipa")
        on_phase("downloading")
        ipa_mod.download(fetcher, url, src, MAX_BYTES, DOWNLOAD_TIMEOUT)
        app = ipa_mod.inspect(src, MAX_UNZIPPED)
        bundle_id = target_bundle_id(profile, app.bundle_id)
        on_phase("signing")
        zsign.sign(binary, src, out, identity.unlocked_p12(), profile_bytes, work,
                   bundle_id=bundle_id if bundle_id != app.bundle_id else None, timeout=SIGN_TIMEOUT,
                   entitlements=app_entitlements(profile, bundle_id))
        app.bundle_id = bundle_id
        return store.put(out, app.bundle_id, app.name, app.version), app
    finally:
        shutil.rmtree(work, ignore_errors=True)
