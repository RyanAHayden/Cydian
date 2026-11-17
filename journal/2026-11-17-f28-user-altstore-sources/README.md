# F28: the user's own AltStore sources as defaults and test sources

## What was done

- `web/app/core/sources.js`: `DEFAULT_ALT_SOURCES`, the 13 URLs from the brief, deduped by `dedupeUrls` (parsed
  href; the two bare hosts get their `/`). No two of the 13 were the same URL or redirected to the same place, so
  the dedupe keeps all 13. URLs are kept as given; the proxy follows the redirects on every fetch.
- Seeding: `core/altstore.js` `openAltStore({ defaults })` puts the defaults in once (DB version 2 adds a `meta`
  store with a `seeded` flag, like the APT store), so a deleted default stays deleted. A seeded record has
  `count: null, name: null` until the first refresh (the row shows the host, as APT defaults do).
  `withAltSources` takes `altDefaults`; only `backend-http.js` passes `DEFAULT_ALT_SOURCES` ("the site's default
  list"). Existing site visitors (DB v1) get the 13 once on the upgrade. `backend-native.js` is unchanged.
- Bug found and fixed: **alt.crystall1ne.dev answers every path with its JSON**, so Add Source with the bare
  host made the APT check (`verifySource`) accept `/Packages` (200, JSON) as an empty APT repo with 0 packages.
  `verifySource` now ignores a Packages text that starts with `<`, `{` or `[`, and `looksLikeRelease` refuses
  JSON too; the add then falls through to AltStore. The test fails without the fix (checked by reverting it).
- Fixtures: `web/fixtures/altstore/` (13 trimmed snapshots, README with the shape of each).
- Tests: `web/app/core/altstore-sources.test.js`, one per shape found (AltStore 2.0; 1.x only; 1.x fields beside
  versions[]; ESign-style AppTesters; RyukSign's variants sharing bundle ids; every source to catalog rows), then
  through `createHttpBackend` with a fake proxy: the 13 are seeded, refresh fills names and app counts, a changed
  source shows on the next refresh, a deleted default stays deleted; and each of the 13 adds by the URL as typed
  (crystall1ne as a bare host). `sources.test.js`'s HTTP-backend test now counts the AltStore defaults too.

## Live check (real proxy, real network)

`web/app.py` on :8758, `/api/fetch?url=<each URL>`: all 13 answer 200 and parse (`live-proxy.txt`), including the
github.com `raw` and `releases/latest/download` redirects (to raw.githubusercontent.com and
release-assets.githubusercontent.com). AppTesters is 10.3 MB (under the 50 MB cap).

Screenshots (`tools/shots.mjs`, headless Chromium 390 wide @3x on that server, fresh profile), in `shots/`:
1. Sources as Not Jailbroken right after the seed: 13 rows by host, "5 APT sources are hidden".
2. After Refresh: names, icons and counts (AppTesters 789, Provenance 4, FIZL0 3, ...); no errors.
3. Jailbroken Rootless: all 18 (5 APT + 13 AltStore).
4. crystall1ne's source page after removing it and adding `alt.crystall1ne.dev` back: an AltStore record
   (`alt:https://alt.crystall1ne.dev/`, 2 apps), news shown.

## Findings

- Bundle ids listed more than once keep only their first entry (existing parseAltSource rule): AppTesters lists
  10,279 entries for 789 ids (one entry per version), RyukSign 12 variants ("No Plugins", "iOS 15", ...) under 2
  ids. The counts above are therefore 789 and 2. Filed as a follow-up (merge repeated entries into one app's
  version history / keep variants), not done here.
- Procursus shows a red URL (refresh error) in shot 3: that is the APT default, unrelated to this task.
- Provenance's source has no `iconURL`, so its row has the letter placeholder.

## Not verified

- The phone (4S) and the native app: not touched; the task is the site's list. The native backend gets no defaults.
- The deployed site: only a local `web/app.py` was used.
- Upgrading a real browser's existing v1 `cydian-altsources` database to v2: only the fake IndexedDB (fresh DBs)
  and a fresh Chromium profile were exercised.
- Dark theme shots: not taken (no UI change).
