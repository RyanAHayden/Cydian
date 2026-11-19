# B69: Modify opens the sheet on the jailbreak app's installed app pages

## Cause

`screens/browse.js` `packageActions`, for an AltStore app (`kind: "ipa"`): `appPageAction` (altstore.js) returns
false outside the sideload app and the website, `signIfReady` returns false without local signing, and then
"Install at the top right installs" ran `rows[0].onClick()`: the helper's Install row. The nav label already read
Modify for an app with a record (altstore.js `trackingSection` → `appNavLabel`), so Modify installed at once.

APT pages were fine (the jailbreak app has a queue, so its sheet opened); they lacked only Ignore Upgrades.

## What changed

- `altstore.js` `jailbreakModify(pkg, { install, history, ... })` + `jailbreakModifyButtons`: for an installed app
  (record in core/installed.js, as the nav label reads it) the sheet, titled with the app's name:
  Upgrade or Reinstall, Ignore Upgrades (only while a newer version is out) / Stop Ignoring Upgrades (once ignored),
  Remove (red; hands over to installed.js `confirmDelete`, B46's helper uninstall, which asks again), Downgrade (then
  which version), Version History (more than one version). Not installed: resolves false, so Install keeps its one tap.
- `browse.js` `packageActions` calls it (only where `ipaInstallAvailable()`, i.e. the jailbreak app) before the
  one-tap row; `install(version)` is that version's first install row (the helper's Install).
- `browse.js` APT sheet: `ignoreAction` adds Ignore Upgrades (newer version out) / Stop Ignoring Upgrades (held) after
  Upgrade/Reinstall, the same list as the Installed Package switch.
- `core/settings.js` holds: `set(id, on, { dpkg: false })` keeps an app's hold in `ifizbox.appHolds`, beside dpkg's
  list; `list()`/`has()` see both and `sync()` (apt-mark showhold) no longer drops it. Needed because the helper
  refuses a name dpkg doesn't know, and the failed `hold` then synced the app's hold away. Unholding an id that is
  only in the app list runs no helper (Settings' Ignored Upgrades row works for both). core/settings.js is outside the
  brief's file list; the change is additive (a new key, one optional argument).
- Test: `web/app/screens/jailbreakmodify.test.js` (fails before the fix: `jailbreakModify` didn't exist, and the
  source check finds no call before the one-tap row).

## Decisions

- Order follows the brief (Upgrade/Reinstall, Ignore Upgrades, Remove, Downgrade, Version History); Cydia's own order
  (docs/cydia.md) is the same minus Ignore Upgrades, which Cydia keeps on Package Settings.
- "Stop Ignoring Upgrades" is offered whenever the app/package is held, so the sheet can undo what it did.
- Daemon prefs (`daemonPrefs`) still send dpkg's holds only: the daemon updates packages, not apps.

## On the iPhone 7 (ui-7.sh, lock B69)

The phone's .deb (0.9.8-1599) had altstore.js, browse.js and core/settings.js byte-identical to main (md5), so I swapped
in this branch's three files (with backups), closed the app from the switcher, and checked AltStore > Delta:

- Not installed: the button reads Install (not tapped). The F210 checkmark marked Delta installed (1.7.1, a record
  only); the button then read Modify, and tapping Modify opened the sheet **Delta: Reinstall, Remove (red), Downgrade,
  Version History, Cancel**. Nothing installed.
- Recorded version set to 1.6.2 (Change Installed Version): **Upgrade, Ignore Upgrades, Remove, Downgrade, Version
  History**. Ignore Upgrades → the next sheet offered **Stop Ignoring Upgrades**, still there after opening Changes
  (which runs `holds.sync()`, apt-mark showhold): the app hold survives dpkg's sync.
- A tap while the sheet was still sliding in hit Remove: it opened installed.js's confirm sheet ("Delta is no longer on
  your iPhone.", only forgetting the record), which my next tap dismissed via its backdrop. So Remove reaches the
  confirm and does nothing without it. Lesson for ui-7 work: take a screenshot after a sheet opens and tap only once
  it has settled (Cancel at y≈1245).
- Cleanup: Stop Ignoring Upgrades tapped, Delta unmarked (button back to Install), the phone's three original files
  put back (md5 matches main again), app closed from the switcher, lock released.

## Not verified

- Upgrade, Reinstall and Downgrade's install on the phone: not tapped (the task says not to tap Install on the 7, and
  they run the same helper Install row). The unit test checks they call `install` with the right version.
- Remove's real uninstall of an app that is on the phone: Delta wasn't really installed, so only the forget path's
  confirm sheet appeared (cancelled). The uninstall is installed.js's B46 code, unchanged.
- That Stop Ignoring Upgrades' last tap went through before unmarking: not re-checked on screen. An `ifizbox.appHolds`
  entry left in the phone's localStorage would be harmless (the installed build doesn't read that key).
- Changes listing an ignored app under Ignored Upgrades in the jailbreak app: Changes there only counts apps really on
  the phone (`actual !== null`), and none from a source with a newer version was, so it couldn't show. Changes passes
  `settings.holds.list()`, which now includes app holds.
- APT pages' new Ignore Upgrades row: unit-tested (`ignoreAction`), not tapped on the phone (no held-back upgrade to
  try it on without side effects).
- Restoring settings from an account (account.js `holds.set(p, true)`) for an app id still goes through dpkg and would
  fail there; out of scope.
