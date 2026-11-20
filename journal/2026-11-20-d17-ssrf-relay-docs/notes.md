# D17: SSRF and Apple-relay statements, checked against the code

## What I did
- SSRF (AGENTS.md, README.md `/api/fetch` row, web/app/backend-http.js header, docs/native.md layout): no longer
  claim one "SSRF guard with size and time caps". They now say what each runtime has, from worker/src/index.js,
  ssrf.js and ssrf-node.js (B190):
  - ifizbox.com (Cloudflare): Cloudflare's fetch can't reach private/loopback addresses; index.js refuses literal
    private hosts and `localhost` before fetching (`blockedHost`).
  - node.mjs: `env.FETCH = guardedFetch()` resolves every host and redirect hop, refuses blocked ranges, pins the
    connection to the checked address.
  - Caps: `upstream()` aborts after 30 s waiting for headers; the plain `/api/fetch` body is capped at 64 MB / 120 s
    (`cappedBody`, Content-Length 413); kind=ipa at `MAX_UPLOAD_MB`. kind=packages has no byte cap, so the README
    says "64 MB cap on plain fetches", not on everything.
- Apple relay: worker/README.md and docs/signing.md said ifizbox.com leaves it off; `worker/wrangler.ifizbox.toml`
  sets `APPLE_RELAY = "1"`. Both now say the site turns it on.
- worker/README.md "It stores nothing else and logs nothing": now lists Account blobs (KV, ciphertext), reviews
  (REVIEWS D1, hashed token/address) and push devices (PUSH D1), and says no request bodies are logged
  (push.js logs a count line from the cron, so "logs nothing" was not true either).
- AGENTS.md Gate bullet: dropped "once they exist"; tools/check.sh builds the .deb and IPA first.

## Check
`grep -rn -i ssrf` over the non-journal docs and `grep -n relay` over worker/README.md and docs/signing.md:
remaining statements match the code read above.

## Not verified
- That Cloudflare's runtime fetch refuses every private range (DNS names resolving inward included): this is
  Cloudflare's documented behaviour as the code comment states, not tested from a task (no deploy).
- Whether ifizbox.com is deployed with the current wrangler.ifizbox.toml (relay on live): not probed; the docs
  follow the committed config.
