# native/daemon/: cydian-upgrades, the background upgrade check (N5)

A launchd daemon in the jailbreak .deb (not in the sideload IPA). Once a day it runs `apt-get update`, counts the
upgrades and sets the badge on Cydian's icon to that number. When an upgrade is new since the last notification, it
also posts a local notification: "3 Upgrades" / "3 upgrades: A, B and C." (the same words as `web/push.py` and
`web/app/device-check.js`).

- `upgrades.c`, `upgrades.h`: the rules, in plain C so they build and are tested on Linux (`test_daemon.py` through
  `test_driver.c`). Upgrades are the `Inst <id> [<from>] (<to> …)` lines of `apt-get -s dist-upgrade` whose versions
  differ, so new dependencies don't count, and apt already leaves held packages (Ignored Upgrades) out. Names come
  from dpkg's status (`Name:`) and fall back to the id. A notification goes up only when some `id=version` isn't in
  the state file (push.py `decide`), so the same "3 upgrades" doesn't show again every day. A check is due when the
  last one is 23 hours old or more.
- `main.m`: the daemon. Flags: `--force` (check now), `--no-update`, `--dry-run` (print the count and words, post
  nothing). It runs apt from `/var/jb/usr/bin` with a clean environment and time limits (update 10 min, plan
  2 min), keeps `/var/jb/var/lib/cydian/upgrades.state` (`last <time>`, then `id=version` lines) and
  `upgrades.lock` (one run at a time), and logs through NSLog. If `apt-get update` fails, it still counts from the
  lists it has.
- Notifications: `-[UNUserNotificationCenter initWithBundleIdentifier:@"com.ryha.cydian"]` (private). It needs the
  `com.apple.private.usernotifications.bundle-identifiers` entitlement (`entitlements.plist`). The badge goes up
  with the notification (`content.badge`) or through `setBadgeCount:` (iOS 16+) / `setBadgeNumber:` (before 16).
  iOS shows them only once Cydian has notification permission.
- `com.ryha.cydian.upgrades.plist`: the launchd job at `/var/jb/Library/LaunchDaemons/`. It runs as root at load
  and every hour, and the 23-hour rule makes that one check a day, at most 24 hours apart. `deb/postinst` loads it
  and `deb/prerm` unloads it.
- `stage.sh <root> <sdk> <lld> [ldid] [rcodesign]`: `native/build.sh` calls this for the .deb. It builds arm64 iOS
  15+ (with `../Sources/availability.c` for `@available`), signs with the entitlements, and installs the job.

Try it on a phone: `sudo /var/jb/usr/libexec/cydian/cydian-upgrades --force --dry-run`.
