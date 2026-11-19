# B110: Open LocalDevVPN keeps the install waiting

Before, tapping Open LocalDevVPN in the "Another VPN Is On" or "LocalDevVPN Is Off" alert opened the app and made
`chooseRoute` answer null, so the install stopped. Now it waits for the VPN.

## What changed
- `core/installroute.js`: added `VPN_POLL` (2000 ms), `VPN_WAIT` ("Waiting for LocalDevVPN…"), `VPN_CONNECTED` and
  `vpnReady(status)` (paired and localDevVPN).
- `signing-client.js`:
  - `waitForVPN({ native, signal, every, later, clear, doc })` asks `idevice.status` every 2 s, and at once on
    `visibilitychange` back to visible (the pairing page uses the same foreground signal). A failed call counts
    as not yet. It answers true once `vpnReady`, false when the signal aborts, and cleans up its timer and listener.
  - `chooseRoute`: Open LocalDevVPN now opens the app and then waits. Without a `signal` it opens a progress page
    (`progressHUD(VPN_WAIT)`, whose Cancel aborts `h.signal`). Once connected it answers `{ route: "idevice" }` and
    holds it like any other answer. The waiting page ends with "LocalDevVPN is on" one tick later, so the install's
    next HUD (opened at once) is already on the page and the page doesn't flash Complete. Callers that had a HUD up
    before `chooseRoute` (resignApp, installFromLibrary) get the waiting step on that same page, because progressHUD
    reuses an open page. It answers null only after Cancel. Use Server and OK still pick the server, as before.
  - `openPrepared` (the IPA queue's row): passes the row's signal and `onWait: progress("vpn")`, so it opens no page
    of its own. The run's Cancel, or that row's stop button, aborts the signal. The queue installs one row at a time,
    so the whole queue waits behind it.
- `core/apprun.js` (outside the task's file list, 3 small additive lines): while the row is "asking" with phase
  "vpn", its row line and the run's status say "Waiting for LocalDevVPN…", and the log gets the step once.
  `screens/installroute.js` (the Settings page) needed no change.
- Tests: `install-route.test.js` (the old "stops the install" test now checks waiting/connect, and new tests cover
  Cancel, Use Server, the signal path and the run's Cancel) and the new `install-route-wait.test.js` (the poll interval,
  failed calls, the foreground check, abort, the queue row's words).

## Not verified
- Not run on a phone: this needs the sideload build with This iPhone paired and LocalDevVPN installed, and the
  task doesn't give access to a phone for that. So it's unchecked whether WKWebView fires `visibilitychange` when
  you come back from LocalDevVPN. The 2 s poll covers it either way.
- The waiting page's look: no screenshot taken. It is the standard progress page with one step line and Cancel.
- If one queue row's stop button is tapped while it waits, the next row asks again with the alert (nothing is
  held). Not changed: the task says only Cancel or leaving stops the wait, and this follows the row-stop rule.
