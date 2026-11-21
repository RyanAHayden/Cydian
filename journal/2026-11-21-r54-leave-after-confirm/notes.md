# R54: Lite on the iPhone 15 Pro, leaving the app right after Confirm (B252's build)

Question: with B252's build, This iPhone route, iOS Settings in front within 3 s of Confirm, does the log go on
through the route check (`idevice.status`), signing and the copy while the app is in the background, or does the
page's route check wait for the app to come back (WebKit suspending the web content process)?

## Answer

**It goes on. The route check doesn't wait.** In the 4 runs with a working pairing (runs 2-5 below), the app was
in the background 0.9-1.3 s after the tap. The download, the signing, the page's route check, This iPhone's copy
and installd all ran with the app in the background, and iOS installed the app 35-60 s after the tap. The app never
came back to the front.

How the route check is known to have run, since `idevice.status` writes no log line of its own: on this path the
page sends `signing.open` only after `signing.prepare` has answered and `chooseRoute` has had `idevice.status`'s
answer (`signing/queue.js openPrepared`). Its result was the This iPhone route, and `installHere`'s first line
("This iPhone: com.ryha.r54test …") comes from that `signing.open`. A held route (`ROUTE_HOLD`, 60 s) can't explain
it: each run came more than 3 minutes after the last route check. So the page JS answered `prepare`, called
`idevice.status`, got the answer and sent `signing.open`, all with iOS Settings in front.

WebKit logged `WebProcess::prepareToSuspend: Process is ready to suspend` 305 times during run 2 alone (excerpt:
`run2-webkit.txt`). That never stopped the page: the content process stayed running while the app process ran.
No B filed for the route check.

**But B252's holds are not on the path Confirm takes.** In Lite, Confirm (the queue's Confirm sheet) and Installed
› Manage › Update both run the sign-ahead run (`screens/queue.js runAppQueueRun` → `signing/queue.js`
`prepareOnDevice` / `openPrepared` → native `SignAhead`: `signing.prepare`, then `signing.open`). Every run here
staged `…-ahead.ipa`. B252 put its holds on `signing.install` (`Sideload.install`) and on `installOnDevice`'s
`signing.hold`. The sign-ahead run uses neither. What holds KeepAlive on this path:

- the download (`Sideload.download`, R49): released when the file is complete;
- This iPhone's copy and installd (`installHere`), taken when `signing.open` starts.

In between, nothing holds the app: the signing inside `signing.prepare` and the page's route check before
`signing.open`. My runs got through while that gap was short: about 3 s on the A17 Pro for these IPAs, and 11-12.5 s
after leaving in runs 1-3, where the download was fast too. After a hold ended with the app idle, iOS suspended it
about 5 s later each time (after each install: 00:53:52→00:53:57, 00:57:14→00:57:19, 01:01:12→01:01:17,
01:04:54→01:04:59; `Sending stop command … because client is background suspended`, `taskState: Suspended`). Those
are idle cases. No run caught iOS suspending the app in the middle of unheld work. So it is likely, not shown, that a
signing that runs past that point in the background pauses until the app is back. B246's stalled run ("the IPA not
signed yet", waited 2.5 min, on the build before B252) may be this. Its journal says "Confirm", but its test IPAs went in
through the app's Documents (Install IPAs, the My IPAs path), so which path it took is not certain. Filed as a B (below), as a separate finding from the route check.

## Runs (iPhone 15 Pro, iOS 27.0.1, Lite 0.18.2 build 3447 = main at b0462936, Tailscale route)

Setup: built `make -C native ipa` in this worktree (checked `signing.hold` is in the bundled `web/signing/route.js`)
and installed it with `tools/ui-15.sh R54 install`. Test app `com.ryha.r54test`: Lite's arm64 executable plus random
padding, versions 1.0-5.0, never launched. It was published as a local AltStore source over `tailscale serve` (the
app's ATS refuses plain http for a source: "Verification Error … App Transport Security"). The source → app page →
Install → Confirm path is the one the brief means. Every run: tap Confirm (or Update App), then
`ui-15.sh launch com.apple.Preferences` right away. The app logged "went to the background" 0.9-1.3 s after the tap
command started. The timings come from the os_log lines (`phone-log.txt`, trimmed from `pymobiledevice3 syslog
live`: the app's `iFizBox install:` lines, SpringBoard's process state and audiomxd's stop commands).

| Run | Path | Tap → in background | Download + signing + route check done | Copy | Installed | App in front again? |
| --- | --- | --- | --- | --- | --- | --- |
| 1 (2.0) | Confirm | 00:48:57.98 → 00:48:58.9 | 00:49:09.2 (+11 s) | failed at connect: `Socket(UnexpectedEof "early eof")` | — | no (suspended 00:49:15, 5 s after the failure) |
| 2 (2.0) | Confirm | 00:53:16.57 → 00:53:17.5 | 00:53:29.1 (+12.5 s) | 311.5 MB in 18.1 s, 17.2 MB/s in the background | 00:53:52.2 (+35.6 s) | no |
| 3 (3.0) | Manage › Update | 00:56:39.59 → 00:56:40.5 | 00:56:50.7 (+11 s) | 18.4 s, 17.0 MB/s in the background | 00:57:14.4 (+34.8 s) | no |
| 4 (4.0) | Manage › Update, download throttled to 10 MB/s (~34 s) | 01:00:12.2 → 01:00:13.5 | 01:00:49.0 (+37 s; signing about 3 s after the download) | 18.4 s, 16.9 MB/s | 01:01:12.7 (+60 s) | no |
| 5 (5.0) | as 4, IPA with the app + 11 frameworks (12 Mach-O, 362 MB) | 01:04:00 → 01:04:01.3 | 01:04:39.3 (+39 s; signing about 3 s) | 137.9 MB in 8.5 s | 01:04:54.8 (+55 s) | no |

Run 1's failure was not a background problem. The rig install had left the app with a stale pairing:
Settings said "This iPhone · Paired", Test Connection (Tailscale) said Connected, yet the RSD tunnel was reset
(Check Connection then said "Turn On LocalDevVPN", the wrong advice on the Tailscale route). Fixed by Forget
Pairing, then iOS Settings › Privacy & Security › Developer Mode › Pair with iFizBox, with the code typed through
`ui-15.sh type`. Runs 2-5 came after that. Run 1 still shows the route check running in the background: the install
began 11 s after the tap while Settings was in front.

Runs 4-5 tried to make the unheld gap longer than iOS's ~5 s by making the download (which is held) outlast
iOS's grace period. Then only the signing would run unheld. It didn't show a stall, because signing took about 3 s
even with 12 Mach-O files. I couldn't make an IPA that takes this phone longer than ~5 s to sign in a reasonable
size.

## What I tried that failed

- Install IPAs › SIGN and Download from URL: both go through My IPAs (`signing/library.js`: `library.sign`, route
  check, `library.install`), not Confirm, so I left them.
- A plain-http source on the Tailscale IP: refused by ATS (above). `tailscale serve --https=8454/8455` worked
  (removed after).
- My first waits (`tail -f | head -0`) returned at once, so run 2 looked stalled at first. Re-read with real waits.

## Filed

- B (normal): the sign-ahead run (Confirm, Manage › Update in Lite) holds no KeepAlive from the download's end until
  `signing.open`: hold it in `signing.prepare` (call to answer, as B252 did in `Sideload.install`) and have the page's
  run hold `signing.hold` across prepare → route check → open.
- B (low): `core/installroute.js verifyFailure` turns every `connect_failed` into "Turn On LocalDevVPN", also on the
  Tailscale route and when the phone resets the tunnel after connecting (stale pairing → should offer Pair Again).
- Note on T66: a rig install over an earlier rig build also left the app with a pairing the phone no longer
  accepted, while Pairing still said Paired.

Phone left as: B252's build (3447) installed, re-paired (RemotePairing works over Tailscale), the team ad hoc
identity still there (Certificate 341 days). R54 Test uninstalled, its IPA removed from Documents, the test source
deleted. Screens `r54-*.png` are in the worktree's ignored `ref/15/screens/` (not committed).

## Spec review (fresh subagent, diff + brief only)

- Fixed: wrong ranges (installed 35-60 s after the tap, not 24-55; in the background 0.9-1.3 s, not "under 1 s");
  "runs 1-2" → runs 1-3. Added how the route check is known to have run (no `idevice.status` log line exists) and
  the WebKit lines (`run2-webkit.txt`). The 5 s suspension and the B246 link are now marked as likely, not shown.
- Kept: B257 and B258 are findings from this run, filed as follow-ups as the run rules ask. They are not the brief's
  "file a B if the route check waits", which didn't happen. `plan/TODO.md` was changed by `run plan add` / `plan
  note`, not by hand.

## Not verified

- **The route check as its own log line**: `idevice.status` logs nothing. That it ran is inferred from the order the
  page sends calls in (above).
- **A signing that runs longer than ~5 s after the last hold ends, with the app in the background**: not
  reproduced. The A17 Pro signed every test IPA in about 3 s. The stall is inferred: no hold in the code, plus iOS
  suspending the app about 5 s after each hold ended (4 times here). That inference is why the B is filed. Other
  ways it could show: a slower phone, a bigger app (RyukGram-class), or a fast download, then leaving during the signing.
- **`installOnDevice` / `signing.install` with `signing.hold` (B252's own path)**: not reached. Confirm and Manage ›
  Update in Lite both use the sign-ahead run. The callers left (Browse's app-page Install via `signAndInstall`,
  Settings' own-app install, Custom Install) weren't run. The route check on that path is the same page code
  (`chooseRoute`), and the page JS clearly runs in the background here.
- **iOS 26 / the user's phone**: only the 15 Pro on iOS 27.0.1 was used.
- **LocalDevVPN route**: not installed on the 15 Pro. Only Tailscale.
