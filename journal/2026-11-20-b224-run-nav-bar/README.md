# B224: the install run's nav bar as Cydia's on the 4S

## What the 4S shows

Reinstalled `bzip2` (1.0.5-8 over 1.0.5-8, same version: harmless) in Cydia on the 4S through `tools/ui-4s.sh`
under its lock. Shots in `ref/4s/screens/b224-*.png` (not committed; device screenshots go in `ref/`):

- Confirm: Cancel (left, plain), "Confirm" title, blue Confirm (right).
- The running screen could not be shot: Activator refuses screenshots while Cydia installs ("It is potentially
  dangerous to perform actions while Cydia is installing software." alert), and the 4S has no other screenshot
  tool. What it shows during the run comes from docs/cydia.md (Cydia's `ProgressController`): title "Running",
  black page and black nav bar, no back button, a plain "Cancel" at the top left only while the step can be
  cancelled.
- Complete (`b224-complete-clean.png`): black nav bar, white "Complete" title, **no buttons** at either side, the
  log, and the big "Return to Cydia" button.

No segmented control and nothing red anywhere in Cydia's nav bar.

## What changed

- `nav/progress.js` `page.segmented`: the control no longer replaces the title. It sits on a 44 pt black band just
  under the nav bar (`.progress-seg-band`, layout in progress.css), so the nav bar keeps "Running" / "Complete".
  Both runs (queue run, IPA app run) use it, so both get the fix from one place.
- `screens/queuerun.js`: Cancel is the plain black-bar button, at the top left (Cydia's place); Hide moved to the
  top right. A clean end has no bar buttons (was a blue Done), as the 4S's Complete: the finish button closes it.
- `screens/apprun.js`: Cancel plain, at the top left; a clean end has no bar buttons (was a blue Done).
- Tests: queuerun.test.js (running bar: plain Cancel left, Hide right; nothing at a clean end), apprun.test.js and
  apprun-b170.test.js (same; Cancel now found at the left), queue-confirm.test.js (only Confirm's Cancel is red now;
  the old rule said the runs' Cancel was red too, from F234: the user's B224 report overrides it).

Decisions (no one to ask):

- Kept Packages | Log (Apps | Log) switching: it's the F234 feature (a list and a log). It moved off the nav bar to
  the band under it rather than being dropped. Cydia has no such control; this is the smallest place it fits
  without touching the nav bar the user asked to match.
- Kept Hide, Retry All and Close-after-failures: features Cydia doesn't have, but the brief only objects to the
  segmented control and the red Cancel. A first pass put a plain Close at a clean end (docs/cydia.md says Close);
  the spec review pointed out the 4S's Complete has none, so it's gone: the device wins over the doc.
- The task's file list named ios6.css; nothing there needed changing: the bar buttons already draw the 4S's black
  style on the `.console` nav bar. The band's layout went in progress.css (C45: layout outside ios6.css).

## Screenshots

- `complete-4s-vs-ours.png`: the 4S's Complete (left) beside ours (right), both a one-package bzip2 run on the Log.
- `running-ours-packages-log.png`: ours while running, Packages and Log.
- `running-nav-3x.png`: the running nav bar and band, 3x render (checked zoomed in: button edges, title, the
  segmented control's dividers are clean).

Ours were rendered in headless Chromium (320×480, scale 3) from a scratch page that runs `runQueue` over a fake
backend, with the app's stylesheets.

## Checks

- `node --test web/app/screens/queuerun.test.js web/app/screens/apprun.test.js web/app/screens/queue-confirm.test.js web/app/nav/*.test.js`: 215 pass.
- `tools/check.sh` via `run done`.

## Not verified

- Cydia's running screen itself on the 4S: Activator blocks screenshots during an install (see above); taken from
  docs/cydia.md instead.
- The IPA app run (screens/apprun.js) was not rendered separately: it uses the same `page.segmented` and bar
  buttons as the queue run shot here; its unit test covers the buttons.
- Not tried on a real phone (iPhone 7 / 15): the task asked for the 4S comparison and the 3x render only.
