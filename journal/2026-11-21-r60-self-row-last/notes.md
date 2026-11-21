# R60: iFizBox's own row goes to iOS last (iPhone 15 Pro, after B275)

R58 checked B263's install lane on the iPhone 15 Pro but couldn't see iFizBox's own row: it failed at once with
B275's "Not an http(s) URL". B275 has landed, so this task ran R58's Re-sign All again to check the row's place in the
lane: it must go to iOS only after every other row has ended (`installLaneNext`, `web/app/core/apprun.js`), because
installing it closes iFizBox.

**Result: passes.** In Settings > Installation & Signing > Signed Apps > Re-sign All (B263 A, B263 B, B263 Big,
iFizBox), iFizBox's row was signed from its own bundle about 1 s after Confirm (B275's fix works on the phone) and then
read "Signed" for 80 s. Through that time the two tiny apps were re-signed and installed, and the 300 MB app downloaded,
was signed and copied. iFizBox was handed to iOS 0.78 s after the big app's install ended, when it was the only row not
ended. It copied, closed itself, and installd finished it 2 s after the exit. The run ended "4 re-signed" with no
failure, where R58 got "3 re-signed, 1 failed".

## Setup

- Lite built in this worktree from main b9581cf (`native/build.sh ipa`): 0.18.3 (3664); Home shows `b9581cf`.
  Installed with `tools/ui-15.sh R60 install` over the earlier rig build. The container kept its state.
- Checked first through Web Inspector (`ev.mjs`, pymobiledevice3 `webinspector cdp` on port 9368):
  `signing.status` = the team's Apple Distribution identity + the `com.ryha.*` "sidedrop adhoc" profile,
  `idevice.verify` = `{ok: true, kind: "rp"}`. Install route: This iPhone through Tailscale (RemotePairing tunnel).
- Test apps: B263's `mkapps.py` with the Tiny fixture's binary: `com.ryha.b263big` (314.6 MB IPA), `com.ryha.b263a`,
  `com.ryha.b263b` (34 KB). Served by B263's `slowserve.py` (files over 10 MB at 5 MB/s, so 60 s; each request's start
  and end logged) on 127.0.0.1:8768 behind `tailscale serve --https=8483`. Added with
  `ifizbox://add?url=https://omarchy-desktop.beetal-ling.ts.net:8483/source.json`, then Add & Trust.
- Installed all three through one Confirm (B263 Test > All Apps > each app > Install, Continue Queuing; Big first):
  "3 installed" at 04:55:03.
- R58's recipe for the run: `signed.json` pulled (13 records: other tasks' test apps, OpenTennis, iFizBox, the three
  B263 apps) and narrowed to the three B263 apps + iFizBox with R58's `narrow.py`. Then `afcclient rm` and `put`,
  because `put` doesn't truncate (checked with `cmp`). Big's kept IPA (`Library/Caches/com.ryha.b263big.ipa`) was
  deleted so the Re-sign downloads it again.
- Evidence: the run page's rows read every 1 s through Web Inspector (`poll.sh`, condensed by `condense.py` into
  `row-states.txt`). Also the app's os_log `iFizBox install:` lines and installd's "Apply Staged Update" ends from
  `pymobiledevice3 syslog live` (`phone-install-timeline.txt`), and the server's request times (`server-requests.txt`).
  Screenshots `ref/15/screens/r60-*.png` (gitignored, not committed): `r60-run1-a` shows A and B "Re-signed", Big
  "Downloading 76.8 of 300.0 MB" and iFizBox "Signed". `r60-after` shows the Home Screen after the self-close, with
  iFizBox and the B263 apps freshly installed (blue dots).
- Helpers here: `where.sh` / `tapt.sh` find an element by its exact text in the page and tap its centre (page points
  x3), so taps need no screenshot.

## The run: Signed Apps > Re-sign All

Signed Apps (sorted by expiry; all four expire together) and Confirm listed `B263 A, B263 B, B263 Big, iFizBox`.
Before the run, iFizBox's record said Version 0.18.2 (stale: 0.18.3 was installed). Confirm tapped at 04:56:03.27.

| Time | Server | Run page (poll) / phone (os_log) |
| --- | --- | --- |
| 04:56:03 | start b263big.ipa | A and B signed from their kept IPAs, Big downloading |
| 04:56:04.07 | | poll: A Installing, B Signed, Big Downloading, **iFizBox Signing 92%** |
| 04:56:04.20 | | A handed to iOS ("This iPhone: com.ryha.b263a") |
| 04:56:05.15 | | poll: **iFizBox Signed** (signed from its bundle: B275's fix holds) |
| 04:56:07.06 | | A installed; B handed to iOS 22 ms later |
| 04:56:10.38 | | B installed; Big at 33 MB (poll at 04:56:10.0). iFizBox stays "Signed", not handed over |
| 04:56:11 to 04:57:03 | | poll: A, B Re-signed; Big Downloading; iFizBox Signed (footer "Downloading B263 Big (3 of 4)") |
| 04:57:03 | end b263big.ipa (60.0 s) | |
| 04:57:04.13 | | Big signed and handed to iOS (314.6 MB) |
| 04:57:24.95 | | Big installed (installd "Apply Staged Update" end at 24.90) |
| **04:57:25.72** | | **iFizBox handed to iOS** ("This iPhone: com.ryha.ifizbox 0.18.3, 40.1 MB"), 0.78 s after Big ended. Footer "Installing iFizBox (4 of 4)" |
| 04:57:29.94 | | "self-close: IPA copied; closing in 10 s unless installd answers sooner" |
| 04:57:40.19 | | poll: Complete, "4 re-signed", "Closing iFizBox"; all four rows "Re-signed, expires Oct 28, 2027" |
| 04:57:40.24 | | "installd sent no status 10 s after the copy; closing iFizBox so installd can finish" |
| 04:57:42.33 | | "self-close: exit"; the next poll finds no page |
| 04:57:44.11 | | installd: com.ryha.ifizbox "Apply Staged Update" Success |

In every poll from 04:56:05 to 04:57:21 (73 snapshots), iFizBox's row read "Signed" while other rows were
downloading, signing, copying or installing. It moved only after Big's row read "Re-signed".

## After the run

- iFizBox reopened from the Home Screen (Home shows 0.18.3 (3664), b9581cf). `signed.json` held the four records, with
  iFizBox's record now at version 0.18.3 and a new expiry. `signing.status` still had the identity and profile, and
  `idevice.verify` was still `{ok: true, kind: "rp"}`: the self re-sign kept the Keychain items.
- iOS didn't reopen iFizBox by itself after the self-close: it stayed on the Home Screen until `ui-15.sh launch`.
  This is the self-close design ("closing iFizBox so installd can finish"), not a fault this task checks.
- The iFizBox row read "Re-signed" 4 s before installd confirmed the install (04:57:40 vs 04:57:44). That's by design:
  iFizBox's own row isn't asked about afterwards (`apprun.js`, `isSelf` returns "now"), since the app closes.

## Cleanup

- `signed.json` restored with `restore.py`: the 13 records from before the run minus the three B263 apps, with
  iFizBox's record taken from after the run (0.18.3, new expiry), since the run really re-signed it. That leaves 10
  records, the same set R58 left. `rm` then `put`, checked with `cmp`.
- The three B263 apps uninstalled (`ios uninstall`), their kept IPAs removed (afcclient). Their Installed rows were
  removed (swipe left, Remove from List: no confirm sheet this time) and the B263 Test source deleted (Sources > swipe
  > Delete). Changes shows its 9 Needs Re-sign rows again, as before.
- `tailscale serve --https=8483` turned off. The server and the Web Inspector server stopped by the pids on their
  ports (8768, 9368). The phone's UI lock released. The `syslog live` capture ends on its own 30-minute `timeout`
  (no port to find its pid by).

## Tried that went wrong

- `ev.mjs` from R58 finds the page by title "iFizBox". Right after launch the CDP list gave an empty title and URL,
  so the copy here falls back to the first page.
- The first tap on "Sources" in Sources > Manage hit the back button (same text): `tapt.sh Sources 0`. Harmless.

## Not verified

- **Big first in the run's order**: Signed Apps sorts by expiry and all four tied, so the order was A, B, Big,
  iFizBox. The brief's case (a big app still running when the tiny ones finish) held: Big was still downloading for
  53 s after B was installed. `installLaneNext` skips iFizBox's row whatever its position, and R58's run 3 already
  showed a big-first order for the other rows, so this run wasn't repeated with Big first.
- **The iOS install prompt route** (Signing Server / manifest): every install went through This iPhone, as in R58.
  The brief didn't ask for the other route.
- **Changes > Needs Re-sign > Re-sign All**: not pressed (the B263 apps were freshly signed, so not listed). Signed
  Apps > Re-sign All feeds the same run.
