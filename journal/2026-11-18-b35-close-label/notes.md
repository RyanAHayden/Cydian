# B35: "Return to iFizBox" becomes "Close iFizBox"

The user's note overrides the brief's plain "Close": the label is `Close ${NAME}`.

- `web/app/core/queue.js` FINISH_LABEL.return and `web/app/nav/progress.js` (finish() and progressHUD defaults)
  now say `Close ${NAME}`; comments in screens/queue.js and screens/ipa-install.js follow.
- Tests that expected "Return to iFizBox" (core/progress.test.js, nav/progress.test.js, signing-sheet.test.js) updated.
- grep: no `Return to ${NAME}` / "Return to iFizBox" left in web/, worker/, native/. docs/cydia.md:406 still lists
  "Return to iFizBox" among Cydia's labels; it is outside this task's files, left alone.
- Return vs reopen (both "Close iFizBox" now): checked that they never show together. A finish page has one button,
  whose level is chooseFinish's single highest level (core/progress.js), so it is either return or reopen. Actions
  are unchanged: return's page.finish action only closes the sheet (finishAction does nothing for "return"; IPA
  install's action is uicache or null), reopen's quits the app. Noted in a comment by FINISH_LABEL.
- Other end-of-run labels (Reload Data, Restart/Reload SpringBoard, Reboot Device) untouched.

**Not verified**: the label on a phone or in a browser (no device here); covered by the unit tests only.
