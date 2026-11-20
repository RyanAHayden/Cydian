# F273 (with F274, F275): own provisioning profiles with an App Store Connect API key

Done by hand in one worktree at the user's request (F274/F275 were blocked so the runner left them alone).

## What it does
- Settings > Signing, under the profile (once a certificate is in): **Apple Developer Account**. Add API Key picks
  `AuthKey_<KeyID>.p8` (Key ID from the name, typed if the name lacks it), asks the Issuer ID, and keeps it only once
  Apple accepts a token made from it. App: Keychain (`asc.key.set`, this device only, never handed back). Website:
  localStorage, like the .p12. Rows: API Key, Issuer ID, Check Account (certificate in the account by serial; this
  iPhone registered, registering it), Remove API Key, then "Profiles Made by iFizBox" (one per App ID).
- Signing with Keep Bundle IDs on: App ID `<prefix>.<last component>` (prefix from the imported profile's App ID,
  `com.ryha.*` -> `com.ryha`, explicit `com.ryha.beta` -> `com.ryha`, else `ifizbox.<team>`), made with
  PUSH_NOTIFICATIONS, APP_GROUPS, ASSOCIATED_DOMAINS; IOS_APP_ADHOC profile with every ENABLED iOS device and the
  certificate; cached per App ID; remade when missing, expiring within a day, lacking this iPhone, the App ID's
  capabilities changed, or the certificate changed. A reused profile costs one call (the capabilities).
- App: `native/Sources/ASC.swift`, hooked into `IPASigner.autoProfile`, so every route (Signing Server, This iPhone,
  My IPAs, sign-ahead, re-sign) gets it. JWT ES256 with CryptoKit, 15 minutes. No server involved.
- Website: `core/asc.js` through the Worker's `/apple/api.appstoreconnect.apple.com/v1/...` pass-through
  (`screens/devaccount.js autoProfileSite`, called in `signing-client.js` before zsign).
- UDID in the sideload app: the app's own profile often lists many devices, so it can't tell which is this one.
  New: lockdown `GetValue UniqueDeviceID` through This iPhone's pairing (`IDevice.readUDID`, also on every pairing
  check), kept in UserDefaults `ifizbox.phone.udid`, which PhoneID then uses.

## CORS
`OPTIONS https://api.appstoreconnect.apple.com/v1/devices` with `Origin: https://ifizbox.com`,
`Access-Control-Request-Headers: authorization` -> bare `401`, no `Access-Control-Allow-*` (2026-11-19). So browsers
can't call it: the relay passes it through. Only that host gets `Authorization` and `DELETE`, only the
devices/certificates/bundleIds/bundleIdCapabilities/profiles paths, nothing logged or kept. It stays on with
`APPLE_RELAY` off (the free Apple ID relay stays off on ifizbox.com).

## Left out
- Apple ID sign-in for paid teams: dropped (user 2026-11-19): development profiles, sandbox push only, so real
  servers' pushes (Unbound's) never arrive; the free route already covers the Apple ID case.
- Making an Apple Distribution certificate from the app/site (Admin keys): not built. Check Account says when the
  .p12's certificate isn't in the account. `core/asc.js makeCertificate/distributionCerts/revokeCertificate` and
  `core/freecert.js` (CSR, .p12) are the parts a follow-up needs.
- An imported .mobileprovision is still required (the import takes .p12 + profile); the key only replaces it per app.

## Not verified
- Nothing on a phone yet: the Swift side (CryptoKit JWT accepted by Apple, the sign-time hook, lockdown UDID over
  RemotePairing on iOS 27) waits for the user's hand test (R39). Only compiled (`make -C native ipa`).
- No Swift unit test for the JWT: CryptoKit isn't in the Linux toolchain the native tests use; the JS twin's claims
  and signature are tested (`web/app/core/asc.test.js`).
- Two apps with the same last bundle-ID component share an App ID (and keychain): a known ceiling, marked in asc.js.
