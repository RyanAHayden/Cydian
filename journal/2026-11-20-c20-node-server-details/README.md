# C20: orphan tools and Node server details

## Tools: kept, listed in docs/audit.md

- `tools/spinnercmp.py`: reference tool for the spinner drawing (journal f166 runs it). Kept.
- `tools/gsa-spike.html`: not an orphan: `worker/wrangler.preview.toml` copies it into the preview Worker. Deleting
  it would break that build. Kept.
- `tools/ipa-plist-probe.py`: `worker/src/ipainfo.js`'s header cites it as the source it was ported from. Deleting it
  would mean editing ipainfo.js, which is outside this task's files. Kept.

## worker/node.mjs

- `HOST_IDS` now defaults to `*`, matching worker/README.md and wrangler.toml (it was `*.ifizbox`).
- The static path check is `file === WEB || file.startsWith(WEB + sep)`, so a sibling folder like `app-secret`
  beside `app` can't pass the prefix test.
- `X-Forwarded-Host` is used only with `TRUST_PROXY=1`. Without it the URL uses `Host`. The header comment and
  worker/README.md (a short note under the HTTPS proxies) document it. `X-Forwarded-Proto` is still trusted as
  before: the task didn't ask to change it, and gating it would break `tailscale serve` setups that rely on it for
  https manifest links.

## Tests (worker/test.mjs, "worker node static/host")

Starts node.mjs with `WEB` set to a temporary `site/` that has a sibling `site-secret/`, then:
- `/../site-secret/…`, `/..%2f…`, `/%2e%2e/…` and `/..%5c…` never return the secret;
- a spoofed `X-Forwarded-Host: evil.example` changes neither the `/repo/` page's addresses nor the `/repo`
  redirect;
- with `TRUST_PROXY=1` the forwarded host and proto are used.

The X-Forwarded-Host part fails on the old code. The sibling-folder part also passes on the old code: `normalize`
on the absolute URL path already resolves `..` before the join, so a sibling can't be reached over HTTP. The
`WEB + sep` check is defence in depth, and the test guards that.

Process slip: I made the node.mjs edits with a python heredoc instead of the edit tool. The result was checked
with `git diff`.

## Not verified

- That `tailscale serve`, cloudflared and Caddy pass `Host` through unchanged, as the README note says. I wrote that
  from memory of their defaults; no proxy was run here. If one rewrites Host to `localhost:8787`, people using it
  need `TRUST_PROXY=1`.
