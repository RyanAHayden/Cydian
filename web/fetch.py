"""SSRF-safe fetcher behind `/api/fetch`. Every URL a visitor types goes through here.

The guard: http(s) only; the host is resolved once per hop and refused if *any* address it resolves to is not a
public unicast address (private, loopback, link-local, CGNAT, multicast, reserved, unspecified, and IPv6 forms
that embed one of those: v4-mapped, NAT64, 6to4, Teredo). The socket then connects to that checked IP (never
re-resolving: no DNS rebinding window), with SNI and certificate checks against the original hostname. Redirects
are followed by hand, each hop re-checked. Caps: MAX_BYTES on the wire, MAX_PLAIN after decompression, TIMEOUT
seconds for the whole fetch (all hops).

Stdlib only (http.client, ssl, ipaddress, lzma/bz2/gzip).
"""
from __future__ import annotations

import bz2
import gzip
import http.client
import ipaddress
import lzma
import socket
import ssl
import threading
import time
import zlib
from collections import OrderedDict
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit

MAX_BYTES = 50 * 1024 * 1024        # body as sent by the repo
MAX_PLAIN = 200 * 1024 * 1024       # a decompressed Packages file (zip-bomb guard)
TIMEOUT = 30.0                      # seconds, whole fetch including redirects
MAX_REDIRECTS = 5
CACHE_TTL = 30 * 60                 # Packages cache, seconds
CACHE_MAX_BYTES = 256 * 1024 * 1024  # total gzipped bytes kept
UPSTREAM_ENTRY_MAX = 4 * 1024 * 1024    # F55: largest body kept for upstream revalidation
UPSTREAM_MAX_BYTES = 64 * 1024 * 1024   # F55: total bodies kept for upstream revalidation
UPSTREAM_MAX_ENTRIES = 2048

# Cydia's request headers (MobileCydia.mm). Some repos gate content on them, so we look like a modern device.
# X-Unique-ID (the device UDID) is not sent: we have no device, and a made-up one would be shared by everyone.
HEADERS = {
    "User-Agent": "Telesphoreo APT-HTTP/1.0.592",
    "X-Machine": "iPhone14,2",
    "X-Firmware": "16.5",
    "Accept-Encoding": "identity",  # we decompress Packages ourselves; no surprise gzip layers
}

# Tried in this order; the first that answers 200 and decodes wins.
PACKAGES_NAMES = (
    ("Packages.xz", lzma.decompress),
    ("Packages.bz2", bz2.decompress),
    ("Packages.gz", gzip.decompress),
    ("Packages", None),
)

CGNAT = ipaddress.ip_network("100.64.0.0/10")
NAT64 = ipaddress.ip_network("64:ff9b::/96")
NAT64_LOCAL = ipaddress.ip_network("64:ff9b:1::/48")


class FetchError(Exception):
    """`code` is one of: bad_url, refused, too_large, timeout, upstream, not_found, network."""

    def __init__(self, code: str, message: str, status: int | None = None):
        super().__init__(message)
        self.code = code
        self.status = status  # the upstream HTTP status, for code=upstream


def ip_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> str | None:
    """Why this address must not be fetched from, or None when it is public unicast."""
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.scope_id:
            return "scoped IPv6"
        if ip.teredo:
            return "Teredo"
        if ip in NAT64_LOCAL:
            return "local NAT64"
        if ip.is_site_local:
            return "site-local"
        if ip.ipv4_mapped:
            return ip_blocked(ip.ipv4_mapped)
        # NAT64 and 6to4 reach the IPv4 address they embed: that address decides.
        embedded = ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF) if ip in NAT64 else ip.sixtofour
        if embedded is not None:
            why = ip_blocked(embedded)
            return f"{why} (embedded in {ip})" if why else None
    if ip.is_multicast:
        return "multicast"
    if ip.is_loopback:
        return "loopback"
    if ip.is_link_local:
        return "link-local"
    if ip.is_unspecified:
        return "unspecified"
    if isinstance(ip, ipaddress.IPv4Address) and ip in CGNAT:
        return "CGNAT"
    if ip.is_private:
        return "private"
    if ip.is_reserved:
        return "reserved"
    if not ip.is_global:
        return "not global"
    return None


def default_resolve(host: str, port: int) -> list[str]:
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return [info[4][0] for info in infos]


def default_dial(ip: str, port: int, timeout: float) -> socket.socket:
    return socket.create_connection((ip, port), timeout=timeout)


@dataclass
class Target:
    scheme: str
    host: str
    port: int
    ip: str
    path: str  # path + query, as sent on the request line


@dataclass
class Response:
    url: str            # final URL, after redirects
    status: int
    headers: dict
    body: bytes
    revalidated: bool = False  # F55: the repo answered 304 and this is the kept body


def validators(headers: dict) -> dict:
    """The conditional-request headers that revalidate a response with these (lower-cased) headers: If-None-Match
    from its ETag, If-Modified-Since from its Last-Modified. Empty when it has neither."""
    out = {}
    if headers.get("etag"):
        out["If-None-Match"] = headers["etag"]
    if headers.get("last-modified"):
        out["If-Modified-Since"] = headers["last-modified"]
    return out


class UpstreamCache:
    """F55: URL -> (validators, headers, body) of the last 200 that carried an ETag or Last-Modified, so the next
    fetch of that URL asks the repo If-None-Match/If-Modified-Since and a 304 is answered from the kept body.
    LRU, bounded by entry count and total body bytes; bodies over `entry_max` are not kept."""

    def __init__(self, max_bytes: int = UPSTREAM_MAX_BYTES, max_entries: int = UPSTREAM_MAX_ENTRIES,
                 entry_max: int = UPSTREAM_ENTRY_MAX):
        self.max_bytes, self.max_entries, self.entry_max = max_bytes, max_entries, entry_max
        self._d: OrderedDict[str, tuple[dict, dict, bytes]] = OrderedDict()
        self._bytes = 0
        self._lock = threading.Lock()

    def get(self, url: str):
        with self._lock:
            hit = self._d.get(url)
            if hit:
                self._d.move_to_end(url)
            return hit

    def put(self, url: str, headers: dict, body: bytes):
        v = validators(headers)
        with self._lock:
            old = self._d.pop(url, None)
            if old:
                self._bytes -= len(old[2])
            if not v or len(body) > self.entry_max:
                return
            self._d[url] = (v, dict(headers), body)
            self._bytes += len(body)
            while self._d and (self._bytes > self.max_bytes or len(self._d) > self.max_entries):
                _, gone = self._d.popitem(last=False)
                self._bytes -= len(gone[2])

    def __len__(self):
        return len(self._d)


@dataclass
class Fetcher:
    """`resolve` and `dial` are the only seams: tests swap them to point a public-looking IP at a local server,
    so the guard itself runs unchanged."""
    resolve: callable = default_resolve
    dial: callable = default_dial
    max_bytes: int = MAX_BYTES
    timeout: float = TIMEOUT
    ssl_context: ssl.SSLContext = field(default_factory=ssl.create_default_context)
    upstream_cache: UpstreamCache | None = None  # F55: revalidate repeat fetches upstream (None: never)

    def check(self, url: str) -> Target:
        """Parse and resolve `url`, refusing anything but a public http(s) host. Returns the IP to dial."""
        if not isinstance(url, str) or len(url) > 4096:
            raise FetchError("bad_url", "missing or overlong URL")
        try:
            parts = urlsplit(url.strip())
            port = parts.port
        except ValueError as e:
            raise FetchError("bad_url", f"unparseable URL: {e}") from None
        scheme = parts.scheme.lower()
        if scheme not in ("http", "https"):
            raise FetchError("bad_url", "only http and https URLs can be fetched")
        if parts.username is not None or parts.password is not None:
            raise FetchError("bad_url", "URLs with credentials are not fetched")
        host = parts.hostname
        if not host:
            raise FetchError("bad_url", "URL has no host")
        if any(c in host for c in "\r\n\t \0"):
            raise FetchError("bad_url", "bad characters in host")
        port = port or (443 if scheme == "https" else 80)
        try:
            ips = self.resolve(host, port)
        except (OSError, UnicodeError) as e:
            raise FetchError("network", f"cannot resolve {host}: {e}") from None
        if not ips:
            raise FetchError("network", f"{host} has no address")
        for raw in ips:
            try:
                ip = ipaddress.ip_address(raw)
            except ValueError:
                raise FetchError("refused", f"{host} resolved to a strange address") from None
            why = ip_blocked(ip)
            if why:
                raise FetchError("refused", f"{host} resolves to a {why} address ({ip})")
        path = parts.path or "/"
        if parts.query:
            path += "?" + parts.query
        return Target(scheme, host, port, str(ipaddress.ip_address(ips[0])), path)

    def get(self, url: str, deadline: float | None = None, max_bytes: int | None = None,
            headers: dict | None = None, conditional: bool = True) -> Response:
        """GET `url`, following redirects (each re-checked). Raises FetchError; non-2xx is returned, not raised.

        `headers` are extra request headers (a caller's own If-None-Match: its 304 comes back as is). With an
        `upstream_cache` and `conditional`, each hop whose URL has a kept 200 is asked conditionally, and a 304 is
        returned as that kept 200 with `revalidated` set (F55)."""
        deadline = deadline or (time.monotonic() + self.timeout)
        max_bytes = max_bytes or self.max_bytes
        cache = self.upstream_cache if conditional and not headers else None
        for _ in range(MAX_REDIRECTS + 1):
            target = self.check(url)
            kept = cache.get(url) if cache is not None else None
            if kept and len(kept[2]) > max_bytes:
                kept = None
            status, rheaders, body = self._request(target, deadline, max_bytes, kept[0] if kept else headers)
            if status in (301, 302, 303, 307, 308) and rheaders.get("location"):
                url = urljoin(url, rheaders["location"])
                continue
            if kept and status == 304:
                merged = dict(kept[1])
                for k in ("etag", "last-modified", "cache-control", "expires", "date"):
                    if rheaders.get(k):
                        merged[k] = rheaders[k]  # a 304 may carry fresher validators (RFC 9111 4.3.4)
                if merged != kept[1]:
                    cache.put(url, merged, kept[2])
                return Response(url, 200, merged, kept[2], revalidated=True)
            if cache is not None and status == 200:
                cache.put(url, rheaders, body)
            return Response(url, status, rheaders, body)
        raise FetchError("upstream", "too many redirects")

    def _remaining(self, deadline: float) -> float:
        left = deadline - time.monotonic()
        if left <= 0:
            raise FetchError("timeout", f"gave up after {self.timeout:g} s")
        return left

    def _request(self, t: Target, deadline: float, max_bytes: int, extra: dict | None = None):
        conn = _PinnedConnection(t, self, self._remaining(deadline))
        try:
            try:
                conn.putrequest("GET", t.path, skip_accept_encoding=True)
                for k, v in HEADERS.items():
                    conn.putheader(k, v)
                for k, v in (extra or {}).items():
                    if any(c in str(v) for c in "\r\n\0"):
                        continue  # a kept validator from a stranger: never let it split the request
                    conn.putheader(k, v)
                conn.putheader("Accept", "*/*")
                conn.putheader("Connection", "close")
                conn.endheaders()
                sock = conn.sock  # http.client drops conn.sock once a Connection: close response starts
                _settimeout(sock, self._remaining(deadline))
                resp = conn.getresponse()
                headers = {k.lower(): v for k, v in resp.getheaders()}
                if resp.status in (301, 302, 303, 307, 308):
                    return resp.status, headers, b""
                length = headers.get("content-length")
                if length and length.isdigit() and int(length) > max_bytes:
                    raise FetchError("too_large", f"body is {int(length)} bytes, over the {max_bytes} cap")
                chunks, total = [], 0
                while True:
                    _settimeout(sock, self._remaining(deadline))
                    chunk = resp.read1(65536) if hasattr(resp, "read1") else resp.read(65536)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > max_bytes:
                        raise FetchError("too_large", f"body is over the {max_bytes} byte cap")
                    chunks.append(chunk)
                return resp.status, headers, b"".join(chunks)
            except socket.timeout:
                raise FetchError("timeout", f"gave up after {self.timeout:g} s") from None
            except ssl.SSLError as e:
                raise FetchError("network", f"TLS error: {e}") from None
            except (OSError, http.client.HTTPException) as e:
                raise FetchError("network", f"{type(e).__name__}: {e}") from None
        finally:
            conn.close()


def _settimeout(sock, seconds):
    """Shrink the socket timeout to what is left of the deadline. Once http.client has closed its handle (the
    body is fully buffered) this fails, harmlessly: the earlier, longer-but-bounded timeout still holds."""
    try:
        sock.settimeout(seconds)
    except OSError:
        pass


class _PinnedConnection(http.client.HTTPConnection):
    """An HTTP(S) connection to `target.ip`, with Host/SNI/cert checks for `target.host`."""

    def __init__(self, target: Target, fetcher: Fetcher, timeout: float):
        super().__init__(target.host, target.port, timeout=timeout)
        self._target = target
        self._fetcher = fetcher

    def connect(self):
        t = self._target
        try:
            sock = self._fetcher.dial(t.ip, t.port, self.timeout)
        except socket.timeout:
            raise FetchError("timeout", f"connecting to {t.host} timed out") from None
        except OSError as e:
            raise FetchError("network", f"cannot connect to {t.host}: {e}") from None
        if t.scheme == "https":
            sock = self._fetcher.ssl_context.wrap_socket(sock, server_hostname=t.host)
        self.sock = sock


def decompress_capped(fn, data: bytes, cap: int = MAX_PLAIN) -> bytes:
    """Decompress one xz/bz2/gzip stream with an output cap, so a small bomb can't eat the server's memory.
    Trailing data after the first stream is ignored. Raises ValueError on corrupt or truncated input."""
    if fn is lzma.decompress:
        d, zlib_like = lzma.LZMADecompressor(), False
    elif fn is bz2.decompress:
        d, zlib_like = bz2.BZ2Decompressor(), False
    elif fn is gzip.decompress:
        d, zlib_like = zlib.decompressobj(16 + zlib.MAX_WBITS), True
    else:
        raise ValueError(fn)
    out, total, pending = [], 0, data
    try:
        while not d.eof:
            chunk = d.decompress(pending, cap - total + 1)
            pending = d.unconsumed_tail if zlib_like else b""
            total += len(chunk)
            if total > cap:
                raise FetchError("too_large", f"Packages is over {cap} bytes uncompressed")
            out.append(chunk)
            if not chunk and not pending and (zlib_like or d.needs_input):
                break  # no progress and nothing left to feed
    except (lzma.LZMAError, zlib.error, OSError, EOFError) as e:
        raise ValueError(str(e)) from None
    if not d.eof:
        raise ValueError("truncated compressed data")
    return b"".join(out)


class PackagesCache:
    """repo URL -> (time, source URL, gzipped Packages, validators). Bounded by total bytes, oldest out first.

    An entry past its TTL is no longer a hit, but one whose Packages file had an ETag or Last-Modified stays (as
    `stale`) so the next fetch can revalidate it with a conditional GET instead of downloading it again (F55)."""

    def __init__(self, ttl: float = CACHE_TTL, max_bytes: int = CACHE_MAX_BYTES, clock=time.monotonic):
        self.ttl, self.max_bytes, self.clock = ttl, max_bytes, clock
        self._d: OrderedDict[str, tuple[float, str, bytes, dict]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str):
        with self._lock:
            hit = self._d.get(key)
            if not hit:
                return None
            if self.clock() - hit[0] > self.ttl:
                if not hit[3]:
                    del self._d[key]  # nothing to revalidate with: forget it
                return None
            self._d.move_to_end(key)
            return hit[1], hit[2]

    def stale(self, key: str):
        """(source URL, gz, validators) of an entry past its TTL that can be revalidated, else None."""
        with self._lock:
            hit = self._d.get(key)
            if not hit or not hit[3] or self.clock() - hit[0] <= self.ttl:
                return None
            return hit[1], hit[2], dict(hit[3])

    def refresh(self, key: str, validators: dict | None = None) -> bool:
        """The repo said 304: the entry is fresh for another TTL (with any newer validators the 304 carried)."""
        with self._lock:
            hit = self._d.get(key)
            if not hit:
                return False
            self._d[key] = (self.clock(), hit[1], hit[2], {**hit[3], **(validators or {})})
            self._d.move_to_end(key)
            return True

    def put(self, key: str, source: str, gz: bytes, validators: dict | None = None):
        with self._lock:
            self._d[key] = (self.clock(), source, gz, dict(validators or {}))
            self._d.move_to_end(key)
            total = sum(len(v[2]) for v in self._d.values())
            while total > self.max_bytes and len(self._d) > 1:
                _, old = self._d.popitem(last=False)
                total -= len(old[2])


def repo_dir(url: str) -> str:
    """The directory Packages lives in: the URL as given, with exactly one trailing slash."""
    url = url.strip()
    if "?" in url or "#" in url:
        raise FetchError("bad_url", "a repo URL has no query or fragment")
    return url.rstrip("/") + "/"


def fetch_packages(fetcher: Fetcher, repo: str, cache: PackagesCache | None = None) -> tuple[str, bytes, bool]:
    """Fetch a repo's Packages index. Returns (source URL, gzipped plain text, from_cache)."""
    base = repo_dir(repo)
    fetcher.check(base)  # refuse early, before trying four names
    if cache is not None:
        hit = cache.get(base)
        if hit:
            return hit[0], hit[1], True
    deadline = time.monotonic() + fetcher.timeout
    stale = cache.stale(base) if cache is not None else None
    if stale:
        # F55: ask for the file that won last time, conditionally. 304: keep what we have. Anything else (a 200,
        # a 404, an error): the normal search below decides, with no validators, so the result is never a mix.
        try:
            resp = fetcher.get(stale[0], deadline=deadline, headers=stale[2], **_no_upstream_cache(fetcher))
        except FetchError:
            resp = None  # the search below retries (and raises timeout itself when the deadline is gone)
        if resp is not None and resp.status == 304:
            fresh = {k: v for k, v in validators(resp.headers).items() if k in stale[2]}
            cache.refresh(base, fresh)
            return stale[0], stale[1], True
        if resp is not None and resp.status == 200:  # changed: decode it as the same kind of file, no re-download
            name = stale[0].rsplit("/", 1)[-1]
            fn = dict(PACKAGES_NAMES).get(name)
            if name in dict(PACKAGES_NAMES):
                gz = _packages_gz(name, fn, resp.body, [])
                if gz is not None:
                    cache.put(base, resp.url, gz, validators(resp.headers))
                    return resp.url, gz, False
    tried = []
    for name, fn in PACKAGES_NAMES:
        url = base + name
        resp = fetcher.get(url, deadline=deadline, **_no_upstream_cache(fetcher))
        if resp.status != 200:
            tried.append(f"{name}: HTTP {resp.status}")
            continue
        gz = _packages_gz(name, fn, resp.body, tried)
        if gz is None:
            continue
        if cache is not None:
            cache.put(base, resp.url, gz, validators(resp.headers))
        return resp.url, gz, False
    raise FetchError("not_found", "no Packages file: " + "; ".join(tried))


def _no_upstream_cache(fetcher) -> dict:
    """Packages bodies are kept (and revalidated) by PackagesCache, so they skip the Fetcher's UpstreamCache. Only
    asked of a Fetcher that has one, so fetcher stand-ins with the older get() signature still work."""
    return {"conditional": False} if getattr(fetcher, "upstream_cache", None) is not None else {}


def _packages_gz(name: str, fn, body: bytes, tried: list) -> bytes | None:
    """`body` (the file `name`, compressed with `fn`) as gzipped plain Packages, or None with why in `tried`."""
    try:
        plain = body if fn is None else decompress_capped(fn, body)
    except ValueError as e:
        tried.append(f"{name}: not {name.rsplit('.', 1)[-1]} ({e})")
        return None
    if fn is None and plain.lstrip()[:1] == b"<":
        tried.append(f"{name}: HTML, not a Packages file")
        return None
    if len(plain) > MAX_PLAIN:
        raise FetchError("too_large", f"Packages is over {MAX_PLAIN} bytes")
    return gzip.compress(plain, compresslevel=6, mtime=0)


class RateLimiter:
    """Token bucket per client IP: `rate` requests per `per` seconds, bursts up to `rate`."""

    def __init__(self, rate: int = 60, per: float = 60.0, clock=time.monotonic):
        self.rate, self.per, self.clock = rate, per, clock
        self._b: dict[str, tuple[float, float]] = {}
        self._lock = threading.Lock()

    def allow(self, ip: str) -> bool:
        now = self.clock()
        with self._lock:
            tokens, last = self._b.get(ip, (float(self.rate), now))
            tokens = min(float(self.rate), tokens + (now - last) * self.rate / self.per)
            ok = tokens >= 1
            self._b[ip] = (tokens - 1 if ok else tokens, now)
            if len(self._b) > 10000:  # forget clients whose bucket is full again
                full = [k for k, (t, l) in self._b.items() if t + (now - l) * self.rate / self.per >= self.rate]
                for k in full:
                    del self._b[k]
            return ok
