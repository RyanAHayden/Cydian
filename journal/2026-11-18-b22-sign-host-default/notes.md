# B22: default Signing Server from brand.js

Install failed with "A server with the specified hostname could not be found": the default Signing Server was
hard-coded https://sign.cydian.dev, which no longer resolves.

## Done
- `web/app/core/signing.js`: `APP_SERVER = https://${SIGN_HOST}`, `LEGACY_SERVER = https://${DOMAIN}` (imported from
  `web/app/brand.js`), so the default is https://sign.ifizbox.com.
- `web/app/signing-client.js`: comments only (the logic already used APP_SERVER/LEGACY_SERVER).
- Tests: `core/signing.test.js` checks the constants are sign.ifizbox.com / ifizbox.com;
  `signing-client-device.test.js` checks the default getServer() is sign.ifizbox.com and a saved website address
  means the default; `signing-client-library.test.js` expectations moved to sign.ifizbox.com.
- grep of `native/` and `worker/`: no native code names the signing host (Bridge.swift only has a comment about
  cydian.dev in Safari). worker/'s cydian.dev mentions (User-Agent, comments) are the website/domain: left for F172.
- `settings.js`: no reference to the signing host, unchanged.

## Decisions
- The brief first asked for a saved cydian.dev / sign.cydian.dev to count as unset, then the user's note (2026-11-18)
  overrode it: no special-casing of old cydian values. So a stored sign.cydian.dev stays as the user's server; no
  test for that case. The old test that a saved https://cydian.dev means the default now uses https://ifizbox.com
  (LEGACY_SERVER's new value).
- `core/essential.test.js` still expects "cydian.dev" in the install-in-Safari message: that's the website domain,
  F172's scope.

## Not verified
- An install on a phone against sign.ifizbox.com: no phone use was in the task, and whether the Worker answers on
  sign.ifizbox.com (DNS/route) is deploy-side, not checkable from here.
