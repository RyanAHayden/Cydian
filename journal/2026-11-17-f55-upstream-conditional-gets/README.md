# F55: upstream conditional GETs in the fetch proxy

## What I did
- `web/fetch.py`
  - `UpstreamCache`: URL -> (validators, headers, body) of the last 200 that had an ETag or Last-Modified. LRU,
    bounded at 2048 entries / 64 MB total; bodies over 4 MB are not kept (so .debs and IPAs never fill it).
  - `Fetcher.upstream_cache` (default `None`: no change for push.py's daemon or tests that build their own
    Fetcher). With it, `get()` looks up each hop's URL; a kept entry sends If-None-Match / If-Modified-Since, a
    304 comes back as the kept 200 with `Response.revalidated = True` (validators a 304 carries are merged in).
    Redirect hops are never kept: they are asked again each time and re-checked by the SSRF guard as before.
    A kept body bigger than this call's `max_bytes` is not used. Validator values containing CR/LF/NUL are skipped.
  - `get(headers=..., conditional=False)`: callers can send their own validators and get the 304 raw.
  - `PackagesCache`: entries carry the Packages file's validators. Past the TTL, an entry with validators stays
    (`stale()`); `fetch_packages` asks the file that won last time conditionally: 304 -> `refresh()` and serve
    the kept gz (X-Cache HIT); 200 -> decode it as the same kind (name suffix), no second download; anything else
    -> the normal four-name search. Entries without validators are dropped at expiry as before.
  - Packages fetches pass `conditional=False`, so their (big) bodies are not kept twice.
  - Decode step split into `_packages_gz()` (shared by the search and the revalidation).
- `web/app.py`: the app's fetcher gets an `UpstreamCache`; a revalidated plain fetch answers `X-Cache:
  REVALIDATED`; `_answer` docstring updated. The phone's own 304 (F19) works on top unchanged.
- `web/test_fetch.py`: `UpstreamRevalidateTest` (15 tests) with a `conditional()` route on the local test server
  that answers 304 like a static file server.

## Decisions
- Per-hop keying by URL (not the first URL) so a repo that redirects to a CDN still revalidates at the CDN.
- Revalidation failures (network error on the stale source) fall through to the full search instead of raising,
  so behaviour is never worse than before F55.

## Tried and failed
- nothing notable.

## Not verified
- Against a real repo/CDN (no network use in this task); only the local test server. Real servers that send weak
  ETags (`W/"..."`) are passed back verbatim, which RFC 9110 allows for If-None-Match, but not seen live.

## Gate notes
- First `done` failed: test_push.py's `FakeFetcher.get()` has the old signature and got `conditional=False`.
  Fixed in fetch.py, not in the fakes: `_no_upstream_cache()` passes `conditional` only to a Fetcher that has an
  `upstream_cache`.
