# B219: check the connection by itself after a Tailscale sign-in

## What changed

- `web/app/screens/installroute.js`: a finished Tailscale sign-in no longer shows "Signed In … Tap Test Connection"
  and waits for OK.
  - Settings (Installation & Signing's Tailscale group, and the main page's Sign In action) run
    `connectAfterSignIn`: `testUntilConnected` calls `tailscale.test`. It tries again every 2.5 s for up to 30 s
    (`AFTER_SIGN_IN`) while the failure may pass by itself: the VPN interface not up yet, the node not running, the
    phone missing from the network map (`acl` right after login), no answer, not responding. It stops at once on
    failures only the user can fix: needs_approval, expired, needs_login, refused. While it runs, the Test
    Connection row shows its Testing… spinner. The main page has no such row, so it shows the "Checking Connection" HUD.
    When it connects, the page redraws on its connected state with no alert. B220's `recheckPairing` still runs
    after a connection (and after `refused`, where it forgets the pairing with its own alert). Any other final
    failure shows the same alert Test Connection gives (shared `testAlert`).
  - This iPhone's setup page (sign-in started from its Connect step) does nothing after the sign-in. There is no
    pairing to test yet. The page's poll starts pairing once the Tailscale VPN is on, and its footer already says
    "Turn on the Tailscale app's VPN" with the "Waiting for Tailscale…" spinner. So the old "Turn on the Tailscale
    app's VPN to pair" alert just repeated the page. Running `tailscale.test` there would also hold
    `IDevice.queue` (serial) and delay the pairing.
- No native change was needed: `tailscale.test` already answers with a code for each failure.
- Tests: `installroute-b219.test.js` (new) covers retry until connected, a stop on final codes, the budget, no
  alert on success with the row spinner or HUD, the alert on failure, and refused going to B220's re-pair. The
  source check in `installroute-b220.test.js` now looks for `connectAfterSignIn` and not the "Signed In" alert.

## Spec review

- Fixed: a `tailscale.test` call that throws (not signed in, the bridge refused it) used to be retried for the
  whole budget. Now it is final (`error` is in FINAL_CODES).
- Kept as designed. The setup page skips `recheckPairing` after a sign-in, but its Connect step only shows while
  the phone has no pairing (core setupState: `connect` needs `!paired`), so the recheck would answer "skipped"
  anyway. When `refused` is followed by a verify that passes, the answer is "ok": the pairing works over the
  route in use. The budget is checked before each try, so the worst case is 30 s plus one TIMEOUTS.test (25 s).

## Phone (iPhone 15 Pro, iOS 27.0.1)

Built the Lite IPA from this branch (installroute.js in it has `connectAfterSignIn`), installed it with
`tools/ui-15.sh` and opened Settings > Installation & Signing > Install Apps With > This iPhone. Sign In opened
login.tailscale.com, which asks for the account's email/SSO. Closing the page cancelled the sign-in quietly (no
alert). Then I set Install Apps With back to Signing Server, as it was.

## Not verified

- On the iPhone 15 Pro, that a finished login lands straight on the connected state. The Tailscale login page
  needs the owner's Tailscale account (email, Google, GitHub or passkey), and no agent can sign in to that. The
  phone is also not paired, so a full connected state needs pairing first. Filed as a hand check for a person.
- Retry timings (2.5 s gap, 30 s budget) are a guess at how long a fresh node takes to see the phone in its map.
  They are not measured on a phone.
