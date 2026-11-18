# F134 Settings changes: Zoom gone, Show Expiry Dates, Settings > Signing reworked

## What I did
1. **Zoom**: dropped `allowZoom` from `SETTINGS`/`SECTIONS` (the "zoom" group) and `TRAVELS`, added it to `RETIRED`
   so `dropRetired` clears `cydian.allowZoom`. `applyZoom` now always applies the no-zoom viewport (allow = false);
   the pinch blocker stays. An account or transfer link that still carries `allowZoom` is skipped (`isShown` false).
2. **Show Expiry Dates** (`showExpiry`): a toggle (createSwitch) in the "signing" section, on by default.
   Off: `withSignatures(..., { show })` (installed.js) and `signatureRow(..., { show })` (altstore.js) drop the days;
   `signingExtras({ dates })` (signed-apps.js) drops Signed Apps' days and the "(next: …)" date. **Expired always
   still shows** (pill, Signature row, Signed Apps detail), because that's a state with an action (re-sign), not a date.
   Re-sign Reminder and Changes' Needs Re-sign don't read the switch. Installed redraws on the change.
   - Decision: **sideload only**, not the website the brief named. Nothing on the website draws signed-app dates
     (every `signatureState` caller is sideload-only: `signedRecordOf`, `signedApps`), so a switch there would do
     nothing. Easy to widen: `modes` in core/settings.js.
3. **Settings > Signing**: `signingLayout()` + `SIGNING_GROUPS`: Certificate (Name, Team, Expires + Import/Replace
   Certificate row that clicks the hidden multi-file input), Files (only while something is missing: the old
   certificate block without Select All Files, one-line footer), Provisioning Profile, options (Show Expiry Dates,
   Re-sign Reminder), Signing Server (sideload), Certificate Status/Signed Apps (sideload), Install Cydian App +
   Bring My Certificate (website), Other Apps (website), Remove Certificate, then **How Signing Works**, a link to
   `#/home/settings/signing/help` drawing the old walkthrough (steps, picture, Select All Files). Footers shortened
   to one line (Install Cydian App, Bring, Install on the Website, Lock Home, Signed Apps). "Lock Home Until Cydian
   Is Installed" row label is now "Lock Home" (it was cut off at 390 px). New `web/app/settings.css`, linked by
   screens/settings.js on first draw. `watchReturn`'s 2 s poll also runs on the new page.
4. docs/settings.md: tables updated, new "Settings > Signing (F134)" section.
5. Tests: core/settings.test.js (retired key dropped, switch defaults/section/modes), resignqueue.test.js (switch
   hides pills/Signature row, Expired stays), screens/settings.test.js (group order per build/state, splitSummary,
   help title).

## Checked
Rendered in headless Chromium (390 px, 2x) with a fake sideload bridge (temporary copy of index.html, deleted):
sideload set up, sideload empty, website empty, How Signing Works. Order and look as intended.

## Tried that failed
- First Import row was a `<label>` over the file input (like Browse); app.js's pressed look only covers
  `a/button.cell-inner`, so it would get no pressed state, and app.js isn't on this task's files. Switched to a
  button row calling `input.click()` inside the tap's handler.

## Not verified
- On a real iPhone (sideload build): that `input.click()` from the Import/Replace row opens the iOS file picker in
  the WKWebView. iOS allows it inside a user tap, but I didn't touch the iPhone 7 (the task doesn't ask for it).
- The website's Signing page with a real certificate saved (Certificate/Profile groups, Install Cydian App): only
  the empty state was rendered; the set-up state is covered by the layout test, not a render.
- The Files group's look in a real "password missing" state: not rendered (needs a staged .p12).
- Dark theme renders of the new page: not checked.
