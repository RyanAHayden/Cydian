# R43: how ifizbox.com should deploy

Research only. No deploy setting, script or config was changed.

## Where things stand (read from the repo, 2026-11-20)

- `worker/wrangler.ifizbox.toml` + Workers Builds connected to RyanAHayden/iFizBox: every push to `main` runs
  `tools/buildinfo.sh && cd worker && npx wrangler deploy -c wrangler.ifizbox.toml` and goes live on ifizbox.com,
  www and sign.ifizbox.com.
- Pushes to main (first-parent commits, `git log origin/main`): 388 on 11-17, 691 on 11-18, 367 on 11-19, 360 on
  11-20. Of those, the ones touching `worker/` or `web/app/` (what the site serves): 206, 321, 129, 86.
- Releases (`v*` tags): 19 between 11-18 and 11-20, about 4 to 8 a day, all cut with `tools/publish.sh`.
- What a merge puts live straight away, with no person looking:
  - `web/app/` JS that runs in the visitor's browser while they type an **Apple ID and password** (free Apple ID
    route, gsa.js through the Worker's `/apple/*` relay, `APPLE_RELAY = "1"`) and load a **.p12 and its password**
    (website signing, zsign WebAssembly). A bad or hostile commit there can read both.
  - the Worker: `/sign/*` (holds signed IPAs in KV), `/apple/*`, `/api/account`, reviews and push (D1), the
    30-minute push cron, the SSRF-guarded `/api/fetch`.
- The only check before it is live is agent-runner's merge gate (`tools/check.sh` on the merged tree). It catches
  failing tests, not a wrong-but-passing change or a change nobody asked for.
- Releases no longer need a site deploy: since B165 `/repo/source.json` and `/repo/Packages` read the latest
  GitHub release's assets, so `tools/release.sh --verify-live` passes before any redeploy. The deployed
  `web/app/source.json` is only the fallback when GitHub fails.
- The apps bundle their own copy of `web/app/`; the site deploy reaches them only through the Worker endpoints
  (`/sign/host`, `/repo/*`, `/apple/*`, push, reviews).
- Home's footer (`build.json`) shows `native/VERSION` with the deploy's commit, so today the site claims e.g.
  0.17.0 while running a commit hundreds of merges past v0.17.0.

## Options

### A. Keep deploying main, add guards

Workers Builds settings: production branch `main` (as now). Optional: build watch paths (include `worker/**`,
`web/app/**`, `native/VERSION`, `tools/buildinfo.sh`) so plan/journal/native-only merges don't build.

- + Nothing changes for agents or for `publish.sh`; a site fix is live minutes after its merge.
- − Every merge touching the site (86 to 321 a day) is live unreviewed, on the pages that take Apple ID passwords
  and certificates. Watch paths cut the build count by roughly half; they don't cut that risk.
- − Build minutes: hundreds of builds a day. Workers Builds has a monthly build-minute allowance per plan; at
  ~1 minute a build this can run past it (allowance and per-build time not checked, see Not verified).

### B. A production branch (`site`), moved on purpose

Workers Builds settings:
- Production branch: `site` (Settings > Build > Branch control). Deploy command unchanged.
- Non-production branch builds: on for `main` only if preview URLs are wanted, with
  `npx wrangler versions upload -c wrangler.ifizbox.toml` (uploads a version with a preview URL, doesn't take
  traffic). Caution: a preview version uses the **same bindings** (KV `HOSTED`, D1 reviews/push, rate limits) as
  production, so a preview isn't a sandbox. Simplest is to leave non-production builds off.
- Watch paths: none needed (the branch moves a few times a day).

Moving it: `git push origin <commit>:site` (fast-forward only, never forced). A small `tools/site-deploy.sh
[<commit>]` would check the commit is on main and the gate passed, push it, and poll `/healthz` and `build.json`
for the commit.

How `tools/release.sh` / `publish.sh` fit: `publish.sh` already ends with the release live on GitHub; add one step
after it pushes `web/app/source.json`: move `site` to that commit (the tag commit + the source.json commit), then
`--verify-live` as now plus a check that `/build.json` names the new commit. Then the site, the released apps and
`build.json`'s version all describe the same code, and a site-only hotfix is `tools/site-deploy.sh` without a
release.

- + Nothing reaches the credential pages until a person (or `publish.sh`, which a person starts) moves it.
- + 4 to 8 deploys a day instead of hundreds; footer version and commit are truthful.
- + Rollback stays simple: `wrangler rollback` (or the dashboard) to the previous version, then move `site`
  forward with the fix; `site` itself is never rewound or force-pushed.
- − A site fix waits for the next release or a manual `site-deploy.sh`. Agents' journals that say "live after the
  merge" (e.g. F289's `/apple/status` check) become "live after the next release"; tasks that check the live site
  need `--after` the release or a person's deploy.
- − One more branch for the runner to leave alone: agents must never push `site` (it is not `task/*`, so the
  runner doesn't touch it; a line in AGENTS.md would say so).

### C. Deploy on release tags

Workers Builds triggers on branch pushes; I know of no tag trigger in it (not checked live, see Not verified). So
a tag deploy means one of:
- C1. Disconnect Workers Builds; a GitHub Actions workflow on `push: tags: ['v*']` runs `tools/buildinfo.sh` and
  `cloudflare/wrangler-action` with a `CLOUDFLARE_API_TOKEN` repo secret.
- C2. `release.sh` runs `npx wrangler deploy -c wrangler.ifizbox.toml` itself, with the owner's local wrangler
  login, after `gh release create`.

- + Same "only releases go live" property as B.
- − C1 puts a Cloudflare token with deploy rights in GitHub secrets, and a workflow file any merged commit can edit
  (an agent commit changing `.github/workflows/` could deploy anything on the next tag). AGENTS.md's "no CI
  release" note exists because the native build can't run on a hosted runner; this would be the repo's first CI.
- − C2 ties deploys to the release machine's wrangler login; a site hotfix without a release needs a manual
  wrangler run, and Workers Builds' build log/history goes away.
- − The deploy runs at the tag, before `publish.sh` commits the new `source.json`, so the fallback copy lags one
  commit (harmless, fallback only).

## Recommendation

**B: production branch `site`, moved by `publish.sh` at each release and by a `tools/site-deploy.sh` for hotfixes.**
It gives C's "only what a person released goes live" without a new CI system, a token in GitHub, or losing Workers
Builds; the Workers Builds change is one setting (production branch `main` → `site`), with non-production builds
off. With 4 to 8 releases a day the site still moves fast. Keep A only if live-after-merge matters more than the
credential pages being reviewed first.

If the user picks B, the follow-ups (to file then, not now): T `tools/site-deploy.sh` + a `publish.sh` step + test
cases in `tools/test_release.py`; D README/worker README/docs/release.md/wrangler.ifizbox.toml comments ("every
push to main deploys"); a person creates the `site` branch at the current main and flips the Workers Builds
production branch.

## Not verified

- Workers Builds' current settings UI names, whether it has a tag trigger, build watch paths, and the monthly
  build-minute allowance and per-build time: from memory of Cloudflare's docs, not checked against the live
  dashboard or docs (no dashboard access from this session, and the task is research without deploy changes).
- Whether `wrangler versions upload` preview URLs work for this Worker (they need the workers.dev subdomain /
  preview URLs enabled; `wrangler.ifizbox.toml` sets custom domains and no `workers_dev`). Not tried: it would
  upload a version to the production Worker.
- Push counts are first-parent commits on origin/main; the runner pushes per merge, but whether each push
  triggered its own build (or Cloudflare coalesced queued ones) was not checked.
