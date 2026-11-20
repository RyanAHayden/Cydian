# B145: Cancel at the top left of the Custom Install sheet

User 2026-11-20: the Custom Install sheet should also have a Cancel at the top left of its nav bar, like other
sheets, keeping the red Cancel at the bottom.

## What I did

- `web/app/signing-sheet.js` `signSheetButtons` takes an optional `left` (the nav bar's left side) and puts a plain
  `bar-button ss-bar-cancel` "Cancel" there, calling the same `onCancel` as the red bottom one (the sheet's `close()`).
  It returns it as `barCancel`. `openSignSheet` passes nav/sheet.js's empty left spacer
  (`.sheet-bar-row`'s first child) as `left`; nav/sheet.js itself is not on this task's file list, so I did not add a
  named left slot there.
- `web/app/screens/custominstall.test.js`: a new test that the bar Cancel sits in `left`, is plain (no `done`), the
  red one stays last in the box, and each closes the sheet; without `left` nothing throws.
- Screenshot: `capture.mjs` (copied from B129's journal) in `--mode sideload`, with `web/app/` served on
  127.0.0.1:8731. `sheet.json` opens the real sheet through `inspectAndInstall` with a stub `signing.inspect`
  (Delta 1.6), shoots it at 402x874 @3x (`sheet.png`), clicks `.ss-bar-cancel` and counts `.sheet`: 0, so the
  bar Cancel closes the real sheet too.

The empty "App ID ()" in the notes is just the stub's missing profile data, not this change.

## Not verified

- Not checked on a phone (iPhone 7 / sideload IPA). The task asked for the Chromium check, and the change is web-only.
