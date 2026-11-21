# B217: /sign/upload parts outlive the link

## What I did
- `worker/src/index.js` `uploads()`: each part is now put with `expirationTtl: 2 * ttl + 300` (was `ttl + 300`), as
  B215 did for `/sign/host`'s parts. POST `/sign/upload/<t>/done` gives the upload's key a fresh `ttl`, so a part put
  near the end of the first ttl must still last the link's whole second ttl; before, an upload that took over 5
  minutes left a link whose `app.ipa` ran out ("expired") while `manifest.plist` still answered.
- `worker/test.mjs`: new block (B217) wraps `HOSTED.put`, uploads a two-part IPA, and checks the link's key gets
  `ttl` (600) at done and both parts `2*600+300`.
- Looked at `/sign/host`'s one-body path (`ttl + 300` on its parts): the key is put right after the parts in the same
  request, so it has no such gap; left as is.

## Tried that failed
none

## Not verified
- Not run against real Cloudflare KV (only the test's in-memory KV): the change is one TTL number on a `put` whose
  behaviour the existing tests already cover.
