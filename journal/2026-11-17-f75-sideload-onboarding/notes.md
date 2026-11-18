# F75: sideload app onboarding, and moving the certificate over from the website

## What was done

All of the brief's parts, in this order:

1. **The local HTTPS install mode is gone** (the user's 2026-11-17 replacement of point 2). Removed:
   `native/sign/LocalCA.swift` (its manifest/itms helpers moved to `native/sign/Manifest.swift` as
   `InstallManifest`), `native/sign/ProfileSign.swift` (F69's signed mobileconfig), `LocalTrust` and
   `KeychainCertKey` in `SignStore.swift`, `InstallServer.secure` and its TLS setup, `signing.trust`,
   `signing.resetTrust`, `signing.testServer`, `trust` in `signing.status`, `localInstallSection`, the walkthrough's
   download/install/trust steps, Test Install Server, Check, and the docs and tests about them. Kept:
   `InstallServer.plain` and the keep-alive. `Sideload.install` and `resignAll` now need `manifestServer` (https)
   and otherwise answer `no_server` (`deviceError` opens Settings > Signing). `signed-apps.js` Re-sign All now
   sends `manifestServer` (it sent `{}` and relied on the CA). At launch `SignStore.removeOldInstallCA()` drops a
   0.1.x phone's old CA keys and DER files (only when those files exist).
2. **Walkthrough = certificate + server** (`screens/signing.js`). `missingStep(status, server)`; the server step
   is done for any https server (cydian.dev by default). The sideload page now has the server row and Check Server.
3. **First Install opens the walkthrough at the missing step** (`signing-client.js firstInstallCheck`, called from
   `signAndInstall` before signing.inspect; `browse.js signIfReady` no longer stops at the sheet in the app).
   Checked end to end against `Sideload.install`'s guard: the web side requires exactly what the guard requires
   (an identity from signing.status and an https server); nothing waits for trust.
4. **Import from Safari** (`core/transfer.js`: newKey, sealIdentity/openIdentity AES-GCM, base64url iv‖ct).
   The app opens `<server>/#/settings/signing-export.<key>`. I used one route segment
   (`signing-export.<key>`) rather than `/signing/export/<key>`, because every path segment becomes a page in the
   stack (router.js prefixes). The website's page seals and opens `cydian://signing-import#…` (banner first), or
   says there's no certificate in this origin and shows the rows; once they're complete it goes on by itself.
   App: key kept 30 min in localStorage, one use.
5. **Zero-tap certificate**: server `bring: true` → `ipa.add_identity` writes
   `Payload/<App>.app/cydian-identity.plist` before zsign, only when the IPA's own bundle ID is `com.ryha.cydian`.
   Website: "Bring My Certificate" switch (on by default, `cydian.bringCertificate`) under Install Cydian App;
   Install Cydian App (Settings and Home) sends it. App: `SignBridge.importBundled()` at launch (sideload only),
   `BundledIdentity` (native/sign/Handoff.swift) decides: no identity in the Keychain and a digest not seen before.
   The digest is stored before importing, so a file that fails isn't retried every launch.
6. **Open in Cydian App**: `cydian://import?d=` (gzip via CompressionStream), Settings (site, Not Jailbroken) and
   a tile beside Install Cydian App on Home; banner before opening. App side: `incoming.js` (app.takeURL at start and
   on `cydian:url`) → `screens/importlink.js reviewAndImport`: an "Import from the Website?" alert with only what's
   new, Cancel / Import. The settings that travel are `TRAVELS` in core/settings.js (appearance, allowZoom, device,
   worksOnMyPhone, compatMarks, iosVersion) plus holds (merged as a union) and the server; the app applies only those
   it shows. Sources on the Source Warning list are listed but not added (as Manage's import leaves them unticked).
   `app.gunzip` in the shell for iOS < 16.4 (no DecompressionStream).
7. **Certificate step**: Select All Files (the `.walk-action` blue glossy button, a label over a multi-select
   input) on top of the rows (on the website too); picture = an iOS 26 style file picker drawn in HTML/CSS
   (`modernPicker`), replaced by `web/app/icons/steps/select-files.png` if the user adds one; one-sentence texts.
   Screenshot of the page with a fake bridge: `walkthrough.png` here.

Also: IMPORT_ALERT no longer says "no server" and mentions Import from Safari; docs/signing.md (install step table,
setup, "From the website to the app (F75)", what is stored where), docs/sideload.md (the R5 open question about a
trusted root is answered: no), native/README.md.

Tests added: `core/transfer.test.js`, `incoming.test.js`, rewritten `screens/signing.test.js` (incl. a guard that no
trust wording/calls are left in the signing files), first-install and Import-from-Safari round trip in
`signing-client-device.test.js`, `web/test_signer.py BringTest`, Swift tests in `tests/sideload/main.swift`
(BundledIdentity, IncomingLink, gunzip) and `native/test_sideload.py HandoffSourceTest`.

## Tried and dropped

- A headless chromium screenshot with `--virtual-time-budget` drew the website's Signing page blank (IndexedDB
  never settles under virtual time); a real `--timeout` wait draws it fine. Not a bug in the page.
- First version of the source-check test flagged my own `removeLocalTrustLeftovers` name; renamed to
  `removeOldInstallCA`.

## Not verified

- **Nothing ran on an iPhone** (the task says the user tries it): the cydian:// hand-off from Safari (scene
  `openURLContexts`, launch via `urlContexts`), `app.takeURL` timing, the first-launch Keychain import of the bundled
  identity, Safari's "Open in Cydian?" with the banner, the multi-select picker on iOS. The Swift compiles in the
  native build (the IPA built) and the pure parts run in the Linux Swift tests.
- **Real zsign with the extra file**: BringTest uses a stand-in zsign (copies the IPA). That zsign seals
  `cydian-identity.plist` into CodeResources wasn't checked here (the gate's SignTest runs real zsign, but not with
  bring). By how zsign works (it seals every file in the bundle) it should be.
- Whether iOS opens a ~20 kB `cydian://signing-import#…` URL from Safari without truncation (the .p12 and profile
  are not compressed). Should be fine (iOS takes much longer URLs), not tried.
- The modern picker drawing is my own HTML; not compared against a real iOS 26 screenshot (none in ref/).
