# B118a: Apple Developer Account shown with or without a certificate

## What I did
- `web/app/screens/settings.js` signingLayout: `account` is now `mode === "sideload" || site` (was gated on
  `certificate`). Hiding it after Remove Certificate made the API key look deleted; only Remove API Key deletes it.
- Checked `devaccount.js accountGroup` draws without a certificate: it only reads the key (keyInfo) and the profile
  cache, nothing from the .p12. Its sign-time step (autoProfileSite) still needs a profile, so nothing new runs.
- `settings.test.js` F134 test: the no-certificate layouts (sideload empty, sideload with files picked, site empty)
  now include `account`; added a loop asserting `account` for sideload/site × with/without certificate, and none on
  jailbreak. `remove` stays out of SIGNING_GROUPS (B118 test unchanged and passing).

## Tried that failed
none

## Not verified
- The page on a device or in a browser (no phone test): the change is one layout flag, covered by unit tests.
