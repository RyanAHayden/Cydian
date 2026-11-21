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

Not measured (see below). From the code: installHere holds KeepAlive's silent audio for the whole install, so the app
should not be suspended. Candidates, in the order I'd check them on a phone:
1. the audio loop stopped (another app took audio without mixing: Instagram plays video) and iOS suspended the app;
   the tunnel then went quiet and remotepairingd dropped it (would explain the UnexpectedEof). Fixed in part: the loop
   restarts on return, and the install now resumes / rechecks instead of failing.
2. the work thread at default QoS was demoted in the background (now `.userInitiated`).
3. Tailscale's node in the app (tsnet, Go) throttled in the background, or traffic going through DERP. Not touched.

The new log lines (`the app went to the background`, `AFC: … MB/s, in the background`, `the app was suspended for
N s`, the page's speed summary) tell these apart on the next real install.

## Checks

- `python3 -m unittest native.test_sideload`: passes, with the new B246 test.
- `native/build.sh` (both builds) and `tools/check.sh`: see the commit (run by `done`).

## Not verified

(Superseded below: the user plugged the 15 Pro in and set Tailscale up mid-session.)

- **No phone run at all (first half of the session).** The iPhone 15 Pro was not on USB during this session (`lsusb` showed no Apple device,
  usbmuxd inactive), and even plugged in it has no route for this: on 2026-11-20 it was unpaired, with neither
  LocalDevVPN nor the Tailscale app installed (installing either needs the owner's Apple ID, and Tailscale's sign-in
  the owner's account). So none of: a big IPA leaving the app mid-copy and mid-install, front vs background copy
  speed, whether Browse returns `Path` on iOS 26/27, whether a reinstall of the same version gets a new bundle
  folder, whether installd keeps installing after our installation_proxy socket drops (the user's case says it did),
  whether `AfcRw` + seek on a PublicStaging file resumes correctly. Filed as R53 (after B246) for a person with a phone.
- The cause of the background slowdown (part 2) is not pinned down; see the list above.

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
| 6 (4.0 over 6.0) | VPN off the moment the log said installd started (copy 19.9 s: 17.9 / 16.1 MB/s); my tap to turn it on again didn't take | nothing came back from installd, so the drop showed only at the 180 s installd limit (TIMEOUT, then `BrokenPipe`); the reconnects said "Tailscale isn't back on yet" 4 times (2, 4, 8, 15 s) and the install failed, now saying "iOS may still have installed it: look on the Home Screen" |

Two runs in between didn't test anything: with iOS Settings in front from 3 s after Confirm (the IPA not signed yet) the
run waited for the app to come back, and then went the Signing Server way because one of my VPN taps had left
Tailscale's VPN off (I cancelled iOS's install prompt both times). Filed: B252 (hold KeepAlive from Confirm on) and
B251 (notice a drop during installd sooner than its 180 s limit).

Run 6 also showed the log's "try 5 of 4" (counted before the give-up check) and that the failure didn't say iOS may
have installed it anyway: both fixed.
