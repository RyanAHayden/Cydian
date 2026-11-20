# F280: push notifications (APNs)

## Done

- **App ID**: `com.ryha.ifizbox` didn't exist on team S8NFX3A2LT. Made it with the App Store Connect key in
  `~/sync/default/signing/other` (`core/asc.js ensureAppId`, a scratch script): bundleId id `QDN53GXHP9`,
  capabilities APP_GROUPS, ASSOCIATED_DOMAINS, IN_APP_PURCHASE, PUSH_NOTIFICATIONS.
- **Worker** `worker/src/push.js` (routes `/api/push`, `/register`, `/unregister`, `/status`, `/test`; Cron Trigger
  every 30 min via `scheduled` in `src/index.js`; D1 binding `PUSH` in both wrangler tomls, `APNS_TEAM_ID` in
  `wrangler.ifizbox.toml`). Update rules ported from `native/sign/Updates.swift` (newest runnable version per source,
  `known` skipped, each key pushed once), plus iFizBox's own update and a signature-expiry warning (2 days).
  APNs: ES256 provider token via WebCrypto, cached 40 min; 410/BadDeviceToken/DeviceTokenNotForTopic delete the
  device. Logs counts only. Tests: `worker/test-push.mjs` (imported at the end of `worker/test.mjs`), D1 over
  node:sqlite and a fake APNs that verifies the JWT signature, topic, host and payload.
- **Topic rule per the user's correction**: no team filter. The server accepts any team; it refuses only topics
  outside `APNS_TOPICS` (default brand.js BUNDLE_ID), because its key can't reach them.
- **Keep iFizBox's ID when signing** (correction (a)): `websign-job.js` keeps it with Keep Bundle IDs on;
  `signing-client.js expectedBundleId` predicts it; `native/sign/SignOptions.swift keeps` no longer looks at the
  running copy's ID. On a renamed copy the self-update says once "Installs Beside This One" (`core/push.js
  renamedUpdateNotice`, called from `essential-ui.js installSelfNow`) with how to delete the old one. iOS gives an
  app no way to delete another, so "offer to delete" is the instructions, not a button. Updated the tests that pinned
  the old way (keepid, signing-client-early/prompt/status, early-drop, native sign tests main.swift).
- **Native** `Notifications.swift` `Push`: `push.status` (bundle ID, team, aps-environment and expiry from the
  embedded profile, authorization), `push.register` (permission once, `registerForRemoteNotifications`, waits up to
  30 s for the token via AppDelegate in `App.swift`), `push.unregister`. Register refuses without aps-environment
  (correction (b)).
- **Web** `core/push.js` (+ test): off reasons in order renamed / no aps-environment / notifications denied / server
  without key or database (correction (c)); enable/disable/sync/test; `screens/push-settings.js` adds Settings >
  Updates > Push Notifications (Push switch, Last Push, Test Push, footer with the reason and the background-check
  fallback). `app-updates.js` re-registers when the watch list changes (only while Push is on).
- **Docs**: `docs/push.md`, worker/README.md (self-hosted needs its own key), docs/signing.md (iFizBox keeps its ID).

## Decisions

- `native/entitlements-sideload.plist` unchanged: signers take aps-environment from the profile (websign
  `appEntitlements`, the app's signer, zsign); putting it in the binary risks an install refusal with signers that
  keep binary entitlements under a profile without Push, and `native/test_ipa.py` pins the file.
- Separate D1 database `ifizbox-push` rather than sharing REVIEWS, so push data can be dropped on its own.
- Push goes to the configured signing server (`getServer()`), so a self-hosted Worker without a key shows "has no
  APNs key" instead of silently using ifizbox.com.
- Only iFizBox's own signature expiry is sent; other signed apps' expiry dates already drive the local re-sign
  reminder (Sideload.swift) and could be added to `expires` later.

## Tried / failed

- First test-push run failed "three a minute": my test helper made a fresh limiter per call. Fixed the test.
- `native/test_brand.py` refused the brand name spelled in `worker/test-push.mjs`; now uses `NAME`.

## Needs the user

- **APNs Auth Key**: none in `~/sync/default/signing/other` (asc.p8 is the App Store Connect key, which can't make
  one). Make it at developer.apple.com > Certificates, IDs & Profiles > Keys > + > Apple Push Notifications service
  (team S8NFX3A2LT), then: `cd worker && npx wrangler secret put APNS_KEY -c wrangler.ifizbox.toml` (paste the .p8
  text) and `npx wrangler secret put APNS_KEY_ID -c wrangler.ifizbox.toml`. Until then `/api/push` answers
  `enabled: false, reason: no_key` and Settings says ifizbox.com has no APNs key.

## Not verified

- **Native on a phone**: swiftc isn't on PATH, but the gate's toolchain (SWIFT_TOOLCHAIN) built both the .deb and the
  IPA with the new Swift without warnings in these files. Notifications.swift's `Push` and the App.swift delegate
  methods were not run on an iPhone (no APNs key yet, and the task didn't call for the phones).
- **Real APNs delivery**: no APNs key, so no push was sent to a device. Also unverified: that a Cloudflare Worker's
  `fetch` reaches APNs over HTTP/2 (APNs refuses HTTP/1.1). If it doesn't, set `APNS_HOST` to an HTTP/2-capable relay
  (the code uses it in place of both APNs hosts).
- **Deploy**: the new `PUSH` D1 binding (no database_id, auto-provisioned like REVIEWS) and the Cron Trigger were not
  deployed from here; Workers Builds does that on merge. CPU time of the scheduled run on large sources (Free plan
  limits) not measured.
- **Settings UI** not looked at in a browser or on a phone (no fake bridge with push.* calls); only `pushRows` is
  tested.
- Profiles from RSideload/SideDrop/Arctic carrying aps-environment for `com.ryha.ifizbox`: not checked; the App ID was
  only just made, so profiles made before today for it (none) or wildcard ones won't have Push.
