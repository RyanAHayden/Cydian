# D9: Notifications for signed apps, current state

## What I did

- `web/app/screens/guides.js`: KEEP_INTRO now says the app gets its own server's notifications whoever signed it
  (push goes to the Info.plist ID), Push needs an explicit App ID in an Ad Hoc profile, development profiles get
  test (sandbox) pushes only, one such App ID covers every app, a signing service's .p12 + Push profile works as
  well as a paid account (skip to Import It), and a renamed copy (Keep Bundle IDs off) gets no notifications.
  Step 1 no longer says "One App ID per app": one App ID is enough for every app; per-app IDs only keep keychains
  and App Groups apart. Example ID changed from com.yourname.youtube to com.yourname.apps so it doesn't suggest
  one per app.
- `docs/signing.md` Keep Bundle IDs: a Notifications list with the four points; the warnings bullet describes the
  one-App-ID note as a shared keychain, not a push limit; the guide bullet says one App ID for every app and that
  a signing service's profile only needs the last two steps.
- `docs/sideload.md` "What iFizBox does": replaced the stale "an explicit one renames the app" with Keep Bundle IDs.
  The Feather section's Explicit App ID bullet describes Feather, so it stays.
- `README.md` Sideload app section: one paragraph pointing at the guide.
- `web/app/screens/guides.test.js`: a new test for the new claims.

## Decisions

- The API key's own profiles (Settings > Signing > Apple Developer Account) aren't on main yet (grep finds no such
  UI), so the docs don't mention them; filed D11 `--after F278` to add that line once it lands.
- docs/developer-account.md step 3 and core/keepid.js's one-App-ID warning ("use it for one app") still read as one
  App ID per app being needed, but they're outside D9's files: filed D10.

## Not verified

- The guide's look on a phone (text only changed; node tests render it). Not checked on a device: no device task.
