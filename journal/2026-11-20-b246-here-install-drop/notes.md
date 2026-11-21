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
