# F311 Settings > Checking for Updates in iOS 6 hint style

Concept A+C (https://claude.ai/artifact/PtcZpdU7EZ4a1NZm6MmMTz), built:

- `screens/settings.js` notifyRows now returns Update Alerts, then a **Push** group (Push, Last Push; header
  "Checking for Updates"; footer from core/push.js pushRows) and a **Background Check** group with no header
  (Background Check switch, Last Check). With no Push group (push can't work here) the Background Check group takes
  the header. No joined footers any more.
- Background Check footer: Push on: "Used when Push can't reach this iPhone. iOS decides when it runs, usually every
  few hours."; Push off/absent: "iOS decides when this runs, usually every few hours."; the check turned off here:
  "Off, updates are found only while iFizBox is open (or Push brings them)."
- Background App Refresh and Notifications (iOS's) rows show in that group only when off (and the check is on), with
  Turn On in Settings in the same group; the footer says what's off ("Background App Refresh is off in iOS, so this
  check can't run." / "Notifications are off in iOS, so this check can't alert you." / both).
- Row labels follow the concept: Check in the Background -> Background Check, Last Background Check -> Last Check.
- `core/push.js` pushRows: on footer "Alerts arrive within half an hour of an update."; off footer "...the apps you
  follow..." (concept wording); "no longer knows this iPhone" error drops the fallback sentence (the Background
  Check footer says it now; keeps it to two sentences). lastError footer unchanged.
- AGENTS.md: the Hints bullet, verbatim from the brief, after the iOS 6 controls bullet.
- docs/push.md: the Updates page table row split to match.

## Decisions

- **No "Send a Test Push" button.** The brief (written with the concept) asks for it, but F310, which landed just
  before this task was reopened, explicitly removed the Test Push row and `testPush()` ("Remove ... the Test Push
  row from Settings > Updates"; docs/push.md: "server admins; no button in the app"). The later user instruction
  wins; re-adding it would undo F310. If the button is wanted back, it's a small follow-up (restore testPush from
  54961f55^ and add a centred button group).
- **Icon Badge off no longer brings Turn On in Settings** into the check group: it doesn't stop the check, and the
  brief names only Background App Refresh / Notifications. Icon Badge stays visible (Off) in Update Alerts, whose
  row opens iOS Settings.
- Notifications off shows a Notifications row in the Background Check group although Update Alerts also lists it,
  because the brief asks for it (the fix sits in the group whose footer explains it).

## Checks

- `node --test web/app/screens/settings.test.js web/app/core/push.test.js`: 27 pass (settings.test.js tests
  rewritten for the split groups, off states, header placement, at most two sentences per footer).
- 3x Chromium render (capture.mjs copied from F285 with a NOTIFY env override for app.notifyStatus, `--mode
  sideload`, 402x874@3): `on/updates.png` (everything on), `bar-off/updates.png` (Background App Refresh off),
  `push-off/updates.png` (Push off by hand). Footers computed `text-align: center`. Matches the concept's mock.
  Run: serve web/app on 127.0.0.1:8743, `node capture.mjs http://127.0.0.1:8743/ <dir> script.json --mode sideload`.

## Not verified

- On a real phone (sideload build): no phone test in the brief; the render uses the fake bridge.
- Tapping Turn On in Settings / the switches in the new groups: notifySection's wiring is unchanged (it maps
  rows to cells across all groups in order), but no tap was driven in the render.
