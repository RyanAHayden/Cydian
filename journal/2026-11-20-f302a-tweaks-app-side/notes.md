# F302a: tweaks on the app side (sideload build)

F302 built the source side (Tweak Sources, the filter, the package page's Works In / Add to App). This task adds the
app-side flow from the approved concept (artifact Kv6fxtdbz9qGzEykh8QVVR).

## What was built

- **core/tweaks.js** (pure, tested in `core/tweaks-app.test.js`): `debOf` (pkg_version.deb back to package/version),
  `tweakTitle`, `tweakCountText`, `withTweaksText` ("with A, B and C"), `tweakSteps` (one "Adding X" line per tweak,
  then the bundled ElleKit), `madeFor` (source rows whose cached filter names the app), `tweakUpdates` (kept .debs a
  source has newer, by `compareVersions`), `machoEncrypted` (LC_ENCRYPTION_INFO(_64) cryptid on the first slice) and
  `ipaEncrypted` (reads only the zip directory, Info.plist and the head of the main executable, inflated in steps with
  DecompressionStream, so a 150 MB binary is never read whole), the "<App> Is Locked" alert words and How to Get One text.
- **screens/tweaks.js** (tested in `screens/tweaks-app.test.js`, with a small fake DOM):
  - kept tweaks now carry a `title` (the package's name) so rows and popups say "YTLite", not the file name.
  - `addTweaksGroup`: the app page's row "Add Tweaks", detail "N for This App" (cached checks) or "N Added", footer
    naming them; opens `openAddTweaks`.
  - `openAddTweaks`: a sheet "Add Tweaks": Made for <app> with ADD buttons (grey App Store button; green ADDED the
    moment it's tapped, with a spinner inside while the .deb is fetched and checked; reverts to ADD with an alert on
    failure; tapping ADDED offers Remove), an Added group for tweaks from Files or other sources, then Browse Tweak
    Sources (F302's picker) and From Files….
  - `installTweaksChoice`: the install popup (action sheet) before a fresh install is queued: "<App> <version>" and
    "with A and B", buttons "Tweaks: N" (or "Add Tweaks…") and Install. Tweaks opens the page, then the popup again.
  - `keptTweakParams`: signing.prepare's params get the app's kept tweaks (prepared, ElleKit when needed), with one
    log line per tweak + ElleKit on the run's row. URL installs and updates from a source keep their tweaks this way.
    A re-sign from the phone's record sends the kept set only when it differs from the record's (tweak update, or
    tweaks added after signing); Custom Install params that already carry tweaks go as they are.
  - `pickApp` replaces Add to App's action sheet: a sheet with Made For (tap picks), Can't Take Tweaks (known App
    Store copies, greyed, "App Store copy", How to Get One) and Not Targeted.
  - encrypted apps: `isEncrypted`/`markEncrypted` (localStorage `ifizbox.encryptedApps`), `lockedAlert`,
    `checkPickedIpa`.
  - tweak updates: `tweakUpdatesFor`, `updateTweaks` (fetch + keep the newer .deb), `tweakUpdateApps` (signed records
    with tweaks), `runTweakUpdates` (confirm sheet, HUD, queue a re-sign per app), `tweakPill`.
- **altstore.js**: the Add Tweaks group is the first thing in Details, above the screenshots (sideload only); a fresh
  install's `appPageAction` asks `installTweaksChoice` first (Cancel queues nothing).
- **myipas.js**: a file picked on the website is checked with `checkPickedIpa` before its page opens; an IPA page shows
  a "Tweaks" group under its header: "<App> Is Locked" + How to Get One for a known App Store copy, else (sideload app)
  Add Tweaks, whose changes are also written into the file's library.options so Sign Now / Save Signed IPA match Install.
- **installed.js**: signed apps show a grey "N Tweaks" pill after the subtitle (from signing.installed's new `tweaks`
  names); "Tweak Update" in green when a kept .deb is newer on a source, plus a "Tweak Updates" row above the list that
  updates and queues the re-signs.
- **signing-client.js** `prepareOnDevice`: applies `keptTweakParams`; an `encrypted` signer error marks the app as an
  App Store copy.
- **native**: `SignedRecord.json` reports `tweaks` (names); SignAhead's record re-sign takes a `tweaks` override.

## Decisions

- The install popup only shows when the app has tweaks added or made for it (cached checks). The concept says every
  install; an extra sheet on every app with no tweaks at all would slow every install for nothing, and most apps have
  none. Easy to widen (`installTweaksChoice`'s early return).
- Add Tweaks is a sheet (nav/sheet.js), not a pushed page: browse.js routing isn't on this task's file line, and sheets
  are exempt from the slide-in rule. A pushed page would need a `tweaks:<id>` route in browse.js.
- "Can't Take Tweaks" lists apps known to be encrypted: the website reads it from the picked file; the sideload app
  learns it when the signer refuses with `encrypted`. The sideload library file itself isn't read in JS.
- The app queue (core/appqueue.js createAppQueue) drops unknown job fields, so a tweak update can't be flagged on the
  job; instead keptTweakParams compares the kept names with the record's.
- The Custom Install sheet (signing-sheet.js) was left as it is: it already has the whole Inject Tweaks group with the
  kept tweaks; the old one-at-a-time queue path (runAppQueue, installOnDevice) doesn't get kept tweaks (the sideload
  app runs Confirm through prepareOnDevice).

## What failed on the way

- `apprun.test.js` "a stop sends signing.cancel…": the kept-tweak lookup delays signing.prepare by a tick and the test
  aborted synchronously, so prepare was never called. The test now waits for the call to start before stopping.
- F302's addToApp test drove the old action sheet; it now uses the `pick` hook.

Process slips: tweaks.css's new block was appended with a heredoc, and one test import line was changed with `sed -i`,
instead of the edit tool.

## Not verified

- **Not run on a phone or in WebKit.** No sideload build was installed: the Add Tweaks row/sheet, the install popup,
  the pills and the Tweak Updates row were only exercised by node tests with fakes. Layout, the ADD button's look at 3x
  and dark theme are unchecked.
- **The Swift changes** (record re-sign `tweaks` override, `tweaks` in signing.installed) are compiled by the gate's
  native build but not run; no Swift test was added for them.
- **Encrypted detection on a real App Store IPA**: tested on synthetic Mach-O/zip fixtures only; a real fat binary whose
  first slice starts past 64 KB takes the second read path, untested on real data.
- The Add Tweaks group's footer can change from one line to two when the count arrives without sliding (size-changes
  rule); not checked visually.
- Encrypted copies installed from the App Store that aren't in My IPAs or signed records aren't listed anywhere (no way
  to see them without a jailbreak).
