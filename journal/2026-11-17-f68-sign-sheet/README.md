# F68: the sideload app's page side of F14's signing calls

## What I did

- `web/app/core/signing.js` (appended, pure): `installParams` (signing.install's params: the token plus only the
  edits that change something; a bad bundle ID refused with the signer's own rule), `inspectGroups` (the sheet's
  App / Permissions / Entitlements / Your Profile Can't Give It groups), `isCgBI`, `fromBase64`,
  `certificateWarnings` (revoked; signatureExpires under 7 days or past), `revocationLabel`, `resignLabel`,
  `signedAppRows`, `syncReminder` (signing.remind {days}), `installedId`, `validBundleId`, `entitlementName`.
- `web/app/signing-sheet.js` (new): `inspectAndInstall` (inspect under a HUD, the sheet, then
  `installOnDevice` with the params and `followInstall`: signing.progress on the HUD), `openSignSheet` (the DOM),
  `iconPNG` (picked image -> 180x180 PNG via canvas). Styles in `web/app/signsheet.css` (new), loaded by the module.
- `web/app/signing-client.js`: `signAndInstall` in the sideload build goes through the sheet (one place, so the
  package page, Sign with My Certificate and Version History all get it); `installOnDevice` takes `params` and
  `after` (both optional, old callers unchanged).
- `web/app/screens/signed-apps.js` (new): Certificate Status (Check Certificate, red warnings) and Signed Apps (rows,
  Re-sign All, swipe-left Delete = signing.forget), put under the walkthrough by `screens/settings.js`.
- `web/app/screens/settings.js`: the extras on Settings > Signing; `remindNow()` on launch (init) and whenever Re-sign
  Reminder changes; the root's Certificate row drops its own "Signing" header when the Re-sign Reminder group (also
  "Signing") sits just above it, so the header isn't doubled.
- `web/app/core/settings.js`: "resign" in FEATURES.
- `docs/signing.md`: "The page's side (F68)" replaces the "follow-up task" sentence.
- Tests: `web/app/signing-sheet.test.js` (10): the params (only changes, extensions filtered to known paths, explicit
  profile ID, bad ID), the groups, CgBI, the whole Install flow against a fake bridge (inspect -> sheet edits ->
  signing.install {token, name, removeExtensions} -> signing.progress {bundleId}, the HUD labels), Cancel, inspect
  errors and an older shell without signing.inspect, followInstall's fallbacks, the warnings, Signed Apps' rows,
  Re-sign All's HUD text, and the reminder call (2 by default, 7, 0; no bridge / failing bridge -> null).
  `node --test web/app`: 527 pass.
- Shots (`tools/serve.mjs` = web/app with a fake sideload bridge answering F14's shapes, `tools/shots.mjs` over
  CDP, chromium headless 390x844 3x): `shots/2-4-sheet-*` the sheet top to bottom, `shots/5-signing-status-light`
  and `-revoked` (red row detail and footer), `shots/6-signed-swipe-light` (Delete armed), `shots/1-settings-root`.
  The script's Sign & Install sent `signing.install {"token":"tok1","name":"Delta 2","removeExtensions":["PlugIns/DeltaWidget.appex"]}`
  then `signing.progress {"bundleId":"com.rileytestut.Delta"}`. No page errors.

## Tried and dropped

- Nothing failed on the way. One harness slip: restarting the walk-through server with REVOKED=1 hit EADDRINUSE
  because the first server's pid file had been overwritten; killed it by its own pid (checked its cwd) and re-ran.

## Decisions

- The sheet keeps nav/sheet.js as it is (its one bar button relabelled Cancel) and puts Sign & Install as a big blue
  button at the end, rather than adding a left bar button to the shared sheet (other tasks touch it).
- Re-sign All: one HUD whose label follows each app ("Signing 40% Delta (1 of 3)"), confirmed first by an alert,
  since each app makes iOS ask "Install?".
- Signed Apps shows without an identity too (forgetting needs none); Re-sign All and Check Certificate only with one.
- A chosen icon is drawn on white (iOS fills an icon's transparent parts black).

## Not verified

- On an iPhone: nothing of this ran in the real sideload build (signing.inspect / install / progress / resignAll /
  checkCertificate / remind against Sideload.swift). The task didn't ask for the device, the 4S is iOS 6 (the
  sideload build is iOS 15+), and no modern iPhone is reachable from here. The shapes used are Sideload.swift's
  header and code.
- The icon picker's canvas path (`iconPNG`) wasn't exercised in the shots or tests (needs a real file pick); the
  IPA-icon path was shown only as the CgBI/none placeholder, not with a plain PNG icon.
- Dark theme shots weren't taken.
- The swipe gesture itself wasn't driven in the shot (the row's `armed` class was set directly); the gesture code is
  sources.js's, copied.
