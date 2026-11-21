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

## The background half: the shell drops the row itself

On the iPhone 15 the page's JavaScript did **not** run while iFizBox was in the background, hold or not (details
under Phone checks). So a recount on the page alone moves the icon badge only once iFizBox is opened again, which
is the user's report. B124 already had the shell drop iFizBox's own update from the icon at hand-off
(`selfHandedOff`); this does the same for every app:

- `native/sign/Updates.swift` `UpdateCheck.afterHandOff(ids, version:, counts, resign:)` (pure, Linux-tested): an
  update row (a page key `<id> <version>`) goes when the handed version reaches the update's; a Needs Re-sign row goes
  whatever the version; one app is one row; never below 0. A re-sign of an app that also has an update keeps the
  update counted.
- `BackgroundCheck.appHandedOff(ids:version:)`: applies it to the stored page count (`pageCount`, `pageKeys`,
  `foundKeys`, new `pageResignKey`), moves the watch list to the handed version (as `selfHandedOff`), and sets the
  icon through `Notifications.setIcon` (B158's ordered setter), the widget count, and clears the delivered
  upgrades notice at 0.
- New bridge call `updates.resigns {ids}`: Changes' `badge()` sends its counted Needs Re-sign IDs with each count
  (`screens/changes.js sendResigns`); update rows the shell knew already from `updates.watch`.
- `Sideload.swift`: `appHandedOff` right after each `saveRecords(SignedRecords.adding…)` hand-off (the hosted link,
  This iPhone's success for other apps, the local install link). iFizBox's own This iPhone install keeps
  `selfHandedOff`.
- The page's next count stands over the shell's (`app.badge` sets `pageCount` again), so a hand-off iOS then refuses
  is put back at the next count, as B124 already accepts for iFizBox itself.
- Tests: `native/sign/tests/updates/main.swift` ("B264: …"), `native/test_updates.py`
  `test_every_hand_off_drops_its_row` (wiring), `changes-recount.test.js` (the page sends `updates.resigns`).

Push server (`worker badgeFor`): unchanged. It never counts re-signs. After an install the page's recount sends the
new version with the watch list (`syncPush`), so it no longer counts that update. The worker test now covers that.

## Phone checks (iPhone 15 Pro, iOS 27, Lite 0.18.3 built from this branch, `tools/ui-15.sh install`)

1. Upgrade (5) on the phone's 5 Needs Re-sign rows: all 5 failed on this phone's state, before this task's code:
   B246 Test, Probe and R51Test "That app isn't in My IPAs any more", R54 Test "Could not connect to the server",
   OpenTennis "iOS refused the update: … signed for another App ID". No hand-off, so the badge rightly stayed 5. My
   first Confirm tap landed while the sheet was still sliding and started nothing (memory: shoot twice first).
2. The page-only build, with fake lanes (12 s timers) driven from Web Inspector (`pymobiledevice3 webinspector cdp`):
   Home Screen badge stayed 5 for 60 s. Web Inspector evaluation timed out while iFizBox was in the background
   (`signing.hold {on}` sent 7 times, nothing else). The first timer fired only when the app came back, then counts
   went 5→4→3 at once. So page JS is not something to rely on in the background. (Fake lanes have nothing native in
   flight, unlike a real run; R54 saw native answers keep the page alive. But this showed the page can sleep.)
3. With the shell change: a test app "B264 Test" (`com.ryha.b264test`, Lite's executable, never launched) from a
   local AltStore source over `tailscale serve`. Installed 1.0 in front, then 2.0 published: Changes 6. Upgrade (6),
   Confirm, Home at once. **Home Screen badge 6 → 5 about 11 s after Confirm, in the background** (screenshots
   every ~3.5 s), the app never brought forward.
4. Re-sign: I made the page see B264 Test's signature as ending tomorrow (an inspector patch on `signing.installed`, page
   only; Re-sign Reminder takes only its listed days), so Changes counted it under Needs Re-sign (6, and
   `updates.resigns` carried `com.ryha.b264test`). Upgrade (6), Confirm, Home. **6 → 5 about 11 s after Confirm, in
   the background.** The page's bridge log showed no `app.badge` while hidden, so the shell's `appHandedOff` set
   it. Back in front the patched page counted 6 again (the patch still said "tomorrow"), and after a reload the
   real count was 5.
5. Cleanup: B264 Test uninstalled (`ios uninstall`), removed from Installed's list, its source deleted, the
   inspector patches gone with a page reload, `tailscale serve --https=8471` off.

Screenshots in `ref/15/screens/b264-*.png` (gitignored).

## Tried and failed

- First version of the changes test had no IndexedDB in node, so `catalog.upgrades` threw and nothing was counted;
  added `fakeIndexedDB` and an offline `fetch` as moresources.test.js does.
- A page-only fix (the first commit): on the phone the page slept in the background, so the badge didn't move until
  the app was opened (Phone checks 2). That is why the shell now drops the row itself.
- `settings.set("resignReminder", 400)` to put a fresh app under Needs Re-sign: refused ("not one of its options").

## Not verified

- **A real re-sign that ends a real Needs Re-sign row, start to end, on the phone.** Every re-sign this phone had to
  offer failed for reasons outside this task (missing IPAs, an App ID mismatch), and a fresh app's signature has 341
  days, so the re-sign check used a page-side patch to count it (Phone checks 4). The shell's drop on a real re-sign
  hand-off ran, and the pure rule is tested on Linux.
- **2+ apps dropping one by one in one background run.** Each run had one app that could hand off. The per-app
  drop is the same call per hand-off, and the Swift test walks 5 → 4 → … → 0.
- **The hosted-link and local-link routes** (`Sideload.swift` link hand-offs): only This iPhone was run on the
  phone. Same call, after the same record save.
- **The server's push badge after a run**: no push was sent (the check needs the worker's cron and a new update).
  Covered by `worker/test-push.mjs` and by reading that the page's recount re-sends the watch list.
