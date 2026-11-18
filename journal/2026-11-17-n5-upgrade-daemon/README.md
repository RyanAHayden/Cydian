# N5: background upgrade checks on the device (launchd daemon)

## What I did

- `native/daemon/`: `cydian-upgrades`, a root launchd daemon in the jailbreak .deb (see its README.md).
  - `upgrades.c/.h`: plain C rules that the host tests. The upgrade count comes from the `Inst id [from] (to …)` lines of
    `apt-get -s dist-upgrade` (new installs and same-version lines don't count, a `:arch` suffix is dropped).
    Names come from dpkg's status (installed stanzas only). Title and body use the same words as `web/push.py`. The
    "fresh" rule is push.py `decide` (notify only when an id=version wasn't shown before). A check is "due" 23 hours
    after the last one.
  - `main.m`: Objective-C daemon. apt-get update (10 min limit), the simulated plan (2 min limit), names, then the badge
    via `setBadgeCount:` (iOS 16+) or `setBadgeNumber:`, and a notification via the private
    `-[UNUserNotificationCenter initWithBundleIdentifier:]`. It writes state atomically and holds a flock for one run
    at a time. Flags: `--force`, `--no-update`, `--dry-run`.
  - `com.ryha.cydian.upgrades.plist`: RunAtLoad plus StartInterval 3600. With the 23-hour rule, checks land at most
    24 hours apart, even when a rootless jailbreak reloads its jobs often (a plain StartInterval 86400 restarts its
    timer on every load).
  - `entitlements.plist`: `com.apple.private.usernotifications.bundle-identifiers = [com.ryha.cydian]`, no-sandbox,
    platform-application.
  - `stage.sh`: builds arm64 iOS 15+ with clang + ld64.lld, signs with the entitlements (ldid or rcodesign) and
    installs the job.
- Wiring outside `native/daemon/` (small, additive). I judged it part of the task, because a daemon that never gets
  installed does nothing:
  - `native/build.sh` calls `daemon/stage.sh` in the .deb part only.
  - `deb/postinst` runs `launchctl unload`/`load`, and `deb/prerm` runs `unload` on remove/purge.
  - `native/README.md` has one bullet.
- `test_daemon.py` (15 tests): count, odd lines, CRLF, more than 2048 upgrades, names, titles and bodies (1/2/3/4),
  the same words as `web/push.py message()` (skips if flask isn't importable), fresh, state, due, and the launchd
  job, entitlements, stage path and postinst/prerm lines.

## Decisions

- **apt directly, not cydian-helper.** The helper refuses any caller but Cydian.app (parent exe check), and the
  daemon is already root through launchd.
- **dist-upgrade for the count:** it matches what "Upgrade All" would take, apt leaves held packages out, and the
  `[from]` filter keeps new dependencies out.
- **A failed apt-get update still counts** from the lists that are there. Otherwise one dead source would stop the
  check for good, and a failure that writes no state would retry every hour.
- **Quiet when nothing is new.** Unlike the web push (iOS makes a web push always show something), a local
  notification is optional, so the daemon only sets the badge.

## Tried and failed

- First iOS link: `undefined symbol __isPlatformVersionAtLeast` from `@available`. Fixed by linking the app's
  `native/Sources/availability.c` (its compiler-rt stand-in), unchanged.

## Follow-ups filed

- F65: the app asks for notification permission, a Settings switch the daemon reads, a tap opens Changes, and the
  badge clears.
- T5: mkdeb.py/mkipa.py checks for the daemon.

## Not verified

- **Nothing ran on a phone.** There is no jailbroken iOS 15+ test phone (user, 2026-11-17), so none of these are
  checked:
  - launchd loading `/var/jb/Library/LaunchDaemons` jobs on install, and on boot or re-jailbreak (Dopamine loads
    them; roothide and rootful paths are not handled)
  - `launchctl load` in postinst
  - apt-get running from the daemon
  - whether usernotificationsd accepts `initWithBundleIdentifier:` with that entitlement on iOS 15–27
  - whether `setBadgeNumber:` exists on iOS 15
  - whether iOS shows anything before the app has notification permission (F65)
- I checked the daemon only as far as Linux allows: it compiles and links for arm64-apple-ios15.0 (Foundation,
  UserNotifications, libobjc, libSystem), and rcodesign signs it with the entitlements slot. `main.m` itself has no
  automated test, because it is all apt, launchd and UserNotifications.
- The iPhone 4S was not used: the task says not to, and iOS 6 has neither UserNotifications nor `/var/jb`.
