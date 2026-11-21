# R48: hand check of the Tailscale sign-in on the iPhone 15 Pro

## What I did

- Confirmed B219's code (auto Test Connection after a Tailscale sign-in, `web/app/screens/installroute.js`) is on main.
- Tried to look at the phone's current state with `tools/ui-15.sh lock R48`: refused, the UI lock is held by
  another task (B753, touched 20:46). I didn't take it over.
- Did not try to sign in: login.tailscale.com wants the owner's own account (email, Google, Apple, passkey…),
  and closing the page cancels quietly. No agent can finish it (see the earlier B219 phone attempt).

## Outcome

Blocked as CONFIRM for the owner: the whole check happens right after their own Tailscale login, so it can't be
split into an agent part. No code changed.

What to check by hand, on the iPhone 15 Pro (Lite app):

1. Settings > Installation & Signing > This iPhone (paired) > Tailscale Sign In; finish the login.
2. Back in the app the Test Connection row should start spinning by itself and the page land on its connected
   state, with no "Signed In" alert.
3. Note how many seconds pass from returning to the app until the test passes (the budget is 30 s with 2.5 s
   between tries; both are guesses).
4. A failure (e.g. the device isn't approved in the tailnet) should show exactly one alert.

## Not verified

- Everything in the list above: needs the owner's Tailscale login on the phone.
- The phone's current pairing/route state: the iPhone 15 UI lock was held by B753.
