# B263: the re-sign queue holds every install until the last download finishes

User report (Lite, their phone, Changes › Needs Re-sign › re-sign all, 0.18.3): apps got signed, then all sat
waiting for the last one's download before any went to iOS.

## Cause: two holds, one in each half

1. **The run's install lane (`web/app/core/apprun.js` pump).** It took `rows.find((r) => !ended(r))`, the first row
   that hadn't ended, and only if that row was signed. A big app at the head of the run that was still downloading
   held every signed app behind it, and its sign-ahead slot kept the third app waiting too.
2. **The shell's signer (`native/Sources/SignAhead.swift` prepare).** The IPA hash and `IPASigner.sign` ran
   synchronously on `SignBridge.queue`, a serial queue. `signing.open` (the next install) starts with
   `SignBridge.queue.async`, so it waited for whichever other app was being signed, a minute or more for a big one,
   even with the JS lane free.

## Fix

- `installLaneNext(rows)` (core/apprun.js): the install lane hands iOS the first **signed** row in the run's order,
  whatever the rows ahead of it are doing. Still one app with iOS at a time (one prompt / one installd copy). A failed
  or stopped row already ended, so it holds nobody. iFizBox's own row goes only once every other row has ended, since
  installing it closes iFizBox (before, its place last in `runOrder` did that).
- `SignAhead.signer`: a serial queue of its own for the hash and the signer (still one signing at a time, as
  before); the kept copy, `keepInLibrary` and the answer go back to `SignBridge.queue`. `signing.open` no longer
  waits for another app's signing. `SignJob` and `PhoneID` already lock their own state.
- Each row already showed its own state (Downloading / Signing / Signed / Tap Install / Installing); with the lane
  change a Signed row behind a still-downloading one now moves on instead of sitting at Signed.
- Tests: `apprun.test.js` "a row still downloading holds nobody…" (big app downloading, the others go to iOS one by
  one, a failed sign holds nobody, iFizBox waits for every other row); the first test's strict-order steps changed
  to the new order.

## Kept as it was, and why

- **Signing stays one app at a time** (`SignAhead.signer` is serial) and the run still downloads/signs `ahead = 2` at
  once. Signing is CPU-bound on the phone, so two at once finishes neither sooner, and it doubles the memory and disk
  for big IPAs; R54 measured about 3 s to sign a 362 MB IPA on the 15 Pro, so the wait behind another app's signing is
  seconds, not the minutes of a download. Downloads are not on the signer's queue, so a big download never holds a
  signing; it holds one of the two sign-ahead slots, and the other apps go through the other one.
- `fail`, `emit` and `log` now run on the signer's queue when signing fails or reports progress. They were already
  called off `SignBridge.queue` before (from the download's callback): `job.end()` locks, `Apt.reply` and
  `c.emitOnMain` hop to the main queue. `kept` is only touched on `SignBridge.queue`.

## Spec review

A fresh subagent read only the diff and the brief. It flagged: signing still serial (above, kept); "show each row's
own state" not in the diff (rows already have their own states: rowStatus, unchanged); the edited comment line too
long (fixed); `fail` off `SignBridge.queue` (safe, above). Nothing reverted.

## Phone check

Prepared, not run. Built Lite from this branch (`make -C native package`, 0.18.3 build 3491, `installLaneNext` in the
bundled `web/core/apprun.js`, Swift compiled), made three test apps with `mkapps.py` (the Tiny fixture's binary
under `com.ryha.b263big` padded to 300 MB, `com.ryha.b263a`, `com.ryha.b263b`; source.json for an AltStore source)
and served them with `slowserve.py` (big files at 5 MB/s, about 60 s, every request's start and end logged) behind
`tailscale serve --https=8463`; source.json loaded over https from this desktop. `tools/ui-15.sh lock B263` said
"locked by R55" from 01:56 to 02:28 (retried every minute for 30 min; R55 is a long multi-part phone test), so
nothing ran on the phone. The server and the tailscale serve were stopped. Filed **R58** (after B263) to run the
check from main with these two scripts: Install the 3 through Confirm with the big one first, then Re-sign All, and
journal the order from the Log.

## Not verified

- **The iPhone 15 Pro run with 3+ apps, one big, and the order of events from its Log**: the phone's UI lock was held
  by R55 for the whole session (30 min of retries). Filed as R58.
- The shell's change (signing off `SignBridge.queue`) is checked only by the build compiling it and by reading the
  code; no host test drives `SignAhead` (it needs the phone's keychain identity). R58 covers it on the phone.
