# F256: website installs use the UDID F253's profile found

## What changed
- `web/app/signing-client.js`
  - `siteCause(id, app, phone = null)`: passes the phone to `deviceCheck`. A stored UDID that isn't listed puts the
    UDID in the likely-cause line; a listed one drops the line; no UDID keeps the old guess.
  - `siteRefusal(id, phone)`: `notInProfileText(udid)` when the stored UDID isn't in a device-limited profile, else null.
  - `siteUdid()`: `storedUdid()` from `screens/signing.js`, loaded lazily because that module imports
    signing-client.js. Any error gives null.
  - `signInBrowser` takes a new `phone` option (default `siteUdid`). After the identity check and before the download,
    a refusal drops the early link and shows "iPhone Not in Profile" (the title the apps use for
    `device_not_in_profile`), adding the blank-icon line when iOS was already sent to the early link, and returns false.
    The same UDID goes to `siteCause` for watchInstall.
- `web/app/signing-client-web.test.js`: tests for siteCause/siteRefusal and for the refusal: nothing downloads or
  signs, and the install goes on when the UDID is listed, missing, or can't be read.

## Decisions
- I made it refuse before signing, as the brief suggests. A UDID kept in Safari's localStorage came from this
  device's own profile visit, so an "out" answer is reliable. It refuses only when there is a UDID; an unknown
  phone still installs and gets the guess.

## Tried and failed
- nothing

## Not verified
- I didn't try it on a real iPhone (a stored UDID plus a website install). The task doesn't cover the test phone, and
  the website flow needs a real certificate and profile. Unit tests cover the logic with fake dependencies.
- Under node, the default `siteUdid` touches node's `localStorage` getter, which prints an ExperimentalWarning in
  tests that don't pass `phone`. The value read is undefined, so the answer is null. It's harmless, and I left it.
