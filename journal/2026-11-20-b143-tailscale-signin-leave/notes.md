# B143: leaving This iPhone's page during a Tailscale sign-in

## What changed

- `native/sideload/tailscale/Tailscale.swift`: new bridge call `tailscale.signInCancel` (quick, off IDevice.queue).
  It sets a flag under a lock; `signIn`'s loop checks it every pass (and once before `TSStart`) and throws
  `canceled: sign-in canceled: the page was left`, so the existing `defer` stops the node and dismisses the login
  sheet. The flag is cleared in the `tailscale.signIn` handler itself, before the call is queued, so a cancel sent while
  the sign-in still waits on IDevice.queue (behind a status or test) still counts. A node that just reached Running
  keeps its sign-in: the Running check comes before the cancel check.
- `web/app/core/installroute.js` `leaveQuestion("signingIn")`: the same "Stop Setting Up?" with Cancel / Leave,
  "Leaving stops signing in to Tailscale. …".
- `web/app/screens/installroute.js`: `tailscaleSignIn` remembers the pair page visit that started it
  (`signInVisit`; null from Settings' main page). `pendingStep()` answers "signingIn" while that sign-in runs, so
  Back, the tab bar and the edge swipe ask first (B134's guard, unchanged). `leave()` sends `tailscale.signInCancel`
  once for that sign-in (also on a plain hashchange off the page, as pairing does); an older shell without the call
  rejects it and is ignored. A sign-in from the main page is never stopped by the pair page.
- Found while testing: the pair page passed its `redraw` to the sign-in, so a sign-in ending after the page was left
  (now: every cancel) drew the detached page again, which started a new visit and its 2 s VPN poll for ever. The pair
  page's sign-in now redraws only while its visit is current.
- Test: `web/app/screens/installroute-signin-leave.test.js` (asks, Cancel keeps it, Leave cancels once and shows no
  "Couldn't Sign In", a plain leave cancels).

## Tried / failed

- The first test run hung after all tests passed: that was the leaked poll above (the event loop never emptied).

## Verified

- `make -C native package` built the .deb and the sideload IPA with the Swift change (compiles; no new warnings).
- `node --test` on the two leave test files and core/installroute.test.js: 27 pass.

## Not verified

- On a phone: the sideload build wasn't installed and run on an iPhone (no task permission to drive one here, and the
  sign-in needs a real tailnet login/approval). Not checked by hand: Leave during "Waiting for approval" ends the node
  and the page shows Sign In again on return; the Safari login sheet (step "login") covers the app, so the guard only
  matters once it is closed or before it opens.
