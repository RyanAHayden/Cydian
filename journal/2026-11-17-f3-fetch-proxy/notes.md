# F3: SSRF-safe fetch proxy

## What I did

- `web/fetch.py` (stdlib only: http.client, ssl, ipaddress, lzma/bz2/zlib):
  - `Fetcher.check(url)`: http/https only, no credentials in the URL, a host is required. Resolves with
    `getaddrinfo` and refuses if **any** answer is not public unicast (`ip_blocked`): loopback, private, link-local,
    CGNAT 100.64/10, multicast, unspecified, reserved/not-global (incl. 192.0.0/24, 198.18/15, 240/4, 2001:db8::),
    IPv6 site-local, scoped addresses, Teredo, local NAT64 64:ff9b:1::/48. v4-mapped, NAT64 64:ff9b::/96 and 6to4
    are judged by the IPv4 address they embed (so `64:ff9b::808:808` passes, `::ffff:127.0.0.1` does not). Odd IPv4
    spellings (`2130706433`, `0x7f.1`) are caught because the check runs on what the resolver returns.
  - Connects to the checked IP itself (`_PinnedConnection`, a `dial` hook): no second resolution, so no DNS
    rebinding window. Host header, SNI and certificate verification use the hostname.
  - Redirects followed by hand (max 5), every hop re-checked. One 30 s deadline over the whole fetch (all hops),
    re-applied to the socket before every read, so a slow drip can't stretch it. 50 MB body cap (Content-Length
    early, then counted). Packages decompression capped at 200 MB output (zip-bomb guard).
  - `fetch_packages(fetcher, repo_dir, cache)`: tries `Packages.xz`, `.bz2`, `.gz`, plain in that order; non-200,
    undecodable, or an HTML plain body moves on to the next. Returns gzip of the plain text. The client passes the
    directory (flat repo URL or `dists/…/binary-<arch>/`), the server appends the names.
  - `PackagesCache`: per repo dir (trailing slash normalised), 30 min TTL, bounded at 256 MB total, oldest out.
  - `RateLimiter`: token bucket per client IP, 60/min by default (`CYDIAN_FETCH_RATE`).
  - Headers sent: `User-Agent: Telesphoreo APT-HTTP/1.0.592`, `X-Machine: iPhone14,2`, `X-Firmware: 16.5`,
    `Accept-Encoding: identity`. **Decision**: R2 has not landed, so I send all three the brief names with a
    modern-device value. No `X-Unique-ID`: we have no device and a made-up UDID would be shared by every visitor.
    Revisit when R2 says which headers repos actually need (constants at the top of `fetch.py`).
- `web/app.py`: `GET /api/fetch?url=…` (any URL) and `?url=<repo dir>&kind=packages`.
  - Errors are JSON `{error, code[, status]}`: bad_url 400, refused 403, not_found 404, rate_limited 429 (with
    Retry-After), timeout 504, too_large/network/upstream 502 (upstream non-2xx carries the repo's `status`).
  - Proxied bodies are made inert on our origin: `nosniff`, `CSP: default-src 'none'; sandbox`, and only
    png/jpeg/gif/webp/text-plain/json keep their Content-Type; anything else (HTML, SVG) becomes
    `application/octet-stream`.
  - Packages: `Content-Encoding: gzip`, `text/plain; charset=utf-8`, `X-Source-URL`, `X-Cache: HIT|MISS`.
  - `CYDIAN_PROXY_HOPS=n` wraps the app in werkzeug's ProxyFix so the rate limit sees the visitor behind n
    reverse proxies. Default 0 (trust nothing).
- `web/app/backend-http.js`: `createHttpBackend({base, fetchFn})` with `fetch(url)` (Response), `text(url)`,
  `packages(repoDir)` → `{text, source, cached}`; failures throw `BackendError(code, message, status)`.
  `web/app/backend-http.test.js` (not in the file list, new file, runs in the gate's `node --test`).
- `web/test_fetch.py`: a local HTTP server plays the repo; the test resolver maps made-up names to public IPs and
  the dialer sends exactly those IPs to 127.0.0.1, so the guard runs unchanged. Covers every refused range (v4 and
  v6), IP-literal forms, mixed answers, redirect to localhost/127.0.0.1/[::1]/metadata IP, redirect chains
  (re-resolved per hop), loops, DNS rebinding (dialed IP == the checked one, resolved once), Cydia headers,
  oversize with and without Content-Length, timeout, slow drip, decompression bombs and truncation per format,
  each compression and the fallback order, cache hit/expiry/bound, rate limit, and the route's headers/errors.

## Tried that failed

- Reading `conn.sock` after `getresponse()`: http.client sets it to None for `Connection: close` responses. Kept
  the socket from before the response instead; `settimeout` on it fails harmlessly once the body is fully
  buffered (the slow-drip test shows the deadline still holds mid-body).
- First `ip_blocked` ran Python's generic `is_global` on NAT64/6to4 too, which refused public embedded addresses.
  Now the embedded IPv4 decides for those.

## Checked

- `web/test_fetch.py` (28 tests) and `node --test web/app` pass; full gate via `agent-runner done`.
- Live, from this machine: chariz.com and havoc.app (Packages.xz), BigBoss dists dir over http (falls back to
  Packages.bz2), each decompressed to a real Packages file. `self-signed.badssl.com` and `wrong.host.badssl.com`
  are refused with TLS errors (cert and hostname verification are on with the pinned IP).

## Not verified

- Which of X-Machine / X-Firmware / X-Unique-ID real repos require: waits on R2 (not landed).
- DNS resolution time is not inside the 30 s cap (`getaddrinfo` has no timeout); bounded by the system resolver.
- Rate-limit and cache state are per gunicorn process (the Dockerfile runs one process with 32 threads, so fine
  today; more workers would multiply the limit). No persistence across restarts.
- Behind a real reverse proxy (CYDIAN_PROXY_HOPS): not deployed anywhere yet, untested beyond reading ProxyFix.
- `backend-http.js` in a real browser (gzip Content-Encoding decoded by the browser): tested only under node with
  a fake fetch; nothing in the UI calls it yet (F4+).
