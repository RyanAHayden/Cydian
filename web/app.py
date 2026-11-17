"""Cydian's web server. Thin: serves the shared frontend in web/app/, the SSRF-safe fetch proxy, Web Push (push.py),
and the signer (signer/, I5: POST /sign, docs/signing.md)."""
import hashlib
import os
from pathlib import Path
from urllib.parse import quote

from flask import Flask, jsonify, request, send_from_directory

import fetch
import push
import signer

APP_DIR = Path(__file__).resolve().parent / "app"

app = Flask(__name__, static_folder=None)

# Behind a reverse proxy, set CYDIAN_PROXY_HOPS to the number of proxies so the rate limit sees the visitor's IP.
if int(os.environ.get("CYDIAN_PROXY_HOPS", "0") or 0) > 0:
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=int(os.environ["CYDIAN_PROXY_HOPS"]))

fetcher = fetch.Fetcher()
packages_cache = fetch.PackagesCache()
rate_limiter = fetch.RateLimiter(rate=int(os.environ.get("CYDIAN_FETCH_RATE", "60")), per=60.0)
# Assets (icons, depictions, screenshots, .debs: any fetch without kind=packages) get their own, larger bucket, so a
# page of http icons can't starve Packages refreshes and a refresh can't blank the icons (B3).
asset_limiter = fetch.RateLimiter(rate=int(os.environ.get("CYDIAN_ASSET_RATE", "300")), per=60.0)
# Upgrade alerts (F10): /api/push/* and the private feed /feed/<token>; the daily check is `python push.py daemon`.
app.register_blueprint(push.create_blueprint(fetcher, packages_cache))
# Sign & install with the visitor's own certificate (I5): POST /sign, its manifest and IPA under a 10-minute token.
app.register_blueprint(signer.create_blueprint(fetcher))

ERROR_STATUS = {"bad_url": 400, "refused": 403, "too_large": 502, "timeout": 504, "upstream": 502,
                "not_found": 404, "network": 502}
# Proxied bodies come from strangers: never let them run as our origin.
SAFE_HEADERS = {"X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'; sandbox",
                "Cache-Control": "no-store"}
PASSTHROUGH_TYPES = ("image/png", "image/jpeg", "image/gif", "image/webp", "text/plain", "application/json")


def _header_url(url):
    return quote(url, safe=":/?#[]@!$&'()*+,;=%~")


def _error(code, message, status=None):
    body = {"error": message, "code": code}
    if status is not None:
        body["status"] = status
    resp = jsonify(body)
    resp.status_code = ERROR_STATUS.get(code, 502)
    resp.headers.update(SAFE_HEADERS)
    return resp


def _etag(body):
    return '"' + hashlib.sha256(body).hexdigest()[:32] + '"'


def _not_modified(etag, last_modified=None):
    """F19: whether the visitor's If-None-Match (else If-Modified-Since) says it already has this body."""
    inm = request.headers.get("If-None-Match")
    if inm is not None:
        return etag in [t.strip().removeprefix("W/") for t in inm.split(",")] or inm.strip() == "*"
    ims = request.headers.get("If-Modified-Since")
    return bool(ims and last_modified and ims.strip() == last_modified.strip())


def _answer(body, headers, last_modified=None):
    """The body with an ETag (and the repo's Last-Modified), or an empty 304 when the visitor has it already: an
    unchanged Release costs the phone no transfer (F19). The upstream fetch still happens (fetch.py sends no
    conditional headers upstream)."""
    etag = _etag(body)
    headers["ETag"] = etag
    if last_modified:
        headers["Last-Modified"] = last_modified
    if _not_modified(etag, last_modified):
        headers.pop("Content-Encoding", None)
        return b"", 304, headers
    return body, 200, headers


@app.get("/api/fetch")
def api_fetch():
    """`?url=<URL>`: the body of URL. `?url=<repo dir>&kind=packages`: the repo's Packages, as gzip-encoded
    plain text, whichever of Packages.xz/.bz2/.gz/plain exists first (cached 30 min per repo)."""
    url = request.args.get("url", "")
    kind = request.args.get("kind", "")
    limiter = asset_limiter if kind == "" else rate_limiter
    if not limiter.allow(request.remote_addr or "?"):
        resp = _error("rate_limited", "too many fetches, slow down")
        resp.status_code = 429
        resp.headers["Retry-After"] = "5"
        return resp
    try:
        if kind == "packages":
            source, gz, cached = fetch.fetch_packages(fetcher, url, packages_cache)
            headers = dict(SAFE_HEADERS)
            headers.update({"Content-Type": "text/plain; charset=utf-8", "Content-Encoding": "gzip",
                            "X-Source-URL": _header_url(source), "X-Cache": "HIT" if cached else "MISS",
                            "Vary": "Accept-Encoding"})
            return _answer(gz, headers)
        if kind:
            return _error("bad_url", f"unknown kind {kind!r}")
        r = fetcher.get(url)
    except fetch.FetchError as e:
        return _error(e.code, str(e), e.status)
    if not 200 <= r.status < 300:
        return _error("upstream", f"upstream answered HTTP {r.status}", r.status)
    ctype = r.headers.get("content-type", "").split(";")[0].strip().lower()
    headers = dict(SAFE_HEADERS)
    headers["Content-Type"] = (r.headers["content-type"] if ctype in PASSTHROUGH_TYPES
                               else "application/octet-stream")
    headers["X-Source-URL"] = _header_url(r.url)
    return _answer(r.body, headers, r.headers.get("last-modified"))


@app.get("/healthz")
def healthz():
    return "ok\n", 200, {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"}


@app.get("/")
def index():
    resp = send_from_directory(APP_DIR, "index.html")
    resp.headers["Cache-Control"] = "no-cache"
    return resp


# F8: /add?url=… opens Cydian with Add Source filled in (web/app/core/handoff.js); the page reads the query itself.
@app.get("/add")
def add_link():
    return index()


@app.get("/<path:path>")
def static_file(path):
    # send_from_directory refuses paths that leave APP_DIR and 404s missing files.
    resp = send_from_directory(APP_DIR, path)
    if path.endswith(".js"):
        resp.mimetype = "text/javascript"  # ES modules need a JS MIME type in every browser
    resp.headers["Cache-Control"] = "no-cache"  # revalidate (cheap: ETag) so a phone never keeps an old CSS/JS
    return resp


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8080, debug=True)
