# F80: Sideload Confirm and queue, like Cydia's

## What I did

- `web/app/core/appqueue.js` (new, pure): the app queue for the sideload app and the website (no apt there).
  `createAppQueue()` (one job per app, mode from core/queue.js `modeOf`), `appJob(pkg, {installed, version})` (a
  catalog app as a job: its IPA, size, icon and the fields the Installed record needs; none for a source-signed
  itms-services link), `appPlan(jobs)` (parseSimulation's shape, so Confirm reuses the jailbreak sheet's own
  Statistics and Modifications groups; a job's `deps` show under Install ahead of it, for tweaks later),
  `runOrder` (Cydian last), `appNavLabel` (Modify while queued) and `modifyActions` (Clear first, as Cydia).
- `web/app/app-queue.js` (new): the shared store, beside queue.js (the apt queue).
- `screens/queue.js`: `queueApp`, `openAppConfirm` (Cancel top left clears the queue, Confirm top right; Statistics
  total download, Modifications, Queue with each app's size, mode and version, tap to Clear, Continue Queuing) and
  `runAppQueue` (each app in turn, out of the queue once iOS has it, recorded in Installed; the first failure stops
  the run and keeps the rest queued). Sideload: `installOnDevice` (no look-first sheet: Confirm is the confirmation,
  and F81 makes Install one-tap anyway), Cydian's own IPA through `signAndInstall` (hosted on the Signing Server);
  website: `signAndInstall`. The sideload app's first-install walkthrough (`firstInstallCheck`) runs once before.
- `screens/altstore.js`: `appPageAction(pkg, source)`, what the app page's nav button and its "Signed with your
  certificate" Install row do outside the jailbreak build: queue and open Confirm; queued, the button reads Modify
  and its sheet offers Clear or the verb again. It returns false (old behaviour) in the jailbreak build, for
  itms-services links, and on the website without a saved certificate (so the old Download IPA sheet still shows).
  The nav label listens to the queue. `installRows`' unused 5th parameter is now `queue`.
- `screens/browse.js` (not on the task's file line, 3 lines): `packageActions`' app branch calls `appPageAction`
  first. The nav button's click lives there, so there was no other way in.
- `screens/changes.js`: the sideload Upgrade (N) calls `queueUpgrades` (each available upgrade with an IPA becomes a
  job, Cydian's row by its own `ipa`), replacing the `upgradeApps` loop and its test.
- Tests: `core/appqueue.test.js`, `screens/appqueue.test.js` (queueApp opens Confirm, the run's order, clearing,
  stopping, the Modify label and sheet), `screens/changes.test.js` (queueUpgrades).
- Rendered the Confirm sheet in headless Chromium at 320 px, 2x (3 apps, Cydian among them): groups, sizes and
  buttons as planned.

## Decisions (unattended, nobody to ask)

- No Cydia screenshots of Confirm/Modify were asked for or taken: the run can't ask, and getting Cydia's Confirm
  on the 4S means queuing a real package there. ref/4s/screens/cydia-package-modify.png shows Modify as the plain
  bar button, which is what the page already draws. The sheet reuses the jailbreak build's Confirm (queue.css).
- The website gets the queue from app pages; its Changes keeps no Upgrade (N) (its upgrades can be apt packages
  from an uploaded status file, which can't install from there). Only the sideload app's Changes queues.
- Version History's per-version Install still installs straight away (it picks one older version; not asked for).

## Tried and failed

- First screenshot was blank: the sheet's Web Animation slide-in doesn't advance under --virtual-time-budget;
  stubbing `Element.prototype.animate` in the scratch page fixed it. (A scratch file also landed in web/ through
  a symlinked `app/..` path; moved out before committing.)

## Not verified

- Install, Upgrade (N) and Modify on a real iPhone (sideload build): no device run here; the task asks the user to
  try them.
- Several installs in a row: each `installOnDevice` returns once iOS has the link, then the next one starts while
  iOS may still show the first "Install?" prompt. The old upgradeApps loop did the same; whether iOS queues or drops
  the second prompt is untested.
- The website's Confirm run through the Signing Server (needs a saved certificate and the server).
