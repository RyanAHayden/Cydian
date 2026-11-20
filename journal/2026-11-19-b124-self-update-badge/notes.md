# B124: badge left on the icon after iFizBox updated itself, and no "Finishing" notification

User report (2026-11-19, 0.11.0 to 0.12.0): after the self-update the icon still had a badge, and no
"Finishing the iFizBox Update" notification came.

## Why the badge stayed

The badge counted that same update (Changes' count through app.badge, or the background check's
UpdateCheck.badge). iOS keeps an app's badge through an install, and the only thing that cleared it was the new
version's first launch (app.js `lastVersion` → `app.badge {count: 0}`). So it stayed until then, and for good when the
install never happened.

## Why the notification didn't show

- The phone ran 0.11.0's CloseForUpdate, which only started waiting after resign-active then become-active. B123
  (same report, same update) found that it could stay in `.prompt` for ever: no polling, so `finish()` never ran,
  no notification was added and iFizBox never exited (the user closed it by hand). That matches both reports, so
  `finish()` was most likely never reached. B123 already fixed it (the wait also starts on background or after 5 s).
- Permission: in the sideload build nothing asked for notification permission before a first self-update unless
  the page followed an app (BackgroundCheck `updates.watch` with a non-empty list), app.badge set a first count, or
  a re-sign reminder was set. Without permission `closeWith`'s `add` fails silently. In this report the badge was
  showing, so permission had been granted, which means this wasn't the cause here, but it could be on another phone.

## What changed

- `native/sign/Updates.swift` (pure, tested on Linux): `UpdateCheck.Counts` (the badge's parts: Changes' count and
  keys, the last background find), `without(ids, counts)` (drops the self update's row: one off Changes' count when
  its key is there, and off the background find), `handedOff(watch, ids, version)` (moves iFizBox's watched version
  up so a background run before the first launch doesn't badge the same update again; never lowers it).
- `BackgroundCheck.swift`: the background run stores its found keys (`foundKey`); `selfHandedOff(ids:version:)`
  recomputes the badge without the self update, stores the parts, moves the watch, sets the icon badge and the
  widget count, and takes the delivered "n Updates" away at 0. It returns the count.
- `Notifications.swift` app.badge: drops the stored background find (from then on the page's count covers
  everything).
- `Sideload.swift`:
  - `CloseForUpdate.closeWith` (finish and guess): calls `selfHandedOff`, and the notification's `content.badge` is
    that count. That's 0 when nothing else waits; the brief said 0, but a flat 0 would also wipe other apps' updates
    off the icon, so it uses the count without this update (the brief's own "or the badge minus the self update").
  - The This iPhone route (`installHere`, self): `selfHandedOff` before installd starts, since installd ends the
    process mid-install.
  - `hostAndOpen`: `CloseForUpdate.askToNotify` before opening the itms-services link. Asks while permission is
    undecided; if it's refused, a console line says iFizBox will close without a notification. `afterPrompt` gets
    the signed app (its IDs and version) for the badge.
- I chose to clear the badge at the real handoff (closeWith, just before exit) and not at afterPrompt: if the prompt
  is cancelled (notStarted) iFizBox stays open and the update is still waiting, so the badge should stay.
- `web/app/app.js` unchanged: the first-launch clear stays as a backstop.

Tests: `native/sign/tests/updates/main.swift` "B124" (badge parts, background find, not counted, 0 floor, watch move,
no second find); `native/test_updates.py` `test_self_update_clears_its_badge` (wiring).

## Tried and dropped

- Reading the current icon badge back (`applicationIconBadgeNumber`) and subtracting 1. That can't tell whether the
  badge actually counted the self update, and the getter is deprecated on iOS 17+. Storing the badge's parts gives an
  exact count instead.

## Not verified

- On a phone: no real self-update was run (it needs two signed builds and a phone to update over). So these are
  unchecked on a device: whether iOS keeps a badge set just before exit through the install, whether a pending
  notification whose 3 s trigger fires mid-install is shown or dropped by SpringBoard, and how the permission alert
  followed by the itms prompt looks.
- The Swift app code is only checked by the gate's native builds (the .deb and the IPA built by tools/check.sh when
  the iOS SDK is present). It wasn't run.
- A self row hidden under Ignore This Version is in Changes' keys but not in its count. If the user updates through
  it anyway, the badge loses one too many until the page counts again (clamped at 0). It's rare, and I left it.
- The This iPhone route clears the badge before installd runs. If the install then fails, the badge is one short
  until the page next sets app.badge.
