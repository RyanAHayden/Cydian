# I3: sideload management in the IPA (remembered-version updates, background check)

## What was already there

- F9/F30: tapping Install (or Mark as Installed) on an AltStore app page already records the app, its version and
  its source on the device (`core/installed.js` `recordInstall`, called from `screens/altstore.js` and
  `screens/browse.js`). Install already opens the source's itms-services link where one exists (`core/altstore.js`).
- F65/F72: `settings.js` `createUpgradeNotices` already mirrors the Changes tab count onto the icon badge
  (`app.badge`) in both builds, sideload included.

## What I3 adds

- `web/app/core/appupdates.js` (pure): an app recorded at version X becomes an upgrade when a loaded source offers
  this phone a newer one (dpkg version order, `minOSVersion`/`maxOSVersion` respected through `appStanza`). It also
  merges these upgrades with dpkg's and Cydian's own, keeps Ignored Upgrades holds, and builds the shell's watch list
  and the `"n Updates"` title.
- `web/app/app-updates.js`: `withAppUpgrades()` runs in Changes' `load()` and `badge()` (`screens/changes.js`),
  so the rows show under Available Upgrades and both the tab badge and the icon badge count them. Jailbreak mode is
  left alone (dpkg is the truth there; I4 reads real versions). In sideload it sends `updates.watch` to the shell,
  but only when the list has changed.
- `native/sign/Updates.swift` (Foundation only, so it builds and tests on Linux): `UpdateCheck` reads an AltStore
  source the same way, compares with `DebVersion` (a port of dpkg's verrevcmp), and works out which updates are new
  against the "known" keys. It also builds the notification text: title "1 Update"/"n Updates", body "Delta 1.6,
  UTM 4.5 and 2 more".
- `native/Sources/BackgroundCheck.swift`: registers the BGAppRefreshTask `com.ryha.cydian.updates` at launch, in
  sideload mode only and only where Info.plist permits it (iOS traps otherwise). It asks for no earlier than every
  4 h, fetches the watched sources in parallel with a 25 s cap, and posts one notification under N5's
  `cydian-upgrades` id (a tap opens `#/changes`, app.badge 0 removes it), with the icon badge set to the count.
  An update counts as notified only once the notification was actually posted.
- `native/Info-sideload.plist`: adds `fetch` to UIBackgroundModes and adds BGTaskSchedulerPermittedIdentifiers.

Most of this came from the earlier session's uncommitted work (wip/I3; the runner saved it, and the ledger says only
"left 12 files uncommitted"). It applied cleanly onto main. My one change to it: the background check took the
iOS version from `UIDevice.current.systemVersion` on a background queue, which UIKit expects on the main thread.
It now uses `ProcessInfo.operatingSystemVersion` (gives "17.4.0", which `compareOS` treats like "17.4").

## Tests

- `node --test web/app/core/appupdates.test.js web/app/app-updates.test.js`: 10 pass (remembered-version upgrades,
  including install, a source bump, a version the phone can't run, and reinstalling the upgrade).
- `native/test_updates.py`: the Swift unit test (notification text, version order, source reading, fresh/known)
  builds with the Linux toolchain and passes; text checks for the launch registration, the plist and the bridge.
- `native/build.sh ipa` builds with BackgroundCheck.swift (com.ryha.cydian 0.2.8, 1171 KB executable).

## Not verified

- Nothing has run on an iPhone. The task's last check ("the user sideloads it and reports how it feels") is the
  user's to do. In particular:
  - whether iOS ever runs the BGAppRefreshTask for a sideloaded app. iOS decides that from how much the app is used.
    To force a run in a debugger: `e -l objc -- (void)[[BGTaskScheduler sharedScheduler]
    _simulateLaunchForTaskWithIdentifier:@"com.ryha.cydian.updates"]`. There is no Mac here.
  - how the notification and icon badge actually look, and whether the notification permission prompt appears
    when the first app install is recorded.
  - whether the F14 audio keep-alive and the fetch background mode get along.
- The jailbreak .deb build was not run by hand; tools/check.sh builds both.
