# B178: self-update posts no notification

User 2026-11-20: when iFizBox (sideload build) updates itself, post no notification at all.

## What changed

- `native/Sources/Sideload.swift`, `CloseForUpdate`:
  - `finish()` (hosted route, iOS has the whole IPA), `guess()` (older server, 8 s close) and `hereReady()`
    (This iPhone route) no longer build "Finishing the iFizBox Update" / "Updating iFizBox" content.
  - `closeWith(exitAfter:)` keeps the B124 badge clearing (`BackgroundCheck.selfHandedOff`, which sets the icon
    badge itself through `Notifications.setIcon`) and the B173 exits (main-queue exit after `exitAfter`, plus the
    off-main backstop). Exit timing is unchanged: before, the exit came `exitAfter` after the notification was
    queued; now `exitAfter` after the close starts. It also removes any delivered `ifizbox.updating` notification
    (a "Didn't Start" notice left from an earlier attempt).
  - `askToNotify` and `closesQuietly` are gone: they existed only so the closing notification could show
    (B124's own comment said so). `hostAndOpen` now opens the itms-services link straight away on the main queue
    (askToNotify used to hop to main before `go`, so the queue is the same).
- `BackgroundCheck.swift`: comment on `selfHandedOff`'s return value.
- `docs/signing.md`: the self-update paragraph says it closes with no notification, on both routes.
- Tests: `native/test_updates.py` (no notification content or permission prompt in CloseForUpdate, finish/guess/
  hereReady all go through closeWith, badge still cleared), `native/test_selfupdate_here.py` (hereReady's call).
- `web/app/signing-client.js`: nothing to change; its progress lines never mentioned the notification.

## Decision

- `giveUp()` still posts "The iFizBox Update Didn't Start/Finish" when iFizBox is in the background and the update
  failed. That is not a notification about iFizBox updating itself (nothing updated), and without it a user who went
  Home never learns to come back and Try Again. The brief names only the Finishing/Updating notifications. If the
  user wants that gone too, it is a two-line removal in `giveUp`.

## Not verified

- Swift build: only where the gate has a Swift toolchain; whether this machine's gate built it is in the `done`
  output. No device run: no sideload-build phone was available to this unattended run (the iPhone 7 runs the
  jailbreak build, which has no self-update via CloseForUpdate).
