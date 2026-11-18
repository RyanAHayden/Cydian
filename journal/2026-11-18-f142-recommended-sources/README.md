# F142: Recommended sources match today's apps

## What I did
- Read the defaults each app ships, from its current source (shallow clones, 2026-11-18):
  - **Sileo** (Sileo/Sileo main, `Backend/Repo Manager/RepoManager.swift`): first run adds Havoc and Chariz.
  - **Zebra** (zbrateam/Zebra v1): its own repo `getzbra.com/repo/` (`ZBBaseSource zebraSource`); "utility" sources
    per jailbreak (`ZBCommunitySourcesTableViewController.m`): Dopamine and rootless palera1n get Procursus and
    ElleKit, palera1n gets repo.palera.in. Its community list, `api.getzbra.com/sources.json`, answers 404.
  - **Dopamine** (already recorded in recommended.js, F19): Chariz, Havoc, BigBoss, ElleKit.
  - **Feather** (claration/Feather main, `Views/Sources/SourcesAddView.swift` `recommendedSources`): 15 sources.
  - **SideStore** (SideStore/SideStore develop, `AppConstants.swift`): its own `sidestore.io/apps-v2.json/` and
    `sidestore.io/default-sources` (19 sources).
  - **AltStore** (altstoreio/AltStore marketplace): `apps.altstore.io` built in; its recommended collections
    (`cdn.altstore.io/.../recommended-sources.json`) are EU marketplace (PAL) sources (Epic Games, Stremio, …), which
    a sideloaded app can't install from, so none taken.
- Picked: APT = every flat repo those jailbreak apps add (Havoc, Chariz, ElleKit, palera1n, Zebra). AltStore =
  each sideloader's own source (AltStore, SideStore, Feather) plus every source on **both** Feather's and SideStore's
  lists (Team Picks, StikDebug, LiveContainer, Provenance, Manic EMU, DolphiniOS, Flycast, UTM, Amethyst, PokeMMO).
  Sources on only one list (Aidoku, iTorrent, Geode, MeloNX, Navic, …) were left out to keep the list short.
  FIZL0 kept (marked `own`). Provenance, Feather, AltStore, Team Picks were on the old list too; they stay because
  the apps ship them, with new descriptions. All old descriptions rewritten.
- Left out on purpose: Procursus and BigBoss (dist repos: Recommended adds flat repos only, and every rootless
  bootstrap adds Procursus already). LiveContainer's URL in Feather's list (raw main/apps.json) is 404; SideStore's
  (release asset) answers, so that one is used. MeloNX's URL from SideStore's list doesn't return JSON.
- `tools/recommended_check.py`: fetches every entry (or URLs given) and prints what it carries (apps; packages,
  rootless count, paid, sections, firmware range). Its output for today is `check.txt`; every `why` was written from
  it and the apps' subtitles/descriptions. `CHECKED = "2026-11-18"` in recommended.js records the date.
- Per build (F142 brief): `recommendedFor` (the jailbroken path) now returns the APT repos for the jailbreak plus
  FIZL0's own source only; Not Jailbroken/IPA/website already kept only AltStore sources (F144). Before, a
  jailbroken phone saw every AltStore source too.
- Tests: `web/app/core/recommended.test.js` (shape, one-line descriptions, per-build lists, deps.js homes all on
  the list); updated the F19 test in `sourcetools.test.js` for the new names and the FIZL0-only AltStore part.

## Tried and failed
- Zebra's community sources API (404); Feather's LiveContainer URL (404); MeloNX's source URL (not JSON).

## Not verified
- The Recommended page wasn't looked at in a browser or on a phone: the change is data plus one filter, covered by
  the node tests; no UI code changed.
- Adding the github.com redirecting URLs (LiveContainer release asset, Flycast `raw/`) through the native app's
  fetch wasn't tried on the iPhone 7 (the task doesn't call for the phone); the worker proxy follows redirects
  (`worker/src/index.js` `redirect: "follow"`) and URLSession does by default.
- Havoc's "iOS 15 and later" and Chariz's "iOS 15 to 17" were read from the most common firmware bounds, not every package.
