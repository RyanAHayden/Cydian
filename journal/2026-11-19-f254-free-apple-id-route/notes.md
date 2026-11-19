# F254 Free Apple ID route: the website's side

The brief changed shape after R32 (iOS refuses free-profile apps from itms-services, `MIInstallerErrorDomain` 111):
no Home Screen route. The website signs in, keeps the development key and certificate, makes the profiles and hands
them to the app, which installs through `installation_proxy` (F15, not built). This session built the website half
and split the rest off. How it works now: `docs/signing.md` "Free Apple ID (website)".

## What I built

- **`core/gsa.js` DevPortal**: listDevices, addDevice, listCerts (`listAllDevelopmentCerts`), submitCsr
  (`submitDevelopmentCSR`), revokeCert, listAppIds, addAppId, downloadProfile (`downloadTeamProvisioningProfile`),
  and `appIdName`. Action names and parameters are the ones the R32 scratch test site ran on a real free account
  (its `lib/devportal.js`, the same author's code, written fresh against isideload's MIT usage).
- **`core/freecert.js`** (new): a DER writer, RSA-2048 key (WebCrypto), the CSR (PKCS#10, SHA-256 RSA), the `.p12`
  (plain cert bag, key under PBES2/PBKDF2-HMAC-SHA256/AES-256-CBC, HMAC-SHA256 MAC with PKCS#12's KDF: OpenSSL 3's
  `-export` defaults), certificate SPKI/serial readers, `sameKey`, and a stored (no compression) zip writer.
  The R32 test site did key, CSR and `.p12` with the `openssl` CLI on a server; the website needs them in the browser.
- **`core/freeroute.js`** (new): `runSetup` (device → certificate reuse/make → App ID `<id>.<TEAMID>` → profile, with
  `onStep` for the checklist and `askRevoke` at the certificate limit), `freeEntitlements`, `freeExpiry` (3 days),
  `setupError`, `pickTeam`, `freeAppId`.
- **`screens/free-apple-id.js`** (new) + **`freeid.css`** (new): the Free Apple ID group on How Signing Works
  (`screens/signing.js drawWalkthrough` appends it on the website only, hidden unless `/apple/status` says on), the
  sign-in form, the code screen, the live checklist (iOS 6 grey spinner, the walkthrough's green tick, grey for not
  reached, red cross on failure), the Ready page with Save for the App, the Developer Mode + Trust note, Refresh
  Profile and Forget. Alerts are `nav/alert.js` with `gsa.js signInAlert`'s words and the effects the user asked for.
- **`worker/src/apple-relay.js`**: `GET /apple/status` → `{"on":true}` when `APPLE_RELAY=1` (still a 404 when off,
  so ifizbox.com shows nothing).
- Tests: `core/freeroute.test.js` (15), `screens/free-apple-id.test.js` (5), `worker/test.mjs` (status).
  New fixtures `core/fixtures/signing/test-key.pk8`, `test-cert.der`, `test-ca.der`: the existing fake test identity
  (`test.p12`, password hunter2) taken apart with openssl, so the zsign test can repack it with `makeP12`.

## Decisions (unattended, written down here)

- **Placement**: How Signing Works, not the main Signing page. That's the page Install opens when there's no
  certificate, and it's in my file list (`screens/signing.js`); the main page is `settings.js`, another task's file.
  Filed F254e for the main page.
- **Hand-off**: a `.zip` (`.p12`, `password.txt`, `.mobileprovision`), because the app's Select All Files already
  imports exactly that. No new native code in this task.
- **Setup's App ID is the app's own** (`BUNDLE_ID` + `.TEAMID`): the first thing the app needs is a profile for itself.
- **Storage**: localStorage (`ifizbox.freeid`, `ifizbox.freeid.anisette`), like the UDID; gsa's note suggested
  IndexedDB, but the anisette storage interface is synchronous and the data is a few KB.
- **The certificate-limit alert** lists this site's certificates first and SideStore/AltStore/Xcode/… ones last
  (`otherTool` by machineName), each button red, with the warning; Cancel revokes nothing.
- **Limit detection**: `7460` (the code AltStore/SideStore name) or Apple's wording; App ID limit `9401` or wording.
  Neither code was seen live (see Not verified).
- **Text doesn't promise an install**: the Ready page says the app's own install route for free-profile apps isn't
  out yet.

## Tried and failed

- First Chromium render: the website never left Loading. `web/app/app.js` on main declares `refreshOnLaunch` twice
  (an import from `websign-gate.js` and a `const`), a SyntaxError, so **the live site doesn't load at all**. Not my
  file; filed **B103 (critical)**. My screenshots used a scratch server that renamed the const in memory.
- `ui.js` rows take one class (`classList.add`), and I passed two: the click threw InvalidCharacterError. Fixed (one
  class per button row).
- zsign refused the first `makeP12` run ("Unknown issuer hash … the p12 carries no usable CA chain"): the fixture
  certificate comes from a fake CA that only `test.p12` carries. Added `chain` to `makeP12`; with the CA in, zsign
  signs. Real Apple Development certificates don't need it (zsign has the WWDR intermediates built in).
- A heredoc write hit EDQUOT on /tmp (shared tmpfs at 80%, per-user quota) and left a 0-byte file; moved my
  scratch work into the worktree (`.f254tmp/`, deleted before finishing).

## Checked

- CSR: `openssl req -verify` OK; WebCrypto verifies it in the test.
- `.p12`: `openssl pkcs12 -info` reads it (MAC sha256, PBES2 AES-256-CBC hmacWithSHA256); checkP12Password; zsign's
  password check (OpenSSL 3.5 in WebAssembly) opens it and refuses a wrong password; zsign signs the tiny IPA with it.
- Zip: `unzip -t` OK and `certfiles.js unzipEntries` reads it back.
- Rendered in headless Chromium at 320 pt (iPhone UA): the entry group, sign-in form and Ready page (screenshots
  here; `checklist-mock.png` is the checklist's CSS on hand-built rows, not a live run).

## Not verified

- **A real sign-in and setup through the Worker**: the relay is off on ifizbox.com and turning it on needs R35's
  preview deploy with the user's OK and their spare Apple ID. The setup calls are the ones the R32 test site ran on
  a real free account, but this code path (browser → Worker → Apple) hasn't run end to end.
- **Apple taking a CSR made by `makeCsr`**: Apple ignores the subject; the format is standard PKCS#10 and openssl
  verifies it, but Apple hasn't seen one from this code.
- **The certificate-limit and App ID-limit codes** (7460, 9401): from AltStore/SideStore's use, not seen live.
- **iOS's `SecPKCS12Import` reading the PBES2/AES `.p12`** (the app's Select All Files): the app's import code wasn't
  run with it. If iOS 15 can't read AES-256 PBES2, the hand-off needs a 3DES/RC2 `.p12` (no WebCrypto for those).
  Belongs to F254b.
- **Install of a free-signed app**: by design not from the website (error 111); the app's route is F15 + F254b.
- **2FA screens and the alerts in a browser**: only the pure mapping is tested; the code screen, SMS path and the
  password clear/focus were not driven (they need Apple's replies).
- Safari/iOS rendering: only Chromium; no phone was used (the task didn't need the 7, and the iPhone 15 is
  read-only).
- The checklist animation live (spinner turning while a step runs): only the static mock.

## Follow-ups filed

- B103 (critical): app.js double declaration breaks the site.
- F254a: bootstrap download (free-signed iFizBox IPA with the identity, for a one-time USB install).
- F254b: the app's side (import, free signing rules, installation_proxy, 3-day expiry, refresh link). After F15.
- F254c: LiveContainer. F254d: Developer Mode walkthrough with screenshots. F254e: entry on the main Signing page.
