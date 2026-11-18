# F56: detect the jailbreak from its marker files

## What I did
- Read the marker names in each jailbreak's own source (GitHub tarballs, 2026-11-17):
  - Dopamine `DOBootstrapper.m`: writes `JBROOT/.installed_dopamine`.
  - nathanlr `usprebooter/main.m:884-885`: writes **both** `/var/jb/.installed_dopamine` and
    `/var/jb/.installed_nathanlr`. So `.installed_dopamine` alone is not proof of Dopamine; nathanlr's marker must win.
  - palera1n loader `LREnvironment.swift`: `jb_prefix("/.installed_palera1n")`; `LRBootstrapper.swift` writes
    `etc/apt/sources.list.d/palera1n.sources`. Dopamine's `DOEnvironmentManager.m` also names `.palecursus_strapped`
    (palera1n's bootstrap), `.installed_nekojb` and `.xia0o0o0o_jb_installed` as jailbreaks that fake
    `.installed_dopamine`.
- `native/Sources/Bridge.swift`: `Jailbreak.markers` (the names, relative to the jbroot, that exist; empty when
  rootful/stock) and app.info `markers`.
- `web/app/core/recommended.js`: `jailbreakFromMarkers(markers)`: nathanlr > palera1n > NekoJB/xia0 ("other") >
  Dopamine > null. Test in `core/sourcetools.test.js`.
- `web/app/screens/manage.js` `currentJailbreak`: markers first (via `cydianNative.call("app.info")`), apt's source
  files (`detectJailbreak`) as the fallback, so an older shell without `markers` still works.

## Decisions
- The shell reports raw marker names, the JS decides: the order rules are testable with `node --test`, and a new
  marker only needs a name added to Swift's list.
- NekoJB / xia0's jailbreak map to "other" (a sure "not Dopamine"), which lists every tweak repo as before.
- manage.js calls `cydianNative` directly (as screens/settings.js does) because backend-native.js is not in this
  task's file list.

## Not verified
- On a real rootless phone (Dopamine, nathanlr, palera1n): no such device here; the 4S is iOS 6 rootful, and the
  task does not allow touching it. Marker names come from reading each project's source, not from a device.
- The Swift compiles only if the gate's native build runs (`native/build.sh --probe` passed here, so it does).

## Gate fix outside the task
- The first `done` failed in native/sign's test "sign with the user's edits": an explicit profile's `removed` came
  back `[Widget, Share]` instead of `[Share, Widget]`. `IPASigner.swift` built the cut list from `bundles.keys`, and a
  Swift Dictionary's order is seeded per process, so the test (and the list shown to the user) varied run to run.
  Fixed with `bundles.keys.sorted()` (one word; nothing else in that file touched).
