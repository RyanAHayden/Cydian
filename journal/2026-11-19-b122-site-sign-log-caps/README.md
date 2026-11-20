# B122: capability refusals in the website's sign log

## What changed
- `web/app/screens/devaccount.js` `autoProfileSite` now passes its `log` to `core/asc.js` `ensureProfile`. That
  means the lines `addCaps` writes ("Capability X: Apple refused it for team T …; skipped from now on", "not added this
  time", "accepted but didn't turn it on") reach the website's sign log. `signing-client.js` already sends that
  log to the sign page (`h.page.raw`), so nothing changed there.
- The refusals are remembered per team in the site's profile cache (`ifizbox.asc.profiles`, which `autoProfileSite`
  already writes back after each sign), so a refusal is logged once and later signs skip that capability.
- `autoProfileSite` takes an optional `request` (the default is still `siteRequest(k)`), so a test can pass a fake
  App Store Connect.
- New test `web/app/screens/devaccount-log.test.js`: a fake ASC refuses ICLOUD (409). The first sign logs the refusal
  once along with the Profile line. A second app on the same team doesn't ask for ICLOUD again and logs nothing about it.

## Tried and failed
- The first draft of the fake ASC had no certificates, so `ensureProfile` threw `no-cert`. I gave it a certificate
  with the serial the test's `cert` returns.

## Not verified
- I did not sign through the website in a real browser against Apple, because an unattended run has no API key or
  browser session. The test covers this path with a fake ASC, and the sign page already showed `log` lines (the
  Profile line).
