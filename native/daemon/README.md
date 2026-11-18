# native/daemon/: cydian-upgrades, the background upgrade check (N5) and automatic updates (N7)

A launchd daemon in the jailbreak .deb (not in the sideload IPA). Once a day it runs `apt-get update`, counts the
upgrades and sets the badge on iFizBox's icon to that number. When an upgrade is new since the last notification, it
also posts a local notification: "3 Upgrades" / "3 upgrades: A, B and C.".

- `auto.c`, `auto.h`: N7's decisions and the whole hourly run (below).
- `upgrades.c`, `upgrades.h`: the rules, in plain C so they build and are tested on Linux (`test_daemon.py` through
  `test_driver.c`). Upgrades are the `Inst <id> [<from>] (<to> …)` lines of `apt-get -s dist-upgrade` whose versions
  differ, so new dependencies don't count, and apt already leaves held packages (Ignored Upgrades) out. Names come
  from dpkg's status (`Name:`) and fall back to the id. A notification goes up only when some `id=version` isn't in
  the state file, so the same "3 upgrades" doesn't show again every day. A check is due when the
  last one is 23 hours old or more.
- `main.m`: the daemon (N7: the facts and apt calls behind `auto_step`). Flags: `--force` (check now), `--no-update`, `--dry-run` (print the count and words, post
  nothing). It runs apt from `/var/jb/usr/bin` with a clean environment and time limits (update 10 min, plan
  2 min), keeps `/var/jb/var/lib/cydian/upgrades.state` (`last <time>`, then `id=version` lines) and
  `upgrades.lock` (one run at a time), and logs through NSLog. If `apt-get update` fails, it still counts from the
  lists it has.
- Notifications: `-[UNUserNotificationCenter initWithBundleIdentifier:@"com.ryha.cydian"]` (private). It needs the
  `com.apple.private.usernotifications.bundle-identifiers` entitlement (`entitlements.plist`). The badge goes up
  with the notification (`content.badge`) or through `setBadgeCount:` (iOS 16+) / `setBadgeNumber:` (before 16).
  iOS shows them only once iFizBox has notification permission: the jailbreak app asks once, at its first launch
  (F65, `../Sources/Notifications.swift`). A tap opens the notification's `url` route (`#/changes`) in the app, and
  the app clears the badge once its Changes tab shows no upgrades (`web/app/settings.js`, bridge `app.badge`).
- Upgrade Notifications (F65, `quiet.h`): with `/var/jb/var/lib/cydian/upgrades.off` there (Settings' switch, written
  by `cydian-helper notifications off`), "3 Upgrades" becomes a badge-only update; N7's notes still post.
- `com.ryha.cydian.upgrades.plist`: the launchd job at `/var/jb/Library/LaunchDaemons/`. It runs as root at load
  and every hour, and the 23-hour rule makes that one check a day, at most 24 hours apart. `deb/postinst` loads it
  and `deb/prerm` unloads it.
- `stage.sh <root> <sdk> <lld> [ldid] [rcodesign]`: `native/build.sh` calls this for the .deb. It builds arm64 iOS
  15+ (with `../Sources/availability.c` for `@available`), signs with the entitlements, and installs the job.

## Automatic updates (N7)

Every hourly run is `auto_step` in `auto.c` (tested on Linux by `test_auto.py` through `auto_driver.c`, with a fake
clock, phone and apt in a folder); `main.m` only fills `struct auto_env` with the phone's facts and apt's work.

- **Settings:** the F13 keys, read from iFizBox's preferences (`com.ryha.cydian`, user mobile, through cfprefsd):
  `cydian.checkUpdates` (off / launch / 6h / daily), `cydian.cellular`, `cydian.autoInstall` (off / marked / all),
  `cydian.autoInstallIdle`, `cydian.respring` (notify / locked), `cydian.keepVersions` (0-2), and the lists
  `cydian.autoMarked` (Only Packages I Mark) and `cydian.holds` (an array, or localStorage's JSON text). No
  preferences or a missing key: F13's defaults, except Check for Updates, which stays daily (N5) until the app
  writes it. The jailbreak app mirrors them (F70): `web/app/settings.js` createPrefsMirror sends them to
  `Bridge.swift` `prefs.set` at launch and on every change, with get()'s string/bool/number values and the lists as
  arrays; a setting nobody picked is removed, so the default above applies. `cydian.autoMarked` is the package
  page's Update Automatically switch.
- **When:** Off and On Launch: no background check (On Launch is the app's). Every 6 Hours: when the last check is
  5 h old; Daily: 23 h (launchd starts it hourly). On cellular with Use Cellular Data off, a due check waits for the
  next start (the last time stays). `--force` checks whatever the schedule says.
- **What installs:** Everything, or Only Packages I Mark; never a hold (`apt-mark showhold` or the settings' list),
  nor an `id=version` that failed before (a `failed` line in the state; a newer version clears it). With Only
  When Charging and Locked, the upgrades a check found wait, and each hourly start that is charging and locked
  plans again (`apt-get -s`, no network) and installs. Installs also need a network that's allowed, dpkg's lock
  free (else they wait, without counting as a failure), and an `apt-get -s install --only-upgrade --no-remove`
  plan with no `Remv` line (else they wait for a person: an "Update Failed" notification). The install is
  `apt-get -y install --only-upgrade --no-remove <ids>` with `CYDIA=1 1`.
- **Links apt can't fetch (B16):** an upgrade whose candidate's `Filename:` is a full URL (ios.jjolano.me's GitHub
  links, found in `/var/jb/var/lib/apt/lists/*_Packages`) never installs automatically: apt would 404 on it. It is
  logged and skipped (not a failure; it stays in the count and the badge), and the app's queue installs it (F131).
  A plan whose other upgrades would pull in such a package as a dependency waits for a person ("Update Failed").
- **Respring:** needed when a maintainer script says `finish:reload|restart` (Cydia's protocol, on stdout) or the
  package puts files where SpringBoard loads tweaks, preference bundles or themes from (its dpkg `.list`).
  Just Notify Me: the "2 Packages Updated" notification ends "Respring to finish." Respring When Locked: respring
  at once if locked, else `respring <time>` in the state and the first locked start resprings (dropped if
  SpringBoard has started since). `finish:reboot` only ever notifies.
- **Rollback:** with Keep Previous Versions 1 or 2, the installed version's .deb (if apt's cache has it) and the
  new one are copied to `/var/jb/var/cache/cydian/rollback/<id>/` (apt's file names, mtime = when stored); kept:
  the installed version's and the newest 1-2 others. 0 deletes the folder. Only the daemon's installs are stored.
  The package page's Roll Back is a follow-up task (it needs a helper verb that installs a stored .deb).
- **Notifications:** N5's "3 Upgrades" (`cydian-upgrades`), N7's "2 Packages Updated" / "Update Failed"
  (`cydian-autoupdate`); the badge is the upgrades left after any install.

Try it on a phone: `sudo /var/jb/usr/libexec/cydian/cydian-upgrades --force --dry-run`.
