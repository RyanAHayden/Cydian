# R58: B263 on the iPhone 15 Pro (a downloading app holds nobody)

B263 changed the IPA queue's install lane (`installLaneNext`, `web/app/core/apprun.js`) and moved signing off
`SignBridge.queue` (`SignAhead.signer`). Its phone check never ran (the phone was held by R55). This task ran it.

**Result: B263 passes for installs and re-signs.** In every run each tiny app went to iOS as soon as it was signed and
the lane was free, while the 300 MB app was still downloading. The lane hands iOS one app at a time (by design), so
the second tiny app, signed in the same second as the first, waited only for the first one's ~3 s install (handed over
12-30 ms after it ended). Both were installed about 54 s before the big download ended. The big app went to iOS within
about 1 s of its download ending: the server logs whole seconds, so the gap is 0-2 s, and the phone's log shows
download end, signing and hand-over back to back.
iFizBox's own row could not be checked: it fails at once with B275's "Not an http(s) URL" (open bug), so it never
reached the install lane. Filed R60 to check it after B275.

## Setup

- Lite built from main 7d00351 on Linux (`native/build.sh ipa`): 0.18.3 (3590), Settings shows `7d00351`. Installed
  with `tools/ui-15.sh R58 install` (rig signer) over the earlier rig build; the container kept its state.
- Before any test, through Web Inspector (`ev.mjs`, pymobiledevice3 `webinspector cdp`): `idevice.verify` =
  `{ok: true, kind: "rp"}`, `signing.status`: the team's Apple Distribution identity + `com.ryha.*` ad hoc profile.
  Install route: This iPhone through Tailscale (RemotePairing tunnel).
- Test apps from B263's `mkapps.py`: `com.ryha.b263big` (314.6 MB IPA), `com.ryha.b263a`, `com.ryha.b263b` (34 KB).
  Served by B263's `slowserve.py` (files over 10 MB at 5 MB/s, so the big one takes 60 s; every request's start and end
  logged) on 127.0.0.1:8758 behind `tailscale serve --https=8473`; added with
  `ifizbox://add?url=https://omarchy-desktop.beetal-ling.ts.net:8473/source.json`, Add & Trust.
- Evidence: the run page's Log (read as page text through Web Inspector, saved here as `run*-log.txt`), the
  server's request times (`server-requests.txt`), the app's os_log `iFizBox install:` lines from
  `pymobiledevice3 syslog live` (`phone-install-timeline.txt`), and screenshots of the run page every 2-3 s. The Log has
  no timestamps; its order plus the timestamped os_log lines date the hand-overs. For run 2 the run page's rows were
  also read every 2 s through Web Inspector (`poll.sh`, condensed by `condense.py` into `run2-row-states.txt`). The
  screenshots went to `ref/15/screens/r58-*.png` (gitignored, not committed); what they show is written below.

## Run 1: Install all 3 through Confirm, big one first

B263 Test > All Apps > B263 Big > Install > Install, Continue Queuing, then B263 A, then B263 B. Confirm listed
`B263 Big, B263 A, B263 B`. Confirm tapped at 03:39:31.

| Time | Server | Phone (os_log / Log) |
| --- | --- | --- |
| 03:39:32 | start+end b263a.ipa, start b263big.ipa, start+end b263b.ipa | A downloaded and signed, then B downloaded and signed (two sign-ahead slots: Big + A, then B once A was signed; the Log lists A's and B's signing before A's copy, and the first screenshot at 03:39:34 shows B "Signed" while A copies) |
| 03:39:33.1 | | A handed to iOS ("This iPhone: com.ryha.b263a"); Big at 9 MB of 300 |
| 03:39:35.9 | | A installed (2.8 s); B handed to iOS at once |
| 03:39:38.7 | | B installed (2.8 s); Big at ~31 MB, still downloading |
| 03:40:32 | end b263big.ipa (60.0 s) | Big downloaded, signed (~0.9 s) and handed to iOS at 03:40:32.97 |
| 03:40:53.7 | | Big installed: 300 MB copied in 16.3 s (18.4 MB/s), installd ~3 s |

Run page: "3 installed". Before B263 the lane took the first row not ended (Big, downloading) and held A and B for the
whole minute; here A and B were installed 54 s before the big download ended. The row screenshots show Big
"Downloading 9.2 of 300.0 MB" beside A "Copying to iPhone" and B "Signed", then A and B "Installed" while Big reads
33 MB and 69 MB.

## Run 2: Settings > Installation & Signing > Signed Apps > Re-sign All

Re-sign signs from the IPA kept at install, so the big app wouldn't download at all. To get the brief's case (a big
app still downloading) I deleted Big's kept copy (`Library/Caches/com.ryha.b263big.ipa`, afcclient) first; Re-sign then
downloads it again ("The kept IPA is gone ... downloading it again").

Signed Apps on this phone held 13 records, including other projects' apps (OpenTennis) and other tasks' test apps.
Re-sign All would have reinstalled all of them, possibly downgrading another project's app. So for the run I narrowed
`Library/Application Support/Signing/signed.json` to the three B263 apps + iFizBox (`narrow.py`) and put the original
back afterwards without the B263 records (`restore.py`). Changes > Needs Re-sign wasn't used: the B263 apps were
freshly signed, so they weren't in it (it listed the 9 older test apps).

Signed Apps sorts by expiry, not by the file's order (`narrow.py` put Big first, which made no difference); all four
expire together, so the list and Confirm showed `B263 A, B263 B, B263 Big, iFizBox`.
Confirm at 03:45:05.

| Time | Server | Phone |
| --- | --- | --- |
| 03:45:06 | start b263big.ipa | A and B signed from their kept IPAs (no download); Big downloading |
| 03:45:06 | | iFizBox: "Not an http(s) URL", row Failed (B275), right after B was signed |
| 03:45:06.3 | | row poll: A Installing, B Signed, Big Downloading, iFizBox Failed |
| 03:45:06.8 | | A handed to iOS; installed 03:45:09.7 |
| 03:45:09.8 | | B handed to iOS (16 ms after A ended); installed 03:45:12.7 (row poll: Big at 33 MB) |
| 03:46:06 | end b263big.ipa (60.0 s) | Big signed and handed to iOS at 03:46:06.7; installed 03:46:27.8 |

Run page: "3 re-signed, 1 failed", with Retry All. Here A and B were ahead of Big in the run's order, so this run
alone can't show the old hold; run 3 does.

## Run 3: Re-sign with the big one first

Big's kept copy deleted again, then Modify > Re-sign on B263 Big, Continue Queuing, B263 A, B263 B. The failed
iFizBox row from run 2 was still queued (by design: "failed and cancelled apps stay queued", `screens/apprun.js`), so
Confirm listed `iFizBox, B263 Big, B263 A, B263 B` (queue order); the run page then drew the rows as `B263 Big, B263 A,
B263 B, iFizBox` (screenshots r58-run3-1..4): the run puts iFizBox's own row last in its order, Confirm doesn't.
Confirm at 03:49:12.

| Time | Server | Phone |
| --- | --- | --- |
| 03:49:13 | start b263big.ipa | A and B signed from kept IPAs; iFizBox failed at once (B275) |
| 03:49:13.9 | | A handed to iOS; installed 03:49:16.7 |
| 03:49:16.7 | | B handed to iOS; installed 03:49:20.0 (Big at ~31 MB) |
| 03:50:13 | end b263big.ipa (60.0 s) | Big signed, handed to iOS 03:50:13.7, installed 03:50:34.7 |

Run page: "3 re-signed, 1 failed". So with Big first in the order and still downloading, the signed apps behind it
went to iOS at once: the B263 lane fix holds for Re-sign too.

## The shell side (SignAhead.signer)

Signing a tiny app never waited on another signing or on `signing.open`: in every run A was handed to iOS 1.8-2.1 s
after the Confirm tap (03:39:31 → 33.1, 03:45:05 → 06.8, 03:49:12 → 13.9; this includes the tap's own latency
through WDA, the download and the signing), and B 12-30 ms after A's install ended. Big's signing (314.6 MB, kept copy
written) sits between the server's whole-second download end and the phone's hand-over 0.7-0.97 s into the next
logged second, so it took at most about 2 s. Signing two big apps at once (where the serial
signer queue would show) wasn't part of this check.

## Cleanup

- The three B263 apps uninstalled (`ios uninstall`), their kept IPAs removed, their Installed rows removed (swipe,
  Remove from List), the B263 Test source deleted (Sources > Manage > Sources), the leftover iFizBox Re-sign row
  cleared (Queue > Cancel). `signed.json` is the original 10 records (13 minus the three B263 ones). Changes shows its
  9 Needs Re-sign rows again, as before.
- The server, `tailscale serve --https=8473` and the syslog / Web Inspector processes stopped; the phone's UI lock
  released.

## Tried that went wrong

- `afcclient ... -- put -f src dst` over an existing file does not truncate it: the shorter new `signed.json` left
  the old tail behind (invalid JSON). Fixed within seconds with `rm` then `put` (checked with `cmp`). The app didn't
  touch the records in that window: Signed Apps showed the 4 narrowed records, and the restored file read back
  byte-identical.
- `afcclient put` without `-f` refuses an existing file; with `-f` it must come after `--`.
- A tap on "Remove from List" in Installed opens a confirm sheet; my first loop of taps toggled it and removed
  nothing. One tap on the row's button, then one on the sheet's button, works.

## Spec review

A fresh subagent read only the diff and the brief. Fixed: "within 1-2 s of being signed" (B waits for A's ~3 s
install, one app with iOS at a time), "about 1 s after the run started" (1.8-2.1 s after the tap), "under a second"
for Big (the server logs whole seconds: 0-2 s), the Confirm vs run-page order in run 3 explained, `narrow.py`'s order
explained, and the missing timestamped row evidence added (`run2-row-states.txt`; screenshots are in gitignored
`ref/`). Kept, with reasons above: the extra run 3, and the phone-side edits (narrowed `signed.json`, deleted kept
IPAs), all put back afterwards.

## Not verified

- **iFizBox's own row going to iOS last**: it fails at once in both Re-sign runs with "Not an http(s) URL" (B275, open:
  sign-ahead's `signing.prepare` doesn't know iFizBox's own `self:bundle` record), so it never reached the install
  lane. Noted on B275; filed **R60** (after B275) to check it then.
- **Changes > Needs Re-sign > Re-sign All**: not used, as the B263 apps were freshly signed and not in it (the list
  held 9 other apps, including another project's). Signed Apps > Re-sign All queues the same `resignJob` rows into
  the same run, so the lane is the same; the Needs Re-sign button itself wasn't pressed.
- **Two big apps signing at once** (the serial `SignAhead.signer` making the second wait): not in the brief's setup
  (one big app); B263's notes put that wait at a few seconds.
- **iOS's install prompt path** (the manifest/Signing Server route): every install went through This iPhone (Tailscale
  pairing), which needs no prompt; the brief didn't ask for the other route.
