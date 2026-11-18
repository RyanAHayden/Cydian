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

## Checks

- `node --test web/app`: 908 tests passed before the new HUD-adapter tests were added. New: `core/progress.test.js`
  (classification, hudLine, auto-scroll, packageKind, finish choice from finish: lines and kinds) and
  `nav/progress.test.js` (progressHUD). `native/helper` tests: 56 passed, including the new `uicache` plan.
  `tools/check.sh` passed (rc 0, native .deb and IPA built).
- iPhone 7 (jailbreak build 0.4.0-881 from this branch, installed over 0.4.0-891 with `--allow-downgrades`):
  - Installed `sl` (Procursus, Section Utilities) through the queue: `iphone7-install-complete.png`. The steps are
    in bold and dpkg's output in monospace, the page auto-scrolled to the end, and the button is Return to Cydian
    (not a tweak, not an app).
  - Removed `sl` the same way: `iphone7-remove-complete.png`. `sl` is no longer installed on the phone.
- `ssh 7 sudo uicache -a` (the command the new verb plans): exit 0, 0.2 s. Called over ssh, the helper itself refuses
  with "the calling process isn't Cydian" (exit 77), as its caller check should.
- Desktop renders (headless Chromium, 375x667 at 3x, same CSS):
  - `render-running-tweak.png`: Running, with a warning and an error badge.
  - `render-complete-restart.png`: the tweak case, Restart SpringBoard.
  - `render-sideload-failed.png`: a HUD-style install that failed.
  - I zoomed into the button at 3x against the sampled art: the top edge, the step at the middle, the bottom edge and
    the line under it are all there.

## Not verified

- **The "Running" state on the phone**: `sl` is 6 kB, so the run ended before a screenshot (about 1.5 s after
  Confirm) could catch it. The desktop render shows that state.
- **Restart SpringBoard, Reload Data and Reboot Device on the phone**: I didn't install a tweak or an app, and didn't
  respring or reboot the shared test phone. The choice of button is covered by the node tests. The actions call the
  helper's respring (unchanged), the new uicache verb (its plan is tested, and the command ran by hand) and the
  existing userspace-reboot verb.
- **The app's own call to the uicache verb**: the helper only answers Cydian, and no app install ran on the phone
  (installing a test IPA there would replace Cydian itself: the fixtures are Cydian IPAs).
- **The jailbreak IPA install page and the sideload/website HUD flows on a device**: they use the same page and the
  same code as the verified queue run. The adapter is covered by `nav/progress.test.js`. Not run on the sideload
  build or in Safari.
- **Auto-scroll under a real finger** (stopping while the user scrolls up, the New Output pill): covered by the
  `createFollow` tests, but not driven on the phone. Scrolling a 2-screen log with phonectl while lines are still
  coming in wasn't possible with a run this short.
- **Headless Chromium quirk**: in one of the two HUD renders the sheet's slide-in animation sat at currentTime 0, so
  that shot is the page off-screen. I read this as headless virtual time not ticking Web Animations, because the
  other render of the same page was fine. On the phone the page slid in normally.
- The phone was left on this branch's 0.4.0-881 (it had 0.4.0-891 from another task). The next task that tests on
  it installs its own build.

## Follow-up

- F155 (low): an Open button for sideload/website installs (a shell call to launch an app by bundle ID).
