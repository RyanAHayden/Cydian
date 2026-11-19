# F219 Jailbreak package page: installed managers in Share, no Open In group

## What changed

- `web/app/screens/handoff.js`: `openInGroup` returns an empty fragment for a package page (`pkg` given) when
  `mode` (core/settings.js `detectMode`) is `"jailbreak"`. Source pages and the website / sideload IPA are unchanged.
  New `MANAGER_BUNDLES` (Cydia `com.saurik.Cydia`, Sileo `org.coolstar.SileoStore` + `org.coolstar.SileoNightly`,
  Zebra `xyz.willy.Zebra`, Irisin `wiki.qaq.irisin`), pure `managersIn(answer)` and `installedManagers(backend)`.
- `web/app/backend-native.js`: `appsInstalled(bundleIds)` over the existing `signing.isInstalled` bridge call (B46,
  `Workspace.isInstalled` = LSApplicationWorkspace `applicationIsInstalled:`), cached per app for the session. A
  failed call is not cached.
- `web/app/screens/browse.js`: `packageShareItems` takes `managers` (a Set of names); in the jailbreak build it lists
  only those managers (none when the set is empty or not asked). Site mode is unchanged. `showPackageShare` (the page header's Share and the
  row hold menu's Share) awaits `installedManagers()` first and passes `appIcon(label)` so the tiles show real icons.
  The package page warms the detection and `loadAppIcons` while it renders.

- `native/Sources/Sideload.swift`: new bridge call `apps.isInstalled {bundleIds}` -> `{installed: {id: bool|null}}`,
  registered beside B46's `signing.isInstalled` and answered the same way (`Workspace.isInstalled`), on a background
  queue, in every build.

## What failed first

- My first version reused `signing.isInstalled`. It is registered in every build, but `SignBridge.run` refuses every
  `signing.*` call when `AppMode.current == .jailbreak`, so on the iPhone 7 the call failed, the detection came back
  empty and Share showed only Copy Link (`share-before-native-fix.png`, taken with the web files swapped in on the old
  shell). Fix: the mode-independent `apps.isInstalled` above, and the backend calls that instead.

## Decisions
- Bundle IDs: Sileo's read from `/var/jb/Applications/Sileo.app/Info.plist` on the iPhone 7 (`org.coolstar.SileoStore`);
  Irisin's from its Xcode project (github.com/Lakr233/Irisin, branch main-4.0: `PRODUCT_BUNDLE_IDENTIFIER = wiki.qaq.irisin`).
  Sileo Nightly `org.coolstar.SileoNightly` and Zebra `xyz.willy.Zebra` are the well-known IDs, not checked on a device.
- The row hold menu's Share uses the same function, so it lists the installed managers too (same sheet as the header's,
  as F192/F194 intended).
- Icons: `app-icons.js` has icons for Sileo and Zebra. Cydia keeps its letter (AGENTS.md: never its logo). Irisin
  has no icon source there (its GitHub owner avatar is a person, not the app); it shows its letter tile. Not in this
  task's files, so left alone.
- The jailbreak package page also loses "Add on Another Device" (it was in the Open In group); the task says drop the
  group entirely. Copy Link stays in Share.

## Tests

- `web/app/screens/handoff-managers.test.js` (new): no Open In group in jailbreak mode, site/sideload keep it; bundle ID
  mapping; `installedManagers`; Share lists only the detected managers; site mode unchanged; showPackageShare wiring.
- `web/app/backend-native.test.js`: `appsInstalled` caching and the failed-call retry.

## Phone check (iPhone 7, 2026-11-18, under `ui-7.sh lock F219`)

- Built `native/build.sh deb` (com.ryha.ifizbox 0.9.7-1427, this branch) and installed it over the phone's 0.9.7-1426
  with `apt-get install`. **The phone keeps this build** (it has F219 in it until the next install from main).
- Opened `ifizbox://package?id=com.nahtedetihw.listening` (Havoc). The page ends Links / Depends / Source / footer:
  no Open In group (`no-open-in.png`).
- Header Share: Copy Link and **Sileo** (the only manager on the phone: `/var/jb/Applications` has Sileo.app and
  iFizBox.app), with Sileo's icon from app-icons.js (`share-sileo.png`).
- Tapping Sileo opened Listening's page in Sileo (`opened-in-sileo.png`).
- Removed my temp files from the phone's /tmp afterwards.

## Not verified

- Cydia, Zebra, Irisin and Sileo Nightly detection on a device: none of them is installed on the iPhone 7, and
  installing package managers on the shared test phone is outside this task. The bundle IDs for Zebra and Sileo Nightly
  are the well-known ones, not read from a device; Irisin's comes from its Xcode project. Covered by node tests only.
- The row hold menu's Share on the phone (same function as the header's; node tests only).
- Website and sideload IPA on real devices: unchanged code paths, checked by node tests (site/sideload modes keep
  the Open In group and the full manager list on the website).
