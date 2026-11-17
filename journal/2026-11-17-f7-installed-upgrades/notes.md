# F7 Installed and upgrades

## What I did

- `web/app/core/installed.js` (pure): `parseStatus(text)` keeps the stanzas dpkg has on disk (state installed,
  unpacked, half-*, triggers-*; drops `config-files` and `not-installed` leftovers), shaped like catalog rows plus
  `held` (`hold ok installed`). `findUpgrades(installed, candidateOf, holds, { dpkgHolds })` gives
  `{ available, ignored }`: candidate newer than installed (F2's `compareVersions`), held ones under ignored.
  `looksLikeStatus` guards the upload. `STATUS_PATHS` names both dpkg paths.
- `core/catalog.js`: `setInstalled(text)`, `installed()`, `upgrades(holds, opts)` ops in the worker's catalog.
  The candidate is the All Sources merge (newest across every source), and hidden sections don't hide upgrades.
  `core/worker.js` takes the status file as text or bytes for `setInstalled`, like `load`.
- `catalog.js` (UI): the status file comes from `cydianNative.dpkgStatus()` in the app (N3 still has to provide
  it: a function resolving to the file's text) or, on the site, from IndexedDB (`cydian-index`, key `dpkg:status`)
  after the visitor uploads it. Nothing is sent to the server. `setStatus`, `reloadInstalled`, `hasStatus`,
  `installed`, `upgrades`.
- Installed tab: the virtualised package list with A–Z headers; on the site a "Choose Status File" row with the
  paths, and a Load button in the nav bar to pick a newer file. Rows open the package page.
- Changes tab: "Available Upgrades" and "Ignored Upgrades" sections before the New at groups; an upgraded package
  isn't listed again under New at (Cydia's rule). The tab badge counts available upgrades; at launch it is only
  computed when a status file exists (otherwise there is nothing to count, and no reason to load every source).
- Holds: "holds" added to FEATURES (the Ignored Upgrades row now shows in Settings; the "rows wait for their
  feature" test updated). Held packages (Settings' list, and on the site the status file's dpkg holds) go under
  Ignored Upgrades. In the app `holds` already *is* dpkg's list (F22's `holds.sync`), so the app passes
  `dpkgHolds: false` and the (possibly older) status file's flags don't override it; Changes syncs holds at start
  in the app.
- Package page: an "Installed Package" group (Cydia's Installed Details) with the installed Version and an Ignore
  Upgrades switch, so the Ignored Upgrades list can be filled at all (Settings' empty text already said to do it
  there, but there was no switch). On the site a dpkg hold from the status file reads "Held by dpkg" instead.
- Fixtures: `web/fixtures/dpkg-status` (10 stanzas from the 4S's status, byte for byte) and two synthetic repos.
  `core/installed.test.js` checks the expected upgrade list (epoch bump on a second repo, `~` pre-release, equal and
  older candidates, wrong arch, `cydia::obsolete`, dpkg hold, Settings hold, source removed).

## Checked in a browser

Headless Chromium against `web/app.py`, the 4S's whole status file uploaded through `catalog.setStatus`, the
default sources fetched live through the proxy:
- iphoneos-arm: 198 installed packages listed (`installed.png`); no available upgrades, and the four packages held
  on the 4S (Cylinder, f.lux, RocketBootstrap, WinterBoard) under Ignored Upgrades (`changes-ignored.png`); badge
  hidden.
- iphoneos-arm64: badge 1 at launch (PreferenceLoader 2.2.6 -> 2.2.8); turning on Ignore Upgrades on its page
  (`package-installed.png`) hid the badge and moved it to Ignored Upgrades; Settings showed Ignored Upgrades 1.

## Tried and dropped

- First version of the package-page group built its own cells: the detail and switch weren't pushed right. Now it
  uses `grouped()` and appends the switch afterwards, as the Settings tab does.

## Not verified

- The app side: `cydianNative.dpkgStatus` doesn't exist yet (N3's bridge). The code path is the same as the
  upload's from the worker on, but reading the real file on a device is unchecked.
- On the 4S / a real iPhone: the file picker (`<input type=file>` from a row tap) wasn't tried in Mobile Safari;
  only headless Chromium, and there the upload went through `catalog.setStatus` directly, not the picker.
- Cydia's "Upgrade (N)" nav button on Changes: not added; it needs the install queue (no apt pipeline yet).
- Rows for installed packages that no source carries open "Package not found" (the package page only knows the
  catalog); a status-file-only package page is not built.
