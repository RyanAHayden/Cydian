# F213: swipe a row left to queue an app in the sideload IPA

User, 2026-11-18: "we can add things to queue in ipa so we should be able to".

## What changed

- `screens/altstore.js` `rowAppJob(pkg, source, { store, mode })`: the job the app page's Install would queue
  (`appJob` with the apps store's installed record, as `appPageAction`), plus `installed` ("" when the version isn't
  known) and `newest`. Null off the sideload build or for a non-app.
- `screens/browse.js`:
  - `rowMenuItems(item, { apps, job, installed, newest, queued })`: with `apps` (sideload), an `ipa` item gets Cancel
    (queued), Install (not installed) or Upgrade (newer out). Up to date / unknown installed version / no job: none
    (Reinstall stays on the app page). Tweaks there get none; the jailbreak path is untouched.
  - `queueKind()`: "apt" (jailbreak: `queueOf()`), "apps" (`detectMode() === "sideload"`), or null (website, F89).
  - `attachQueueSwipe` hands "apps" to `attachAppSwipe`: app rows only; prepare reads `appRowState` (package + source
    cached 20 s like `historyFor`; record and queue read fresh); commit is `appQueue.add` (no Confirm, as F193; the
    app queue has no `quiet` because only `queueApp` opens Confirm), undo bar puts back the previous job or clears.
  - `swipeMessage` takes the label table (APP_MODE_LABEL for apps, so a queued Re-sign cancels as "Re-sign X cancelled").
  - Hold menu: app rows in sideload show the same item; Install/Upgrade there goes through `queueApp` (opens Confirm,
    as the jailbreak menu's queue item and the app page's button do); Cancel clears.
  - First-run hint: in sideload counts `appQueue.size`, plays only on an app row; an app-queue add marks it seen.
  - The shared canStart test moved into `canSwipeRow` so both swipes use it (same conditions).
- Tests: `browse.test.js`, two F213 tests (rowAppJob: fresh/old/unknown/site/jailbreak/non-app/itms; rowSwipeAction
  and rowMenuItems for ipa items in sideload: add, upgrade, cancel, none on the site, none for tweaks/jailbreak).

## Decisions

- Hold menu Install opens Confirm (explicit tap, like F192's apt menu) while the swipe stays quiet (F193).
- Installed with an unknown version (Mark as Installed without one): no swipe, matching appNavLabel's Reinstall.

## Not verified

- On a phone: the iPhone 7 runs the jailbreak build and has no AltStore source (memory), and there is no sideload
  device here, so the sideload swipe was not driven by touch.
- No new 3x render: the swipe uses F193's `nav/rowswipe.js` controls unchanged (add = green +, cancel = grey), whose
  3x renders are in `journal/2026-11-18-f193-row-swipe-queue/`. A sideload end-to-end in headless Chromium would need
  a fake native sideload backend with an AltStore source loaded; not built for this task.
- `attachAppSwipe`, `appRowState` and the menu's DOM wiring are covered only by reading; the pure parts are unit tested.
