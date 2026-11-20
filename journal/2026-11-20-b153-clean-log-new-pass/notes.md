# B153: a new install pass starts with a clean Log

## Cause

`runAppRun` (screens/apprun.js) opens a new progress page for each run, so two separate runs never share a log.
The page *is* reused when a run that has ended goes again on it: Retry All, a failed or cancelled row's tap,
the self update's Try Again, and the own-bundle-ID retry (B151). Each of these calls `createAppRun`'s `start()`
again, and `drive()` → `page.reopen()` kept every line of the last pass. In a one-app run (it opens on the Log)
that is exactly the user's report: "Downloading X … X: Cancelled / 1 failed" still on screen when X went again.

## Fix

- core/apprun.js: `createAppRun({ onStart })`, called with the pass number every time `start()` starts an idle
  run (pass 1 is the first run; a retry while the run is still going is not a new pass). Also `run.pass`.
  `ownIdRetry` now logs "Installing X with its own bundle ID" after `start()`, so that line opens the new pass's
  log and is not cleared.
- screens/apprun.js: `onStart(pass > 1)` → `clearLog(page)`: flush the lines that are still waiting for a frame,
  then `page.out.replaceChildren()` (or the page's own `clear()` if it has one). The rows were already reset by
  `retryPatch` (Waiting), so the Apps list of a one-app run is clean too. Rows that ended Installed in a
  multi-app run stay as they are: they are still true, and the summary counts them.
- I didn't change nav/progress.js (it isn't on the task's file list). `clearLog` uses the page's public
  `flush` and `out`.

## Tests

- core/apprun.test.js "B153: each start of an idle run is a new pass…": pass numbering, no new pass for a retry
  while the run is going, and the own-ID line comes after the pass starts.
- screens/apprun-b153.test.js (DOM, fake page with a line buffer like the real one): a run of X that ended
  "X: Cancelled. / 1 failed", then Retry All and the row's tap: the Log starts with "Downloading X" and holds
  none of the old lines; a second run on a new page starts with no lines and the row Waiting; `clearLog`.

## Not verified

- On the phone (sideload build): not run. The task asks for a unit/DOM test, and I had no phone slot for this.
- I didn't confirm that the new DOM test fails without the fix, because reverting the fix needs a stash or a
  reset, which this run doesn't allow. The cause is plain from the code: `reopen()` never touches the log.
- Edge case: if the user has text selected in the Log at the moment a new pass starts, the real buffer holds
  its waiting lines (`held`) and `flush()` does nothing, so those few waiting lines could still appear after the
  clear. This is rare: a tap on Retry All or a row ends the selection first. Fixing it means a `clear()` on the
  page in nav/progress.js, which `clearLog` already prefers once one exists.
- I couldn't find any path where a *fresh* run (Confirm → runAppQueueRun) reused an old page. If the user really
  started from an app page and not a retry, this fix doesn't cover it. Retry is the only path in the code
  that shows the old lines.
