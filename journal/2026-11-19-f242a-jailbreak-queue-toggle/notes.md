# F242a: jailbreak app page's + / x queue toggle

## What I did

- `web/app/screens/altstore.js`: a new section after F210's `markToggle`.
  - `queueToggleApplies(app, { mode, available })`: the jailbreak build only, with the native bridge
    (`ipaInstallAvailable`, the same check browse.js's `jbAppQueue` uses). Hidden for iFizBox's own app (bundle ID,
    `.suffix`, or a self-IPA link), as the mark toggle is. renderApp also requires `appJob(pkg)` (an IPA to install).
  - `queueToggleJob(pkg, source)`: `{ app: "install", ...appJob(pkg, { installed, source }) }` at the newest
    version, `installed` from the apps store's record. That is the job the nav button's Install / Upgrade / Reinstall
    queues and the one `jailbreakAppRowState` builds for a row (it calls the same `appJob`); the queue's `modeOf` makes
    it install / upgrade / reinstall.
  - `queueToggle(pkg, source)`: a `bar-button bar-icon queue-toggle` button. Not queued: + (aria "Add to Queue");
    a tap adds the job with `{ quiet: true }` (no Confirm sheet, as a row's swipe), a haptic and F193's undo bar
    ("Reinstall OpenTennis queued"; Undo clears it). Queued (by anything): x (`is-queued`, "Remove from Queue"); a tap
    clears it, undo bar "… cancelled", Undo re-adds the same job quietly. `refresh()` redraws from the queue.
  - renderApp puts it in with `addNavIcon(body, toggle, "queue")` where the mark toggle goes in the other builds, and
    subscribes to `appQueue`: every event refreshes it; once the button has been on screen and is gone, it unsubscribes.
- `web/app/altstore.css`: the glyphs as SVG on the mark toggle's narrow bar button: UIKit's Add (UIButtonBarPlus,
  16x17pt plus, 4pt bars, traced from the 4S's mask) and Stop (UIButtonBarStop, 17pt X, round ends, ~3.7pt stroke),
  white with the 1pt-up dark shadow. ios6.css needed no change (the bar button and `.bar-icon` already there).
- `web/app/screens/altstore-marktoggle.test.js`: 5 tests: applies per build (and exactly one of the two toggles per
  build), the job and its mode per installed record, the undo text, + / x / Undo / follows-the-queue with the quiet
  flag and haptic count, and nothing queued (no undo bar) when the app has no IPA.

## Decisions

- **Installed and up to date**: a row's swipe would queue Remove there; a + that queues a removal reads wrong, so the
  + queues a Reinstall (what the nav button's Reinstall does). Remove stays in Modify and the row swipe.
- No import of browse.js (it imports altstore.js; and the tests load altstore.js in node): I used `appJob` directly,
  which is what `jailbreakAppRowState` uses for a catalog app.

## Checks

- `node --test web/app/screens/altstore-marktoggle.test.js`: 12/12.
- 3x render (`nav.html` here, headless Chromium with the real style.css/ios6.css/altstore.css): `nav-320.png`
  (320pt @3x) and `nav-375.png` (375pt @2x): + and x beside Install / Upgrade / Modify, long titles, the mark toggle
  for comparison, and the 4S's own UIButtonBarPlus/Stop below. Zoomed in: glyphs match the kit's shape and weight, no
  light line at the button bottoms, shadow 1pt up like the label's.
- iPhone 7 under the ui-7.sh lock: its web files matched this branch's base by md5 (altstore.js, altstore.css,
  app-queue.js, undobar.js, core/appqueue.js, browse.js), so I swapped in only altstore.js and altstore.css (backups,
  restored after, md5 verified back). OpenTennis's page (installed): + left of Modify (`phone-plus.png`); tap: x, undo
  bar "Reinstall OpenTennis queued", Installed tab's Q'd badge, no Confirm sheet (`phone-queued.png`); x: + and
  "… cancelled", Undo: x again (`phone-cancel-undo.png`); Modify > Clear: the x turned back into + live. Left the queue
  empty and the app closed.

## Tried, didn't work

- My first Undo tap on the phone came after the bar's 4 s timeout (screenshot then read then tap), so it hit the page
  instead. Tapping x then Undo in one command worked.

## Not verified

- **A fresh (not installed) app's + on the phone**: OpenTennis is installed there, so the phone showed Reinstall; the
  Install and Upgrade modes are covered by the unit test only.
- **Running the queued job through Confirm** on the phone: not run, to avoid reinstalling an app on the shared phone;
  the job shape is B71a's (`appJob`, same as Modify's Install), covered by its own tests.
- **The haptic on the phone**: called in the click handler (counted in the unit test); a tick can't be seen in a
  screenshot.
