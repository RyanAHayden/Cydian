# T35: release 0.15.0

## What I did
- `run plan` first: F288, F290 and F291 are all ticked, and their merges are on origin/main (a5308723, 833d574b,
  025b1d18 + a203e243). The branch had every commit of origin/main (a203e243).
- As in T25: this session may not push main, so `tools/publish.sh` (main only) was not used; its steps were run on
  `task/T35`. Bumped `native/VERSION` to 0.15.0 (4f8e06b0), pushed `task/T35` so `release.sh` sees HEAD on origin.
  The tag v0.15.0 points at 4f8e06b0; it reaches main when the runner merges this branch.
- Notes written by hand (first line: tweak injection when signing), covering F288, F291 and B159; F290 (marketing
  video) and B165 (Worker-side) change nothing in the builds, so they are not in the notes.
- `tools/release.sh --dry-run`, then `tools/release.sh --notes …` as RyanAHayden (owner token). Piracy list:
  Canister f517ff676e47, current.
- Committed and pushed the rewritten `web/app/source.json` (0.15.0 first), 4652c1a6.

**Shipped: 0.15.0** (build 2408), <https://github.com/RyanAHayden/iFizBox/releases/tag/v0.15.0>.

## Checks
- release.sh's own check: assets listed, `latest/download/iFizBox.ipa` redirects to v0.15.0's (206).
- `gh release view v0.15.0`: "iFizBox 0.15.0", not a draft, assets iFizBox.ipa, iFizBox.deb,
  com.ryha.ifizbox_0.15.0-2408_iphoneos-arm64.deb, Packages, Packages.gz, Release, source.json.
- `tools/release.sh --verify-live 0.15.0`: https://ifizbox.com/repo/source.json lists 0.15.0 first, and
  /repo/Packages lists com.ryha.ifizbox 0.15.0-2408 first.

## Tried and failed
- nothing

## Not verified
- No install of 0.15.0 on any phone (iPhone 7 or otherwise): the task asked for the release and the server checks
  only, and phones are touched only when a task says so.
- The deployed fallback copy of `web/app/source.json` updates only when the runner merges this branch and Workers
  Builds deploys, after this session; the live check passed through the release asset, not that copy.
