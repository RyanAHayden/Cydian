# T39: release 0.16.0

## What I did
- `task/T39` already had every commit of origin/main (`git merge --ff-only origin/main`: up to date, 6594c694).
  Nothing was waited for: F302, C16 and B171 go in the next release, as the task says.
- As in T25/T35: this session may not push main, so `tools/publish.sh` was not used; its steps were run on
  `task/T39`. Bumped `native/VERSION` to 0.16.0 (e2ad4bc3), wrote the notes (`notes.md` here, f1fcaf68) and pushed
  `task/T39` so `release.sh` sees HEAD on origin. The tag v0.16.0 points at f1fcaf68; it reaches main when the
  runner merges this branch.
- Notes cover the user-facing changes since v0.15.0: F294, F295 (+ D16), F297/F298, F292, F296, F300, F301, F299,
  B170, B168, B166, B169. R42 and plan/archive commits change nothing in the builds.
- `tools/release.sh --dry-run --notes …`, then the real run as RyanAHayden (owner token; `--check-auth` confirmed).
  Piracy list: Canister f517ff676e47, current (unchanged).
- Committed and pushed the rewritten `web/app/source.json` (0.16.0 first).

**Shipped: 0.16.0** (build 2500), <https://github.com/RyanAHayden/iFizBox/releases/tag/v0.16.0>.

## Checks
- release.sh's own check: all assets listed, `latest/download/iFizBox.ipa` redirects to v0.16.0's (206).
- `gh release view` (latest): "iFizBox 0.16.0", v0.16.0, not a draft, not a pre-release.
- `tools/release.sh --verify-live 0.16.0`: https://ifizbox.com/repo/source.json lists 0.16.0 first, and
  /repo/Packages lists com.ryha.ifizbox 0.16.0-2500 first.

## Tried and failed
- nothing (a stray no-op wait command I started was left to end on its own timeout; it touched nothing)

## Not verified
- No install of 0.16.0 on any phone: the task asked for the release and server checks only, and phones are
  touched only when a task says so.
- The deployed fallback copy of `web/app/source.json` updates only when the runner merges this branch and Workers
  Builds deploys, after this session; the live check passed through the release asset, not that copy.
