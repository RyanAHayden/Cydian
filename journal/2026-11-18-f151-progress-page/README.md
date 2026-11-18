# F151: install progress page with verbose log, replacing the black popups

## What the "black popups" were

- The jailbreak app's apt runs (queue, Roll Back, paid installs) and IPA installs already had a console, but as two
  copies of the same code (`screens/queue.js runConsole`, `screens/ipa-install.js openIpaInstall`). It slid up as a
  modal sheet, every line in one 12px font, the finish button a white outline. The user reads that as a black popup.
- The sideload IPA's and the website's installs (`signing-client.js` installOnDevice, installFromLibrary,
  signInBrowser, and the app queue's re-sign) used the dark rounded HUD (`nav/hud.js liveHUD`): Downloading, Signing,
  Installing, with no log at all.

## What I did

- `core/progress.js` (new, pure, tested in `core/progress.test.js`):
  - `classify({fd, line})`: one streamed line becomes a step (apt's status fd: pmstatus, dlstatus, dpkg's
    status:/processing:), raw output (dpkg/apt/scripts), an error (pmerror, `E:`, `dpkg: error`, `Errors were
    encountered`, the helper's own complaints), a warning (`W:`, `dpkg: warning`), a conffile question or a finish
    level. Built on `core/queue.js parseStatusLine`/`consoleText`, so those keep their own tests.
  - `hudLine("Downloading 45%")` gives `{ text: "Downloading", percent: 45 }`: HUD labels become one step each, and
    the percent moves the bar.
  - `createFollow()`: auto-scroll. It follows the newest line, stops when the user scrolls more than 32px above the
    bottom, never moves the page while a finger is down, and follows again once the user is back at the bottom.
  - `packageKind(stanzas)`: tweak (hooks through Substrate/ElleKit etc., or its Section is a tweak/theme one), app
    (Section Applications/Apps/Games, or a `role::app` tag) or package.
  - `chooseFinish({ ok, levels, kinds, build })`: the highest of the scripts' `finish:` words and what the kinds
    need (tweak: restart, app: uicache). A failed run, the sideload build and the website get Return only. When the
    run also installed an app but the button respings or reboots, `uicache: true` rebuilds the icon cache first.
- `core/queue.js`: a new finish level `uicache` ("Reload Data") between return and reopen. A script's
  `finish:uicache` now counts instead of showing as plain text.
- `core/catalog.js queueInfo`: each id also gets `kind` (packageKind over the same stanzas as `restart`).
- `nav/progress.js` (new): the page.
  - Black page with the black nav bar (queue.css `.console`), "Running" then "Complete".
  - Step lines in bold 13px Helvetica Neue, white. Raw output in 11px monospace (`ui-monospace`, SF Mono, Menlo),
    Cydia's grey `#a9a9a9`.
  - Errors in red with a red x badge; warnings in yellow with a triangle badge. Both badges are SVG I drew, not
    Apple art.
  - A blinking block cursor while it runs (opacity animation only).
  - All text can be selected and copied.
  - A "New Output" pill appears while the user reads further up.
  - Lines are batched to one paint per frame. Lines are trimmed from the top past 1500, but only while following.
  - At the bottom: the status line and Cydia's 158px bar, replaced at the end by the big finish button, with Close
    at the top right.
  - `progressHUD(label)` gives the page the HUD interface (`set`, `hide`, `done`, plus `fail(message)`). A job that
    starts while the page is still up (the app queue's next app) continues on the same page.
- `progress.css` (new, linked in index.html): the finish button is the 4S's `UIAlertSheetBlackButton` composited over
  black, sampled from `ref/4s/artwork/Shared@2x` at 2x:
  - normal: a `#f1f1f1` top edge, `#e3e3e3` down to `#bdbdbd` at the middle, a hard step to flat `#a5a5a5`, a `#d3d3d3`
    bottom edge, and a faint line under it;
  - pressed: `UIAlertSheetBlackButtonPressed`, blue (`#c7cde9` edge, `#818fce` to `#253eaa`, then `#001d9d` to
    `#1354cd`).
- `screens/queue.js runConsole`: rebuilt on the page and on `classify`/`chooseFinish`. The finish actions:
  - Reload Data: the helper's new `uicache` verb, then reload the installed list.
  - Restart SpringBoard / Reload SpringBoard: respring (as before).
  - Reboot Device: an alert offering a userspace reboot (`userspace-reboot`, N8's verb, which keeps the jailbreak), or
    Later.
  - When an action fails, its alert shows and the page stays up.
  - The run log now records `finish`.
- `screens/ipa-install.js`: the same page. A successful IPA ends on Reload Data (uicache) where the backend has it.
- `signing-client.js` and `screens/queue.js resignApp`: the default HUD is now `progressHUD`. Errors go on the page in
  red (`fail`) before their alert. Inspect-before-the-sheet (`signing-sheet.js` inspect*) keeps the small HUD: it
  isn't an install.
- `backend-native.js`: `uicache()` and `userspaceReboot()` over the helper.
- Helper: new verb `uicache` (`<prefix>/usr/bin/uicache -a`, no arguments): policy.h/.c, test in `test_helper.py`,
  README row.

## Tried / decided

- I kept the page as a full-screen sheet that slides up. Cydia's progress page is presented modally too.
- I put the status line, bar and button in a fixed footer below the log, not after the last line as Cydia did, so the
  button is always on screen in a long log.
- "Open" for the sideload/website installs (the brief's "just Return/Open"): the shell has no call to open an app by
  bundle ID (`app.openURL` needs a URL scheme the app may not have), so those pages end on Return to Cydian.
  Filed as a follow-up.
- App detection is a heuristic (Section, tag), because the web side never sees dpkg's file lists. A script's
  `finish:uicache` covers the rest.

## Not verified

(filled in at the end)
