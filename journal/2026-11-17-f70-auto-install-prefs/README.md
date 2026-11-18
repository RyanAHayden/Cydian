# F70: Automatic Installs rows, and the settings handed to N7's daemon

## What I did

- `web/app/core/settings.js`: "auto-install" and "rollback" join FEATURES, so the jailbreak app's Settings shows
  the Automatic Installs section (Install Updates Automatically, Only When Charging and Locked, After a Respring
  Update, Keep Previous Versions). New `autoMarked` list (package ids, sorted JSON under `cydian.autoMarked`, like
  holds) and `daemonPrefs(keys?)`, which returns `{ "cydian.<key>": value }` for DAEMON_KEYS (checkUpdates,
  cellular, autoInstall, autoInstallIdle, respring, keepVersions) and DAEMON_LISTS (holds, autoMarked).
- `web/app/settings.js` `createPrefsMirror({ settings, native }).start()`: jailbreak app only; sends all of them
  through `native.call("prefs.set", { values })` at launch, then each changed key alone. Started from `app.js` after
  `upgradeNotices.start()` (app.js wasn't in the task's file list, but nothing else runs at launch; one import line
  and one call, added beside the existing ones without touching them).
- `native/Sources/Bridge.swift` `Prefs`: `prefs.set` writes with `CFPreferencesSetAppValue` into `com.ryha.cydian`
  (current user = mobile, any host: what the daemon's `CFPreferencesCopyMultiple(…, "mobile", AnyHost)` reads) and
  synchronises. Only the daemon's eight keys are taken; null removes a key; JS booleans arrive as CFBoolean and stay
  booleans (the daemon's `flat()` turns them into true/false).
- Package page (`screens/browse.js` installedGroup, where Ignore Upgrades already lives; the task listed
  `depiction.js`, but that file only renders Sileo depictions): an "Update Automatically" switch row in the Installed
  Package group, shown when `autoMarkShown(settings)` (`core/automark.js`): jailbreak app, Install Updates
  Automatically = Only Packages I Mark.
- `native/daemon/README.md`: the "app doesn't mirror them yet" line now says how it does.

## Decisions

- **A setting nobody picked is sent as null (key removed), not as its default.** The daemon's defaults are F13's
  except Check for Updates, which it keeps Daily until the app writes it. The app's default is "launch", which
  for the daemon means no background check, and the Check for Updates row isn't shown yet ("update-check" isn't in
  FEATURES), so writing the default would switch N5's daily check off with no way to turn it back on. The other
  defaults match the daemon's (auto.c auto_settings_parse), so removing them changes nothing.
- The holds list is always written as an array (the daemon also takes localStorage's JSON text, but the task asks
  for arrays). In the jailbreak app `holds.sync()` (dpkg's showhold) notifies on a change, so the daemon gets dpkg's
  list too; it also reads `apt-mark showhold` itself.
- The mark row shows only for Only Packages I Mark, where it does something; marks stay stored when the setting
  changes, so switching back restores them.
- The package page isn't redrawn when Install Updates Automatically changes; the row appears on the next open of
  a package page (same as other settings-dependent rows there).

## Tests

- `web/app/core/settings.test.js`: rows shown in jailbreak mode now include the four Automatic Installs rows;
  Automatic Installs only in the jailbreak app; autoMarked (sorted, unique, notified on change, bad JSON reads empty);
  autoMarkShown; daemonPrefs (all keys, nulls when unpicked, typed values, lists, one-key form, non-daemon keys left out).
- `web/app/settings.test.js`: mirror sends everything once at launch, then one call per daemon-key change, nothing
  for others; nothing on the site/sideload; a throwing shell is swallowed; app.js starts it.
- `node --test web/app`: 560 pass.

## Not verified

- The Swift `Prefs` code was not compiled: no Swift toolchain on this machine (`tools/check.sh` skips the native
  build here). Written carefully against the CF API signatures, but a typo would only show on a build machine.
- Not run on a phone: that cfprefsd hands the app's write to the root daemon reading user mobile's domain (this is
  what `CFPreferencesCopyMultiple(…, "mobile", …)` in main.m expects, and the plist-file fallback covers a missed
  sync), and that a jailbroken, unsandboxed app's `CFPreferencesSetAppValue` lands in
  `/var/mobile/Library/Preferences/com.ryha.cydian.plist`. The task says the Swift side is untested without a phone.
- The new switch row was not looked at in a browser/render (the code reuses the Ignore Upgrades switch exactly).
