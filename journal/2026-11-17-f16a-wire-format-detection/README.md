# F16a: wire F16's format detection into the app

## What changed

- `core/altstore.js` `withAltSources.addSource` now asks `core/sources/add.js` `detectSource` what the URL is,
  instead of `looksLikeAltUrl` / APT-then-AltStore fallback:
  - IPA source of any format (AltStore, ESign, Scarlet, GBox) -> saved in the AltStore list with `format`
    (add.js `ipaRecord`). An encrypted GBox source is saved with `unsupported` (its reason) and `count: null`.
  - APT repo (flat, a Release/Packages URL, or a dist repo found under `dists/<d>/`) -> handed to the wrapped
    calls as the URL (flat) or `{ uri, dist, components }` (dist), so each backend still saves it its own way
    (the app writes apt's sources through the helper). They re-check it; one extra round of fetches, accepted
    to keep backend-http/-native untouched.
  - An object input (Import's `deb` lines, F48) still goes straight to the wrapped calls.
  - `add.js` is loaded with a dynamic `import()`: add.js -> core/sources.js -> altstore.js is a cycle, and
    detect.js's `class SourceFormatError extends SourceError` would hit SourceError's TDZ if core/sources.js
    were the first module loaded. `ipa.js` is a static import (its top level uses nothing from altstore.js).
- `parseSource(format, json|text)`: parseIpaSource by format (no format = AltStore, the pre-F16a records). Used
  by `refreshAltSource` and `core/catalog.js loadAlt(key, json, ios, format)`, so add, refresh and catalog
  rows/extras match. `web/app/catalog.js` passes `source.format` to the worker, and skips fetching an
  `unsupported` source (status error = its reason).
- Refresh of an encrypted GBox source: no error, keeps `unsupported`; once it reads, `unsupported: null`.
- dists: `withAltSources` opts `dists` (array or function; add.js DEFAULT_DISTS by default) and
  `coreFoundation` (a function returning kCFCoreFoundationVersionNumber), turned by `coreFoundationDist()` into
  Telesphoreo's `ios/<cf %.2f>` suite (docs/cydia.md: ios/793.00 on the 4S) and added to the dists.
- `screens/altstore.js`: an `unsupported` record's page shows a "Can't List Apps" row with the reason as footer,
  then F8's Open In group. `screens/sources.js`: its row's subtitle uses the error style.

## Tried / decided

- The phone's CoreFoundation number: the bridge's `app.info` has no such field (only `ios` and `jailbreak`), and
  Bridge.swift / backend-native.js / device.js are outside this task's files. So the option exists and is
  tested, but nothing supplies it yet: filed **F49**.
- Open In for non-AltStore formats: `core/handoff.js formatOf` knows only apt/altstore, so a Scarlet or GBox
  source's page offers the AltStore-format sideloaders (wrong for an encrypted GBox one). handoff.js isn't in
  this task's files: filed **F50** (also the Add Source alert text in screens/manage.js).
- First gate run failed: `altstore-sources.test.js` F28 "each source adds…" got 6 AppTesters apps, not 4.
  AppTesters is ESign-format, so it now goes through `ipa.js esignToAlt`, whose idMaker made every repeated
  bundle id unique (`<id>.<name slug>`, `~2`…) and so undid F42's merge of one-entry-per-version sources.
  Fixed in `core/sources/ipa.js` (outside the listed files, but the wiring exposes it): ESign keeps real ids
  as given and parseAltSource's F42 rules handle repeats; id-less apps get `esign.<name slug>`. F16's ESign
  test (made-up ids) still passes.
- The old test "an APT check that finds nothing falls back to AltStore; APT's error stands" now expects
  detectSource's `not_source` message (it names both APT and the app-source formats).

## Tests

- `core/altstore.test.js`: Scarlet add (URL and scarlet:// link), refresh, catalog load with extras; GBox add
  and load; encrypted GBox add -> unsupported, refresh keeps it without error, becomes readable; APT found by
  detection (a landing page root, dist under `ios/793.00` from coreFoundation) goes to the wrapped calls;
  `coreFoundationDist`.
- `core/catalog.test.js`: `runCatalog("loadAlt", [key, text, ios, format])` for Scarlet, GBox, ESign, AltStore.

## Not verified

- The UI changes (unsupported source page, row style) were not rendered in a browser or on the 4S: no browser
  run in this slot, and the task did not call for the device. The code paths are small and use existing
  helpers (`grouped`, `openInGroup`).
- The native backend's addSource with a detected dist repo was not run (needs the app and helper); it takes the
  same `{ uri, dist, components }` input F48's Import already sends it.
