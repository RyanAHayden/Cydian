# B34: iFizBox's own update in Changes, badges and the background notification

## What I checked
- `web/app/source.json` lists 0.9.4, `downloadURL` …/v0.9.4/iFizBox.ipa, bundle id and source identifier
  `com.ryha.ifizbox`. Nothing to change there; the new test checks it (and every later version).
- The page chain for the sideload build, as `screens/changes.js` badge()/load() run it:
  `essential-ui.js upgradesWithSelf` (row from the source info `readSelfInfo` keeps, or GitHub's release) →
  `app-updates.js withAppUpgrades` (keeps iFizBox's row first; sends `updates.watch` with iFizBox at app.info's
  version, source `SELF_ALT_URL`) → `badgeCount` → `ctx.setBadge` → `settings.js createUpgradeNotices` (app.badge,
  which asks for badge permission on its first count > 0). New `web/app/self-upgrade.test.js` drives this with a
  fake bridge at 0.9.3 and the real source.json: one row (0.9.4, iFizBox.ipa), badge 1, watch list has iFizBox
  0.9.3 on the built-in source. All of that already worked.
- The task's file list names `web/app/core/app-updates.js` as "missing — this task creates it": the module is
  `web/app/app-updates.js` (with `core/appupdates.js`). Nothing created.

## What missed it
`native/Sources/BackgroundCheck.swift` `updates.watch` asked for notification permission only when the watch list
had an app **other than** iFizBox. The background task posts and badges only with permission, and iOS can't ask
in the background. So on a phone that follows only iFizBox (no Install recorded), permission was asked only if the
page ever counted an upgrade in the foreground (app.badge). Until then iFizBox's own update could never reach the
Update Alerts notification or the icon badge from the background check. Fix: ask once whenever the watch list holds
anything (iFizBox included). `native/test_selfwatch.py` checks it as text (the file only builds with the iOS SDK).

Decision (unattended): this means a fresh sideload install asks for notifications at the first launch, not at the
first recorded Install. The task asks for iFizBox's update in the background notification like other apps', and
that can't happen without permission, so the earlier ask is the price.

Left as is, by design: once the page has counted an upgrade on screen (tab badge, icon badge, banner), it is in
`known` and the background check badges it but doesn't notify about it again. Same rule as for other apps. Because
the page checks iFizBox's source on every launch and return, an iFizBox release seen while the app is open gets no
notification, only the badges and the banner.

## Not verified
- On a phone with 0.9.3 sideloaded: the badge and the notification. No sideload phone is reachable from this
  session (the iPhone 7 runs the jailbreak build; the task doesn't hand me a sideload device), and the background
  task runs when iOS decides. Needs: install 0.9.3 IPA, open once (permission prompt should now come at launch),
  close, wait for a background run (or trigger it with Xcode's `_simulateLaunchForTaskWithIdentifier`
  `com.ryha.ifizbox.updates`), expect "1 Update / iFizBox 0.9.4" and badge 1.
- The Swift change isn't compiled here (no iOS SDK on this machine; the gate's native build runs where it is).
