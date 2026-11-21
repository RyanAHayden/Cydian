# R48: hand check of the Tailscale sign-in on the iPhone 15 Pro

## First attempt (2026-11-20)

The iPhone 15 UI lock was held by another task (B753), and the check was handed to the owner as a CONFIRM. The
user turned that down on 2026-11-21: run it on the 15 Pro, block only for a step that needs their password.

## What I did (2026-11-21)

The 15 Pro's Lite app already holds a signed-in Tailscale node (`ifizbox-on-iphone-4.beetal-ling.ts.net`,
100.109.186.91, key expiry 2027-05-20), paired, Connect With on Automatic. A real Sign In only shows after Sign
Out, and Sign Out deletes the node's state (container and Keychain), so the next sign-in needs the owner's
Tailscale login and every Tailscale install test on the phone waits until they type it.

**Stand-in instead of a new login.** Through Web Inspector (`pymobiledevice3 webinspector cdp`, docs as in the
phone web view debug notes) I wrapped `ifizboxNative.call` on the live page:

- `tailscale.status` answered `signedIn: false` until Sign In was tapped, so Settings > Installation & Signing >
  Install Apps With drew the Tailscale group's **Sign In** row;
- every `tailscale.*` call was logged with start and end times, and a MutationObserver logged each `.alert`.

Then I tapped Sign In on the phone with `tools/ui-15.sh` (under its lock). The real `tailscale.signIn` ran (the
node started from its kept state, so no login page), then the page's own `connectAfterSignIn` and real
`tailscale.test` calls. Afterwards I put `call` back, stopped the inspector and released the lock.

## Results

| Run | What happened | Alerts |
|---|---|---|
| Success | signIn 0.29 s; first `tailscale.test` started straight after and passed in 1.44 s (`ok`, peer `iphone-15-pro-1`, 9 ms); then the Checking Pairing HUD (`idevice.verify`) | none |
| Final failure (first test faked as `needs_approval`) | signIn 1.46 s; the test loop stopped at once | exactly one: "Approve This Device" |
| Failure that clears up (first test faked as `no_answer`) | signIn 0.29 s; tried again 2.5 s later (the gap); second test passed in 1.5 s | none |

Screenshots (in the main checkout's `ref/15/screens/`, gitignored): `r48-2` Sign In row; `r48-s1`…`s6`, taken
every 0.5 s after the tap: Test Connection says "Testing…" with the spinner by itself, then the Checking
Pairing HUD; `r48-4` the connected state (Device, Test Connection with no value, Sign Out, footer "This iPhone
is 100.109.186.91 on your tailnet."; the LocalDevVPN rows are gone because the route is now Tailscale);
`r48-7` the single needs_approval alert.

- Matches B219: after the sign-in the Test Connection row spins by itself, the page lands connected, and no
  "Signed In" alert shows; a final failure shows one alert; a passing failure is tried again quietly.
- Timing: with the node's state kept, the first `tailscale.test` passes on the first try (about 1.5 s after
  signIn returns). The 30 s budget and 2.5 s gap are never touched here. The 2.5 s gap did work as written.

## Side observations (no task filed)

- The needs_approval alert says `Approve "iFizBox"`, but the machine in the tailnet is named
  `ifizbox-on-iphone-4…` (the Device row). This is the wording `core/installroute.js` already uses. Left as is: a
  person can find it under Machines either way, and it's outside this check.

## Not verified

- **The login page itself and a brand-new node.** I didn't sign out, so login.tailscale.com never opened and
  the node wasn't new in the tailnet. Timing for a new node's first `tailscale.test` (its map not yet holding
  the phone's Tailscale peer) wasn't measured, so the 30 s / 2.5 s guesses stay untested for that case. Signing
  out would need the owner to type their login and would break the phone's Tailscale route for every other task
  until then. Filed as a `later` research task to time it the next time the node has to log in anyway.
- **A real (not faked) needs_approval or no_answer.** The failure runs faked one `tailscale.test` answer in the
  page. The alert text and the retry logic are the page's real code, but the tailnet never actually refused.
- **The Settings main page (HUD) variant** (`hud: true`, Sign In from the Installation & Signing summary): not
  run. That page shows Sign In only when not signed in, and only the Install Apps With page got the stand-in.
