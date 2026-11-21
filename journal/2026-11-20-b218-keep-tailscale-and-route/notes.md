# B218: keep the Tailscale node and the install route across a fresh container

## What was lost and why

- Install Apps With (`ifizbox.installRoute`) lives only in the web view's localStorage, and it isn't one of the
  settings the iFizBox Account carries (`core/settings.js` TRAVELS). Connect With and the signed-in node
  (`{name, keyExpiry}`) live in UserDefaults, and the node's keys in Application Support (`Tailscale.stateDir`,
  tsnet's `tailscaled.state`). All of it is in the app's container, which a reinstall or a re-sign (a new container)
  starts empty; signing in to the account with the saved key afterwards brings back sources, settings and the
  certificate, but none of this. So the route read Signing Server, Tailscale asked for a login, and each login
  registered a new node ("<name> on <device>") on the tailnet.
- Nothing on an account sign-in itself calls `tailscale.signOut` or `Tailscale.forget()`: the only delete of the
  node state is the explicit Sign Out, and it stays that way.

## What changed

- `native/sideload/tailscale/Tailscale.swift`: `TailscaleKeep`, a Keychain store (service
  `com.ryha.ifizbox.tailscale`, AfterFirstUnlockThisDeviceOnly, as the account key: never in a backup, survives
  deleting the app while the signing team stays the same).
  - `remember()` (every time the node is seen Running: sign-in, test, install) copies `tailscaled.state` and
    `{name, keyExpiry}` into it.
  - `start()` puts `tailscaled.state` back first when the container has none, so the same node (machine and node
    keys) comes back instead of a new device. A second Sign In with the state kept goes straight to Running.
  - At launch (`TailscaleBridge.register`) `{name, keyExpiry}` (only when the state is kept too) and Connect With go
    back into UserDefaults when missing; `tailscale.setConnect` keeps Connect With.
  - `forget()` (Sign Out only) deletes the Keychain's node state and record too. Connect With and the route stay.
  - New bridge calls `tailscale.keepRoute {value}` / `tailscale.keptRoute`.
- `web/app/core/installroute.js` `keepRoute()`, started from `app.js`: in the sideload app, keeps every change of
  Install Apps With in the Keychain; at launch with nothing in localStorage it takes the kept route (a pick made
  while the shell answers wins). With a value stored already (a build from before this), it keeps that.
- Tests: `web/app/core/installroute-b218.test.js` (keepRoute), `native/sideload/tailscale/test_tailscale_keep.py`
  (restore before TSStart, keep in remember, only Sign Out deletes, ThisDeviceOnly, calls registered).

## Decisions

- The route goes to the Keychain, not into the account's synced settings: it is per device (a second phone isn't
  paired), and the account would carry it to the website and other phones.
- Only `tailscaled.state` is kept: tsnet regenerates the rest of its Dir; logs go to TMPDIR.

## Not verified

- On the 15 Pro: pick This iPhone + Tailscale sign-in, reinstall the Lite IPA, sign in with the saved account key,
  and see the route still This iPhone, Tailscale signed in without a login page, and the tailnet admin console still
  one device. Not done in this run: it needs a reinstall of the user's Lite build on the 15 Pro and the owner's
  tailnet admin console (memory: Tailscale login there needs the owner). Filed as a CONFIRM follow-up if the gate
  passes.
- Whether the Keychain item survives a re-sign with a different team (a different access group): by iOS design it
  doesn't; then the old behaviour (a new node) remains. Not checked on a device.
