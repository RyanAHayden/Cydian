# F287: keep the phone awake while work runs

## What was done

- `web/app/core/keepawake.js` (new): `createKeepAwake(apply)`, a counted hold: `apply(true)` with the first hold,
  `apply(false)` after the last; `set(on)` is the backends' `keepAwake(on)`, `during(promise)` holds for one promise.
  `apply`'s errors are swallowed (an older shell, a refused lock never fail the job). `wakeLockScreen()` is the
  website's screen: `navigator.wakeLock.request("screen")`, asked again on `visibilitychange` back to visible while
  still wanted (the browser drops the lock when hidden), released on `false`; no API: a no-op.
- Both backends have `keepAwake(on)` (and `awake`, the counter):
  - `backend-http.js`: onto `wakeLockScreen()` (injectable as `screen` for tests).
  - `backend-native.js`: onto the shell's new `app.keepAwake {on}`. Its `call` also holds the screen for the length
    of a long call (`longCall`): a streamed `helper.run` (apt-get update, apply-ask, rollback, uninstall with a
    console), `share.debFetch`, `share.debInstall`, `ipa.install`, `paid.install`. That covers the apt queue run
    (screens/queuerun.js) without touching it. Quick helper calls (simulate, auto, app-versions: no stream) don't.
- `core/apprun.js` (the IPA queue run: downloads, signing, installs): new `keepAwake(on)` option, `true` when a pass
  starts, `false` in `pump()` once every row has ended (installed, failed, stalled, stopped, cancelled), exactly once
  per pass. `screens/apprun.js` passes the backend's (loaded with a dynamic import of backend.js, and only where
  there is a screen: the app's bridge or a browser with `navigator.wakeLock`, so node tests never build a backend).
  screens/apprun.js was not on the task's file list; it's a 5-line addition, needed to wire the run to the backend.
- Native: `native/Sources/KeepAwake.swift` (new), registered in Bridge.swift. `app.keepAwake {on}` sets
  `UIApplication.shared.isIdleTimerDisabled` (on the main thread). Never stuck on: didEnterBackground turns the idle
  timer back on; willEnterForeground restores what the page last asked for; the web view's `didCommit` (App.swift,
  a reload or a WebKit content process restart: the new page holds nothing) resets it to off. Both builds (same
  Bridge/App sources).
- Test stand-ins: `native/fake/fake-native.mjs` records `app.keepAwake` in `awake`, not `calls`, and
  `backend-native-linked.test.js`'s wrapper leaves it out of its call list, so tests that list a run's calls are
  unchanged.
- Tests: `web/app/core/keepawake.test.js`: counting, first-on/last-off, failures and cancels in the app run
  (failure, retry's new pass, Cancel mid-signing, a stalled row), overlapping native long calls and keepAwake,
  an older shell without the call, the wake-lock re-acquire/release, and the site backend's counting.

## Tried and dropped

- First run of the suite: 5 tests that compare a run's exact call list failed because `app.keepAwake` went
  through the same bridge call. Fixed in the stand-ins (above) instead of giving the backend a second bridge path.

## Not verified

- On the iPhone 7, that the screen stays on through a long run: not done in this unattended session (driving the
  7's screen and waiting out its auto-lock needs the phone's lock and a long apt/IPA run; another slot's .deb may
  also overwrite the installed build). To check: install this build, set Auto-Lock to 30 s, run a long queue, watch.
- The Swift file is compiled by the gate's native build (toolchain present here); its runtime behaviour
  (background/foreground, didCommit reset) is untested on a device.
- The website's wake lock in a real browser (Safari 16.4+): only tested against a stand-in `navigator.wakeLock`.
  Whether the artifact/site frame allows the lock was not checked.
