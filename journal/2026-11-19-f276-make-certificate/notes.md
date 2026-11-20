# F276: Make Certificate with an API key (core part)

## What landed (core/asc.js, tested in core/asc.test.js)
- `newCertificate({ request, revokeId, ownSerials })`: RSA key and CSR made in the WebView or browser (freecert
  makeKey/makeCsr). Only the CSR goes to Apple: `POST /certificates` DISTRIBUTION. Checks that Apple's certificate
  is for our key (`sameKey`), then packs a .p12 with a random password (freecert makeP12).
  Errors: `key-role` (403: not an Admin key, sidedrop's wording), `key-refused` (401), `cert-limit` (409 with
  certificates listed, `.certs` = the picker's list), `cert-gone` (the picked certificate is no longer listed, so
  nothing is revoked). A 409 with nothing to revoke is passed on as Apple's own error.
- Revoking happens only with `revokeId`, the certificate the user picked. Nothing is ever revoked on its own (tested).
- `certsForPicker(request, ownSerials)`: Apple Distribution and iOS Distribution (they share the limit), newest
  first, `kind`, and `ours` for the certificate this app signs with. The old `distributionCerts` is left unchanged.
- `LIMIT_TEXT`, `KEY_ROLE_TEXT`, `REVOKE_WARNING` (sidedrop's: apps signed with it stop opening on every iPhone,
  wherever they were signed; App Store/TestFlight not affected) for the UI.
- `makeOwnSigning(...)`: newCertificate, then `ensureProfile` for this app's own App ID (brand.js `BUNDLE_ID`, so
  `appIdFor(BUNDLE_ID, prefix)`). The prefix defaults to `appIdPrefix(null, team)`, and the team comes from the new
  certificate's subject OU (`certTeam`), because a key-only user has no profile to take a prefix from. The .p12 lives
  only in memory until it's imported. So a failed profile step doesn't throw: it returns `profileError`, and the caller
  can still save the .p12 and make the profile later.
- `profileForP12(...)`: a .p12 imported without a .mobileprovision gets the own App ID's profile from the key.

## Why it stops here (blocked --after F278)
The brief's UI file `web/app/screens/devaccount.js` (Settings > Signing > Apple Developer Account, Check Account)
isn't on main. It's only on wip/F273 (ea5447c), and F278 (critical) is porting it, together with settings.js,
signing-client.js and ASC.swift. If I wrote devaccount.js here, it would collide head-on with that port. So the UI
waits for F278. Still to do there:
- Check Account finds no certificate (`no-cert`), or there's a key and no .p12: offer Make Certificate.
  Call `makeOwnSigning`. On `cert-limit`, show `err.certs` as a radio picker with `REVOKE_WARNING` and a confirm
  step in the page (the viewer has no confirm()), then call again with `revokeId`.
- Import: in the app, `signing.import(p12, password, profile)`. On the website, `saveIdentity`. On the website the
  request goes through the relay (`/apple/api.appstoreconnect.apple.com/v1`). The relay already allows
  `/v1/certificates(/{id})`, and DELETE works on that host (worker/src/apple-relay.js line 41).
- A .p12 alone with a key: `profileForP12`.

## Tried / slips
- I appended the new tests with a shell heredoc instead of the edit tool (against the session rules). The content
  was checked by running the tests.

## Not verified
- No real App Store Connect call: there's no API key on this machine. Apple's 409 body at the certificate limit
  is assumed from sidedrop (status 409). The fake ASC returns that.
- `certTeam` was checked only on a synthetic certificate built like Apple's (issuer OU "G3" before the subject OU),
  not on a real Apple Distribution certificate.
- The .p12 opening in zsign/the app's Signing import wasn't checked for a certificate made this way. It uses the same
  makeP12 as the free route (F254), and checkP12Password opens it in the tests.
- No UI: see above.
