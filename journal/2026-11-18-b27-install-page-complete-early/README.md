# B27: install progress page said Complete while iOS was still installing

The screenshot: title "Complete", "Return to iFizBox", status "Installing 72%". "Return to iFizBox" with the
status left as it was is the HUD interface's `hide()` (or a `done()` whose status was then written over), so
something ended the page while a `followInstall` (signing-sheet.js) was still streaming `signing.progress`.

## Causes found

1. **Shared page, several jobs** (nav/progress.js progressHUD). A queue run (screens/queue.js runAppQueue) starts
   the next app as soon as `installOnDevice` returns true, which is when iOS has the link, *before* the last app's
   `followInstall` ends (it isn't awaited, in installOnDeviceOnce's F169 path or the `after` path). The next job's
   progressHUD reuses the page; whichever HUD ended first called `page.finish` ("Complete"), and the other HUD,
   not ended itself, kept writing "Installing 72%" into the status line. The same happens with two Installs in a
   row (the `installing` guard is released once iOS is asked).
   Fix: progressHUD keeps the set of HUDs still running on each page (WeakMap page -> Set); `end` only finishes
   the page when it is the last one, and that one's button wins.
2. **Native watch ends on one empty read** (native/Sources/Sideload.swift `watch`): once progress has been seen,
   the first tick where `installProgressForBundleID` returns nil answers `isInstalled` -> false mid-install, and
   followInstall then `hide()`s. Fix on the JS side: followInstall calls signing.progress again (up to 3 more
   times) when the answer isn't installed:true and the last percent it saw was between 1 and 99. A round that sees
   no progress ends it as before. Filed **B28** (low) for the shell to tolerate the gap itself (Sideload.swift was
   outside this task's files).

Not a cause: installOnDeviceOnce hands the HUD to `after`/followInstall and doesn't end it itself; queue.js
installCustom awaits followInstall in its `after`.

## Tests

- signing-sheet.test.js: "B27: a queue run's next job ending doesn't complete the page while the last app's
  signing.progress still streams" (real progressHUD on a fake page, a signing.progress stream the test drives) and
  "B27: signing.progress answering not-installed mid-install ... is followed again".
- nav/progress.test.js: two HUDs on a page, completes on the last.
- All three fail against the old code (checked by restoring HEAD's two source files) and pass with the fix.

## Not verified

- On a phone: no device run (the iPhone 7 is for the jailbreak build; the sideload build's install path wasn't
  driven). Which of the two causes produced the user's screenshot isn't known; both are fixed.
- When iOS really gives up mid-install, the page now waits up to the shell's 45 s no-progress limit (one more
  signing.progress round) before showing Return; not timed on a device.
- An update over an installed app: `applicationIsInstalled` may already be true mid-install, so a nil read could
  end on "Open <app>" early. Left to B28 (native).
