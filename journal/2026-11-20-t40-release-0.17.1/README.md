# T40: release 0.17.1

## What I did
- Checked the queue: F306, F307, B180, B177 and B178 (the task's `after`) are all on origin/main; `task/T40` was at
  origin/main (58cef3b9).
- This session may not push main, so `tools/publish.sh` was not used (it commits VERSION to main and merges the tag
  into main); its steps ran on `task/T40`, as in T38. Bumped `native/VERSION` 0.17.0 → 0.17.1 (patch, as the task
  says, although a lot landed), wrote `notes.md` here, committed (9d3787ad) and pushed `task/T40`.
- Notes cover the user-facing work since v0.17.0: the task's list (B171, F305a, B172, B176, B179, C18, B177, B178,
  B180, F306, F307) and what else landed meanwhile: paid sideload tweaks (F308, F318, F319, F309), push on by
  default (F310), hint style (F311, F314, F315, F317), pull to refresh (B188, B197), switch (B187), theme defaults
  (F320), lazy loading (F313), B181–B186, B192, B199, B200. C18 (a Credits row removed) gets no line of its own.
  Gate, tests, refactors and server hardening (B189, B190, F312) are left out as not user-facing.
- `tools/release.sh --check-auth` (RyanAHayden), `tools/deploy.sh --check-auth` (wrangler logged in), `--dry-run`,
  then `tools/release.sh --tag-source --notes …`. Piracy list: Canister f517ff676e47, current.
- release.sh tagged v0.17.1 at 1bfced9c (the build's commit plus `web/app/source.json`) and left `task/T40` there
  too; pushed `task/T40`. That commit's subject is release.sh's own ("iFizBox's AltStore source: 0.17.1"), without
  the T40 prefix; it is the tagged commit, so it was left as it is.
- Since T53 the site deploys from release tags only, so I ran `tools/deploy.sh v0.17.1` (publish.sh's step):
  "https://ifizbox.com now runs v0.17.1".

**Shipped: 0.17.1** (build 2850), <https://github.com/RyanAHayden/iFizBox/releases/tag/v0.17.1>.

## Checks
- release.sh's own check: all 7 assets listed; `latest/download/iFizBox.ipa` redirects to v0.17.1's (206).
- `tools/release.sh --verify-live 0.17.1`: https://ifizbox.com/repo/source.json lists 0.17.1 first (downloadURL
  v0.17.1/iFizBox.ipa); /repo/Packages lists com.ryha.ifizbox 0.17.1-2850 first.
- https://ifizbox.com/build.json: version 0.17.1, commit 1bfced9c.

## Tried and failed
- nothing

## Not verified
- No install of 0.17.1 on any phone (iPhone 7 or otherwise), and no in-app check that Changes offers it: the task
  asked for the release and the server check only, and phones are touched only when a task says so.
- The site's build.json says build 2851 while the release's apps are 2850: deploy.sh's buildinfo counts the tag
  commit (one more than the built commit). Cosmetic, not looked into further.
