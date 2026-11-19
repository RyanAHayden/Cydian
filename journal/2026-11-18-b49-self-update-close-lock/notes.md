# B49: sideload self-update lost by tapping Close

User 2026-11-18: updating 0.9.6 to 0.9.7, iOS started, they tapped Close instead of letting iOS close the app, and
it was still 0.9.6 on reopening. The task was simplified by the user: while iFizBox's own update installs, disable the
finish button and any Cancel/Close (greyed, not tappable), and the finish button reads "Closing iFizBox".

## What changed

- `web/app/nav/progress.js`: `page.finish({ locked: true })` disables the finish button (class `is-locked`, no
  onclick) and shows Close at the top right greyed (`disabled`; its click handler returns early, and a stoppable page's
  Cancel/Done is replaced by it, so the stop function isn't run). `CLOSING_LABEL` = `Closing ${NAME}`.
  `lockSelfUpdate(h)` ends a progressHUD that way (Done step, then the locked button); a HUD without `finish` keeps the
  old "Done after 1.2 s". progressHUD remembers a locked job per page, so a shared queue page ends locked whichever
  job ends last. `reopen()` clears the lock for the next job.
- Callers, at the point iOS has the itms-services link:
  - `signing-client.js` installOnDeviceOnce: `host`, the self IPA URL or iFizBox's bundle ID (installSelfNow,
    signAndInstall of the self IPA, the update banner, Changes).
  - `signing-sheet.js` followInstall: iFizBox's own ID (Custom Install sheet, app queue's Custom job). Replaces B45's
    tappable "Close iFizBox" there.
  - `screens/queue.js` resignApp: iFizBox's own record re-sign (hosted).
- `progress.css`: greyed disabled bar button on the progress page, no pointer events while locked.
- Tests: `web/app/self-update-lock.test.js` (page lock with a fake DOM, HUD page sharing, the three callers);
  `signing-sheet.test.js`'s own-IPA case now expects Closing iFizBox, locked.

## Decisions

- **Safety valve**: after `LOCK_LIMIT` (2 min) the top-right Close works again (the finish button stays locked). If
  iOS never shows its prompt (a failed hand-off, a manifest iOS rejects silently) the page would otherwise sit over
  everything until the user force-quits. Native `CloseForUpdate.afterPrompt` exits iFizBox as soon as the prompt has
  been answered (Install or Cancel), so in the normal case the lock never times out.
- The lock starts when iOS has the link, not before: Cancel during download/sign/upload still stops the job (F188),
  which loses nothing.
- The jailbreak build's own .deb upgrade (queue console, "Close iFizBox" level) is unchanged: its button is the
  user's way to quit there, and the bug is the sideload hand-off.
- Sideload Confirm run (runAppQueue): every app shares one progress page; iFizBox's own job runs last (runOrder), so
  the page ends locked after the others are handed to iOS. User asked about this mid-session; answered, no change.
- Native files (Sideload.swift, Bridge.swift) were not touched: the upload to /sign/host and the exit stay as they are.
- "The update didn't finish. Try Again" (optional per the user) was not done: it needs a record of the attempted
  version across launches plus a Changes/banner wording change; not small.

## Why the Close tap broke it (reasoning, not reproduced)

The hosted path uploads the IPA to the server and opens the link; `CloseForUpdate` waits for resign-active then
become-active. Closing the page itself stops nothing native, so the likely failure is that the tap came while iOS's
prompt was being shown/answered and the user then ended up interacting differently with iOS (e.g. the app left the
foreground some other way and iOS's install waited on the running copy). Locking the page removes the tempting tap
either way, which is what the user asked for.

## Not verified

- Not tried 0.9.6 -> current on a sideload phone: no sideload phone is reachable from this unattended run (the
  iPhone 7 runs the jailbreak build, and the task didn't clear driving a phone). The lock is covered by node tests
  with a fake DOM only.
- The greyed look of the disabled bar button and finish button on a real render (3x zoom) was not checked: no
  browser screenshot run in this session.
