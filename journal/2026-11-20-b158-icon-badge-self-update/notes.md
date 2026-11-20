# B158: Home Screen icon has no badge for iFizBox's own update

User report: iFizBox 0.12.0 knew 0.13.0 was out (Changes tab showed 1) but the Home Screen icon had no badge.

## What I found

I read the whole count-to-icon path, page and shell:

- Page: `screens/changes.js badge()` → `ctx.setBadge("changes", n)` → `settings.js createUpgradeNotices().badge`.
  The sideload build sends `app.badge {count}` on every count (B47). The jailbreak build sent it only when the
  count was above 0 **and different from the last one**.
- `upgradesWithSelf` does put iFizBox's own row in the count (self-upgrade.test.js), and every permission request
  (`Notifications.swift`, `BackgroundCheck.askOnce`, `Push`, `Sideload.askToNotify`) already asks for `.badge`.
  So the permission options and the count were not the problem.
- Shell `app.badge` (Notifications.swift): each call waited on **its own** `getNotificationSettings` callback (on a
  background queue) and set the badge from there. Two calls close together could be applied in either order,
  so a 0 sent before a 1 could land last. `BackgroundCheck.selfHandedOff` and the background run called
  `setBadgeCount` directly, also outside any ordering.
- `app.js`: on the first launch of a new version it sent `app.badge {count: 0}` once `appVersion()` resolved,
  with no ordering against Changes' count. If Changes counted first (as on 0.12.0's first launch with 0.13.0 already
  out), the 0 won. In the jailbreak build the next recount with the same count was then skipped by the
  "changed" check, so the icon stayed bare until the count changed. In the sideload build it stayed bare until the
  next recount (a self-info read, or a return after more than a minute).
- B124 `selfHandedOff`: it drops iFizBox's own update from the badge at hand-off, as designed. The page's next
  count puts it back if the install didn't land: the app is relaunched, the pending `ifizbox.updating`
  notification is removed at launch, and the page sends its count. With the ordering fix it can no longer
  overwrite a later page count while the app is open. I left its "drop at hand-off" rule as it is.

I couldn't check which of these races hit the user's phone (no access to their phone's state). The fix covers all
of them.

## What changed

- `native/sign/Updates.swift` `UpdateCheck.BadgeSync`: pure ordering (want / start / done). Only the latest count
  is set, and only one at a time. Tested in `native/sign/tests/updates/main.swift` ("B158: …"), which `native/test_updates.py` builds.
  The brief said `native/updates/`, which doesn't exist; that test dir is where this module's Swift tests live.
- `Notifications.setIcon(n, ask:)`: the one badge setter, on the main thread through BadgeSync. `app.badge`,
  `BackgroundCheck.selfHandedOff` and the background run all use it. Once a permission request (asked at the
  first count above 0) gets its answer, the latest count is set again, in case one landed before the answer.
- `settings.js`: the jailbreak build sends every count above 0, not only changed ones. New `updated()` (clear, then
  re-send Changes' count if it has one; app.js's first-launch-after-update clear goes through it now). New `shown()`
  on `visibilitychange` → visible re-sends the last count: always in sideload, and only a count above 0 in
  jailbreak (a 0 there stays with the Changes-tab rule, because the daemon's badge may be newer).
- Tests: `web/app/badge-count.test.js` (two B158 tests, both builds), `native/test_notifications.py`
  `test_one_badge_setter` (wiring: no direct setBadgeCount outside setIcon, app.js uses `updated()`).

## Tried and failed

- A first `setIcon` version called a nested `func apply` from a closure declared above it (Swift refuses this).
  Rewrote it as `applyIcon`, a static method.

## Not verified

- On a phone: I did not run it on the iPhone 7 (jailbreak) or on a sideload phone. The fix is about ordering
  between asynchronous iOS calls, and a phone check would need the exact timing of the user's launch. The pure
  ordering is tested on Linux and the page side in node. The user can confirm on their phone: with 0.13.x+
  installed and a newer release out, the icon badge should match the Changes tab after launch and after
  returning to the app.
- Whether the user's phone has badges turned off for iFizBox in iOS Settings (Settings > Notifications). If it does, no code can show
  a badge. Settings > Update Alerts in the app already shows it (`app.notifyStatus` "badges").
