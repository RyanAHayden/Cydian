# B246: This iPhone install survives a dropped connection

User report (2026-11-20, iOS 26+ phone, Tailscale route, RyukGram 383.7 MB): left the app after signing, the copy
took far too long, the page ended `This iPhone's install failed: install_failed: Socket(Kind(UnexpectedEof)) (1)`
while iOS had installed the app.

## What changed

- `native/sign/HereRecheck.swift` (pure, tested on Linux in `native/sign/tests/sideload/main.swift`): which
  idevice error codes are a dropped connection (Socket 1, SessionInactive 17, NoEstablishedConnection 19, CdTunnel
  101, RemotePairing 103, Timeout 109, plus the watchdog's `timeout`) versus installd's own errors (107, 203, 13…);
  the verdict on what installation_proxy Browse lists (installed / not yet / same as before / can't tell, by version
  and the bundle folder `Path`); where a resumed copy carries on; the copy speed split front / background.
- `IDevice.install` (native/sideload/idevice/IDevice.swift) now takes the signed app's bundle ID and version and runs
  as tries over one `HereRun`: a drop after the first connect connects again (up to 4 times, pauses 2/4/8/15 s).
  - before the copy it asks iOS what it lists for the bundle ID (`before`);
  - a drop during the copy resumes from the end of iOS's staged file (AfcRw + seek), not from zero;
  - a drop after the install was sent polls Browse every 3 s for up to 180 s and reports installed when iOS lists the
    new copy; still the old copy at the end: one more install of the staged IPA, else a clear failure;
  - real installd errors still fail at once and remove the staged IPA.
- `IDevice.Failure` keeps idevice's code (`lib`), `dropped` reads it.
- Watchdog (`watched`): the work thread runs at `.userInitiated` (a plain Thread was `.default`); a 0.5 s tick that
  took more than 5 s means the app was suspended, so the step's clock starts again instead of timing out at once on
  return.
- `IDevice.AppFront`: front/background flag readable from any thread; the AFC log lines say which, and the page's
  "Copied … to iOS in N s (X MB/s in front, Y MB/s in the background)" line gives the timings the brief asks for from
  any real install.
- KeepAlive: back in front, the silent loop plays again if it had stopped (iOS doesn't always send an interruption's
  end), so leaving the app a second time keeps the install running.

## Why the copy was slow in the background (part 2): what is known

Measured on the 15 Pro later (tables below): no slowdown there. From the code: installHere holds KeepAlive's silent
audio for the whole install, so the app should not be suspended. Candidates for the user's phone:
1. the audio loop stopped (another app took audio without mixing: Instagram plays video) and iOS suspended the app;
   the tunnel then went quiet and remotepairingd dropped it (would explain the UnexpectedEof). Fixed in part: the loop
   restarts on return, and the install now resumes / rechecks instead of failing.
2. the work thread at default QoS was demoted in the background (now `.userInitiated`).
3. Tailscale's node in the app (tsnet, Go) throttled in the background, or traffic going through DERP. Not touched.

The new log lines (`the app went to the background`, `AFC: … MB/s, in the background`, `the app was suspended for
N s`, the page's speed summary) tell these apart on the next real install.

## Checks

- `python3 -m unittest native.test_sideload`: passes, with the new B246 tests.
- `node --test` on the install-route screens and core (29 tests, the new `installroute-b246.test.js` included): pass.
- `native/build.sh` (both builds): passes; `tools/check.sh` runs in `done`.
- Phone runs on the iPhone 15 Pro: below.

## First half of the session

The iPhone 15 Pro wasn't on USB at first (`lsusb` showed no Apple device), so the code above was written and
unit-tested before any phone run, and R53 was filed for a person to check it. The user then plugged the phone in
with Tailscale set up and asked for the reproduction and part 3 in this task: see below. The current list of what
is still unchecked is under **Not verified** at the end.

## Part 3 (added mid-task by the user): the 15 Pro stuck on "No Answer" over Tailscale

The user plugged the 15 Pro in (iPhone16,1, iOS 27.0.1) with Tailscale set up. The app sat on Install Apps With with
the alert "No Answer: This iPhone didn't answer through Tailscale (read tcp 100.81.244.3:25186: connection reset by
peer)", and Pairing said Not Paired.

Phone log during a fresh Test Connection (`pymobiledevice3 syslog live -e "iFizBox|tsnet|remotepairing"`):

- the app's tsnet node came up, got the network map (17 peers) and reached the phone's own node directly
  (`disco: node [CGkiG] now using 192.168.0.194:41641`, via=direct), so Tailscale and the policy are fine;
- `probe 100.109.186.91:49152: connected`;
- remotepairingdeviced: `NetworkControlChannelService: accepted connected socket from peer`, then
  `Not configuring launchd-managed TCP control channel due to no hosts being paired` and `Rejecting TCP control
  channel connection from launchd-managed socket as launchd-managed TCP control channels are not enabled`, and
  resets it; the app logs `no RemotePairing answer: read tcp …: connection reset by peer`.

So the route works and the phone answers; it has no RemotePairing host paired at all, and the test called that "No
Answer". USB and LAN can't help here: an app can't use the phone's own USB, and plain sockets to its own Wi-Fi
address are reset by iOS (`../../native/sideload/tailscale/README.md`); the phone only serves RemotePairing over the
network once a host is paired, whichever route reaches it.

Fix: `Tailscale.test()` turns a reset after connecting into code `not_paired` (with `paired`: whether the app still
holds a pairing the phone forgot). The page (`tailscaleTestResult`) says "Not Paired Yet" / "Pair Again" with a Pair
button that opens Pairing; after a sign-in, `not_paired` ends the 30 s of retries at once (`FINAL_CODES`), and with a
kept pairing it runs the same check as `refused` (forget and pair again). Test: `web/app/screens/installroute-b246.test.js`.

After pairing (Settings > Privacy & Security > Developer Mode > Pair with iFizBox, code typed through WDA), Test
Connection said "Connected: reached this iPhone through Tailscale in 13 ms".

## Phone runs on the 15 Pro (iOS 27.0.1, Tailscale route, 2026-11-20 23:00-23:30)

Setup: the app had no certificate. The `com.ryha.*` development p12 + profile from `~/sync/default/signing/dev/`
imported through the bridge (`signing.import` via Web Inspector) signed fine, but installd refused every app signed
with it: `ApplicationVerificationFailed … 0xe8008015 (A valid provisioning profile for this executable was not
found.)` (203), for the Tiny fixture and for a real arm64 executable alike; the profile does list this phone and
its certificate matches the p12. Not looked into further (not this task). The team's distribution p12 with the
`com.ryha.*` ad hoc profile (`~/sync/default/signing/cert.p12`, `adhoc.mobileprovision`) installs fine; it is what
the app has now. Those 203 refusals were reported at once as failures, as they should be (a real installd error).

Test IPA: `com.ryha.b246test`, Lite's own arm64 executable plus 340 MB of random padding (368.6 MB signed; the copy
is 351.5 MiB), in versions 2.0-5.0 so each run is an update. Built in the scratchpad, put into the app's Documents
with `afcclient --container`, never launched. Timings from the os_log lines (`iFizBox install:`):

| Run | What I did | Copy | Install | Result |
| --- | --- | --- | --- | --- |
| 1 (2.0, new app) | stayed in the app | 351.5 MiB in 19.4 s, 18.1 MB/s in front | installd 4 s, all 24.8 s | installed |
| 2 (3.0) | Home Screen 6 s into the copy, stayed away | 20.1 s: 18.2 MB/s in front, 17.3 MB/s in the background | 4 s, all 26.9 s | installed |
| 3 (4.0) | locked the phone 6 s into the copy | 23.2 s: 17.7 MB/s in front, 14.4 MB/s locked | 5 s, all 29.8 s | installed |
| 4 (5.0) | Tailscale's VPN off in iOS Settings 7 s into the copy, on again 12 s later | dropped at 102 MB: `Socket(Kind(TimedOut)) (1)` | - | failed: see below |

So on the 15 Pro with this build, leaving the app or locking it doesn't slow the copy much (17.3 and 14.4 MB/s
against 18 in front) and nothing stalls. The user's slow install (iOS 26+, their phone) didn't reproduce here;
KeepAlive held the app every time (no "suspended" line). What differs from their run: another iOS version and phone,
a 383.7 MB RyukGram, and whatever they switched to (an app that takes the audio session would stop KeepAlive's loop;
not tried here: the 15 Pro has no sound and no Apple ID for other apps).

Run 4 found two bugs in the first reconnect version, fixed after it:
- the drop was caught ("dropped during the copy (102.0 MB of 351.5 MB) … try 1 of 4"), but the reconnect 2 s later
  went through **LocalDevVPN**: Connect With is Automatic, and with Tailscale's VPN still coming back
  `Tailscale.useForInstall()` said no. Now a reconnect keeps the first session's route (`Session(tailscale:)`), and
  says "Tailscale isn't back on yet" until it is.
- that connect failed with `connect_failed: InternalError("connect: Operation Timeout") (16)`, which isn't a drop
  code, so the install ended. Now, once it is already connecting again, a `connect_failed` is tried again too
  (`HereRecheck.shouldReconnect`), within the same 4 tries (pauses 2, 4, 8, 15 s).

With those fixes (build 90c3d03+, installed on the 15 Pro with `ui-15.sh install`):

| Run | What I did | Result |
| --- | --- | --- |
| 5 (6.0) | VPN off 6 s into the copy (at 91 MB), on again 11 s later | `Socket(Kind(TimedOut))` 19 s later; reconnected through Tailscale 2 s after that (node restart 1.5 s, tunnel 0.19 s); "carrying on from 91.0 MB of 351.5 MB"; copy 37.9 s in all (16.9 MB/s in front, 17.1 in the background); installd took the resumed file; **installed** |
| 6 (4.0 over 6.0) | VPN off the moment the log said installd started (copy 19.9 s: 17.9 / 16.1 MB/s); my tap to turn it on again didn't take | nothing came back from installd, so the drop showed only at the 180 s installd limit (TIMEOUT, then `BrokenPipe`); the reconnects said "Tailscale isn't back on yet" 4 times (2, 4, 8, 15 s) and the install failed (the right end with the route gone for good). iOS had installed 4.0 anyway: run 7's `before` lists it |
| 7 (2.0 over 4.0, the user's case) | VPN off the moment installd started (copy 20.2 s: 17.8 / 15.4 MB/s), on again 16 s later (checked by the switch's pixel) | TIMEOUT at the 180 s installd limit, reconnected through Tailscale 2 s later, "iOS lists com.ryha.b246test: 2.0 (2.0) in F3872F13… -> installed" (bundle folder changed from 033D9A67…), staged IPA removed; **installed** |

Two runs in between didn't test anything: with iOS Settings in front from 3 s after Confirm (the IPA not signed yet) the
run waited for the app to come back, and then went the Signing Server way because one of my VPN taps had left
Tailscale's VPN off (I cancelled iOS's install prompt both times). Filed: B252 (hold KeepAlive from Confirm on) and
B251 (notice a drop during installd sooner than its 180 s limit).

Run 6 also showed the log's "try 5 of 4" (counted before the give-up check) and that the failure didn't say iOS may
have installed it anyway: both fixed before run 7 ("… iOS may still have installed it: look on the Home Screen").

Phone left as: paired with the app (RemotePairing), Tailscale's VPN on, the app holding the team's ad hoc signing
identity (it had none before; useful for later Lite tests), B246 Test uninstalled and its IPAs and signed copies
deleted from the app's container. Screenshots: `ref/15/screens/b246-*.png` (main checkout's ref/, not committed).

## Not verified

- **The user's own slowdown** (iOS 26+, their phone, RyukGram): not reproduced. On the 15 Pro (iOS 27.0.1) the copy
  ran at 15-17 MB/s in the background or locked against 18 in front, with no suspension. Not tried: switching to an
  app that takes the audio session (KeepAlive's loop would stop; the 15 Pro has no Apple ID for such apps and no
  sound), a slower or DERP-relayed Tailscale path (here it was direct over the LAN), iOS 26. R53 asks a person to
  repeat it on their phone with this build; its log and page lines now give front/background speeds and drops.
- **A drop during installd is only noticed after the 180 s installd limit** (run 7): it ends right, but slowly.
  Filed B251.
- **Leaving the app before the copy starts** (signing, route choice) pauses the run until it is back: filed B252.
- **Resume of a copy that dropped mid-chunk**: run 5 dropped between chunks as far as the log shows; a chunk cut
  part-way is handled by `resumeAt` (tested on Linux only).
- **Same-version reinstall after a drop** (the `sameAsBefore` / bundle-folder rule): every phone run changed
  version; Browse does return `Path`, and each install got a new bundle folder (runs 6-7), which is what the rule
  relies on.
- **LocalDevVPN route**: not installed on the 15 Pro; only the Tailscale route was run.

## Spec review (fresh subagent, diff + brief only) and what changed after it

- Fixed: `cannotTell` (this version listed, nothing to tell it from the earlier copy) counted as installed on the first
  poll; now only once it has held for 30 s (`HereRecheck.settle`), or at the deadline.
- Fixed: the version match took CFBundleVersion or CFBundleShortVersionString, so an old build number equal to the
  new short version read as installed; now it uses the same order as the signer (short version, else build number).
- Fixed: the 180 s asking window restarted on every reconnect; now one deadline per install (`HereRun.askUntil`).
- Fixed: a drop with no version to compare left the install to throw at once; such an install now fails as before
  instead of pretending to ask (installHere always passes both).
- Reverted (not asked): sending the install again when iOS still lists the earlier copy at the deadline; it now fails
  saying iOS may still be installing it. The speed figures on the progress page: back to "Copied N MB to iOS"; the
  speeds stay in the log. The README's example numbers are now the measured ones.
- Answered: "no run left the app during the install": in runs 6 and 7 iOS Settings was in front from before installd
  started ("the app went to the background" at 23:41:50, installd from 23:41:53), so the app was in the background
  for the whole install and the drop. The background slowdown's cause on the user's phone stays open (R53).
- Phone runs above used the build before these review fixes; the fixes are covered by the Linux tests and
  `native/build.sh`, not re-run on the 15 Pro (each after-install drop run takes ~4 minutes of the phone).
