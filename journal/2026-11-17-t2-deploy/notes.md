# T2: deploy

## What I did

- `deploy.sh` (new, Cydian's own design, not sidedrop's; a message from the user's other session asked for this
  too). It runs from cron in a clone used only for deploying. It fetches `origin/main`. If main moved, or the
  container isn't running: detached checkout, `docker compose -p cydian build --pull && up -d`, then poll
  `/healthz` (90 s). If that fails it writes the commit to `.deploy.failed`, prints `compose logs`, checks out
  the commit that was running, rebuilds it and exits 1. While the old build is still running, a failed commit
  isn't retried every tick (one cron mail instead of one every 5 minutes), only once main moves again or with
  `--force`. `flock` on `.deploy.lock` keeps a slow build from overlapping the next tick. It refuses to deploy
  over local edits to tracked files. It warns when `.env` has no `CYDIAN_PROXY_HOPS`. `--status` changes
  nothing.
- `README.md`: how to run it locally and in Docker, the `.env` settings, and the NAS steps (clone, `.env` with
  `CYDIAN_PROXY_HOPS=1`, first deploy, TrueNAS cron job, Cloudflared app plus public hostname, checks).
- Hop count is **1**. Cloudflare's edge appends the client IP to `X-Forwarded-For`, cloudflared forwards the
  header unchanged, and ProxyFix `x_for=1` trusts only the last entry, so a spoofed XFF from the visitor sits
  earlier in the list and is ignored.
- **Dockerfile fix (outside the file list, one line):** it copied `web/app.py` but not `web/fetch.py`
  (added by F3), so the image would fail on `import fetch` and never pass a health check. Now
  `COPY web/app.py web/fetch.py ./`. Without it the deploy can't work.

## Tested

- `deploy.sh` against stub `docker` and `curl` in a scratch clone with a local bare origin: first deploy, no-op
  run (silent, exit 0), new good commit, bad commit (rollback, exit 1, skipped next tick, shown by `--status`),
  `--force` on the bad commit (tries again, rolls back), the fix commit deploys and clears `.deploy.failed`.
  Lock held → "another deploy is running", exit 0.
- `docker build` of the image succeeds with the Dockerfile fix. Image removed afterwards.

## Not verified

- Nothing ran on the NAS, no container was started, no tunnel or public URL was opened. The task says the NAS side
  needs a human, and the user hasn't approved publishing yet (message from the user's other session). So these
  are unchecked: real `docker compose` behaviour on TrueNAS (the `ps --status running` flag needs compose v2,
  which current SCALE has), that `flock` and `curl` exist there (they do on stock SCALE, not checked here), the
  TrueNAS menu names, and the Cloudflared app.
- That the container actually serves with `fetch.py` in it: I built the image but didn't run it (no containers
  started, as asked).
- That Cloudflare + cloudflared deliver XFF as described (from Cloudflare's docs, not seen live). Once it's up,
  check with a request that logs `request.remote_addr`.
- Whether the GitHub repo is public. The README covers the private case with a deploy key.
