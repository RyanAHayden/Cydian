# B61: respring after a fresh AppSync Unified install

## What

An IPA installed right after F189's auto-install of AppSync Unified won't open until SpringBoard restarts
(AppSyncUnified-FrontBoard.dylib loads into SpringBoard only on respring; B59 saw it on the iPhone 7).

- `web/app/screens/ipa-install.js`:
  - `installWithAppSync` sets a session flag (`appSyncRespring`) when `ensureAppSync` answers `{ installed: true }`.
  - New `ipaFinish({ ok, name, backend, alert, pending })` picks the console's finish button without the DOM:
    with the flag set and a backend that has `respring()`, `chooseFinish`'s restart level ("Restart SpringBoard"),
    uicache first, then respring; a console line says why ("<app> opens once SpringBoard restarts: AppSync
    Unified was just installed…"). A backend without `respring` keeps Reload Data and the line says the app opens
    after a respring. The flag clears only when the respring went through, so a second IPA installed before the
    respring (dpkg then says AppSync is present) still ends on Restart SpringBoard. A failed respring shows an alert
    and keeps the page up, as the queue's finishAction does.
  - `runIpaConsole` now uses `ipaFinish`; behaviour without a fresh AppSync is unchanged (Reload Data / Close).
- `web/app/screens/ipa-respring.test.js`: new tests for the above (a new file rather than appsync.test.js, to keep
  merges clean).

Decision: chose "end on Restart SpringBoard" over just a message, since the brief offers both and the queue's own
finish uses that level for tweaks; the message is added too so the user knows why.

## Not tried / known limits

- A respring made elsewhere (the install queue's Restart SpringBoard for another tweak) doesn't clear the flag; the
  worst case is one extra Restart SpringBoard on the next IPA in the same session. Not worth a cross-module hook.
- The flag is per session (module state): if iFizBox is closed before restarting SpringBoard, the next launch
  doesn't know. The note on the console still told the user.

## Not verified

- Not run on the iPhone 7: the task didn't call for the phone, and a real check needs AppSync removed first and a
  fakesigned IPA installed (see memory about the test IPA fixture). The respring path itself is the queue's
  existing `backend.respring()` (helper `respring` verb), already used by tweak installs.
- The progress page with the extra "step" line was not looked at in a browser; it is the same `page.line("step", …)`
  the run's own steps use.
