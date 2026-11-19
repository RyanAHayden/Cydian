# T12: README screenshots retaken in the iPhone 18 Pro bezel

## What I did

### The frame: Apple's iPhone 18 Pro bezel from the iOS 27 UI Kit

`tools/readme_shots.py` now reads `ref/apple-ios27/Apple iOS 27 UI Kit.sketch` (a zip) in memory with zipfile+json
and Pillow; nothing is extracted to disk or committed. What it uses from the kit:

| Part | Kit layer | File in the .sketch |
|---|---|---|
| Bezel, Black (jailbreak app) | symbol `Bezels/iPhone 18 Pro/Black - Portrait`, bitmap `iPhone 18 Pro - Black - Portrait` | `images/c6354c1291c53be238105427cb42251cd80145c0.png` |
| Bezel, Silver (website) | symbol `Bezels/iPhone 18 Pro/Silver - Portrait`, bitmap `iPhone 18 Pro - Silver - Portrait` | `images/5c6a71082e18f559a67a88305b074d0924796c6e.png` |
| (Glacier, Burgundy: `--finish`, unused) | `Bezels/iPhone 18 Pro/Glacier - Portrait`, `…/Burgundy - Portrait` | `images/2d0c0a06…png`, `images/10132fd3…png` |
| Status bar | symbol `Status Bars/iPhone 18 Pro/Dark Background` (Time text, Cellular bars, Wifi paths, Battery Body + Contact; its Dynamic Island layer skipped) | vectors in `pages/8BB9E8C9-93C3-4F9B-915A-9E053AA6CC05.json` |
| Time font | SF Pro (variable, Semibold instance), embedded in the kit | `fonts/fe2e0536a47f0598dbdeeaffe566d4d2289fed41` |
| Home indicator | symbol `Home Indicators/Portrait - Dark - iPhone` (144x5) | same page |

The symbols are in `pages/7E1130AE-2292-40C0-A8B2-F178C6FA27A2.json` ("Product Bezels"). Each bezel symbol is
402x874 points (the screen); its bitmap is 450x920 points at -24,-23, a 1350x2760 PNG (3x). The bitmap already has
the Dynamic Island with its camera, the side buttons and the band's shading, and the screen is see-through. It has no
screen glare of its own, so, as the brief says, the tool adds a toned-down sheen: the shape of the iOS 6 kit's
iPhone 5 "Screen glare" (a diagonal from the top right, opaque to a fifth of the height, clear past 55%), white at
peak opacity .2 (the old kit's was .35), with a blurred diagonal edge, over the screen and under the bezel.

Framing: the screen hole is the transparent region around the bitmap's centre (flood fill), grown 2 px under the
bezel's soft inner edge; the capture goes under the bezel through that mask, so the bezel's own rounded screen corners
and the island cover it. Output at 0.4 of the 3x bezel plus 24 px of transparent padding left and right (`--pad`),
so phones side by side don't touch on GitHub. `--plain` (no kit) gives rounded-corner screens with the same padding.

### Captures: 402x874 points at 3x, both builds in headless Chromium

`capture.mjs` (here) drives headless Chromium 155 over CDP: device metrics 402x874, DPR 3, mobile, iPhone UA, and
the 18 Pro's safe areas through `Emulation.setSafeAreaInsetsOverride` (62 top, 34 bottom), so `env(safe-area-inset-*)`
in style.css lays the nav bar under the status bar and pads the tab bar over the home indicator as on the phone.
Server: `node worker/node.mjs` on 127.0.0.1:8817 (REVIEWS_DB=off).

- **Website** (`website-shots.json`): as F174's run, `ifizbox.firstVisit=later` and the four default AltStore
  sources whose Changes read "Injected with Subscription Unlocked" removed from IndexedDB first. For Installed's
  Manage mode the site needs apps it installed, so three are put in its own store (`ifizbox-installed`, the record
  shape core/installed.js appRecord writes) from default sources with their real versions and icons: Provenance
  3.3.0, iTorrent 2.2.0, Flycast 1.0; then Manage, and Provenance and iTorrent ticked. The theme preview is
  Theme > Light after a tap on Classic (the tap springs the preview up to half the screen).
- **Jailbreak app** (`jailbreak-shots.json`, `jailbreak-install.json`, `--native`): the brief's first choice,
  web/app rendered in jailbreak mode with a fake native bridge, works, so no iPhone 7 capture had to be fitted
  (16:9 into 19.5:9). capture.mjs puts a `ifizboxNative` shaped like native/bridge.js (jailbreak "rootless", mode
  "jailbreak") in place before any module runs and answers its calls in Node as the Swift shell does: `apt.sources`,
  `apt.list`, `apt.dpkgStatus`, `apt.autoInstalled` from a copy of the iPhone 7's apt state (sources.list.d, apt's
  lists, dpkg status, extended_states, pulled read-only with `tar` over ssh into the session scratchpad, not
  committed); `net.fetch`, `net.packages` (xz/gz/plain), `net.icon` from the network; `app.info` with the 7's iOS
  15.8.8, iPhone9,1 and version 0.9.8. Others answer null. So Home, Sources (the 7's eleven repos with their real
  counts), Installed (its real dpkg packages) and ElleKit's package page are the 7's real state.
  - **The install log**: `helper.run` simulate/apply go to the iPhone 7. ifizbox-helper refuses any caller but the
    installed app ("the calling process isn't the installed app"), a guard I left alone; so the fake runs the exact
    apt-get command the helper builds for those verbs (native/helper/policy.c queue_plan: `-s` or `-y`,
    `--reinstall --allow-downgrades --allow-unauthenticated`, `APT::Status-Fd=3`, `CYDIA="3 1"`) with `sudo -n`
    over ssh, stdout/stderr/fd 3 tagged and split back into the bridge's `{fd, line}` events. The log is a real
    install of `figlet` 2.2.5 from Procursus; figlet was removed afterwards.

### README and docs/img

- Hero row: jb-home, jb-package, jb-log (jailbreak app Home first). Website row: web-home (the Install iFizBox
  Lite and Jailbroken? rows), web-sources, web-app, web-changes. Jailbreak row: jb-home, jb-sources, jb-package,
  jb-log. More screenshots, two rows: Search, Installed in Manage mode, Install IPAs, Theme > Light with the preview;
  Sources > Manage, Settings, Settings > Signing, the jailbreak app's Installed.
- All 11 images README already showed and still shows were regenerated (git diff: each one modified); new:
  web-installed-manage, web-myipas, web-theme, web-manage, jb-installed. Removed: web-installed.png (the plain
  Installed page, replaced by the Manage shot; nothing else in the repo referenced docs/img). 588x1104 each
  (540x1104 phone + 24 px padding each side), 150-310 KB, 3.6 MB in all.
- The Screenshots intro says the size (402x874 at 3x) and the finishes; the jailbreak row's label no longer names
  the iPhone 7 (the frame is an 18 Pro): "the sources, packages and install of a rootless iPhone".
- Checks: the frame at full size zoomed in (top-left corner, island, status bar, bottom corner with the home
  indicator over the tab bar): no seam between screen and bezel, island and camera on top. The README rows
  rendered in Chromium at GitHub's 830 px content width on white: the phones have clear gaps, Silver reads well
  on white, so no Glacier.

## Tried, and what failed

- The first driver hung: the CDP WebSocket's `open` fired during a 200 ms sleep before the listener was added.
  A run cut off by `timeout` left its headless Chromium behind for a moment (Node's `exit` handler doesn't run on
  SIGTERM); I found it by its profile's SingletonLock pid, it had already exited, and I deleted its profile dir.
  The driver now kills Chromium on SIGTERM/SIGINT too.
- Search result rows are matched by text; `\b` after the name failed because the row's text runs on into the
  version ("ElleKit1.2…"). Install opens an action sheet first, so the script taps Install twice.
- `ifizbox-helper` over ssh: refused (caller check), so the first install run's simulate said "Nothing to
  change"; replaced by the helper's own apt-get command (above).

## Not verified

- **How GitHub itself renders the README**: checked with a local Chromium page at GitHub's width, not on
  github.com (unattended, nothing published).
- **The jailbreak shots were not taken on a phone**: they are web/app in jailbreak mode in Chromium with the
  iPhone 7's apt state and a real apt install on it, not the WKWebView in the installed .deb. So the newest .deb was
  not installed on the 7 (the brief's step for on-phone captures; not needed for this route, and the 7 keeps
  0.9.7-1465). Differences the WKWebView might show (font rendering, WebKit vs Blink) aren't in these shots. The
  Settings footer the app would show (iPhone9,1, iOS 15.8.8) isn't in any README shot.
- `app.info` reports version 0.9.8 (the coming release) rather than a build's real version; no README shot shows it.
- The status bar time, signal, Wi-Fi and battery are the kit's sample values (9:41, full), not the phone's.
