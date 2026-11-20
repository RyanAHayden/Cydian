# T38: release 0.17.0 (the tweaks release)

## What I did
- Checked the queue first: T37 was dropped in favour of T39 (0.16.0, out), and F302, F302a, F303, F304, B174 and
  B175 are all ticked and on origin/main. README has the "Tweaks without a jailbreak" section and
  `web/app/screens/why.js` exists. `task/T38` was at origin/main (2c847280).
- As in T25/T35/T39: this session may not push main, so `tools/publish.sh` was not used; its steps ran on
  `task/T38`. Bumped `native/VERSION` 0.16.0 → 0.17.0 (minor), wrote `notes.md` here (leads with tweaks), committed
  both (40daea25) and pushed `task/T38` so `release.sh` sees HEAD on origin. Tag v0.17.0 points at 40daea25; it
  reaches main when the runner merges this branch.
- Notes cover the user-facing changes since v0.16.0: F302, F302a, F304, F305, F303, B174, B175, B173, C16.
  B171 and F305a are still open and are not in it.
- `tools/release.sh --check-auth` (RyanAHayden), `--dry-run`, then the real run. Piracy list: Canister
  f517ff676e47, current (unchanged).
- Committed and pushed the rewritten `web/app/source.json` (0.17.0 first).

**Shipped: 0.17.0** (build 2541), <https://github.com/RyanAHayden/iFizBox/releases/tag/v0.17.0>.

## Checks
- release.sh's own check: all 7 assets listed; `latest/download/iFizBox.ipa` redirects to v0.17.0's (206).
- `gh release view` (latest): "iFizBox 0.17.0", v0.17.0, not a draft, not a pre-release.
- `tools/release.sh --verify-live 0.17.0`: https://ifizbox.com/repo/source.json lists 0.17.0 first;
  /repo/Packages lists com.ryha.ifizbox 0.17.0-2541 first.

## Tried and failed
- nothing

## Not verified
- No install of 0.17.0 on any phone, and no hands-on run of tweak injection from it: the task asked for the release
  and server checks only, and phones are touched only when a task says so.
- The deployed fallback copy of `web/app/source.json` updates only when the runner merges this branch and Workers
  Builds deploys, after this session; the live check passed through the release asset, not that copy.
