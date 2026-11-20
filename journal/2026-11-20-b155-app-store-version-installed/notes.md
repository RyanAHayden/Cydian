# B155: IX Code 46 says "the App Store version is installed"

The user found the real cause of IXErrorDomain Code=46 "(creator App Store)": the App Store copy of the app was
still installed. Once they deleted it, the IPA installed fine on both routes.

## What changed

- `web/app/core/apprun.js`
  - `BUSY_ROW_KEPT` = "the App Store version is installed. Delete it, then Retry".
  - `BUSY_ROW` = the same, plus ", or tap to install it with its own bundle ID" (the row's tap still runs
    `ownIdRetry`). Decided to keep the own-ID offer in the row's words, since otherwise nothing tells the user the
    tap does something different from Retry.
  - The comment no longer claims the coordinator outlives deleting the app or a restart.
  - The Log: the red line is now `<App>: <the same short line>`, followed by installd's raw error as a `raw` line
    (progress.js draws `raw` grey monospace). `busyText` (the long paragraph) removed; nothing else used it.
- `web/app/screens/apprun.js`: header comment quotes the new words.
- `web/app/core/apprun.test.js`: both B151 tests check the exact row text, the single red line, and the user's
  error string (`IX46`) as the grey line right after it.

`node --test web/app/core/apprun.test.js`: 22/22 pass.

## Not verified

- On a phone: no iPhone run with the App Store copy installed (needs the user's phone and an App Store app); the
  words and log order are covered by the unit test only.
