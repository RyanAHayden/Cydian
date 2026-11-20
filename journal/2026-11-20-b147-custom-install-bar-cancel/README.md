# B147: Cancel at the top left of the Custom Install sheet (already done by B145)

B147 asks for the same change as B145, which landed on main (9fbbfc84) before this task started and is already in
this branch.

## What I checked

- `web/app/signing-sheet.js` `signSheetButtons` already takes `left` and puts a plain `bar-button ss-bar-cancel`
  "Cancel" there, calling the same `onCancel` (the sheet's `close()`) as the red bottom Cancel, which stays.
  `openSignSheet` passes nav/sheet.js's left spacer.
- `web/app/screens/custominstall.test.js` already asserts the left Cancel is in the left side, is plain, and closes
  the sheet. `node --test web/app/screens/custominstall.test.js`: 5 pass, 0 fail on this branch.
- The 3x Chromium render is B145's `journal/2026-11-20-b145-custom-install-bar-cancel/sheet.png` (402x874 @3x):
  Cancel at the top left, Delta title, blue Install at the top right. I looked at it zoomed in; the bar button
  matches the iOS 6 modal style. The same capture clicked `.ss-bar-cancel` and found no `.sheet` left.

No code change: doing it again would only make a merge conflict with B145's lines.

## Not verified

- No fresh Chromium render on this branch: the code under it is unchanged since B145's capture (no commit touched
  `web/app/signing-sheet.js` after 9fbbfc84), so B145's screenshot shows this branch's sheet. B132's
  `web/app/ios6.css` change may have merged after that capture, but it only touches the tab bar gloss and the
  status strip, not the sheet's nav bar buttons.
- Not checked on a phone; the change is web-only and the task asked for the Chromium check.
