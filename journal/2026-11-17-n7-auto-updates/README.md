# N7: automatic updates in the jailbreak daemon (2026-11-17)

## What I did

- `native/daemon/auto.c`, `auto.h`: the decisions, in plain C beside N5's `upgrades.c`: the F13 settings as the
  daemon reads them (`key=value` text; defaults as settings.js, except Check for Updates stays daily while the
  setting is missing, so the daemon keeps N5's behaviour until the app hands the settings over), when a check runs
  (Off / On Launch: never in the background; 6 h: 5 h since the last, daily: 23 h, launchd's hourly start;
  cellular waits when it isn't allowed), what installs (Everything / marked; never a hold from `apt-mark
  showhold` or the settings' list; never an `id=version` that already failed), when (charging and locked if set,
  a network that's allowed, dpkg's lock free, a plan without `Remv`), the respring (Cydia's `finish:` protocol on
  stdout, or files in the tweak/preference/theme folders from the dpkg `.list`; notify, or respring when locked,
  pending across runs and dropped once SpringBoard has started since), the rollback store (installed version's
  .deb plus the newest 0-2 others, by mtime) and the notification words.
- `auto_step`: one whole hourly run over a `struct auto_env` (facts and apt as callbacks). `main.m` now only fills
  it: CFPreferences (user mobile) for the settings, SCNetworkReachability, IOKit power sources (declared by hand,
  the SDK has the symbols in IOKit.tbd but no header), `com.apple.springboard.lockstate`, sysctl for SpringBoard's
  start, `lock-frontend` for busy, apt-get with `--only-upgrade --no-remove`, sbreload/killall.
- `auto_driver.c` + `test_auto.py` (33 tests): every decision, and whole runs against a fake phone/clock/apt in
  a temp folder (several runs in a row, the clock moved between them): waits for charging and locked then installs
  without a new `apt-get update`, marked-only, holds, failure not retried until a new version, dpkg busy waits
  without failing, a plan that removes waits for a person, respring notify / locked now / waits for the lock /
  dropped after a user respring, rollback keep 0/1/2 with real files, dry run, cellular, update/simulate failures.
- `stage.sh` links `auto.c`, SystemConfiguration and IOKit. Built for iOS with stage.sh by hand (links, 94 KB).
- Follow-ups filed: **F70** (the app shows the Automatic Installs rows, mirrors the settings into its preferences
  for the daemon, and a per-package "Update Automatically" mark), **F71** (Roll Back on the package page through a
  new helper verb that installs a stored .deb).

## Decisions (unattended, written down)

- Settings channel: the app's NSUserDefaults (`com.ryha.cydian`, user mobile), read by the root daemon with
  `CFPreferencesCopyMultiple(..., CFSTR("mobile"), kCFPreferencesAnyHost)` (fresh through cfprefsd), falling back to
  the plist file. Chosen over a helper verb writing a root file: the app can write its own defaults with no new
  root surface. Risk accepted: anything running as mobile can change these; at worst it makes the daemon install
  upgrades apt already offers, or respring.
- Installs run apt directly (the daemon is root through launchd); cydian-helper only accepts Cydian as caller.
- A failed or refused auto-install is recorded per `id=version` and notified once, so a broken package doesn't
  retry and notify every hour.
- With Only When Charging and Locked, a run that isn't charging and locked runs no apt at all; one that is plans
  again (local `apt-get -s`) while the state lists an upgrade that hasn't failed. That includes held or unmarked
  ones, so a phone with a held upgrade plans hourly while charging and locked: cheap, left as is.
- Rollback only stores .debs the daemon's own installs touch (the installed one from apt's cache, if there, and the
  new one). Installs from the app (N4) don't feed it; F71 can widen that if wanted.

## Tried and failed

- `#define _POSIX_C_SOURCE 200809L` at the top of auto.c (needed on Linux for `utimensat`/`O_NOFOLLOW` under
  `-std=c11`) hid `O_NOFOLLOW` on Darwin: now only defined off Apple.
- First run of the tests: two wrong expectations in the tests themselves (a failed `apt-get -s` is still a call;
  the fake apt's plan has to be changed by hand after an install). Fixed the tests.

## Not verified

- Nothing ran on a phone: the user has no jailbroken iPhone yet (N5/N7 briefs). So none of main.m's facts are
  checked: that CFPreferences for user mobile returns the app's values from a root daemon, that
  `IOPSGetProvidingPowerSourceType` says "AC Power" while charging on iOS 15-27, that
  `com.apple.springboard.lockstate` reads non-zero when locked from a launchd daemon, that sysctl gives
  SpringBoard's `p_starttime`, the reachability flags on cellular, that `--no-remove` with `--only-upgrade` behaves
  on Procursus' apt, that maintainer scripts' `finish:` lines reach stdout with `CYDIA=1 1`, and sbreload.
- The app doesn't write the settings yet (F70), so on a phone today the daemon behaves as N5 (daily check, no
  installs) — by design, but the whole N7 path is only reachable once F70 lands.
- iOS build: compiled and linked with stage.sh (no signer here, so no entitlements); the full `.deb` build runs in
  the gate.
