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


@dataclass
class Fetcher:
    """`resolve` and `dial` are the only seams: tests swap them to point a public-looking IP at a local server,
    so the guard itself runs unchanged."""
    resolve: callable = default_resolve
    dial: callable = default_dial
    max_bytes: int = MAX_BYTES
    timeout: float = TIMEOUT
    ssl_context: ssl.SSLContext = field(default_factory=ssl.create_default_context)

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

    def get(self, url: str, deadline: float | None = None, max_bytes: int | None = None) -> Response:
        """GET `url`, following redirects (each re-checked). Raises FetchError; non-2xx is returned, not raised."""
        deadline = deadline or (time.monotonic() + self.timeout)
        max_bytes = max_bytes or self.max_bytes
        for _ in range(MAX_REDIRECTS + 1):
            target = self.check(url)
            status, headers, body = self._request(target, deadline, max_bytes)
            if status in (301, 302, 303, 307, 308) and headers.get("location"):
                url = urljoin(url, headers["location"])
                continue
            return Response(url, status, headers, body)
        raise FetchError("upstream", "too many redirects")

    def _remaining(self, deadline: float) -> float:
        left = deadline - time.monotonic()
        if left <= 0:
            raise FetchError("timeout", f"gave up after {self.timeout:g} s")
        return left

    def _request(self, t: Target, deadline: float, max_bytes: int):
        conn = _PinnedConnection(t, self, self._remaining(deadline))
        try:
            try:
                conn.putrequest("GET", t.path, skip_accept_encoding=True)
                for k, v in HEADERS.items():
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
    """repo URL -> (time, source URL, gzipped Packages). Bounded by total bytes, oldest out first."""

    def __init__(self, ttl: float = CACHE_TTL, max_bytes: int = CACHE_MAX_BYTES, clock=time.monotonic):
        self.ttl, self.max_bytes, self.clock = ttl, max_bytes, clock
        self._d: OrderedDict[str, tuple[float, str, bytes]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str):
        with self._lock:
            hit = self._d.get(key)
            if not hit:
                return None
            if self.clock() - hit[0] > self.ttl:
                del self._d[key]
                return None
            self._d.move_to_end(key)
            return hit[1], hit[2]

    def put(self, key: str, source: str, gz: bytes):
        with self._lock:
            self._d[key] = (self.clock(), source, gz)
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
    tried = []
    for name, fn in PACKAGES_NAMES:
        url = base + name
        resp = fetcher.get(url, deadline=deadline)
        if resp.status != 200:
            tried.append(f"{name}: HTTP {resp.status}")
            continue
        try:
            plain = resp.body if fn is None else decompress_capped(fn, resp.body)
        except ValueError as e:
            tried.append(f"{name}: not {name.rsplit('.', 1)[-1]} ({e})")
            continue
        if fn is None and plain.lstrip()[:1] == b"<":
            tried.append(f"{name}: HTML, not a Packages file")
            continue
        if len(plain) > MAX_PLAIN:
            raise FetchError("too_large", f"Packages is over {MAX_PLAIN} bytes")
        gz = gzip.compress(plain, compresslevel=6, mtime=0)
        if cache is not None:
            cache.put(base, resp.url, gz)
        return resp.url, gz, False
    raise FetchError("not_found", "no Packages file: " + "; ".join(tried))


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
