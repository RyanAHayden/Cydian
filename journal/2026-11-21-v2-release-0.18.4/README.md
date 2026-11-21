# V2: release 0.18.4

## What I did
- The brief is agent-runner's default release brief (CHANGELOG.md, a release workflow). iFizBox has neither: its
  version is `native/VERSION` and a release is `tools/publish.sh` / `tools/release.sh` (docs/release.md), run
  locally because the build needs the iOS SDK. So I followed docs/release.md, as T38 and T40 did.
- This session may not push main, so `tools/publish.sh` (which commits VERSION to main and merges the tag into
  main) was not used; its steps ran on `task/V2`, and the runner's merge of `task/V2` brings `native/VERSION`
  and `web/app/source.json` onto main.
- Version: 0.18.3 → **0.18.4**, a patch bump. 198 commits landed since v0.18.3, features among them (F342, F343,
  F344, F346), but the owner's own 0.18.1–0.18.3 were patch bumps with features too, so I kept that habit.
- Notes in `notes.md` here: the user-facing work since v0.18.3 (F343 kept IPA, B263 re-sign pipeline, F344/F344a
  tweak index, B268, F346, B262, B276/B284, F342, B261, B273, B269, B272, B274, B275, B264, B265/B279, B270 and
  smaller fixes). Research (R*), journal, tests and log-only changes (B286) are left out.
- `tools/release.sh --check-auth` (RyanAHayden), `tools/deploy.sh --check-auth` (wrangler logged in), `--dry-run`,
  then `tools/release.sh --tag-source --notes notes.md`. Piracy list: Canister f517ff676e47, current.
- release.sh tagged v0.18.4 at 2dea3348 (build commit 05b76ec4 plus `web/app/source.json`); that commit keeps
  release.sh's own subject ("iFizBox's AltStore source: 0.18.4") without the V2 prefix, as in T40, since it is the
  tagged commit.
- `tools/deploy.sh v0.18.4`: "https://ifizbox.com now runs v0.18.4". This first deploy with F344's TWEAKS binding
  created the D1 database `ifizbox-tweaks` (wrangler: "TWEAKS provisioned").

**Shipped: 0.18.4** (build 3685), <https://github.com/RyanAHayden/iFizBox/releases/tag/v0.18.4>.

## Checks
- release.sh's own check: all 7 assets listed; `latest/download/iFizBox.ipa` redirects to v0.18.4's (206).
- `gh release view v0.18.4`: published, not a draft.
- `tools/release.sh --verify-live 0.18.4`: /repo/source.json lists 0.18.4 first; /repo/Packages lists
  com.ryha.ifizbox 0.18.4-3685 first.
- https://ifizbox.com/build.json: version 0.18.4, build 3685, commit 05b76ec4.

## Tried and failed
- nothing

## Not verified
- "The release workflow passed (gh run list)": there is no release workflow; `gh run list` is empty, because the
  build needs the iOS SDK and runs locally (docs/release.md). release.sh's own checks and `--verify-live` stand in.
- No install of 0.18.4 on a phone, and no in-app check that Changes offers it: the task asks for the release only.
- The tweak index's cron and `/api/tweaks` on the new D1 database: only that the deploy made the database; a bare
  `GET /api/tweaks` answers 400 (no app named), and the cron's first runs were not watched.
