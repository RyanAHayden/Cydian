# B170: cancelled or unconfirmed installs are never recorded as Installed

## The paths, and what each did before
- **Round stop / red Cancel**: core `cancelRow` ends the row `cancelled`, and `recordWhen` already said "never". The
  run also ignores whatever the shell answers after the abort (`f.why`). Nothing changed here; tests now pin it,
  including a shell that answers `installed: true` after the stop and an `apps.isInstalled` that says true.
- **Cancel on iOS's own install prompt**: when iOS says nothing, `signing.progress` gives `installed: null`
  (signing-client.js, B146), and the row ends "Sent to iOS" (unsure). followHandoff then asked `apps.isInstalled`,
  got no boolean (`null`, or `{}` from a failed call), and `recordWhen(row, null)` returned **"now"**. That was the
  user's bug: the app was recorded. Now null is "wait".
- **Leaving iFizBox mid-install (`.away()`)**: `installed: false` after the handoff turns into "Sent to iOS". Same
  check as above, same null bug, same fix.
- **No `isInstalled` at all**: the page used to pass null for it, which meant "record it". Now an unsure row with
  nothing to ask is never recorded. phoneLanes always has `isInstalled`. helperLanes rows are never unsure, so the
  jailbreak build behaves as before.

## What changed
- `core/apprun.js recordWhen`: an unsure install row is recorded only for `onPhone === true` with a bundle ID.
  Re-signs, removes and iFizBox itself stay "now" (recordApp skips re-signs and iFizBox anyway).
  `run.unconfirm(id)`: a confirmed install goes back to "Sent to iOS", with the log line "iOS doesn't have X now".
- `screens/apprun.js followHandoff`: a null answer is asked again on the B156 retry timer, as false already was.
  Each return to the front starts the tries over. Rows that were ever "Sent to iOS" keep being asked after they
  are confirmed. A later false calls `run.unconfirm` and `answered(row, false)`.
- `screens/apprun.js runAppRun`: each record keeps the record it replaced (`before`, read from Installed's store)
  and the one it wrote. `answered(row, false)` on a recorded row undoes it with `core/installed.js undoRecord`. That
  puts `before` back (an upgrade's older version, or a Mark as Installed) or removes the record, and leaves it
  alone if something recorded the app again since (compared by date). The log says "X is no longer recorded as
  installed". `deps.store` / `deps.unrecord` are there for tests.
- An app iOS really installed but never confirmed while the page was open isn't lost: Installed's B156
  `restoreSourceRecords` writes records for signed apps the shell lists.

## Tests
- `web/app/core/apprun-b170.test.js`: recordWhen per path, unconfirm, undoRecord (restore / remove / changed since).
- `web/app/screens/apprun-b170.test.js`: the round stop (shell answers installed anyway), the red Cancel, iOS's
  prompt cancelled (no answer, then null, then false, then true), `.away()`, undo with a real memory store (the
  older record comes back, a new one goes), and followHandoff asking again after no answer.
- `core/apprun-b136.test.js`: its "null → now" line is now "null → wait", which is this task's change.

## Tried and failed
- nothing

## Not verified
- On a phone: I didn't run a real cancel of iOS's install prompt on the iPhone 7 or any sideload device. This task
  doesn't say to touch the test phones, and the sideload path needs a signed install. The fix rests on the
  existing answer shapes (signing-client.js returns `installed: null` once the prompt was shown; apps.isInstalled
  gives `{id: bool | null}`).
- Whether `apps.isInstalled` ever gives false for an app that *is* installed after it once said true (B146 notes
  isInstalled is unreliable on iOS 27 for re-signed apps). If it does, the undo would drop a correct record. The
  next true restores it while the page is open, and Installed's B156 restore covers it after the page closes.
  Not checked on iOS 27.
