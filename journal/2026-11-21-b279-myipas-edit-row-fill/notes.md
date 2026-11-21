# B279 My IPAs Edit rows: one fill, pressed as picked

My IPAs' rows already wear `.manage-row` (screens/myipas.js) and their list toggles `.managing`, so B265's
packages.css rule (`.managing .manage-row:is(.picked, :has(> .cell-inner.is-pressed))`, `var(--multi-select)`) and
ios6.css's blue-press exclusion (`:not(:where(.managing .manage-row > *))`) already reached them. What kept the bug
was myipas.css's own rule painting the picked fill on both the row and its slid `.cell-inner` (dark:
`rgba(255,255,255,.15)` twice), which beat the shared one.

- myipas.css: dropped that rule; a comment points at the shared one. ios6.css needed no change.
- ios7.css / ios13.css: their picked rules painted row and `.cell-inner` (for both `.manage-row` and `.myipa-row`)
  and nothing while held (the base press is off for these rows). Now one rule each, on the row only, held as
  picked, in the era's grey. This also changes Installed's Manage in those eras the same way (same rows, same bug).
- New test web/app/manage-row-fill.test.js checks the four sheets.

Tried and failed: nothing.

**Not verified**
- No screenshot or phone check of the rows (iOS 6 light/dark, iOS 7, iOS 13): the change is selector-only and
  covered by the CSS test; a visual check needs the Chromium shot rig or a phone, which I skipped for a small CSS fix.
