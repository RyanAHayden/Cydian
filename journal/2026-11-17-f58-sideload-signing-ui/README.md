# F58: the sideload app's Settings > Signing and Install, on the phone's own signer

User 2026-11-17: the sideload build (v0.1.0) had no Signing section at all (`signingAvailable()` was site-only).

## What I did

- `web/app/core/signing.js`: pure helpers for the sideload paths: `deviceSummary(identity)` (signing.status's
  identity/profile as rows + problems, the signer's own `problem` preferred over date checks), `localInstallSection(trust)`
  (Status; until trusted a Set Up row `action: "trust"`, the two iOS Settings steps, Check Again `action: "refresh"`),
  `phaseLabel(ev)` for the HUD, `deviceError(err, name)` (alert text + `open: "signing"` for `untrusted` and `no_identity`).
- `web/app/signing-client.js`: `localSigning()` (sideload), `deviceStatus`/`importToDevice`/`removeFromDevice`/`setUpTrust`
  (the `signing.*` bridge calls; files base64), `installOnDevice` (HUD following `signing.install`'s phase events, errors
  by code). `signingReady()` and `signAndInstall()` dispatch to these in sideload, so browse.js's Install and Version
  History rows use the signer unchanged. `loadIdentity`/`saveIdentity`/`clearIdentity` keep the picks **in memory** in
  sideload: the .p12 never lands in the web view's IndexedDB; after import only the file names stay.
  `signingAvailable()` stays site-only on purpose: home.js uses it for the "Install Cydian App" tile, which the
  sideload app must not show (it is that app).
- `web/app/screens/settings.js`: sideload root row (Certificate: the Keychain identity's name / Incomplete / None);
  the Signing page = the same Certificate rows (now showing "In Keychain" / the profile's name / "Not Kept" from
  status), "In This iPhone's Keychain" summary, Local Install, Remove Certificate; no Signing Server. Import runs
  once .p12 + profile + password are staged and the password isn't known wrong (after a Browse pick, a password that
  checks out while typing, or on the field's change/blur when WebCrypto can't check it). `wrong_password` from the
  signer marks the password wrong. The page redraws on `visibilitychange` (back from iOS Settings).
- `web/app/screens/browse.js`: "Sign with My Certificate" also in sideload (no identity yet).
- docs/signing.md: "The page's side (F58)".

## Checks

- `node --test web/app`: all pass, 17 new (`signing-client-device.test.js`, `core/signing-device.test.js`) against a
  fake `cydianNative`: status rows, trust steps, phases, error codes, base64 import params, in-memory staging.
- Rendered the sideload Settings root and Signing page in headless Chromium with a fake bridge injected (trusted and
  untrusted): rows, Local Install steps and Ready state look right.

## Not verified

- On a real iPhone: the sideload app importing a real .p12 (SecPKCS12Import), Set Up opening Safari, the trust
  steps, and a real install. Needs the user and a new Cydian.ipa release (the brief says one follows this task).
- Whether `crypto.subtle` exists on the app's custom URL scheme in WKWebView (not a secure context, maybe). If it
  doesn't, `checkP12Password` answers null and the import waits for the password field's change/blur (or a Browse
  pick) and the signer's own `wrong_password` decides; that path is tested only through the logic, not on a device.
- The file picker and import flow in the browser render (the fake bridge only answered `signing.status`); the
  import path is covered by unit tests of the call, not a DOM test (no DOM in the node tests).
