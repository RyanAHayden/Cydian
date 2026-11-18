# F65: the app side of N5's upgrade daemon

## What I did

- **Permission** (`native/Sources/Notifications.swift`, one line in `App.swift`): at launch the shell makes itself
  the `UNUserNotificationCenter` delegate and, in jailbreak mode only, asks for alert, badge and sound while the
  status is `.notDetermined` (so once: a "no" stays the user's). The sideload build keeps asking only when its
  re-sign reminder is set (Sideload.swift).
- **Tap → Changes**: `didReceive` reads `userInfo["url"]` (main.m sets `#/changes`), accepts only `#/` +
  `[A-Za-z0-9/%._~-]` up to 200 chars, and sets `location.hash` through `callAsyncJavaScript` arguments (data, not
  script). On a cold launch the web view is still loading, so it retries every 0.2 s for up to 10 s; the router
  follows `hashchange`. `willPresent` shows banners while the app is open.
- **Badge clear**: bridge `app.badge {count}` (`setBadgeCount` on iOS 16+, `applicationIconBadgeNumber` before;
  0 also removes the delivered `cydian-upgrades` notification). `web/app/settings.js` `createUpgradeNotices` sits
  beside `ctx.setBadge` in `app.js`: a Changes count of 0 clears the icon badge **only while the Changes tab is
  shown** (a 0 worked out in the background before sources load would wipe a correct badge); a 0 counted elsewhere
  clears when the user opens Changes (hashchange). Sent once until the count goes above 0 again.
- **Settings switch "Upgrade Notifications"** (`core/settings.js`, feature `upgrade-notifications`, jailbreak only,
  default on, in the Notifications section). Each change runs `cydian-helper notifications on|off`; when the helper
  fails the value goes back and listeners hear it. `screens/settings.js` got `syncSwitches` so a toggle whose value
  went back moves its switch (before, toggles ignored their own change events). At launch, if the switch is off it
  is written again (a reinstalled .deb loses the file).
- **Helper verb** `notifications on|off` (policy.c `notify_plan`/`helper_notify_apply`, main.c): off creates
  `<prefix>/var/lib/cydian/upgrades.off` (folder made 0755), on deletes it; refuses a symlink or non-regular file at
  the path and a symlinked folder (exit 74). Runs nothing else.
- **Daemon** (`native/daemon/quiet.h`, one call in main.m `e_notify`): with the file there, N5's "n Upgrades"
  becomes a badge-only update. Decision: the badge stays (Settings has a separate, future "App Icon Badge" row,
  feature `badge`), and N7's "Packages Updated"/"Update Failed" still post (they report installs the user turned on
  under Automatic Installs).
- Tests: `native/helper/test_notify.py` (plan, chain, link refusals), `native/daemon/test_quiet.py` (rule, same path as
  the helper, main.m calls it), `native/test_notifications.py` (Swift as text), `web/app/settings.test.js`,
  `web/app/core/upgrade-notifications.test.js`; `core/settings.test.js`'s visible-rows lists gained the new row.

## Files outside the task's list

`web/app/app.js` (import + `setBadge` + `start()`, 4 lines), `web/app/screens/settings.js` (switch sync),
`web/app/core/settings.test.js` (expected row lists). `web/app/settings.js` didn't exist; the brief named it, so it is
the new glue module.

## What failed

- One run of `test_notify` + `test_helper` together failed `Helper.test_chain_apply_ask` (fds 4-6 open in the
  stand-in apt). It passed alone, on HEAD, and in three re-runs; not caused by this change. Filed as T7 (critical).

## Not verified

- Nothing ran on a phone (no jailbroken test device for N5/N7 work): the permission prompt, iOS actually showing
  the daemon's notifications after permission, the tap opening Changes on a cold and a warm launch, `setBadgeCount`
  clearing the badge, and the helper writing `upgrades.off` as root under `/var/jb`.
- The Swift and main.m changes compiled in this machine's gate (native build: Cydian.deb with the daemon, and
  Cydian.ipa), with no warnings from the new code; whether they behave is the device list above.
- The settings switch flipping back after a helper failure was checked through `core/settings.js` tests, not in a
  browser.
