# F129: the app's own bundle ID to signAndInstall

## What I did
- `installRows` (web/app/screens/altstore.js) takes `bundleId` (and `sign`, default `signAndInstall`, so tests can
  watch the call). Every signAndInstall it makes (website gated Install on the Website, Cydian's own website
  Install, the sideload app's Install) now gets `{ bundleId, version }`. `version` is the version's own, so F121's
  early manifest says the real version instead of "1.0".
- `appBundleId(app, rowId)`: the AltStore `bundleIdentifier`, else the package row's id with core/altstore.js's
  `~name` suffix (two apps sharing an ID) cut off.
- Callers: renderApp and siteInstallVersion (altstore.js), the nav-bar Install and Version History (browse.js).
- Test: web/app/screens/bundleid.test.js.

## Decisions
- Jailbreak (helper) and Custom Install rows unchanged: they don't go through signAndInstall/F121.
- If a source's `bundleIdentifier` differs from the IPA's real one, signInBrowser's existing check
  (`signed.bundleId === early.bundleId`) drops the early link and falls back to the Ready to Install alert (F121).

## Not verified
- On a phone: the early-prompt behaviour for a third-party app with a wildcard profile was not tried on the
  iPhone 7 (the task doesn't allow driving it, and the website path needs a real wildcard certificate). The node test
  only checks the ID reaches signAndInstall; F121's own tests cover expectedBundleId with a wildcard profile.
- A source whose bundleIdentifier lies leaves iOS's already-opened prompt waiting until the Worker's hold times out
  before the fallback alert; not checked on a device.
