# F312: rate limits on /api/fetch, /sign/host, /sign/upload

## What changed

- `worker/src/limits.js` (new): per-address limits a minute, the account.js pattern: Cloudflare's Rate Limiting
  binding when bound (`FETCH_RATE_LIMIT`, `HOST_RATE_LIMIT`, `UPLOAD_RATE_LIMIT`, keyed `<route>:<ip>`), else, or
  when the binding throws, account.js's `rateLimiter` in this isolate's memory. Over the limit: 429 JSON
  `{code: "rate_limited"}`, `Retry-After: 60`, CORS headers (so the website reads it; backend-http.js already maps
  429 to `rate_limited`).
- `worker/src/index.js`: one check after the OPTIONS line in `fetch`, plus the import and a header note.
- `wrangler.toml`, `wrangler.ifizbox.toml`: three `[[ratelimits]]` (namespaces 9804-9806).
- `node.mjs`: passes FETCH_RATE/HOST_RATE/UPLOAD_RATE through, and sets `cf-connecting-ip` itself (the socket's
  address, or the last X-Forwarded-For entry when the socket is loopback, i.e. a local proxy). Before this a visitor
  could send their own CF-Connecting-IP and choose their bucket, for /api/account's and the reviews' limits too.
- `worker/README.md`: the three settings.
- `worker/test.mjs`: "worker limits" block: the (N+1)th request in a minute gets 429 on each route at the shipped
  defaults, per address; parts not counted; `0` = off; binding keyed and used, broken binding falls back to memory;
  node.mjs spawned with small rates: XFF-behind-local-proxy counting and a spoofed CF-Connecting-IP not helping.
  The base test env sets the three rates to "0", since the existing tests make 21 upload POSTs from one address.

## Choices (decided unattended)

- Limits: /api/fetch 300/min. The website sends every source's Release + Packages, every icon and depiction image
  (`assetUrl`) and IPA Range resumes through it, so a low number would break browsing with many sources.
  /sign/host 10/min (an update is one POST). /sign/upload 12/min: each install POSTs twice (reserve the token,
  then start with the size). Upload parts (`PUT /sign/upload/<t>/<i>`) aren't counted: they're bounded by the
  upload's own size, and a 512 MB app sends 26.
- `0` in FETCH_RATE etc. means no memory limit (the binding, when bound, still applies with its own `limit`).
- HOST_IDS=* stays: limiting the starts caps how much one address can park (12 × 512 MB a minute at most per
  address in memory mode); a byte budget per address would be a further step if abuse shows up.

## Not verified

- The Cloudflare Rate Limiting bindings themselves on the deployed Worker: only tested with a fake binding; nothing
  is deployed from a task. Their config shape is copied from the existing ACCOUNT_RATE_LIMIT entries.
- Whether `tailscale serve` sends X-Forwarded-For: not checked here (no tailscale serve set up for this). If it
  doesn't, every visitor through it shares one count (README says so).
- The website's wording when an install hits the 429: it shows the server's `error` text; not looked at in a browser.
