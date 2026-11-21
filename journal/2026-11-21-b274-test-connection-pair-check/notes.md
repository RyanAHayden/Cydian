# B274: Test Connection checks the pairing; a stale pairing at the install's first connect is Pair Again

## What was wrong

On the This iPhone route over Tailscale (R55, iPhone 15 Pro), Tailscale's Test Connection said "Connected … Apps
install over Tailscale now" while remotepairingd turned the app's pairing down: `tailscale.test` only does
RemotePairing's TCP handshake (plus B246's reset-by-peer → not_paired, for a phone with no paired host at all). The
install then failed with the raw `connect_failed: Socket(Custom { kind: UnexpectedEof, error: "early eof" }) (1)`.

## What changed

- `native/sideload/tailscale/Tailscale.swift`: `tailscale.test` takes `{verify: true}`. With it, a TCP handshake
  that worked, a pairing kept and Tailscale as the install route (`useForInstall`), it connects once with the pairing
  through Tailscale (`IDevice.verify(tailscale: true)`, the same Session an install opens). Success adds
  `verified: true`; a failure answers `ok: false, code: "verify_failed", detail: <the shell's "code: text">,
  paired: true`. The node started by the test is reused by the Session's `beginInstall` (start() reads a running
  node) and stopped by its `endInstall`; the test's own deferred stop then finds it stopped.
  Only Test Connection passes `verify`: the after-sign-in retries (`testUntilConnected`) stay TCP-only, because
  `connectAfterSignIn` already runs `recheckPairing` (idevice.verify) after them.
- `native/sideload/idevice/IDevice.swift`: `verify(tailscale:)` pins the route (nil: as before). `isEarlyEOF` and
  `pairAgain`: in `install()`, a `connect_failed` early eof before the first connection was made (`!run.connected`)
  becomes `pair_again: this iPhone answered through <VPN>, then closed the connection: it no longer accepts
  <name>'s pairing. Pair again in Settings > Installation`, the words Check Connection uses (B258). Not folded into
  `connectFailure`: a reconnect mid-install that reads an early eof stays a drop that is tried again (B246), and
  `idevice.verify`'s error keeps its code, which the page already words (B258's `verifyFailure`).
- `web/app/core/installroute.js` `tailscaleTestResult`: `verify_failed` is "Pair Again" (`again: true`) when the
  detail is a refusal or turn-down (`verifyFailure(...).unusable`), `bad_pairing`, or a `connect_failed` early eof;
  anything else (a native timeout, say) is "Couldn't Connect … Try again". Not `verifyFailure`'s `again` alone: its
  catch-all "Pairing Didn't Work" offers Pair Again for a timeout too, which isn't proof.
- `web/app/screens/installroute.js`: `tailscaleTest` sends `{verify: true}` with a deadline of
  `TIMEOUTS.test + TIMEOUTS.verify` (Not Responding names the total). `testAlert`'s `again`: Cancel / Pair Again;
  Pair Again forgets the pairing (`idevice.forget`, as Check Connection's Pair Again does) and opens the pairing page.
- Tests: `web/app/screens/installroute-b274.test.js` (the wording for each verify detail, the `{verify: true}` call,
  Pair Again forgetting and opening Pairing, Cancel keeping it). `installroute-f301.test.js`'s Not Responding test
  sets `TIMEOUTS.verify` to 0 beside `TIMEOUTS.test`, since the deadline now adds both.

## Choices

- The install row still shows the shell's `code: text` (`Failed: pair_again: this iPhone answered …`), as every
  install error does (core/apprun.js `errorText` passes the text through); stripping the prefix is apprun's job and
  outside this task's files.
- "via" in the install's message comes from `Tailscale.useForInstall()` at the time of the failure: the Session that
  failed isn't reachable from the catch. It is the same rule the Session used a moment earlier.
