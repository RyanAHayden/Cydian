# B210: Home blank below the signing card after Why > Home tab

Report (user, 2026-11-20, in the More Sources Live concept, Lite, dark): open Why iFizBox from Home, tap the Home tab;
Home shows only the header and Signing Needs Setup, nothing under it.

## Result: not reproduced, in the app or in the concept tool

I ran the exact steps (a real tap on the Why tile, then a real tap on the Home tab) in seven setups. Home drew every
row each time. The Why tile went away as F306 intends, and everything under it moved up 70 px.

| where | engine | result |
| --- | --- | --- |
| web/app served locally, sideload fake bridge, dark (`probe.mjs`) | Chromium | all rows drawn |
| concept built from this checkout, Lite, Dark Gunmetal (`probe-concept.mjs`) | Chromium | all rows drawn |
| **the artifact the user saw** (version 1795212284-9446, saved from Artifact read), Lite, Dark Gunmetal | Chromium | all rows drawn |
| the same artifact: Home scrolled 150 px first (`HOMESCROLL=150`), Why scrolled to its end (`SCROLL=1`), Home tab tapped mid-push (`WAIT=150`), the "Before (main)" build (`BEFORE=1`) | Chromium | all rows drawn |
| the same artifact sandboxed (CSP `sandbox`, opaque origin like the Artifact viewer's frame; `SANDBOX=1`) | Chromium | all rows drawn |
| the installed Lite app on the iPhone 15 Pro (0.17.1, iOS 27; the Why tile had never been opened there) | WebKit (WKWebView) | all rows drawn (`ref/15/screens/b210-1-home`, `-2-why`, `-3-after`) |
| the user's artifact in Safari on the iPhone 15 Pro (written into the tab through the web inspector, `phone-load.mjs`), Lite, Dark Gunmetal, real taps | WebKit (Safari) | all rows drawn (`ref/15/screens/b210-sf-2`, `-3`, `-4`) |

The code path itself looks safe too. `renderRoot` appends every tile in one `home.append(...)`. On the way back, the
only change is `whyRow.hidden = true` (F306, `onHash`), plus `certRow`'s re-check repainting its own tile. Nothing
removes or empties the rows under them.

## What changed

- `tools/concept/check.mjs`: a new step in every run (`homeRetap`). It taps the Home tab and notes Home's rows. Then
  it opens a page pushed on Home: Why while its tile shows, otherwise the first link in Home's list. It taps the Home
  tab again and checks that every row from before is still there, has a height, and is what `elementFromPoint` hits
  at its centre (nothing blank over it). The Why tile may go (F306).
  Checked both ways. It passes on this checkout in all three modes, and it fails on a scratch copy of web/app where
  `onHash` hides the rows under the Why tile on return (the reported symptom):
  `FAIL … draws all 12 rows again (12; covered home-row.pair, home-row.stack.browse, …)`.
  It runs in Chromium, like the rest of check.mjs. `tools/check.sh` has no DOM, so the gate doesn't run it.
- The probes are in this folder for the next try: `probe.mjs` (web/app + fake bridge), `probe-concept.mjs` (any
  built concept page, env knobs above), `probe-webkit.mjs` (Playwright WebKit; didn't start here, see below),
  `phone-eval.mjs` / `phone-load.mjs` (eval in the phone's web views and load a local page into Safari, through
  `pymobiledevice3 webinspector cdp`).

No change to `web/app/screens/home.js`: I found nothing to fix there.

## Seen on the way (not this task)

- In iPhone Safari, with the concept page written into a `data:` tab (an opaque origin), the concept's Sources tab
  showed `IDBFactory.open() called in an invalid security context`, and Home's green tile said Add a Source. The
  concept shell (`tools/concept/shell.js`) stands in for localStorage but not for IndexedDB. Whether the real
  Artifact viewer's frame refuses IndexedDB the same way is unknown. Headless Chromium on http, as check.mjs runs
  it, allows it, so check.mjs can't see this. Home itself still drew all its rows there.

## Tried and failed

- Playwright WebKit: the cached builds (`~/.cache/ms-playwright/webkit-2370`, `webkit_ubuntu20.04_x64_special-2092`)
  need libicu 74, libxml2.so.2, flite and libjxl 0.8. This Arch install has ICU 78. playwright-core 1.65.1 (scratch
  npm install) wants revision 2388. No WebKitWebDriver either. So I used the real phone.
- Serving the concept to the phone over the network: Tailscale (100.90.204.78) was unreachable from the phone
  ("Can't Open Page"), and the LAN address is blocked by the desktop's ufw (no sudo). `phone-load.mjs` writes the page
  into a Safari tab through the inspector instead (15 chunks of 400 KB).
- Port 8099 was taken by something else; I served on 8211.

## Not verified

- **The user's own viewer.** I don't know which browser or device showed the blank Home (desktop Chrome or Safari
  at claude.ai, the Claude app, iPhone Safari), or any step before Why (theme or mode switches, Restart app, a
  scroll). Asked under Needs you (CONFIRM). In every setup I could run, it doesn't happen.
- The claude.ai Artifact viewer itself: I tested the artifact's saved HTML in Chromium (plain and sandboxed) and in
  iPhone Safari, not inside claude.ai's own frame, which I can't drive from here.
- The new check in its full default matrix (two devices × two themes, with the drag checks). I ran it at
  iphone-16 × dark:gunmetal × all three modes, with `--drag-route none`.
- Side effect on the iPhone 15 Pro: opening Why there set `ifizbox.whyOpened`, so its Home no longer shows the Why
  tile. That's what normal use does (F306); I left it as is.
