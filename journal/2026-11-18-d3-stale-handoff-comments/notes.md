# D3: stale comments after F95

What I did:
- `web/app/incoming.js` header: `cydian://install` no longer comes from the website's app page
  (`handoff.js installLinks` is gone); the app still handles it, for links already out there.
- `docs/signing.md` "The website signs nothing": an app's page / Version History / My IPAs' Install is now the
  certificate alert with Download IPA (`altstore.js siteCertificateAlert`, F92/F95) until F93 signs in the browser;
  Home's Install Cydian App is the same alert (`home.js installAppSheet`, not the old `appInstallChoices` sheet,
  which was also stale); Essential Upgrade's "same sheet" is now "same alert".
- `docs/signing.md` "From the website to the app": the Open in Cydian bullet now says `cydian://install` was sent
  until F92/F95.
- `docs/signing.md` My IPAs (~276): `siteInstallChoices` replaced by the certificate alert; the Tests paragraph's
  description of `siteinstall.test.js` updated.

Left alone (not in this task's files): `web/app/app.js:358` comment still says "F89's Open in Cydian on an app
page". Filed as D4 (low).

Tried that failed: nothing.

**Not verified**: none (comments and docs only; the gate runs in `done`).
