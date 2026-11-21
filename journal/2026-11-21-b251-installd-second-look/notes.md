# B251: notice a drop during installd sooner (a second look)

B246's run 7 (iPhone 15 Pro, Tailscale): VPN off the moment installd started, on again 16 s later. Nothing came
back on the first connection, so the drop showed only at installd's 180 s quiet limit (TIMEOUT), then the
reconnect asked iOS and found the app installed. Right end, three minutes late.

## What changed

- `HereRecheck.SecondLook` (pure, tested on Linux): while installd's step is quiet, a look is due after
  `lookAfter` (30 s) of quiet and every `lookEvery` (30 s) after; installd's next percentage (the step moving)
  starts the looks over. `ends(verdict)`: only `.installed` (the new copy listed) ends the wait. A look that
  couldn't ask iOS, or got `.notYet`, `.sameAsBefore` or `.cannotTell`, changes nothing.
- `IDevice.Watch` gets a per-step quiet hook (`whileQuiet`, cleared by `begin`) that the watchdog calls on
  every 0.5 s tick, and `stop(_:step:then:)`: the watchdog then closes the tunnel, gives the waiting call
  `Limit.grace`, and throws `stopped`.
- `installTry` sets the hook right before `installation_proxy_install_with_callback` (only with a bundle ID and
  version). Each due look runs on its own thread under its own `watched("second look")`, so the watchdog never
  waits on it: a `Session(second: true)` on the install's pinned route, installation_proxy Browse, the verdict.
  On `.installed` it removes the staged IPA. When `SecondLook` says installed, `stop` records
  `run.lookedInstalled` and `install()` reports installed (note + `progress(.install(1))`).
- `Session(second: true)` over Tailscale doesn't start or stop the node: it uses the install's running relay
  (`Tailscale.mapPort`), since `endInstall()` stops the node and would cut the install's own connection off.
  With the VPN off it fails at once ("Tailscale isn't back on yet", the B246 pinned-route check).

## Decisions

- **A look that can't reach iOS does not end the wait.** The task's ask is to see the installed app sooner.
  Treating "route down" as the drop would start install()'s reconnects (2+4+8+15 s) at 30 s, and with the VPN
  still off they'd give up long before the 180 s B246 gave the user to turn it back on (run 6 vs run 7). A look
  that can't open a second connection also can't tell a dead route from iOS not letting in a second tunnel, and
  killing a working install on that guess would be worse than waiting.
- **A look that sees "not yet" doesn't end the wait either**: installd may still be verifying a big app. The long
  limit stays 180 s and decides as before (then B246's reconnect and askInstalled).
- Run 7 with this change: VPN back at 16 s, first look at 30 s of quiet. If installd had finished by then (run 7's
  copy was a small app), the look sees the new folder and the install ends at ~30 s instead of ~182 s; otherwise
  the next look 30 s later.

- **`cannotTell` never ends the wait here** (spec review). The first version counted it once it held 30 s, as
  askInstalled does after a drop. But the first connection may still be alive: when the same version is reinstalled,
  or what was there before is unknown, the old copy reads `cannotTell` from the first look. So it ended a live install
  at 60 s of quiet while installd was still verifying. Those cases keep B246's path (the 180 s limit, then a reconnect
  and askInstalled).
- When the waiting call comes back on its own during the stop's grace wait with success, `watched` returns that
  success rather than `stopped` (spec review).
- A look that sees the new copy removes the staged IPA itself: the first connection's tunnel is closed right
  after, so the install's own removal can't run.

## Tried and dropped

- Running the look inside the watchdog loop (a nested `watched` on the watchdog thread): it blocks the loop for
  the look's time, and the loop's suspension check (a tick gap > 5 s) would then read it as the app being
  suspended and give the step its time again. A thread per look instead.

## Checks

- `native/test_sideload.py`: the Swift tests, the new "a second look while installd is quiet (B251)" among them,
  passed (no skips).
- `tools/check.sh`: see the commit (the gate builds IDevice.swift for both builds).

## Not verified

- **On a phone.** Not run on the iPhone 15 Pro: the task's files are the code and the Linux tests, and the drop
  needs Tailscale's VPN switched off mid-install on the phone (B246 did it by tapping the switch through
  ui-15.sh and checking its pixel). Unknown until then:
  - whether remotepairingd lets a second RPPairing tunnel in from the same pairing while the install's tunnel is
    up. If it refuses, every look returns nil and the install waits for the 180 s limit as before (no harm).
    If it lets the second tunnel in but drops the first, the install's call fails as a drop and B246's
    reconnect + askInstalled take over (the right end, sooner).
  - whether a second relay (`Tailscale.mapPort` for the tunnel's port, through `tunnel_set_port_map`) beside the
    install's works on tsnet; a failure there is a look that returns nil.
  - the lockdown route (older iOS) with a second provider + heartbeat beside the first: same fall-back.
- The `stopped` path when the waiting idevice call doesn't come back after the tunnel is closed: the call's
  thread is left, as for the watchdog's TIMEOUT; not exercised.
