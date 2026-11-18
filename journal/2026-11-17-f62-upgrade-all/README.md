# F62 Changes tab: Upgrade (N)

## What I did
- `web/app/screens/changes.js`: in the jailbreak build (`detectMode() === "jailbreak"` and the backend has
  `queue`), the root nav bar gets a right button "Upgrade (N)". It is hidden until the load finishes and while
  there are no available upgrades (Cydia hides it too); `draw()` updates label and visibility from
  `state.data.upgrades.available`. A tap calls `upgradeAll()`, which queues one
  `{ op: "install", id, version, installed, name }` per Available Upgrade (Ignored Upgrades are never touched)
  through `getBackend().queue`. The first add opens the Confirm sheet (screens/queue.js `initQueue` subscribes to
  the queue), later adds refresh it, so nothing more is needed to open it.
- Site and sideload build: `canUpgrade()` is false, no right button at all.
- The button is found with the same page/nav-item lookup browse.js `setRightLabel` uses (copied, not imported:
  browse.js's is private and the task's files are only changes.js and its test).
- Tests (`changes.test.js`): jobs queued against a real `core/queue.js` queue (mode reads `upgrade`), ignored ones
  left out, no queue -> nothing, label text, `canUpgrade` per mode, and no right button on the site.

## Decisions
- Jobs, not one `apt-get dist-upgrade`: the brief asks for per-package queue jobs, which also lets the Confirm
  sheet show and clear each one. A package whose upgrade needs new dependencies is then apt's to resolve in the
  simulate step, as for a single Upgrade.

## Not verified
- The button in the running app (jailbreak build) and the Confirm sheet opening from it: no app build/device run in
  this task (the device is only touched when a task says so). Covered only by the unit tests and by N4's own
  tests of the queue -> Confirm path.
