# F171 iFizBox rename 2/3: IDs, storage keys and on-device paths

User 2026-11-18: IDs become `com.ryha.ifizbox`; "we can break user data paths and not support old cydian 100%".

## What changed

- One scripted pass over every tracked text file outside `plan/`, `journal/` and `docs/concepts/` (~290 files):
  `cydian` -> `ifizbox`, `CYDIAN` -> `IFIZBOX`, `Cydian` -> `iFizBox` (Swift mangled `6Cydian` -> `7iFizBox`), and
  the files whose names had it (`ifizbox-helper`, `com.ryha.ifizbox.upgrades.plist`, `iFizBox-Bridging-Header.h`,
  `tools/zsign-wasm/ifizbox.cpp`, the fixtures). That covers bundle IDs (`.share`, `.widget`, ...), the app
  group and keychain groups, the .deb package, helper/daemon/launchd names, `IFIZBOX_*` env and build variables,
  `ifizboxNative`/`ifizboxApp` JS globals, localStorage/IndexedDB keys (`ifizbox.*`, `ifizbox-account`), the
  `ifizbox://` URL scheme, `ifizbox-identity.plist`, `ifizbox.upgrades.plist`, `ifizbox.sources`, the module and
  executable (`iFizBox.app/iFizBox`, `iFizBoxWidget.appex`, `iFizBoxShare.appex`), release assets
  (`iFizBox.ipa`/`.deb`), `X-iFizBox-Minimum-Version`, and the worker's `HOST_IDS = "*.ifizbox"` (both tomls).
- Left for F172, by design: `cydian.dev` (also as `cydian\.dev` in regexes), the GitHub slug `RyanAHayden/Cydian`,
  the old worker's `name = "cydian-sign"`, and URLs of assets already published under the old name (the
  test-fixtures pre-release's `cydian-0.x.ipa`, `web/app/source.json`'s v0.5.0 `Cydian.ipa`).
- No migration (the brief): the .deb's postinst lost the B17 block that rewrote the old GitHub address in the old
  sources file, and its test `native/deb/test_postinst_source.py` went with it.
- Code that hung on the old length: `dropFirst(15)`/`slice(15)` after the `ifizbox-helper: ` prefix are now 16
  (Apt.swift, Share.swift, ipa-install.js, fake-native.mjs).
- Through the brand source: JS asset names are `${NAME}.ipa`/`.deb` (appoffer, selfupdate, essential); Swift's
  keychain labels, User-Agent and update file use `Brand.name`; `tools/altsource.py` takes `BUNDLE_ID` and the
  IPA name from brand.env. The plists, entitlements and control still spell `com.ryha.ifizbox`: build.sh feeds
  entitlements straight to ldid and the Python tests read the templates as plists, so rather than template them
  `test_brand.py` checks that every `com.ryha.*` ID in the repo is `BRAND_BUNDLE_ID` or a suffix of it.
- `isSelfIpa` (signing-client.js) now takes any IPA of a versioned release (`download/v<X.Y.Z>/*.ipa`), so the live
  site still treats v0.5.0's `Cydian.ipa` as iFizBox's own until the next release; a test covers it.
  `tools/altsource.py check` and the source.json test accept any IPA of that release for the same reason.
- `native/test_brand.py`: `NoOldIds` greps every tracked text file (and file name) outside plan/, journal/,
  docs/concepts for the old name in any case, with only the F172 patterns allowed (F172 should drop those);
  checks the binary fixtures too; the ID test above. The file spells the old name in pieces to pass its own grep.
- Binary files: `web/app/vendor/zsign/zsign.wasm` rebuilt with `tools/build-zsign-wasm.sh` (emcc 6.0.13 from
  ~/emsdk, the same as the committed copy, so the gate compares byte for byte; it exports `_ifizbox_unzip`,
  `_ifizbox_plist_json`). `tiny-ifizbox.ipa`: Info.plist rewritten (`com.ryha.ifizbox`, "Tiny iFizBox").
  `test.mobileprovision`: "Cydian" patched to the same-length "FizBox" in place (DER lengths unchanged; its CMS
  signature no longer verifies, but nothing checks it: every node test passes, zsign signing included).
- AGENTS.md's bundle ID line, brand.js/brand.env comments, docs/iphone7.md (package, paths, reinstall, clean
  removal), docs/release.md (postinst note).

Effects of the clean break worth knowing:
- The account salt changed (`ifizbox-account-v1`), so an old account key derives a different account id.
- Old installs' localStorage, sources, keychain items and the app itself are not carried over.
- `releases/latest/download/iFizBox.ipa` (Home's Download IPA) 404s until a release built after F171 is out;
  the newest release (v0.9.0, published today) still ships `com.ryha.cydian` and `Cydian.ipa/.deb`.

## iPhone 7 (iOS 15.8.8, palera1n rootless)

- `com.ryha.cydian` 0.5.0-974 was half-configured (dpkg "was interrupted"; no dpkg/apt running):
  `sudo dpkg --configure -a`, then `sudo apt-get remove -y com.ryha.cydian`. prerm unloaded the launchd job and
  unregistered the app; `/var/jb/Applications/Cydian.app`, `/var/jb/usr/libexec/cydian`, the LaunchDaemon plist
  went with the package.
- Removed what the app had made itself: `/var/jb/etc/apt/sources.list.d/cydian.sources`, `/var/jb/var/{lib,cache}/cydian`,
  `/var/mobile/Library/{Caches,HTTPStorages}/com.ryha.cydian`, its cookies and saved state, and four 4 KB container
  stubs (Data/Application, Shared/AppGroup, two PluginKitPlugin) whose metadata named com.ryha.cydian. `uicache -a`;
  `uicache -l` lists nothing of com.ryha.* afterwards.
- Installed `native/build/iFizBox.deb` (com.ryha.ifizbox 0.5.0-1004, from this branch's gate build) with apt:
  `/var/jb/Applications/iFizBox.app`, `/var/jb/usr/libexec/ifizbox/{ifizbox-helper,ifizbox-upgrades}`,
  `com.ryha.ifizbox.upgrades` loaded. Left installed.
- Through `tools/ui-7.sh` (both the new `ifizbox-7-ui.lock` and the old `cydian-7-ui.lock` taken, since agents on
  the old code use the old name): first launch asked for notifications (Allow); `ifizbox://sources` opened Sources;
  `ifizbox://add?url=https://ios.jjolano.me/` -> Add Source -> "jjolano, 23" in the list and a stanza in
  `ifizbox.sources`; Refresh ran apt-get update: jjolano's lists landed in `/var/jb/var/lib/apt/lists/`, but it
  ended with "Some index files failed to download" because `https://cydian.dev/repo/` (the built-in source, F172)
  answers **525** right now; `ifizbox://package?id=me.jjolano.fmwk.hookkit` -> Install -> Confirm -> Complete
  ("Installed HookKit Framework", via `/var/tmp/ifizbox-deb.*`), `dpkg-query` 3.0.5-1. Removed HookKit again with
  apt afterwards; the jjolano source stays in iFizBox's list.
- The launch also showed "iFizBox 0.9.0 Is Available" (the v0.9.0 release, old package ID): answered Later.
- Screenshots: `ref/7/screens/f171-*.png` (gitignored).

## Not verified

- Refresh with every source succeeding: cydian.dev answers 525 (Cloudflare can't reach its origin; the old worker is
  being retired, F172), so the built-in source failed; the added source's refresh did work.
- Deploying the worker with `HOST_IDS = "*.ifizbox"`: not deployed (F172 deploys; the task publishes only through git).
- The sideload IPA on a phone (iFizBox.ipa, app group `group.com.ryha.ifizbox`): built and checked by mkipa in
  the gate, not installed anywhere; this task's device check is the jailbreak .deb.
- The widget, share extension and Shortcuts under their new IDs on the phone: built into the .deb and checked by
  the gate's tests, not exercised on the 7.
- The zsign wasm on a real browser: the node test signs with it; no browser run.
