# F49: the phone's CoreFoundation number reaches Add Source

- `native/Sources/Bridge.swift`: app.info replies `cf` = `kCFCoreFoundationVersionNumber` (a Double).
- `web/app/backend-native.js`: unless `sourceOptions.coreFoundation` is given, the backend asks app.info once
  (lazily, on the first Add Source) and passes `coreFoundation: () => cf` to `withAltSources`, whose
  `coreFoundationDist` adds `ios/<cf %.2f>` to detectSource's dists. Because withAltSources reads the option
  synchronously, `addSource` is wrapped to await the app.info answer first. A failed or missing answer (older
  shell, fake bridge without app.info) leaves the number null: Add Source works as before.
- `web/app/backend-native.test.js`: a landing-page repo whose only index is `dists/ios/1854.10/` is found and
  written to apt as suite `ios/1854.10` when app.info says `cf: 1854.1`; without `cf`, or without app.info,
  `dists/ios/` is never tried and the URL is "not a source".
- `web/app/device.js` (on the task's file list) needed no change: it keeps reading app.info for `ios`/`jailbreak`;
  the backend asks for `cf` itself so the number is there even before initDevice runs.

Nothing failed along the way.

**Not verified**
- The Swift change was not compiled or run on a phone: no Swift/iOS toolchain on this Linux machine.
  `kCFCoreFoundationVersionNumber` is a CoreFoundation global (via UIKit's import of Foundation) of type
  `Double`, which WKScriptMessage replies bridge to a JS number.
