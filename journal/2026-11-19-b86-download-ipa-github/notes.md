# B86: Download IPA on opentennis opens github.com, not the IPA

## Cause
The rows were never the problem: `installRows` / `downloadRow` (screens/altstore.js) and `siteGateRows`
(websign-gate.js) pass `o.download` unchanged to the opener, which calls `window.open(url, "_blank", "noopener")`.
In the Home Screen web app, app.js replaces `window.open` for outside links with `core/applinks.js openOutside`. Its
`appSchemeFor` turned **every** github.com path into `github://github.com/<path>`. So the release asset
`…/releases/download/v1.8.0/opentennis-ios.ipa` went to the GitHub app, which can't download a file and just shows
its home. Safari's x-safari- fallback ran only if the app didn't open. So the user saw "github.com, not even the repo".

## Fix
`appSchemeFor` returns null (stay https, so `x-safari-<exact URL>`) for GitHub files: `releases/download/…`,
`releases/latest/download/…`, `archive/…`, `raw/…`, and paths ending in .ipa/.tipa/.deb/.zip/.plist/.json. Profiles,
repos and release pages still open in the GitHub app. The native shell's anchor handler uses the same function, so
it gets the same fix.

## Tests
- `screens/download-ipa.test.js`: parses opentennis's source and checks that Download IPA opens the exact downloadURL
  on the website (gated rows) and in the sideload app. In the Home Screen web app path (openOutside), Safari gets
  `x-safari-` plus that exact URL, with no app-first timer.
- `core/applinks.test.js`: new cases for release, archive and raw files, plus repo and releases pages.

## Not verified
- On the iPhone in Safari / the Home Screen web app: the fix reaches ifizbox.com only after the runner merges and
  publishes. The iPhone 15 is read only, and the iPhone 7 runs the jailbreak app, not the website. Once it's
  deployed: open opentennis's app page in the Home Screen web app, tap Download IPA, and check that Safari downloads
  opentennis-ios.ipa.
- The sideload app sends window.open to native LinkOut, which asks iOS for the universal link first. I didn't check
  whether the GitHub app's universal links claim release-download URLs there. That's a different code path from
  this bug.
