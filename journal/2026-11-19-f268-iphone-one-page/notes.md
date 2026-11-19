# F268: Install on This iPhone as one automatic page

## What changed
- `installation/benefits` (bullet rows + Set Up) and the separate pair page are now one page, `installation/pair`
  (nav title "This iPhone"), drawn from `core setupState(status, pairing)`:
  - `connect`: VPN off. One iFizBox alert per visit, "Turn On LocalDevVPN" (Cancel / Open LocalDevVPN), plus a
    LocalDevVPN row (Off / Another VPN) and an Open LocalDevVPN row. Rechecks `idevice.status` every 2 s
    (`VPN_POLL`) and on visibilitychange/pageshow; once on, the page redraws and pairing starts.
  - `pairing`: starts `idevice.pair` by itself, once per visit. Shows LocalDevVPN On, the code big under "Pairing
    Code" (placeholder dashes until the first event), then "Where to Type It": 5 short lines, three with a
    screenshot of the Settings row, ringed in orange (#f5a623), then the step/error line. No Cancel: pairing keeps
    listening while the page is open and is cancelled on hashchange off the page (unchanged B109 behaviour, as is
    reading `idevice.pairState` back on foreground). If `idevice.pair` rejects (not a cancel): Couldn't Pair alert,
    then a "Try Again" row.
  - `paired`: "Paired" with a check, Check Connection, Forget Pairing. A successful pairing goes straight here (the
    old "Paired" alert is gone, since the page shows it).
  - `file` (before iOS 27): Import Pairing File, as before.
- Benefits are one sentence under the title on every state (`IPHONE_INTRO`); `BENEFITS` and `PAIR_STEPS.phone` removed.
- Settings > Installation subtitles: one point per line, wrapping (`.route-row`, `white-space: pre-line`):
  Signing Server "Default / Uses ifizbox.com" (from `DOMAIN`), This iPhone "LocalDevVPN / No server / Updates itself"
  (first line from `vpnList()`).
- Screenshots: `web/app/img/pair/*.jpg`, made by `crop.py` here from `ref/pair-shots/`: cropped to the row (the
  Privacy hand and Developer Mode hammer icons cut off, label/chevron/"On" kept), the group's black rounded corners
  filled with the row's grey so each is a plain rectangle the CSS rounds; 3x pixels kept (975/1110 px wide, ~5 KB
  each, JPEG q78). Credits > Artwork gains a "Pairing Screenshots" row naming the user (screens/home.js, outside the
  task's file list, one row added).
- docs/sideload.md and docs/settings.md describe the page.

## Decisions
- AGENTS.md now allows committing tutorial screenshots whole, icons included; the brief asks for crops to the row
  text. Followed the brief (stricter, and a row crop is what the ring marks).
- Tailscale: F264 hasn't landed, so the check and the alert title come from `VPNS` / `vpnList()` and say only
  "LocalDevVPN" for now; `vpnOn()` in core is the one place F264 adds Tailscale's status. Telling users to turn on a
  Tailscale route that doesn't exist yet would be wrong.
- The connect alert shows once per visit, not on every recheck, so it doesn't nag after Cancel; the page itself
  keeps saying what's missing.

## Checked
- `node --test` on core/screens installroute tests and install-route-wait: pass (new tests for setupState, the guide
  and its image files, setupGroups in each state, subtitles).
- 3x headless Chromium render (`shot.mjs`, fake sideload bridge) at 402 and 320 px: Installation, connect (alert),
  pairing (code + guide, `pairing-402.png`), paired. Subtitles wrap at 320 (`installation-320.png`), nothing cut.

## Not verified
- On the iPhone 15: the real flow (LocalDevVPN detection, auto-start, typing the code in Settings, coming back to
  Paired) and the 320/iPhone 15 look of the subtitles. The task leaves that to the user; agents don't drive the
  iPhone 15 (daily phone, read only).
- Dark themes: the step text and code use `--head`/`--emboss` like group headers, but no dark render was taken.
- The older-iOS pairing-file state wasn't rendered (logic unchanged, covered by the setupGroups test).
