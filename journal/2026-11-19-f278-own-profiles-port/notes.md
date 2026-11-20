# F278 Own provisioning profiles: the rest of wip/F273, ported onto main

## What I did

- Took wip/F273's commit ea5447c for the files the merged F273 left out (`git show ea5447c -- <files> | git apply -3`):
  `native/Sources/ASC.swift` (CryptoKit ES256 JWT, `asc.*` bridge calls, `IPASigner.autoProfile`),
  `ASC.register` in Bridge.swift, `PhoneID.remember`/`udid` (lockdown UDID wins in the sideload build),
  the certificate `serial` in `signing.status` (SignBridge.swift), `IDevice.Session.udid()` / `IDevice.readUDID()`
  and the UDID learned on every `verify()`, the `autoProfile` hook in IPASigner, `screens/devaccount.js`
  (Settings > Signing > Apple Developer Account: Add API Key, Check Account, Profiles Made by iFizBox), the
  `account` group in settings.js and SIGNING_GROUPS, and the website's sign hook in signing-client.js
  (`autoProfileSite` before zsign when Keep Bundle IDs is on).
- Fitted it to main:
  - SIGNING_GROUPS and the layout tests without the `remove` group (B118 put Remove Certificate in the Certificate
    group). `installsigning.test.js` (not on the task's file line) expected the old sideload layout: added
    `account` there too.
  - ASC.swift cache entries keep the App ID's capabilities under `capabilities` (core/asc.js's shape), and
    `remakeReason(_:udid:capabilities:certId:)` mirrors core/asc.js `remakeReason(cached, {capabilities})`
    (nil capabilities = not compared).
  - `GET /v1/bundleIds/{id}/bundleIdCapabilities` now goes without a query string (Apple 400s `limit`, B119).
  - Renamed ASC's `caps` constant/function to `appIDCaps` / `capabilities(of:_:)` so the static property and the
    method no longer share a name.
  - devaccount.js uses nav/alert.js `alertOK` (C12) instead of its own copy.

## Tried and failed

- `git apply -3` left conflicts in core/settings.js and settings.test.js (the `remove` group); resolved by hand.

## Not verified

- No real App Store Connect call and no phone run: the unattended session has no API key and must not drive the
  iPhone 7 without a task saying so. Add API Key, Check Account, the sign-time profile (app and website) and the
  lockdown UDID read are untested on real hardware/accounts.
- No unit test for devaccount.js (DOM + localStorage + showAlert; core/asc.js holds the tested logic). The Swift
  side has no unit test either; the gate's native build only proves it compiles.
