# F237 Keep Bundle IDs: signed apps keep their own bundle ID, on by default

Built on R25's verdict (journal/2026-11-18-r25-keep-bundle-id): Info.plist and the code signature keep the app's
ID, only the entitlements (`application-identifier`, keychain group) carry the profile's App ID.

## What I did

**Both signers**
- Native (`native/sign`): `Profile.signingIDs(for:keep:)` (Info.plist ID, entitlements ID: explicit App ID, or the
  wildcard narrowed with the existing `bundleID(for:)`), `Profile.pushEnvironment`. `SignOptions.keepBundleID`
  (default true, bridge key `keepBundleId`) and `keeps(_:running:)`. `IPASigner` signs the app and every extension
  with `entitlements(for: entID)` when kept, keeps extensions with an explicit profile (R25 #5: they keep their own
  Info.plist IDs, prefixed by the app's, under the app's application-identifier), and logs the App ID it used.
- `SignedRecord.StoredOptions.keepBundleID: Bool?`: records and My IPAs Sign Options written before have none and
  read as the old way, so Re-sign still replaces the app it installed. Custom `==` treats nil as false.
- Website: `core/websign.js signingIds()`, `profileInfo().push`; `websign-job.js` takes `keepBundleId`, gives zsign
  no `-b` when kept, and writes the entitlements for the profile's App ID.
- Bridge: `signing.inspect` takes `keepBundleId`, answers `signsAs` accordingly plus `appIdAs`, `keepBundleId`,
  `push`, `wildcard`, `profileAppId`; `signing.status`'s profile has `push`.

**Decisions (unattended, written down here)**
- iFizBox's own IPA: native keeps its ID only when the running iFizBox has that ID (`SignOptions.keeps`), else an
  update would install a second iFizBox beside one under the profile's ID. The website always signs it the old way:
  it can't see what's installed, and the early install link and bring files were built around that.
- No fallback to the old way for any profile kind: R25 says every kind installs with the ID kept (installd never
  compares application-identifier with the bundle ID). The brief's "else falls back" branch never triggers, so it
  isn't built; the warnings say what the profile can't do instead.
- The website still removes extensions (as before): unverified whether zsign's same-entitlements-for-all works on a
  stock phone (R26 filed).
- Only `keepBundleId: false` is sent (`core/keepid.js withKeep`); absent means on, so older shells and every call
  site that doesn't know about it get the new default.
- Pre-F237 My IPAs signed copies without an options file now count as stale (the default changed): re-signed with
  the ID kept on next Install.

**Pages**
- `core/keepid.js` (new, pure): `profileFacts`, `profileNotes` (wildcard: no Push; development: sandbox only; App
  ID without Push; one App ID per app), `originalNote` (original on the phone, not ours: iOS refuses over the App
  Store copy), `sheetNotes`, `originalState` (apps.isInstalled + signing.installed), `keepPlan`, `withKeep`,
  `storedKeep`, `OLD_WAY_ALERT`.
- Settings > Signing: **Keep Bundle IDs** switch (`core/settings.js keepBundleId`, site + sideload, default on,
  row tile indigo "copy"); turning it off shows the old-way alert first (`confirmOff`, `screens/settings.js
  makeSwitch`; Cancel puts the switch back). Below it a group with the profile's notes and "How to Get
  Notifications" (only when a note links the guide).
- Custom Install sheet (`signing-sheet.js`): a Keep Bundle ID switch (starts as the global setting; off asks with
  the app's name), the Bundle ID field follows it unless typed over, the footer shows the notes plus the
  original-app warning, and the guide row closes the sheet and opens the guide. `installParams` always sends the
  switch; `signsAsFor` gives the ID for either choice (`installedId`, the queue's `signsAs`).
- Guide: Home > User Guides > Notifications for Signed Apps (`screens/guides.js`, `guides/keep-bundle-id`): listed in
  lite (where apps are signed), opened from links in any mode (`linked`). Five tickable steps from R25.
- Queue: `appqueue.js libraryJob` carries `keepBundleId: false` from old Sign Options; `prepareParams` adds the
  global setting.
- docs/signing.md: "Keep Bundle IDs" section and the two ID-rule paragraphs.

## Checks run
- `node --test web/app`: all pass (new `core/keepid.test.js`, plus guide, settings, early-link tests updated).
- native: `python3 -m unittest native.test_sign native.test_sideload` pass, Swift built and ran: kept ID with an
  explicit profile (Info.plist + code identifiers kept, app and extension entitlements `TEAM.com.me.fixture`,
  extension kept), prefix wildcard narrowed, old way still renames and drops extensions, options/stored round trip,
  pre-F237 record = old way, iFizBox's own rule.
- `make -C native package` built both (first try caught a tuple-label error in Sideload.swift, fixed).
- **iPhone 7** (ssh only, no screen; R25's `/tmp/r25inst`): a test app (`com.ryha.ifizbox.f237test`, Tiny binary,
  one widget extension) signed by this branch's IPASigner on Linux with a throwaway identity and an explicit
  profile (`com.me.f237only`), both ways (tools/ here). Kept: installed, Info.plist ID kept, PlugIns/Ext.appex in.
  Old way: installed beside it as `com.me.f237only`, extension left out. Both uninstalled with `r25inst uninstall`;
  no Tiny.app left. `/tmp/f237/{kept,old}.ipa` stay on the phone's /tmp (deletes only allowed in the worktree).

## Tried and failed
- First native build: `(d.bundleID, d.bundleID)` as the fallback for a labelled tuple doesn't type-check; labelled it.
- Settings footer of 130 chars broke the 120-char group footer rule (the signing section joins its toggles'
  footers); shortened.

## Not verified
- **The sideload app's own UI on a phone** (Settings switch and its alert, Custom Install's switch, notes and guide
  link): no test phone runs the sideload build (the 7 runs the jailbreak .deb, which refuses signing.* calls), and putting
  the sideload IPA on it beside the .deb was out of scope for an unattended run. Checked only
  through the node tests of the pure parts; the sheet's DOM code has no test (signing-sheet tests inject the sheet).
- **The phone install went through the bridge-free signer on Linux**, not the sideload app's `signing.install`: the
  signer code is the same files, but Sideload.swift's inspect/install wiring of `keepBundleId` ran only in the build.
- **AppSync on the 7 skips profile and signature checks**, so the install shows only installd's non-signing checks
  (as R25's E1). A stock phone with a real profile is untested (R27).
- **Push arriving**: no Ad Hoc profile with Push here (R27, the user's test).
- **Original-app warning against a real App Store app**: `apps.isInstalled` answer shape taken from myipas.js; not
  run on a phone.
- **Website zsign with the ID kept** ran only with the fake zsign (no `-b`, entitlements file); the real WebAssembly
  zsign tests still sign iFizBox's own fixture, which stays the old way.
