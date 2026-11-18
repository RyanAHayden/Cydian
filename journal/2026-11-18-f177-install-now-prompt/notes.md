# F177: Install Now prompt when Signing was reached from Install

## What I did
- `web/app/screens/signing.js`: a session flag for "the install that sent the user here" (module state, not a route
  param, so no router change): `rememberInstall({ name, run })`, `pendingInstall()`, `forgetInstall()`,
  `offerInstall(ready, { alert })` and `siteReady(id)`. `offerInstall` shows the iOS 6 alert
  `Install <name>?` / "Signing is set up. <name> can be signed and installed now." / Later | Install Now (green);
  it clears the flag before asking, so it shows once per trip even if the page redraws under it.
- The trip ends when the route leaves Signing (a `hashchange` to anything without a `signing` segment), so Back to
  Home and opening Signing again later is the user's own visit: no alert.
- Where Install sends the user to Signing, it now remembers the install:
  - `home.js installApp` (the website's Install iFizBox App without a certificate): `run` is the same signAndInstall.
  - `signing-client.js signAndInstall` after `firstInstallCheck` opened the walkthrough (the sideload app, any app's
    Install, including iFizBox itself), and `signInBrowser`'s No Certificate (the website, any app): `run` repeats
    the same signAndInstall call. signing-client.js wasn't in the task's file list; two small insertions, needed for
    "any Install that needs a certificate first".
- `settings.js`: each Signing draw (app page, website page, walkthrough in both) calls `offerInstall` with whether
  signing is ready: the app `missingStep(status, getServer()) == null` (certificate in the Keychain and an https
  server); the website `siteReady(id)` (.p12, profile, a password not known to be wrong). importIfComplete and the
  password check redraw the page (redrawAll), so the alert comes the moment it becomes ready, or at once on arrival.
- Tests: `web/app/screens/installnow.test.js` (flag, alert on arrival and on ready, once per trip, Later, leaving
  Signing forgets, no alert when opened directly, Home's installApp remembers, siteReady, the draws call it).

## Decisions
- Title uses the app's name (`Install iFizBox?` for Home's tile, `Install Delta?` for another app's Install), since
  the task says Install Now runs "the queued app" too.
- Install Now stays on the Signing page; the install's own HUD/progress shows over it.

## Not verified
- Not run in a browser or on a phone (no device step in this task): the alert's look and the real hashchange timing
  (Install sets the hash, then the listener sees the Signing route) are covered only by node tests with fakes.
- My IPAs' Install (`installFromLibrary`, which also calls firstInstallCheck) does not remember its install: it has
  its own flow (sign, then install when reachable) and wasn't named in the task.
