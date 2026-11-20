# T25: release 0.14.0

## What I did
- B138 and B139 are ticked; B139 had already shipped in v0.13.0, B138's follow-up and B156/B160/B164 are new
  since then. The branch had every commit of origin/main.
- v0.13.0 was already out (T31/T32), so this release is **0.14.0**.
- As in T13: this session may not push main, so `tools/publish.sh` (main only) was not used. I ran its steps on
  `task/T25`: bumped `native/VERSION` to 0.14.0, committed (cee1610a), pushed `task/T25` so `release.sh` sees HEAD on
  origin, dry run, then `tools/release.sh --notes <scratchpad notes>` (no `--draft`). The tag points at cee1610a on
  `task/T25`; it reaches main when the runner merges the branch. The task text says "push main": the runner's push
  of the merge does that.
- Notes written by hand (first line: App ID kept on updates, signing 3-4x faster), kept in the scratchpad.
- Published as RyanAHayden (owner token, `--check-auth` first). Piracy list: Canister f517ff676e47, current.
- Committed the rewritten `web/app/source.json` (0.14.0 first).

**Shipped: 0.14.0** (build 2375), <https://github.com/RyanAHayden/iFizBox/releases/tag/v0.14.0>.

## Checks after publishing
- release.sh's own check: assets iFizBox.ipa, iFizBox.deb, com.ryha.ifizbox_0.14.0-2375_iphoneos-arm64.deb,
  Packages, Packages.gz, Release, source.json; `latest/download/iFizBox.ipa` redirects to v0.14.0's (206).
- `gh release view v0.14.0`: not a draft, title "iFizBox 0.14.0".
- `https://ifizbox.com/repo/Packages`: first stanza 0.14.0-2375, Filename under v0.14.0/, then 0.13.0 and older.

## Not verified
- `https://ifizbox.com/repo/source.json` listing 0.14.0 (`tools/release.sh --verify-live 0.14.0`): it still says
  0.13.0, because the Worker serves the copy deployed with the site, and the committed 0.14.0 copy deploys only when
  the runner merges this branch into main and Workers Builds runs, after this session ends.
- No install of 0.14.0 on any phone: the task asked for the release and the server checks only.
