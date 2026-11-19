# B67: black page finish: no status line, "Return to <NAME>"

## Done
- `core/queue.js` `FINISH_LABEL.return` is now `` `Return to ${NAME}` `` (Cydia's "Return to Cydia", docs/cydia.md
  finish level 0). `chooseFinish` (core/progress.js) takes it from there, so queue runs, IPA finishes (ipaFinish) and
  the sideload/website builds all read it. reopen (`Close <NAME>`), Restart SpringBoard, Reload Data etc. unchanged.
- `nav/progress.js`: new `RETURN_LABEL` (= `FINISH_LABEL.return`); `finish()`'s default label and `progressHUD`'s
  `done` default use it. `finish()` hides the status line (`.progress-status`); `reopen()` shows it again for the
  next job. `progress.css`: `.progress-status[hidden] { display: none; }` (the rule's own `display` would beat the
  UA's `[hidden]`).
- Tests: new `web/app/progress-finish.test.js` (labels; status line hidden after finish, back on reopen; progressHUD
  done). Updated the old "Close" expectations in core/progress, nav/progress, screens/ipa-respring and
  signing-sheet tests. The top-right nav bar "Close" button is a different control and stays.

## Tried and failed
none

## Not verified
- On a phone (iPhone 7 .deb or the sideload IPA): not run; the task didn't ask to touch the devices. Checked only
  with the fake-DOM node tests.
- A few code comments outside this task's files (screens/queue.js header, signing-sheet.js:154, ipa-install.js
  header) still say the plain finish is "Close"; left alone to keep merges clean with other tasks.
