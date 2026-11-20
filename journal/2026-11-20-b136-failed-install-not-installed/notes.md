# B136: a failed install no longer marks the app installed

The user's openMX (io.github.fizl0.openmx) install failed (iOS got ECONNREFUSED from the install server, B128), but
its Search row's swipe did nothing while other apps' worked.

## Cause

The sideload row's swipe (browse.js attachAppSwipe -> appRowState -> altstore.js rowAppJob) takes "installed" from
Installed's record (core/installed.js apps store). An installed, up-to-date app gets no swipe item (rowMenuItems
`apps`). The IPA queue run (screens/apprun.js runAppRun) wrote that record whenever a row ended in state
"installed", including the B76 "Sent to iOS" rows (unsure: iFizBox was in the background while iOS had the link, so
a false from the watch reads "lost sight", not "refused"). openMX's row went that way: the link was handed over,
iOS never fetched the IPA, and the record said 1.x installed. The native signed record (signed.json) was also written
when the link was handed over (serveChecked) and never taken back.

## What changed

- `core/apprun.js recordWhen(row, onPhone)`: "now" for a confirmed install (and rows iOS isn't asked about: re-sign,
  remove, iFizBox itself, no bundle ID, or iOS gave no answer), "wait" for a Sent to iOS row iOS hasn't confirmed or
  says it doesn't have, "never" for rows that didn't end installed.
- `screens/apprun.js`: records through `recordIf` (once per row): on the row's end when recordWhen says now, and
  on each followHandoff answer (new `answered(row, onPhone)` hook). A confirm (iOS has it) records it. Lanes without
  `isInstalled` (helperLanes) keep the old behaviour (null: can't be asked).
- `core/appqueue.js installedOnPhone(rec, onPhone)`: the record unless iOS says false (iFizBox's own record always
  stands). `altstore.js rowAppJob` asks the shell's `apps.isInstalled` fresh (`appOnPhone`, not backend-native's
  session cache) for a recorded app, so records already left behind by failed installs (the user's openMX) stop
  blocking the swipe without any migration.
- `native/Sources/Sideload.swift forgetUnlessInstalled(bid)`: when iOS never fetched the whole IPA (15 minutes, or
  the B89 fallback failed) or the user cancelled, the signed record for that bundle ID is removed if
  `Workspace.isInstalled` says false (kept for true: an earlier install; kept for nil).

Decisions (unattended run, nobody to ask):
- A missing/failed apps.isInstalled answer counts as "can't be asked" and records as before, so a phone where
  LSApplicationWorkspace refuses never loses Installed entries.
- Phone list wins over a manual "Mark as Installed" too when iOS says false for that bundle ID. Only affects the
  row's swipe/hold item (the app page and Installed tab still read the record). An app marked installed but signed
  elsewhere under a changed bundle ID will offer Install on swipe; acceptable, and it is what the brief asks
  ("installed state should come from the phone's real app list where available").
- A Sent to iOS row iOS doesn't have yet stays unrecorded until a later check (each return to the foreground while
  the run page is open) sees it. If the user closes the run page before iOS finishes, the app is not recorded
  (see Not verified).

## Tests

- `web/app/core/apprun-b136.test.js`: recordWhen and installedOnPhone.
- `web/app/screens/b136-swipe.test.js`: fake bridge whose apps.isInstalled says false -> rowAppJob not installed,
  swipe is Install and the app queue takes it; true or no answer keeps the record.
- `web/app/screens/apprun.test.js` "B136: a Sent to iOS row is recorded only once iOS has the app": fake lanes whose
  install is handed off and iOS says false -> not recorded; recorded once iOS says true, only once.

## Not verified

- On a phone (iPhone 18 Pro): queue an app whose install fails, check the row swipes to Install. The user's phone
  isn't reachable from here and the task didn't ask for the 7.
- forgetUnlessInstalled's Swift compiles (`make -C native package` built the .deb and .ipa); no runtime check (needs
  a phone and a failing install).
- Full `node --test web/` once failed "F133: a job whose hash changed" (backend-native-linked.test.js) under load;
  it passes alone and the file isn't touched here. A load-flaky test, not this change.
- The first `run done` gate failed in native/helper/test_helper.py: its `cc` build of the helper exited 1 (stderr
  captured, not shown). The same cc command by hand and the test file alone (74 OK) pass; native/helper isn't
  touched here. The second run showed why: `OSError: [Errno 122] Disk quota exceeded` on /tmp (a per-user tmpfs
  quota filled by other slots; this session used 120 KB). A third run with TMPDIR in a gitignored folder of the
  worktree tripped native/daemon/test_auto.py, which passes on tmpfs and fails on /home (it depends on directory
  order): filed as T26. The last run used /tmp again once it had room.
- Closing the run page before iOS finishes a handed-off install (iOS still saying false at every check) leaves the
  app unrecorded in Installed, so its row offers Install although iOS later has it. Recording it late from outside
  the run page would need a background check of unconfirmed handoffs; not built, worth a follow-up if it shows up.
