# B257: KeepAlive on Lite's sign-ahead run

R54 found that the sign-ahead run (Confirm sheet, Installed > Manage > Update: `runAppQueueRun` → `signing.prepare`,
route check, `signing.open`) held no KeepAlive between the download's end and `signing.open`. B252's holds are on
`signing.install` and `installOnDevice` only.

## What I did

- `native/Sources/SignAhead.swift` `prepare`: takes `Sideload.holdUntilAnswer()` once `Sideload.ready` passes, and
  every answer goes through a local `answer` that lets go first (signed, failed, cancelled, `not_signed`,
  `bad_url`). Same pattern as `Sideload.install`. The download's own hold (R49) and `installHere`'s still stack on top.
- `web/app/signing/queue.js` `heldLanes(lanes, …)`: wraps the run's `sign` and `install` lanes. Each start sends
  `signing.hold {on}`. That also renews the shell's 10 minute `pageHoldLimit`, so a run longer than 10 minutes stays
  held. When no lane has run for `HOLD_IDLE` (2 s) it sends `{on: false}`, and `release()` sends it at once. The
  route check (`chooseRoute` inside `openPrepared`) runs inside the install lane, so it is held.
- `web/app/screens/queue.js` `runAppQueueRun`: sends `{on}` at Confirm, once `ready()` has let the run go. The
  safety alerts and the Signing walkthrough come before that, and holding while a person reads an alert would only
  burn the audio session. Then it hands the run `heldLanes(...)` and releases them when the run's page closes (or
  the run throws).
- Re-exported `heldLanes`, `HOLD_IDLE` and `holdApp` from `signing-client.js` on new lines.

Why it lets go when idle and not "when the run ends": the run's first end isn't its last. Retry All, a row's retry
and Try Again start new passes on the same page, and the page can stay open long after the end. Holding until the
page closes would keep the silent audio going for nothing. Following the lanes covers every pass, and the 2 s idle
time keeps the hold from flapping between one app's sign and the next app's install. iOS gives about 5 s after a
hold ends anyway.

## Tests

- `web/app/signing/queue.test.js` (new): `heldLanes` with a fake clock: on as each lane starts, off after the idle
  time, a failing lane still counts down, `release`, and Confirm's hold let go when no lane ever starts.
- `web/app/screens/apprun.test.js`: `runAppQueueRun` sends nothing when the walkthrough opens. A run sends
  Confirm's `{on}`, then one `{on}` per lane start, and `{on: false}` on the page's close.

## What failed

none

## Not verified

- **On the phone (iPhone 15 Pro, iOS 27).** Not run. R54 couldn't make the unheld gap outlast iOS's ~5 s on this
  phone (signing took ~3 s even for 12 Mach-O files), so a phone run would show the same result before and after
  the fix. I'd have nothing to compare it against. The Swift change compiles in the gate's sideload build. That it
  keeps the app running comes from it being the same `holdUntilAnswer` that B252 uses for `signing.install`.
- Whether `KeepAlive.begin/end` flapping (a 2 s gap between passes) has any audible or log cost: not measured, and
  the phone is silent here anyway (memory: no sounds on the 15).
