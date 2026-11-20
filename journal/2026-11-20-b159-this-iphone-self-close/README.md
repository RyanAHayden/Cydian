# B159: self-update on This iPhone hangs at "iOS is installing it"; installed 0.12.0 when 0.13.0 was offered

## What was wrong

1. **The hang.** On iOS 17.4+ (RemotePairing, through Tailscale or LocalDevVPN), installd doesn't end the running
   iFizBox when it installs a new copy over it. It takes the IPA and then waits until the old copy is gone. iFizBox
   was blocked in `installation_proxy_install_with_callback`, and the page stayed on "iOS is installing it" until the
   user closed the app from the app switcher. After that the install finished (killing the process also drops the
   tunnel, and installd went on anyway). The code assumed "installd ends this process", which is no longer true.
2. **The wrong version.** Changes/the banner offered GitHub's release (0.13.0), but `screens/changes.js
   queueUpgrades` built the queue job from the catalog package first (`appJob(pkg, { version })`). The source still
   listed only 0.12.0, so `appJob` fell back to `versions[0]` and took the source's 0.12.0 IPA. The row's own `ipa`
   (GitHub's iFizBox.ipa) was only used when there was no package. "Signed iFizBox 0.12.0" was the real version of
   the IPA that was signed: the source's stale 0.12.0, not the running version.

## What changed

- `native/sign/SelfCloseClock.swift` (new, pure): once the IPA has been copied, iFizBox closes if installd sends no
  percentage for 10 s, or if its percentage stays the same for 5 s. A repeated percentage doesn't restart the clock.
- `native/Sources/Sideload.swift`:
  - In `installHere`, for iFizBox itself, a `HereClose` (main-queue timer around the clock) gets the end of the
    copy and installd's percentages.
  - When it fires (and the job wasn't cancelled), it logs a line, answers the install call (`opened(.success)`) and
    calls `CloseForUpdate.hereReady()`.
  - `hereReady()` sets the state to `finished`, posts the same "Finishing the iFizBox Update" notification and exits
    2.5 s later (`hereExit`), so the page has time to draw "Closing iFizBox".
  - `CloseForUpdate.hereBegan` starts a run in `waiting`. `hereEnded()`: installd answered while iFizBox was still
    open, so `signing.selfUpdate` returns null.
  - If installd answers after HereClose has fired, the result is ignored, so the call is never answered twice.
  - `closeWith` gained `exitAfter`.
- Page:
  - `signing-client.js followHereSelf` (single install) and `screens/apprun.js followHere` (queue run, which the
    banner's Upgrade uses) ask `signing.selfUpdate` after a This iPhone self install.
  - If the answer is `finished`, the page locks on "Closing iFizBox" with the shell's line (`HERE_CLOSING_LINE`).
    If iFizBox is still open CLOSE_GRACE later, it shows CLOSE_BY_HAND.
  - Any other answer (null, an older shell) keeps the previous RESTART_BY_HAND end.
- `screens/changes.js queueUpgrades`: when the row's version isn't the one the package resolves to and the row has
  its own `ipa`, the job takes the row's IPA and version.
- `core/apprun.js staleSelf`: for iFizBox's own upgrade (job.version newer than job.installed), a signed IPA whose
  version (signing.prepare's, from CFBundleShortVersionString) isn't newer than the running app fails the row: "the
  downloaded IPA is iFizBox X, not newer than this iFizBox Y (Z was offered), so it wasn't installed". The signed
  copy is discarded and nothing goes to iOS.

## Decisions (unattended)

- The close signal is "installd quiet", not a specific installd status string. The FFI callback only passes a
  percentage, and no log of where installd stands still exists. The user's report (closing from the switcher let it
  finish) shows that exiting mid-install is safe on this route.
- The version check is in the run (core/apprun.js), after signing and before iOS. The single `signing.install`
  self path (`installSelfNow`) has no callers left, so I did not add a native check for it.
- `screens/changes.js`, `screens/apprun.js` and the tests are outside the task's file list. They were needed: the
  version bug is in queueUpgrades, and the queue run is the path the self-update takes.

## Tests

- Swift: `native/sign/tests/sideload/main.swift` test "This iPhone self-update: close once installd stands still"
  (run by `native/test_sideload.py`, passed).
- `native/test_selfupdate_here.py` (text): `installHere` reaches `CloseForUpdate.hereReady` after answering the
  call; `hereBegan`/`hereEnded`; HereClose uses the clock and respects cancel.
- `web/app/core/apprun-staleself.test.js`, `screens/changes.test.js` (B159 test), `screens/apprun-self.test.js`
  and `selfupdate-waiting.test.js` (This iPhone closing and not closing).

## Not verified

- **On-device run.** No phone was driven: the task allows it "if a phone is available", and only the iPhone 7
  (iOS 15, lockdown route) is a test phone. The bug is on iOS 17.4+ RemotePairing, and the user's iPhone 15 is
  read-only. Not verified on a phone: that installd really stands still (no percentage change for 5 s, or none at
  all for 10 s) while it waits; that exiting there lets the install finish (based only on the user's report); and
  that a large IPA's verify step doesn't go 5 s without a new percentage (if it does, iFizBox closes early. The
  user's evidence says installd finishes anyway, but this is unconfirmed).
- The Swift in Sideload.swift compiles only in the gate's native build (iOS SDK). `run done`'s gate builds it if
  the toolchain is set up on this machine. Check the gate output for "native build skipped".
- The 0.12.0 cause is worked out from the code (appJob's fallback to versions[0]). I didn't reproduce it with the
  live source.json.
