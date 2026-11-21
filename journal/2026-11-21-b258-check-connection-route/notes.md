# B258: Check Connection names the route it used; early eof is Pair Again

## What was wrong

`verifyFailure` (web/app/core/installroute.js) turned every `connect_failed` from `idevice.verify` that wasn't a
"connection refused" into "Turn On LocalDevVPN". On the 15 Pro in R54, over Tailscale, the phone took the TCP
connection and then reset the RemotePairing tunnel (`connect_failed: Socket(UnexpectedEof "early eof")`, from
`tunnel_create_rppairing` in native/sideload/idevice/IDevice.swift): a pairing it no longer accepted while Pairing
said Paired. Check Connection told the user to turn on a VPN they weren't using.

## What changed

- `verifyFailure(err, st)` takes the `idevice.status` read for the check (optional).
- `verifyVPN(st, raw)`: the VPN the check went through. Tailscale when the shell's route is Tailscale
  (`tailscale.use`), LocalDevVPN when it's on; with neither on, the one the user set up (`setUpWithTailscale`, the
  same rule the status cell uses); with no status, Tailscale when the shell's error starts `connect_failed: Tailscale`
  (Tailscale.swift's own failures, e.g. "Tailscale is off").
- `connect_failed` with `UnexpectedEof`/`early eof` → "Pair Again" with the Pair Again button (`again: true`).
  Deliberately **not** `unusable`: `recheckPairing` (B220) forgets the pairing by itself on `unusable`, which costs
  the user the 6-digit code; an early eof is strong evidence but not proof (a tunnel reset for another reason reads
  the same), so the user decides through the alert's Pair Again.
- Tailscale route on and still no connection → "Couldn't Connect … through Tailscale" instead of "Turn On". Neither
  on and set up with Tailscale → "Turn On Tailscale". LocalDevVPN keeps its old "Turn On LocalDevVPN" wording in every
  case (idevice.status sees it on when 10.7.0.1 answers; turning it off and on is the usual fix), so the task stays on
  the Tailscale route.
- screens/installroute.js `check()` passes its status read to `verifyFailure` (two lines; outside the task's listed
  files but the only way the core function can know the route).
- screens/installroute-f301.test.js: its fixture is signed in to Tailscale with Connect With: Automatic, so with both
  VPNs off the answer is now "Turn On Tailscale", matching the status cell's "Tailscale Is Off".

## Spec review

Fixed: the early-eof Pair Again now says which VPN answered ("answered through Tailscale"). The Tailscale-on
"Couldn't Connect" no longer tells the user to check that Tailscale is on (it is); it says to try again, then turn the
VPN off and on. Check Connection's "Not Responding" timeout names the route from the status read instead of
"LocalDevVPN (or Tailscale)".

Kept, with the reasons:
- "after connecting" isn't checked separately. An EOF can only be read on a socket that was open, and the error
  comes from `tunnel_create_rppairing` after its TCP connect, so the match already implies it.
- Both VPNs on → Tailscale. The shell's own rule (`tailscale.use`, decideRoute) connects through Tailscale then.
- Neither on → "Turn On Tailscale" when the user set up Tailscale. This is the "name the route" part for that case.
- `recheckPairing`: an early eof gives `again` without `unusable`, which still returns "failed" there, the same as
  the old Turn On answer.

## Tests

`node --test web/app/core/ web/app/screens/`: 1896 pass. New test in installroute.test.js covers the R54 error, the
Tailscale-on, LocalDevVPN-on, neither-on (each setup) and no-status cases.

## Not verified

- On a phone: no reproduction of the early eof on the 15 Pro. It needs a pairing the phone no longer accepts (R54
  got one from a ui-15.sh rig install over an earlier build); making one on purpose would cost a re-pair with the
  code typed on the phone. The error text matched is the one R54's journal recorded.
- `recheckPairing` still calls `verifyFailure(e)` with no status; it only reads `unusable`, which the route doesn't
  change.
