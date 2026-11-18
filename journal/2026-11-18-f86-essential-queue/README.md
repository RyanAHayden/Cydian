# F86 The Essential Upgrade alert queues like Cydia's

## What changed
- `core/essential.js`: `queueEssential(rows, { queue, confirmed, fallback })` queues the rows, then waits for how
  Confirm went away. `runEssential` takes a button's `"cancelled"`: forced (below the minimum), the alert comes
  back; not forced, it resolves `"cancelled"`. Continue Queuing (`"closed"`) counts as queued and isn't asked again
  (the forced lock's tap still brings the alert back).
- `screens/queue.js`: `whenConfirmEnds()` resolves when either Confirm sheet (apt's or F80's app sheet) closes:
  `"confirm"`, `"cancel"` (Cancel, or the queue emptied under it), `"closed"` (Continue Queuing, Cannot Comply's
  actions).
- `essential-ui.js`: both buttons go through `queueButton`. Sideload: Complete Upgrade reads every upgrade Changes
  would list when you tap it (catalog.upgrades + Cydian's row + app-updates' withAppUpgrades), so the launch alert
  never waits for the catalog. It queues them through changes.js `queueUpgrades` (Upgrade (N)'s path), which
  opens F80's Confirm. runOrder already puts Cydian last. Essential Only queues just Cydian's row. When nothing can
  be queued (no Cydian.ipa in the source), it falls back to `installSelfNow`, whose alert says why. Jailbreak:
  `queueAll` as before, now counted, and the button waits for Confirm.
- Tests: `core/essential.test.js` (both buttons queue and open Confirm, forced Cancel asks again, Continue Queuing,
  fallback), `screens/essentialqueue.test.js` (the real app Confirm sheet over a fake DOM answers cancel/confirm).

## Tried and dropped
- Gathering every sideload upgrade in `gather()`: that makes the launch alert wait for the catalog. It is now read on tap.

## Not verified
- On the iPhone: not tried. The task says the user tries it with the next release, and no device was in scope.
- The jailbreak apt Confirm (`openConfirm`) path of `whenConfirmEnds` has no test: it needs the backend's simulate
  and the catalog. The change there is small: the same `close(how)` as the app sheet, which is tested.
- If a Confirm can't open when the button is tapped (a console or app run already going), the button's promise
  waits for the next Confirm to close. Nothing runs at launch, so this shouldn't come up.
