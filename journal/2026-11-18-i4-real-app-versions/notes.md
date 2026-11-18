# I4: real installed-app versions in jailbreak mode

## What I did

- **Helper verb `cydian-helper app-versions`** (native/helper): runs nothing. It reads installd's containers,
  `/var/containers/Bundle/Application/<UUID>/<the one>.app/Info.plist` (CFBundleIdentifier,
  CFBundleShortVersionString, CFBundleVersion) and `<UUID>/iTunesMetadata.plist` (bundleShortVersionString, App
  Store apps only). It prints `<id>\t<short>\t<build>\t<store>` per app. The code went at the end of `ipa.c`
  (`helper_app_versions`, `helper_plist_string`, `helper_app_value_ok`). Everything that links main.c already links
  ipa.c, so build.sh, the Makefile and test_helper's `build()` stay as they were. That keeps merges clean. Safety:
  it follows no links (lstat on the container, `find_app` takes exactly one real `.app` dir, Info.plist opened
  `O_NOFOLLOW`, at most 4 MiB). The bundle id must pass the same check as install-ipa. A value with a control
  character (tab, newline) or longer than 255 bytes prints as an empty field, so the line format can't be broken.
  At most 4096 apps. A missing folder prints nothing (exit 0). An unreadable one is exit 74. `HELPER_APPS_DIR`
  can be overridden at compile time, for the tests only.
- policy.c: `app_versions_plan` (no arguments allowed), `HV_APP_VERSIONS` and the name added to `HELPER_VERBS`.
  main.c: prints the list.
- **Fake helper** (native/fake/cydian-helper): the same verb over `$CYDIAN_APPS_DIR` (default
  `<prefix>/var/containers/Bundle/Application`), XML plists only.
- **web/app/backend-native.js** (jailbreak build only, in `queueCalls`):
  - `appVersions()` returns `[{ id, version, build, store }]`, or `null` when the helper can't run or refuses
    (an older helper without the verb). Returning `null` rather than `[]` matters: with `[]` every app would read
    as "not installed".
  - `installedApps(records)` returns the core/installed.js records run through `withRealVersions`. Each record gets
    `version` = the real version, `remembered`, `actual`, `disagrees` and `note`. The note reads "Installed: 1.6
    (Cydian remembered 1.5)", or "Not installed (Cydian remembered 1.5)" when no installed app has the id.
  - A remembered version that matches any of the app's spellings (short version, build number or store version)
    does not count as a disagreement. AltStore sources sometimes list the build number.
  - Cydian's own `self` record is left as it is, because dpkg owns it in jailbreak mode.
  - The sideload build has none of these calls (it has no helper), so it keeps the remembered version, as the
    task asks.
- **Not wired into screens.** The task's files are native/** and backend-native.js. The jailbreak Installed tab
  and Changes (app-updates.js `withAppUpgrades`, which skips jailbreak mode) are outside them. I filed **F87**
  (after I4) to use `installedApps` there and show the note.

## Tests

- `native/helper/test_appversions.py` (new, 5 tests) runs against a fake container tree. It covers the plan and its
  refusal; the list with a short version, a build number alone, and App Store metadata; a missing folder; odd
  entries (no Info.plist, a bad id, two `.app` dirs, a linked container, a linked Info.plist, a linked `.app` beside
  a real one, a stray file, a hidden dir, a tab in a value, a 256-byte value); and the whole chain (stand-in Cydian →
  helper → listing, a refused argument exiting 64, an unreadable folder exiting 74).
- `web/app/backend-native-appversions.test.js` (new, 6 tests) uses the fake bridge and the fake helper over a fake
  tree. It covers appVersions, installedApps with notes, no folder, no helper, the sideload build having no calls,
  and the parse and compare rules.
- `test_helper.py` is still green (55 tests). `make -C native/helper ios` builds with the iOS 27.1 SDK, so the
  CoreFoundation branch of `helper_plist_string` compiles.

## Not verified

- **On a device: nothing.** The user has no jailbroken phone yet (task text). Untested so far:
  - that root can list `/var/containers/Bundle/Application` on a modern rootless jailbreak (it should: installd's
    folders are 0755 and the helper runs as root);
  - that real binary Info.plists and iTunesMetadata.plists parse (the CFPropertyList branch is used only on iOS;
    the Linux tests use XML);
  - how long a phone with hundreds of apps takes to list.
- Binary plists are not read off iOS, so the fake tree is XML only.
- The UI showing the note is F87's job, not checked here.
