# B190: SSRF guard for the self-hosted Node server

## What was wrong
`worker/src/index.js` relied on Cloudflare's fetch refusing private addresses. `worker/node.mjs` (Docker, 0.0.0.0)
used Node's plain `fetch`, so `/api/fetch?url=http://127.0.0.1:PORT/`, `localhost` and `http://2130706433/` came back
with the body.

## What I did
- `worker/src/ssrf.js` (new, both runtimes): `blockedIp` (unspecified, loopback, RFC 1918, CGNAT, link-local,
  reserved/documentation, multicast, broadcast; IPv6 ::, ::1, ULA fc00::/7, link-/site-local, multicast,
  documentation, every v4-mapped `::ffff:` address, v4-compatible, NAT64 and 6to4 carrying a blocked v4),
  `blockedHost` (localhost names plus literal IPs; WHATWG URL already turns decimal/hex/octal forms into dotted),
  `refused()` error with code `SSRF_REFUSED`.
- `worker/src/ssrf-node.js` (new, Node only): `guardedFetch()` built on node:http/https. Every hop: DNS lookup (all
  addresses), refused if any address is blocked, then the socket goes to the checked address through the
  request's `lookup` option (no second lookup to rebind; TLS still verifies the hostname). Redirects followed by
  hand (max 10), same check each hop; Authorization/Cookie dropped on cross-origin hops; 30 s headers timeout.
  Returns a web `Response` with `url` and `redirected` set.
- `node.mjs`: `env.FETCH = guardedFetch()`. Decision: handed in through env, not by replacing `globalThis.fetch`,
  so push/apple-relay (other tasks, HTTP/2 to APNs) are untouched.
- `index.js`: `/api/fetch` (plain, kind=packages, kind=ipa, GitHub API route), `/api/ipainfo`, `/api/applookup`,
  `/api/appreviews` use `env.FETCH` when given, else the runtime's fetch. Literal private hosts and localhost are
  refused (403, code `refused`) before any fetch on both runtimes; a refusal from the guard maps to the same 403.
  Plain `/api/fetch` body: Content-Length over 64 MB → 413 up front, and `cappedBody` errors the stream past
  64 MB or after 120 s overall (both runtimes). IPA and Packages paths keep streaming untouched (B95's CPU note).
- Found on the way: `return ipaFetch(...)` inside apiFetch's try wasn't awaited, so any thrown error (network,
  now the guard) escaped the catch and became the router's 500 / an unhandled rejection. Now `return await`.

## Tests (worker/test.mjs, "worker ssrf")
Address tables; an inner HTTP server whose `/secret` counts hits (asserted 0); guardedFetch refuses 127.0.0.1,
localhost, decimal, [::1], [::ffff:127.0.0.1] and a name resolving inward; a stand-in public host (`outer.test`,
resolved by an injected lookup, so the test also proves the connection uses the checked address) redirecting to
127.0.0.1 / localhost / [::1] / decimal / an inward name, all refused; the same through the routes with env.FETCH
(all kinds plus ipainfo); applookup/appreviews go through env.FETCH; Worker path refuses literals without
fetching; 413 on a big Content-Length; cappedBody cap and timeout; and node.mjs spawned for real, the audit's
URLs answered 403.

Live smoke (not in the gate): guardedFetch against example.com, github.com (http→https redirect) and
itunes.apple.com answered normally.

## Not verified
- Docker image run: not built here (no need: the Dockerfile copies all of `worker/`, and node.mjs was run directly).
- Cloudflare runtime with `cappedBody`'s timer and JS stream on the plain path: only run in Node; no deploy from a
  task. The plain path carries sources/icons, not IPAs, so B95's CPU concern shouldn't apply, but untested on the edge.
- Self-hosters who point the site at a LAN repo (192.168.x) now get "refused"; no opt-out env was added (the task
  asks for refusal; an opt-in would be a separate feature).
- worker/README.md not touched: D task "Correct the SSRF and Apple-relay statements" owns those statements.
