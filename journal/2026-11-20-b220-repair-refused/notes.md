# B220: re-setup with a kept pairing, every connect refused

## What was wrong

Three things lined up, all in code that assumed the kept pairing and port 49152 are always good:

1. **Port 49152 was hard-coded** (`IDevice.remotePairingPort`, used by the install session and by Tailscale's Test
   Connection). 49152 is the first port of iOS's dynamic range, which remotepairingd gets when it starts early in
   boot. It's not a fixed port: idevice's own `pair_rsd_ios` finds it through mDNS (`_remotepairing._tcp`), and a
   restart can leave it elsewhere. Then every connect to 49152 is refused. A phone that no longer has the pairing
   (nothing serving it) is refused the same way.
2. **A refusal looked like "turn on the VPN"**. Every `tunnel_create_rppairing` error was `connect_failed`, and
   `verifyFailure` maps `connect_failed` to "Turn On LocalDevVPN" with no Pair Again. VPNCheck counts a refused
   probe as "LocalDevVPN on", so the page said everything was fine. Tailscale's Test said "iPhone Refused, check
   Developer Mode".
3. **The pair step was skipped**: the Pairing page shows Paired as soon as a pairing is in the Keychain (it survives
   re-setting Tailscale up, and even reinstalling the app), and nothing checked it after a new Tailscale sign-in.

## What changed

- `IDevice.findRemotePairingPort(probe:)`: probe the port that answered last in this run, then 49152, then every
  port `_remotepairing._tcp` is advertised on (`advertisedRemotePairingPorts`, DNSServiceBrowse + Resolve for 2 s).
  The probe goes over the route in use: `VPNCheck.probe` on 10.7.0.1, or `Tailscale.probe` (new `TSProbe` in
  tsnet.go: a dial through the tailnet) on the phone's own Tailscale address. Another device's advertised port is
  just refused by this phone, so trying it costs a millisecond. When every candidate refuses, it throws `refused`;
  when nothing answers at all it returns 49152 and the connect reports what's wrong, as before.
- The install session uses it (a relay for the found port on the Tailscale route) and classifies the tunnel's
  error: `RemotePairing(...)`/PairVerifyFailed → `pairing_rejected`, "Connection refused" → `refused`.
- Tailscale's Test Connection uses the found port too; all refused → `refused`, whose alert now says to pair again.
- `Info-sideload.plist`: `_remotepairing._tcp` added to `NSBonjourServices` (iOS refuses to browse an unlisted
  type). Outside the task's file list, one string; nothing else there changed.
- Web: `verifyFailure` treats `refused`, `pairing_rejected` and `connect_failed` with "connection refused" as an
  unusable pairing (`again`, `unusable`): Check Connection offers Pair Again. After a Tailscale sign-in,
  `recheckPairing` verifies a kept pairing once (only with the VPN route on); when the phone no longer accepts it,
  the pairing is forgotten and Pairing opens and pairs again (redraws if already there). Other failures (VPN off,
  timeout) say nothing there; Check Connection explains them.
- The last good port is kept in memory only: `test_idevice.py` forbids UserDefaults in IDevice.swift (nothing of
  the route outside the Keychain), and a fresh run tries 49152 then mDNS anyway.

## Tried and dropped

- Checking the pairing automatically on every visit of the Pairing page: it would race Check Connection's button
  (its tests tap it right after the draw) and costs a connect on each visit. The check runs where the re-setup
  happens, after the Tailscale sign-in, and on Check Connection.
- Browsing the LAN from the desktop (`avahi-browse _remotepairing._tcp`) to see the 15 Pro's advertised port: the
  phone advertised nothing on the LAN, so no evidence of the port moving was gathered here.

## Not verified

- **The phone check the brief asks for (15 Pro: wipe the Tailscale login, set it up again, sign and connect
  without refusals) was not run.** The 15 Pro has neither the Tailscale app nor LocalDevVPN installed (`ios apps
  --list` shows only iFizBox), signing in to Tailscale needs the user's own account, and the UI lock was held by
  B210 the whole session. Needs a person with the Tailscale app and login on the test phone.
- That remotepairingd's port actually moved on the user's phone is inferred (upstream discovers it by mDNS, the
  port is in the dynamic range), not seen in a log. If the cause was a dropped pairing instead, the fix covers it
  through `refused` → pair again.
- That an app's DNSServiceBrowse sees the phone's own `_remotepairing._tcp` advertisement (with Local Network
  access on): not checked on a phone. Without it the code still tries the last good port and 49152 and falls back
  to the old behaviour, plus the clearer refused → Pair Again.
- The exact idevice error text for a turned-down pairing (`RemotePairing(PairVerifyFailed)` etc., from idevice's
  Debug format in `ffi_err!`) was read from the source, not seen from a phone.
- Native code was compiled by `native/build.sh` (gate), not run.
