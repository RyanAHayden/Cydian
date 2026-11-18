# F171 iFizBox rename 2/3: IDs, storage keys and on-device paths

User 2026-11-18: IDs become `com.ryha.ifizbox`; "we can break user data paths and not support old cydian 100%";
no fallbacks for old hosts, saved values, IDs or asset names before 1.0.

## Second attempt

The first attempt (wip/F171, one commit on top of F170's merge) could not merge: 148 commits had landed on main
since (among them bd193f3, which renamed the GitHub slug to RyanAHayden/iFizBox, and B21's new signing fixture), and
after a fix session and a repair session the gate still failed (ledger 11:45). This run did not merge it. It
redid the rename on current main:

1. `ren.py` (in this folder) is the scripted pass the first attempt described. Applied to F170's merge commit, it
   reproduces wip/F171 except for the hand edits; that check is how I knew the script was the same one.
2. The hand edits were taken out as a patch (wip minus scripted-base) and applied to main after the script.
   14 hunks did not apply. Most were the GitHub slug, which main had already renamed. One was Bridge.swift's
   self-update `.deb` name, and C8 had already deleted that code. I redid the rest by hand (postinst, altsource.py,
   isSelfIpa, the test fixtures' asset names).
3. New on main since the first attempt, and fixed here: `core/selfupdate.js` now uses `${NAME}` for asset names, so
   it imports `NAME`. `web/fixtures/missing-exe.ipa` (B21) was rebuilt from `tiny-ifizbox.ipa`, and its Kit.framework
   is now `dev.ifizbox.kit` (native/test_sign.py and sign/tests/main.swift already expected that after the script).
   `zsign.wasm` was rebuilt, because main had changed it (B21's skip-missing-exe patch).

## What changed (same scope as the first attempt)

- Every tracked text file outside `plan/`, `journal/` and `docs/concepts/`: `cydian` -> `ifizbox`,
  `CYDIAN` -> `IFIZBOX`, `Cydian` -> `iFizBox` (Swift's mangled `6Cydian` -> `7iFizBox`). Files whose names had it:
  `ifizbox-helper`, `com.ryha.ifizbox.upgrades.plist`, `iFizBox-Bridging-Header.h`, `tools/zsign-wasm/ifizbox.cpp`,
  `web/fixtures/altstore/ifizbox.json`, `tiny-ifizbox.ipa`, the fake prefix's `var/cache/ifizbox`. That covers:
  - bundle IDs (with their `.share`, `.widget`… suffixes), the app group and keychain groups, the .deb package
  - the helper, daemon and launchd names, `IFIZBOX_*` variables, the `ifizboxNative`/`ifizboxApp` globals
  - localStorage/IndexedDB keys (`ifizbox.*`, `ifizbox-account`), the `ifizbox://` scheme
  - `ifizbox-identity.plist`, `ifizbox.upgrades.plist`, `ifizbox.sources`, `iFizBox.app/iFizBox`, the appex names
  - release assets (`iFizBox.ipa`/`.deb`), `X-iFizBox-Minimum-Version`, and the worker's `HOST_IDS = "*.ifizbox"`
- Left alone, by design:
  - Left for F172: `cydian.dev`, and the old worker's `name = "cydian-sign"` in worker/wrangler.toml.
  - Already published under the old name, so these URLs stay: the test-fixtures pre-release's `cydian-0.x.ipa`
    (testrepo/altstore*.json), and `web/app/source.json`'s real release URLs (`v0.x/Cydian.ipa`). Test data that only
    looked like release URLs now says `iFizBox.ipa`.
- No migration: postinst lost its B17 block (it rewrote the old GitHub address in the old sources file), and
  `native/deb/test_postinst_source.py` went with it.
- The helper prefix length changed: `dropFirst(15)`/`slice(15)` after `ifizbox-helper: ` are now 16 (Apt.swift,
  Share.swift, ipa-install.js, fake-native.mjs).
- Names now come from the brand source:
  - JS asset names are `${NAME}.ipa`/`.deb` (appoffer, selfupdate, essential).
  - Swift's keychain labels and User-Agent use `Brand.name`.
  - `tools/altsource.py` takes `BUNDLE_ID` and the IPA name from brand.env.
  - The plists, entitlements and control still spell `com.ryha.ifizbox`. `test_brand.py` checks that every
    `com.ryha.*` ID equals `BRAND_BUNDLE_ID` or one of its suffixes.
- `isSelfIpa` (signing-client.js) takes any IPA of a versioned release (`download/v<X.Y.Z>/*.ipa`), as well as
  `${NAME}.ipa` and `${NAME}-<v>.ipa`. Reason: `source.json`'s newest entry is still v0.9.2's `Cydian.ipa` until the
  next release, and without this the site would treat it as a foreign app. This doesn't match on the old name;
  it trusts the versioned release tag. `tools/altsource.py check` and the source.json test accept any IPA of
  that release for the same reason.
- `native/test_brand.py` `NoOldIds`:
  - It greps every tracked text file and file name outside plan/, journal/ and docs/concepts for the old name, in
    any case. The only exceptions are the F172 patterns and the published asset URLs. F172 should drop
    `\.dev` and `-sign` from that list. This run removed the GitHub-slug exception, since main had already renamed
    the slug.
  - It also checks the binary fixtures (test.mobileprovision, zsign.wasm, tiny-ifizbox.ipa, missing-exe.ipa) and
    the ID rule above.
- Binaries:
  - `zsign.wasm`/`zsign.js` were rebuilt with `tools/build-zsign-wasm.sh`, using the same emcc as the committed copy.
    The gate compares them byte for byte, and they pass. The build exports `_ifizbox_unzip` and `_ifizbox_plist_json`.
  - `tiny-ifizbox.ipa` and `test.mobileprovision` were taken from wip/F171. Main hadn't changed them, and the first
    attempt had patched "Cydian" to the same-length "FizBox" in the provision.
- Docs: AGENTS.md's bundle ID line, docs/iphone7.md (package, paths, how to reinstall, clean removal, don't
  install a pre-F171 build there), docs/release.md.

Effects of the clean break:
- The account salt changed (`ifizbox-account-v1`), so an old account key derives a different account id.
- Old installs' localStorage, sources, keychain items and the app itself are not carried over.
- Home's Download IPA link (`releases/latest/download/iFizBox.ipa`) 404s until a release built after F171 is out.
  The newest release (v0.9.2) still ships `com.ryha.cydian` and `Cydian.ipa/.deb`.

## iPhone 7 (iOS 15.8.8, palera1n rootless), 2026-11-18 14:00–14:06

- Found the phone back on `com.ryha.cydian` 0.9.2-1139, with iFizBox gone (the first attempt had installed
  0.5.0-1004). Agents on main's code keep installing the old-name build, and they will until this branch merges.
  docs/iphone7.md now tells them not to.
- I took both UI locks (`ifizbox-7-ui.lock`, and `cydian-7-ui.lock` through main's ui-7.sh) so agents on the old
  code wouldn't drive the screen at the same time.
- `sudo apt-get remove -y com.ryha.cydian`. Its prerm unloaded the job and the package's files went with it.
- Then I removed what both apps had made, the old name and the first attempt's iFizBox state:
  - Gone: `cydian.sources` and `ifizbox.sources`, `/var/jb/var/{lib,cache}/{cydian,ifizbox}`,
    `/var/tmp/com.ryha.{cydian,ifizbox}`, `/var/mobile/Library/{Caches,HTTPStorages}/com.ryha.*`, the saved
    states, `Cookies/com.ryha.cydian.binarycookies`, `/var/mobile/Library/WebKit/com.ryha.cydian`, and eight
    4 KB container stubs naming either ID.
  - `cydian.sources` held three sources somebody had added (getzbra, mineek, kittymaxine). They went with it:
    the clean break.
  - Then `uicache -a`.
- Installed `native/build/iFizBox.deb` from this branch's gate build (`com.ryha.ifizbox` 0.9.2-1152) with apt.
  It put in `iFizBox.app`, `/var/jb/usr/libexec/ifizbox/{ifizbox-helper,ifizbox-upgrades}`, and
  `com.ryha.ifizbox.upgrades` (loaded). postinst made `/var/mobile/Library/WebKit/com.ryha.ifizbox`. **Left installed.**
- Through `tools/ui-7.sh`:
  1. `ifizbox://sources` launched the app and asked for notifications (Allow).
  2. `ifizbox://add?url=https://ios.jjolano.me/` -> Add Source: "jjolano, 23" appeared, and the stanza is in
     `ifizbox.sources`.
  3. Refresh: every source got its count (BigBoss 233, Chariz 388, ElleKit 22, Havoc 1,805, jjolano 23,
     palera1n 8). The built-in iFizBox source, `https://cydian.dev/repo/`, got none (F172 moves it).
  4. `ifizbox://package?id=me.jjolano.fmwk.hookkit` -> Install -> Install -> Confirm -> Complete, "Installed
     HookKit Framework", through `/var/tmp/ifizbox-deb.*`. `dpkg-query` shows 3.0.5-1.
- Afterwards I removed HookKit with apt. jjolano stays in iFizBox's list. Screenshots are `ref/7/screens/f171b-*.png`
  (gitignored).

## Not verified

- A refresh of the built-in source: it is still `https://cydian.dev/repo/` (F172), and it showed no package count.
  Every other source refreshed.
- Deploying the worker with `HOST_IDS = "*.ifizbox"`: not deployed. F172 deploys, and this task publishes only
  through git.
- The sideload IPA on a phone (app group `group.com.ryha.ifizbox`): the gate builds it and mkipa checks it, but it
  wasn't installed anywhere. This task's device check is the jailbreak .deb.
- The widget, share extension and Shortcuts under their new IDs on the phone: they are built into the .deb and
  checked by the gate's tests, but weren't used on the 7.
- The zsign wasm in a real browser: the node tests sign with it, but I didn't run a browser.
- How long the 7 stays on iFizBox: until this merges, another task on main's code may install a Cydian build again.
