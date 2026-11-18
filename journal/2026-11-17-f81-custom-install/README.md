# F81: one-tap Install, Custom Install for the options

## What changed
- `signing-client.js` `signAndInstall`: in the sideload app Install now signs and installs straight away
  (`installOnDevice`), with no look-first sheet. This covers the app page's Install row when the queue doesn't take
  it, the package page's Sign with My Certificate, Version History, and My IPAs' URL installs. The F80 queue path
  (nav button / Install row: Confirm, then `installOnDevice`) already skipped the sheet. signing-client.js wasn't in
  the task's file list, but this one branch is where the sheet was opened from, so the change had to go there (a
  three-line edit).
- `altstore.js` `installRows`: a "Custom Install" row (subtitle "Bundle ID, name, icon, extensions") under Install
  for any version with an http(s) IPA, only where the phone signs (sideload mode, not the jailbreak helper, not the
  site, because the site has no `signing.inspect`). It's on app pages and on every Version History entry because
  both use `installRows`. Its tap runs `signing-sheet.js customInstall`: F75's first-install check, then
  `inspectAndInstall` (the F68 sheet). The footer mentions Custom Install in the sideload app.
- `signing-sheet.js`: the sheet's nav bar shows **Install** (done style) at the top right instead of Cancel. The
  bottom button is now a red **Cancel** (`.ss-cancel`, the colours of `sources.css .del-confirm`, UIRemoveControlRed
  and its pressed art). The new `signSheetButtons()` builds these buttons, which lets them be tested without a DOM.
- `signsheet.css`: `.ss-sign` (the blue Sign & Install) is replaced by `.ss-cancel`. `docs/signing.md` is updated.

## Decisions
- I kept F80's Confirm queue for the nav button and the Install row. The user asked for Confirm in F80 (Cydia's flow),
  and "one click install" in F81 reads as no look-first sheet, not as no Confirm. Confirm runs `installOnDevice`
  directly, so there's no sheet after it.
- Custom Install doesn't go through the queue: it is a one-off install with edits, signed right away.

## Tests
- `web/app/screens/custominstall.test.js`: the rows (Custom Install shown and wired up, hidden on the site, in the
  jailbreak build and for a source's itms-only link), the sheet's buttons (Install in the nav bar's right in place of
  Done, red Cancel last in the body, each wired up), and customInstall's walkthrough-first check.

## Not verified
- On the iPhone: the user still has to try Install (one tap) and Custom Install. Driving the sideload app on a modern
  iPhone isn't possible from here (the 4S runs the jailbreak build, and the task doesn't say to touch it).
- The red Cancel's look at 3x hasn't been checked by eye. No browser render was done in this session; the colours
  are copied from the Delete button's CSS.
- `signAndInstall` going straight to `installOnDevice` has no node test: it reads localStorage and draws a DOM HUD,
  and there's no injection point. The change is one branch, which I read through.
