# F282: the jailbreak daemon honours Ignore This Version

## What changed

- `web/app/core/settings.js`: `DAEMON_LISTS` gains `ignoredVersions`; `daemonPrefs()` sends it as its
  `{id: version}` object under `ifizbox.ignoredVersions`. `web/app/settings.js` createPrefsMirror already watches
  every `DAEMON_LISTS` name and the store notifies `("ignoredVersions", map)`, so it needed no change (a test there
  now covers it).
- `native/Sources/Bridge.swift` `Prefs`: a third kind of key, `maps` (`ifizbox.ignoredVersions`), taking a
  `{string: string}` dictionary. Not on the task's file list, but without it `prefs.set` refuses the key and the
  daemon never sees it; the change is three lines beside `lists`.
- `native/daemon/main.m` `e_settings`: reads `ifizbox.ignoredVersions` (a dictionary, or JSON text like
  `ifizbox.holds` can be) into `ignore=<id>=<version>` lines, sorted, skipping entries with `=`, CR or LF.
- `native/daemon/auto.c`/`auto.h`: `auto_same_version` (dpkg's verrevcmp order, equality only), `auto_ignored`,
  `auto_drop_ignored`. `auto_step` plans through `plan_kept`, which drops ignored upgrades from both the first
  plan and the after-install plan, so they are out of the count (badge, "n Upgrades", state) and of the
  installs. `auto_pick` also skips them, for callers that hand it an unfiltered list.
- Version equality follows `core/appupdates.js` (compareVersions equal): `0:1.0` = `1.0`, `01` = `1`,
  `1.0` = `1.0-0`; `1.0` != `1.0.0`.
- Tests: `test_auto.py` (samever, drop, pick, a whole run where the ignored one neither counts nor installs and a
  newer version counts again), `core/settings.test.js`, `settings.test.js`.

## Choices

- Ignored ids that are apps (sideload IDs) are sent too: harmless, the daemon only matches apt package ids, and
  filtering would need the catalog in core/settings.js.
- An empty map is sent as `{}` (not null): the daemon reads no lines from it, same result.
- When the user stops ignoring a version, that upgrade is "fresh" for the state at the next check and the
  "n Upgrades" notification goes up again. That matches what the app shows (it is an upgrade again).

## Not verified

- `main.m` and `Bridge.swift` were not compiled: no iOS SDK / Swift toolchain on this Linux machine (the gate
  doesn't build them either). The Objective-C uses only NSDictionary/NSJSONSerialization calls already used in the
  file's style; the Swift mirrors the `lists` branch.
- Not run on the iPhone 7: the task didn't ask for a phone test, and it needs a .deb build. To check: ignore a
  version in the app, then `sudo /var/jb/usr/libexec/...ifizbox-upgrades --force --dry-run` (path per
  `stage.sh`) should log "1 upgrade at an ignored version left out" and a count one lower.
