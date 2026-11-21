# F344: know which app every tweak is for before anyone opens it

## What was built

- **`web/app/core/tweakindex.js`** (shared by the Worker and the app): the canonical source key the index uses
  (`uri|dist|components|arch`), the query string, `indexTweaks` (newest version of each package the Packages fields
  let through), `indexEntry` (the verdict kept: ok, why, bundles, executables, anyApp, systemOnly, dylibs, needs,
  library), `paidEntry`/`paidHint` (a paid tweak's app guessed from its Name/Description, `unverified`),
  `liteTweaks` (Add Tweaks for an app: tweaks naming that bundle ID, then every-app ones, nothing else) and
  `worksInLine` ("Works in: YouTube", "… (unverified)").
- **`worker/src/tweakindex.js`**: `GET /api/tweaks?source=…&dist=…[&components=…][&bundle=…]` and a cron pass (same
  `*/30` trigger as push). D1 binding `TWEAKS` (added to `wrangler.toml` and `wrangler.ifizbox.toml`, made on the
  first deploy, tables made on first use). Per source: Packages (.gz, plain, .bz2, .xz) re-read after 6 h; each free
  tweak's .deb downloaded once per package+version, `inspectTweakDeb` run on it (the same code the phone runs);
  paid ones never downloaded. Caps: 30 s for headers, Packages 16 MB download / 48 MB unpacked, a .deb 16 MB (bigger
  ones are left to the phone), 3 tries, 300 sources, `TWEAK_INDEX_PER_RUN` (20) .debs a cron run, 4 on demand for a
  source asked about for the first time (after the answer, `ctx.waitUntil`). Literal private hosts refused
  (`ssrf.js`), `env.FETCH` used when given. Without the binding: `{enabled: false}`.
- **`web/app/screens/tweaks.js`**:
  - `loadTweakIndex` / `loadRowsIndex`: the index's verdicts kept in memory for the session (not in the 400-entry
    localStorage cache, which they would flush); `cachedTweakInfo` reads the device's own check first, then the
    index. `tweakInfo` skips the download for a tweak the index refused. The site asks its own origin, the app
    `https://ifizbox.com`.
  - `appTweakRows` / `rowInfo` / `sellerKeys`: Add Tweaks' list. Paid rows only from a source whose
    `payment_endpoint` answers (names a seller), with the guessed app marked unverified.
  - `checkForApp`: the phone's fallback for tweaks no index has seen: up to 24 in the background, the ones whose
    name/description names the app first, rows join as they pass.
  - Add Tweaks: "Made for <app>", then "Works in Any App", each row's subtitle led by "Works in: <app>"; nothing
    unchecked, nothing system-only, nothing for other apps. Browse Tweak Sources (with an app) follows the same rule.
  - `madeForRows` (the app page's count and the install popup) counts only tweaks naming the app, not every-app ones,
    which would otherwise make every app show "N for This App".
  - `checkTweakRows` (a Tweak Source's list, B269) takes `index`: browse.js passes `loadRowsIndex`, so rows the index
    refused drop without downloads.
- Split off **F344a** (the user's decision 2: hide Tweak Sources with nothing usable in Lite, curated trusted
  app-tweak sources, research per source). It needs the index live to know what each source has, and the research
  needs web access this session didn't have (no search tool).

## Found on the phone (fixed)

The first injection run on the iPhone 15 Pro showed iYoutubeReplay in "Made for YouTube", then gone 20 s later.
`tweakInfo` took its localStorage snapshot before the download and wrote it back after: two checks side by side
(checkTweakRows/checkForApp run 2 at once) dropped each other's verdicts. It now re-reads the cache right before
writing; `tweaks-index.test.js` covers it. This was already possible with B269's two background checks.

## Checks

- Node: `web/app/core/tweakindex.test.js`, `web/app/screens/tweaks-index.test.js` (fixture debs built in
  `web/app/core/fixtures/tweaks/index-debs.js`: a YouTube tweak, a SpringBoard tweak, a UIKit-wide one, a paid one),
  `worker/test-tweakindex.mjs` (the endpoint against SQLite-backed D1 and a fake source: on-demand pass, budgets,
  newest version only, paid never downloaded, `bundle=` filter, new version re-checked, oversized .deb left alone,
  cron seeding from ASSETS' tweak-sources.json, private hosts refused).
- iPhone 15 Pro (installed build predates B267, so `core/tweakindex.js`, `screens/tweakrow.js`, `screens/tweaks.js`
  and tweaks.css were injected as blob modules through `pymobiledevice3 webinspector cdp`, then `openAddTweaks`
  called): Add Tweaks for YouTube listed 6 "Made for YouTube" rows "Works in: YouTube · <version> · <author>", then
  YouTubeVolume joined under "Works in Any App" from the background check; no SpringBoard or other-app tweak.
  Instagram: 17+ "Made for Instagram" rows within 25 s, all from background checks (Instagram-named ones first).
  Screens: `ref/15/screens/f344-yt-1.png`, `f344-yt-2.png`, `f344-ig-1.png` (gitignored).
- From the app, `fetch("https://ifizbox.com/reviews/…")` answers (CORS works from `ifizbox://app`), while today's
  deployed `/api/tweaks` is the SPA's HTML with no CORS ("Load failed"), so the app falls back to its own check, as
  designed, until the Worker is deployed.

## Not verified

- **The index on Cloudflare**: not deployed (deploys happen on release tags). Untested there: D1 creation on first
  deploy for `TWEAKS`, the cron pass, and especially **CPU time**: `inspectTweakDeb` decompresses data.tar.* in JS
  (xz/lzma/zstd/bz2); on the Workers Free plan (10 ms CPU a request) a pass would be cut off (`exceededCpu`). The plan
  ifizbox.com is on isn't recorded in the repo. If it is Free, `TWEAK_INDEX_PER_RUN` can't fix it; the index then
  needs the Paid plan (or a self-hosted runner). Every outgoing fetch of a cron run (Packages tries included) counts
  against `TWEAK_INDEX_PER_RUN`, so the default 20 stays under Free's 50 subrequests.
- **Real Tweak Sources through the Worker** (BigBoss's 9k-package Packages, Havoc, Chariz): only the fake source in
  the test. The phone run exercised the on-device fallback, not the index.
- **The site** (Chromium): not run; the site has no sideload mode Add Tweaks page without the app's bridge.
- **Paid tweaks on the phone**: no source on the 15 with a payment endpoint was tried; covered by node tests only.
- `node.mjs` (self-hosted) has no `TWEAKS` database: `/api/tweaks` answers `{enabled: false}` there.

## Spec review (fresh subagent, diff + brief only)

Fixed: `madeForRows` counted a paid tweak's guessed app (unverified) with no seller check, so it now skips those. The
cron charged only .deb downloads against its budget, so now every fetch counts, Packages included. A first
`/api/tweaks` answer (empty, a pass still running) was `max-age=300`, so it is now `no-store` until the source is read.
`checkForApp` put the app's tweaks first only for apps KNOWN_APPS lists, so it now also uses the app's own name.
Kept as they are: the split of decision 2 to F344a (above). User-added sources reach the index when an app first
asks for them, and the cron keeps them after that. `rowInfo` lists a paid row from a source with no seller only when
the phone already has a real verdict for it, which means its .deb was downloaded, so bought. GLOSSARY.md is the
required glossary entry. `madeForRows` counts only tweaks that name the app, because counting every-app tweaks would
show "N for This App" on every app.
