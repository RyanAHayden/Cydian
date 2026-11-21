# B264: icon badge stays after a re-sign run until the app is reopened

User report (2026-11-21, Lite): re-signed everything from Changes, the runs finished, and the Home Screen badge kept
its count until iFizBox was opened again.

## What I found

- Changes' count (`screens/changes.js badge()`, then `ctx.setBadge` → `settings.js createUpgradeNotices().badge` →
  `app.badge` → `Notifications.setIcon`) runs again only on `catalog.onChange`, `onAppsChange` (Installed's record:
  `recordInstall`, `removeInstall`, `undoRecord`), the self-info event and a few settings.
- A re-sign writes no record on the page (`recordApp` skips `mode: "resign"`, `runAppRun`'s `recordIf` writes
  nothing for it either): its new signature lives only in the shell's `signed.json`, which `resignNow` reads
  through `signing.installed`. So nothing recounted after a re-sign. On returning to the front, `settings.js shown()`
  only re-sent the *last* count, which was the old one; the next real recount came later (a catalog change, the
  app reopened).
- The shell saves the new signed record when the app is handed to iOS (`Sideload.swift saveRecords` in
  `installHere`, the link's handoff), before the run's install lane answers, so a recount at the row's end sees it.
- Installs did recount (their record fires `onAppsChange`), but without a hold: in the background the run's hold
  (B257 `heldLanes`) lets go 2 s after the last lane, so a slow count could be cut off. Concurrent counts could also
  land in any order: an older one answering late could put its number back.
- Push server (`worker/src/push.js badgeFor`): counts update rows only (`counted`/`known` from the page's watch
  list plus updates found), never re-signs. After an install, the page's recount runs `withAppUpgrades`, which sends
  the new watch list (`updates.watch` and `syncPush`) because the app's version changed, so the server's next push
  badge no longer counts it. Nothing to change in the worker; I added a test line for it.

## What changed

- `screens/changes.js`: `recountBadge()` (new, exported): counts again now (and redraws when Changes is on screen),
  resolving once the count is set. `badge()` got a latest-wins guard (`badgeAsked`): only the newest count asked for
  sets the badge.
- `screens/apprun.js runAppRun`: new dep `onAppEnd(row, recorded)`, called once per row that reaches `installed`
  (re-signed, installed, or Sent to iOS), after Installed's record was asked for (`recorded`: its promise or null).
- `signing/queue.js heldLanes`: `during(promise)`, held like a lane until the promise settles.
- `screens/queue.js`: `recountChanges()` (lazy import of changes.js). `runAppQueueRun` passes `onAppEnd` that waits
  for the record, then holds the app (`during`) while `recount()` runs, so in the background iFizBox stays running
  until the badge is set, including after the run's last app. `runAppQueue` (the website and the old one-at-a-time
  path) recounts after each app.
- Tests: `screens/changes-recount.test.js` (new: re-sign drops the count; a late older count never wins),
  `screens/apprun.test.js` (onAppEnd per ended row, not a stopped one; runAppQueueRun holds while counting),
  `signing/queue.test.js` (`during`), `screens/appqueue.test.js` (runAppQueue recounts per app),
  `worker/test-push.mjs` (installed version no longer counted).

## Tried and failed

- First version of the changes test had no IndexedDB in node, so `catalog.upgrades` threw and nothing was counted;
  added `fakeIndexedDB` and an offline `fetch` as moresources.test.js does.
