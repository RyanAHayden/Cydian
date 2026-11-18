# F98: Cydian Account's rate limit across isolates

## Done
- `worker/src/account.js`: `bindingLimiter(all, writes, fallback)` uses Cloudflare's Rate Limiting bindings
  (`env.ACCOUNT_RATE_LIMIT` for every request, `env.ACCOUNT_WRITE_LIMIT` for PUT/DELETE as well; with only the
  first bound, writes count in it under `w:<ip>`). `account()` picks it whenever `ACCOUNT_RATE_LIMIT` is bound,
  else the existing per-isolate memory limiter. A binding that throws hands that request to the memory limiter
  (decided: neither lock everybody out nor let everybody through when the limiter service is down).
  `limit.allow` is now awaited, so the sync memory limiter and the async binding share one interface.
- `worker/wrangler.toml` and `wrangler.cydian.toml`: two `[[ratelimits]]` (60/60s and 12/60s, matching
  ACCOUNT_RATE/ACCOUNT_WRITES), namespace ids 9801/9802 (any number unique in the Cloudflare account).
- `web/app/core/settings.js`: Ignored Upgrades' non-jailbreak footer reads "Kept on this device, and synced by a
  Cydian Account." (jailbreak footer unchanged: dpkg holds.)
- `worker/test.mjs`: fake bindings: writes run out before reads, keys, the one-binding case, the throwing fallback.

## Tried and failed
- First test gave `all` a limit of 2; the refused second DELETE still took a slot from `all` (checked first), so the
  GET after it was 429. That is how the binding behaves (it can't refund), so the test now allows 3.

## Verified
- `node worker/test.mjs` passes; `npx wrangler@4.164.0 deploy --dry-run -c wrangler.toml` lists both Rate Limit bindings.

## Not verified
- The bindings on the live Worker: not deployed (the task doesn't say to publish). Cloudflare's limits are per
  location and eventually consistent, so a burst can pass a little over 60/12; not measurable without deploying.
