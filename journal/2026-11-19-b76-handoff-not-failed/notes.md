# B76: Lite installs handed to iOS end "Sent to iOS", not Failed

## Problem

In the IPA queue's run (core/apprun.js), `signing.progress` answering `installed: false` failed the row with
"iOS didn't install it". On a stock phone iFizBox can't watch iOS's install once it is in the background (the
user tapped Install and iOS's home screen shows), so that false usually meant "lost sight", not "refused".

## What changed

- **native/Sources/Sideload.swift**
  - `enum Handoff`: per bundle ID, whether iOS fetched the whole IPA (set from the install server's `onServed`,
    cleared at each new serve). `lostSight(served:away:seen:)` = `away || (served && !seen)`.
  - `watch` tracks `away` (didEnterBackground during the watch, or `applicationState == .background` at a
    tick). Every end goes through one `done()`, which removes the observer and asks `lost(seen, away)` before
    answering a false; lost turns it into `(nil, handedOff: true)`.
  - Once iOS has the whole IPA and no progress has shown for `Handoff.servedQuiet` (30 s), the watch ends then (as
    handed off) instead of waiting the queue's full 600 s `ask`, so the next app isn't held up.
  - `signing.progress` replies `{installed, handedOff}`. A handoff answers `installed: null`, which every
    existing caller already reads as "sent, can't tell" (openPrepared, the single-install pages).
- **web/app/core/apprun.js**: an install result with `handedOff`, or a row that was with iOS when `run.away()`
  was called, ends Done/unsure ("Sent X to iOS") on `installed: false`, and leaves the queue. Failed stays for a
  false seen while iFizBox stayed in front. `run.confirm(id)` upgrades a sent row to Installed (log "Installed X").
- **web/app/screens/apprun.js**: `followHandoff`: `visibilitychange` hidden -> `run.away()`; visible -> ask
  `apps.isInstalled` for the sent rows' bundle IDs and `run.confirm` those iOS has. Also asked when a row ends
  sent while the page is visible. Stops listening when the page closes. `phoneLanes` gains `isInstalled`.
  I used `apps.isInstalled` rather than the brief's `signing.isInstalled`: same Swift answer, and it works in both
  builds (memory: signing.* is refused in the jailbreak build).

## Decisions

- Swift answers `installed: null` + `handedOff: true` instead of `false` + flag, because signing-client.js
  `openPrepared` (not in this task's files) passes only `installed` and `expires` on; null already means "sent".
  The core still honours `handedOff` on a `false` for any lane that passes it.
- "Seen progress to the end, then not installed, while in front" stays a refusal (the only install error we can see).

## Tests

- `node --test web/app/core/apprun.test.js web/app/screens/apprun.test.js`: new B76 tests (handedOff false ->
  sent; away() during the watch -> sent; refusal in front -> failed; away() before iOS doesn't excuse a refusal;
  confirm(); the screen's visibility handling and apps.isInstalled upgrade; phoneLanes.isInstalled).
- `native/test_sideload.py` `test_handoff_not_refusal`: source checks of the Swift side (it can't run on Linux).

## Not verified

- On a phone: not run on a stock iPhone with the Lite IPA (no test phone without a jailbreak is set up for this,
  and the iPhone 7 runs the jailbreak build). Whether `installProgressForBundleID:` reports progress while iFizBox
  is in the background, and whether `servedQuiet` (30 s) is long enough before progress shows on a big IPA, are
  unmeasured. If progress does show after 30 s, the row ends "Sent to iOS" and the return check upgrades it.
- The Swift logic itself is only checked by reading the source (test_sideload.py); it can't run off the phone. The
  native build (`make -C native package`, as the gate runs it) compiles it without warnings.
