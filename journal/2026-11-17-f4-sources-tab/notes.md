# F4: Sources tab

## What I did

- `web/app/core/sources.js` (new): the source list for both front doors.
  - `DEFAULT_SOURCES`: Telesphoreo (`http://apt.saurik.com/ ios/1800.00 main`), BigBoss (`…/repofiles/cydia/
    stable main`), Chariz (flat), Havoc (flat), Procursus (`https://apt.procurs.us/ 1800 main`). Keys are
    Cydia's `deb:<URI>:<dist>`.
  - `normalizeSourceUrl`: Cydia's VerifySource rule, http(s) only (`file:///` can't be fetched by either
    backend), trailing `/` added. **Decision:** a bare host (`repo.chariz.com`) gets `https://` in front; Cydia
    rejects it, but that's how repos are shared today.
  - `verifySource(backend, url)`: the Add Source check. One `backend.packages(url)` (the proxy, or the app,
    tries Packages.xz/.bz2/.gz/plain), then Release/InRelease (also gives the Origin name), then Packages.zst and
    Packages.lzma checked by magic bytes. Any of them = a repo. "upstream"/"not_found" errors move to the next
    name; anything else (refused, timeout, network, too_large, rate_limited) stops with "Verification Error" and
    the backend's message. No file found: Cydia's "Did not Find Repository" text. The count comes from the
    Packages text when there is one (null for .zst/.lzma-only repos: nothing here decodes zstd).
  - `refreshSource`: flat repo -> Packages count; dist repo -> Release first, and if its `Architectures` doesn't
    list ours, count 0 without fetching (Telesphoreo is rootful only); else every component's
    `binary-<arch>/` Packages. Errors come back as `error`, not thrown, so one dead source doesn't stop the rest.
  - `openSourceStore`: IndexedDB `cydian-sources` (stores `sources` and `meta`). The defaults are seeded once
    (a `meta` "seeded" row), so a deleted default stays deleted.
  - `sourceCalls(backend, opts)`: `sources()`, `addSource(input)`, `removeSource(key)`, `refreshSources(onEach)`,
    mixed into the backend. `backend-http.js` now does this; `backend-native.js` (N-tasks) should do the same,
    which is how "the app reuses it unchanged".
- `core/apt.js`: `DEFAULT_ARCH = "iphoneos-arm64"` (was iphoneos-arm in `repoLayout`), `ARCHES`, `matchesArch`,
  `filterArch` (arch or `all`). **Decision:** a stanza with no Architecture field is dropped: apt needs the
  field, and old repos that omit it are rootful. Worker/parser gained a `count` message (packages matching an
  arch) so counting BigBoss doesn't ship every stanza back from the worker.
- `backend-http.js`: `assetUrl(url)` (repo icons load through the proxy as `<img src>`), and the source calls.
- `backend.js` (new): `getBackend()`, `getParser()`, `getArch()` (`localStorage["cydian.arch"]`, until F13's
  Settings exists). The app build swaps the backend here.
- `nav/alert.js` (new): iOS 6 UIAlertView with optional text field, from the kit's "Alert diaglog" layer
  (272 px, `#0b1b43` at 80 %, 2 px light rim, gloss; button gradients are the kit's grey screened over the navy,
  computed by hand).
- `screens/sources.js`: rows with CydiaIcon.png (letter placeholder until it loads, like Cydia's unknown.png),
  name (ours for defaults, else Release Origin, else host), URI, count badge; URI goes red when the last refresh
  failed. Refresh -> "Reloading Data" HUD -> refetch all -> redraw. Edit -> Add / Done (Gloss Blue), red minus
  per row that turns and shows a red Delete (kit's "Email Delete" colours). Left swipe on a row shows Delete; a
  tap elsewhere puts it away without opening the row. Add -> "Enter APT URL" alert -> "Verifying URL" HUD ->
  saved, or Cydia's error alert. Tapping a source opens a "Source Information" page until F5's Sections.
- `sources.css` (new, linked in index.html) holds all of the above's styles, so ios6.css stays untouched.
- Plan notes left on F5 (Sections/All Sources replace the detail page), F13 (arch setting), F8 (`/add?url=`).

## Decisions

- Alert title "Enter APT URL", not Cydia's "Enter Cydia/APT URL": AGENTS.md says pages don't name Cydia.
  The other alert texts are Cydia's.
- No "Source Warning" (Cydia's repotag call to cydia.saurik.com): an external piracy list we don't control.
- No "All Sources" row yet: it opens a combined Sections list, which is F5.
- All defaults can be deleted (Cydia protects Telesphoreo; we own the whole list).
- After Add, the source isn't refreshed again: the check already fetched and counted it.

## Checks run

- `node --test web/app`: new `core/sources.test.js` (13 tests: URL rule, good repo with arch count and Origin,
  worker count, Release-only and .zst-only repos, HTML-for-everything rejected, not-a-repo with the exact probe
  order, bad URL never reaches the backend, refused by the proxy stops at once, refused through the real
  `createHttpBackend` with a fake fetch answering the proxy's 403 JSON, store seeding/sorting/deletes,
  dist-repo refresh and rootful-only Release) plus an arch-filter test in apt.test.js. All pass.
- Live, headless Chromium (CDP, 320x480 @2x) against `web/app.py` with real network:
  - Refresh: BigBoss 240, Chariz 388, Havoc 1,802 (rootless + all), Telesphoreo 0 (Release lists no arm64),
    Procursus failed (see below).
  - Add `http://127.0.0.1/repo/` -> "Verification Error: 127.0.0.1 resolves to a loopback address" (the F3 guard).
  - Add `https://example.com/` -> "Did not Find Repository". Delete Chariz, re-add as bare `repo.chariz.com` ->
    saved with 388. Swipe arms Delete, a tap elsewhere disarms without navigating, the next tap opens the row.
- Screenshots here: `sources.png`, `sources-edit.png`, `add-source-alert.png`. Telesphoreo's fetched icon is
  Cydia's logo, so it was removed from the page before the shots (AGENTS.md: never commit Cydia's logo); the
  live app shows it, fetched from the repo at run time.

## Not verified

- **Procursus**: `apt.procurs.us` answers 403 (a Cloudflare challenge page) to the server's fetches, for Release,
  Packages and CydiaIcon.png, with Cydia's headers too. From the public site it will always show no count and a
  red URI. In the app (direct fetch from the phone) it may work; can't check without a phone running the app.
  The `1800` dist (iOS 15 rootless) is from memory, not checked against the repo.
- Telesphoreo's dist `ios/1800.00`: the Release answers, but on a phone it should be the device's CF version;
  the app should fill that in. Its count is 0 for rootless by design.
- Real touch swipes on an iPhone (tested with synthetic PointerEvents in Chromium only), 120 Hz feel of the
  row slide, and the alert's look next to a real iOS 6 alert on the 4S (no `ui-4s` lock taken; the task didn't
  ask for the device).
- The keyboard on iOS covering the alert: not checked (no iOS browser here).
- docs/native.md doesn't list the new backend calls yet (outside this task's files); `core/sources.js`'s header
  documents them.
