# F172: iFizBox rename 3/3, ifizbox.com and the GitHub repo

## What changed

- Every hard-coded old domain in code is now brand.js `DOMAIN` (or `SIGN_HOST`):
  - `core/essential.js` `SELF_APT_URI` (the jailbreak app's built-in APT source) and `SELF_SITE`, plus the
    installSelf alert text.
  - `screens/home.js` `IFIZBOX_APT_REPO` (the website's Add to Sileo/Zebra and Copy Repo URL).
  - `core/handoff.js` `PUBLIC_SITE` (share and /add links from the app, and the app's /api/ipainfo calls).
  - `core/account.js` `ACCOUNT_BASE` and its error messages; `screens/account.js` footers and alerts.
  - `screens/signing.js` the Signing Server step's hint ("Keep sign.ifizbox.com…").
  - `worker/src/index.js` the GitHub User-Agent (`DOMAIN`).
  - `web/app/index.html` og:url and og:image: `native/brand.py html()` now writes them from `BRAND_DOMAIN`, so
    `brand.py sync` keeps them right and test_brand's sync check covers them.
  - `tools/release.sh` prints `https://$BRAND_DOMAIN/repo/`.
- `worker/wrangler.toml` (the deploy-your-own config) is named `ifizbox-sign`. KV and rate-limit ids untouched.
- Docs, README, AGENTS.md, worker/README.md, comments: the new domain (or "the site"/`DOMAIN`).
- Tests use https://ifizbox.com. The B23 apt-update fixtures (a real 525 capture) now say `dead.example` for the
  old host, so nothing in the tree names it.
- source.json: three published release notes no longer name the old domain. The `releases/download/v*/Cydian.ipa`
  URLs stay: those are the real asset names on GitHub (release.sh writes iFizBox.ipa from the next release on).
- `native/test_brand.py`: the F172 exemption now only covers those published asset URLs; a new
  `test_no_old_domain` fails if any tracked file (but plan/, journal/, docs/concepts) names the old domain.
- GitHub repo: brand.js `GITHUB_REPO` / brand.env were already `RyanAHayden/iFizBox` (F170/F171); every repo link
  already uses it. Nothing to change.

## The iPhone 7's old built-in source (B23 note)

No rewrite code (user: no support for old saved values). Since `SELF_APT_URI` now points at the new domain, the old
line in `/var/jb/etc/apt/sources.list.d/ifizbox.sources` is no longer the built-in (builtin is decided by
`builtinSources`, matched on the key), so the row loses its lock and the user can swipe-delete it, which runs the
helper's removesource on ifizbox.sources. Refreshing also adds the new built-in back (withBuiltins). The phone
itself was not touched (the task doesn't say to).

## Steps for the user (not done here: no deploy)

Note: Workers Builds deploys ifizbox.com on every push to main, so this merge itself deploys the new code to the
`ifizbox` worker. Still:

1. Confirm the ifizbox.com zone is **Active** in the Cloudflare dashboard (and sign.ifizbox.com / www resolve).
2. Detach or delete the old `cydian-sign` worker (Workers & Pages > cydian-sign > Settings > Domains & Routes:
   remove its cydian.dev routes/custom domains, or delete the worker).
3. If a manual deploy is wanted: from `worker/`: `tools/buildinfo.sh && npx wrangler deploy -c wrangler.ifizbox.toml`
   (buildinfo.sh lives at the repo root: from the root it is `tools/buildinfo.sh && cd worker && npx wrangler deploy -c wrangler.ifizbox.toml`).
4. On the cydian.dev zone: Rules > Redirect Rules > new rule, "All incoming requests", dynamic redirect to
   `concat("https://ifizbox.com", http.request.uri.path)` with query string preserved, status 301. (Needs a proxied
   DNS record on cydian.dev, e.g. `AAAA @ 100::` and `AAAA * 100::` proxied, once the old worker's domains are gone.)
   Or let the domain lapse.
5. On the iPhone 7: swipe-delete the old built-in source row (now unlocked), or wait for a release that ships this.

## Not verified

- The deploy, the Cloudflare zone status and the cydian.dev redirect: user steps, not to be done by a task.
- The iPhone 7: not touched (the task doesn't say to). That the old source row unlocks and can be deleted follows from
  `builtinSources`/`isBuiltin` keying on `SELF_APT_URI`; not tried on the phone.
- Native Swift tests (`native/sign/tests/main.swift` URL change) only run where the Swift toolchain is set up; the
  gate decides. The changed line is a plain string swap in the input and the expected output.
