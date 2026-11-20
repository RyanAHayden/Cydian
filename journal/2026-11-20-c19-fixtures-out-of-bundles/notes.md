# C19: keep test fixtures out of shipped bundles

The audit found `web/app/core/fixtures/` (test .p12s, `tiny-ifizbox.ipa`, source and version fixtures) inside
the v0.17.0 IPA.

## What changed

- `web/app/.assetsignore` (the Worker's static assets): adds `core/fixtures/` and `*.test.mjs` beside `*.test.js`.
- `native/build.sh`: the web/ copy skips `./core/fixtures/*` and `*.test.mjs`.
- `native/mkipa.py` / `native/mkdeb.py` `check`: a file under `web/core/fixtures/` is a problem ("test fixtures
  shipped in the bundle"), and `*.test.mjs` now counts as a shipped test. Tests: `test_ipa.py`
  `test_fixtures_flagged`, `test_native.py` `test_fixtures_in_bundle_flagged`.

Only comments in shipped code mention `core/fixtures` (detect.js, signing-client.js), so nothing at runtime needs
them.

## Left alone

`worker/wrangler.preview.toml` overwrites `.assetsignore` in its preview copy with only `.gitignore` and
`.assetsignore`, so the preview deploy still serves fixtures and tests. Preview only, not in this task's files.

## Check

`native/build.sh all` built both and both checks passed: the .deb's data.tar and the IPA's zip each hold 307 web
files (the IPA's 323 names include directories). Neither has anything under `core/fixtures/`, a `*.test.*`, a .p12
or an .ipa.

## Not verified

- The Worker deploy honouring `core/fixtures/` in `.assetsignore`: no deploy from a task run. Wrangler reads it with
  gitignore syntax, which this line follows.
- The fail-path of `check` was tested on fixture bundles in the unit tests only, not on a real built bundle.
