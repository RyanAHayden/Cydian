# B72: why YouMod didn't install on the iPhone 7

## Finding

installd's real reason, asked directly on the 7 (iOS 15.8.8, AppSync Unified 116.0):

```
The system version is lower than the minimum OS version specified for bundle at
/var/installd/Library/Caches/com.apple.mobile.installd.staging/temp.FkcxR5/extracted/Payload/YouTube.app.
Have 15.8.8; need 17.0
  FunctionName = "-[MIBundle isMinimumOSVersion:applicableToOSVersion:error:]"; LegacyErrorString = DeviceOSVersionTooLow
```

- The IPA: `YouMod_2.0.0_21.45.4.ipa` (132.8 MB) from the "YouMod Repo" AltStore source
  (github.com/MountainofPenguin/Altstore-Repository). Its `Payload/YouTube.app/Info.plist` has
  `MinimumOSVersion` **17.0**, but the source's JSON says `minOSVersion: "14.0"` for every version, this one too.
  So the app page showed it as fitting and iFizBox downloaded 130 MB for nothing.
- The other suspects didn't apply. The main binary already has `application-identifier`
  (`EQHXZ8M8AV.com.google.ios.youtube`), so the helper sent the IPA to installd unsigned by us. There are no
  PlugIns/Extensions (Frameworks hold the tweak dylibs and CydiaSubstrate.framework). `com.google.ios.youtube`
  wasn't installed on the phone, so there was no bundle ID clash.
- Nothing on our side can make it install: 15.8.8 is the iPhone 7's last iOS. The older versions in the same source
  (21.18.4, 21.17.3) may have a lower real minimum. I didn't check them (each is 120–145 MB).
- The project's Worker already reads the IPA's real value: `https://ifizbox.com/api/ipainfo?url=…` answered
  `{"minOSVersion":"17.0","deviceFamily":[1,2],"bundleId":"com.google.ios.youtube","version":"21.45.4"}`.

How I asked installd: `ifizbox-helper` refuses every caller but the app (`helper_caller_ok`), so a scratch tool (not
committed) called `LSApplicationWorkspace installApplication:withOptions:error:` and printed the NSError's
`userInfo`. It was signed on the phone with `ldid -Snative/helper/entitlements.plist` and run with `sudo -n`. There
is no `appinst` on the phone, and no akemi source in apt to get it from.

## Extensions and ldid (checked on the 7 with a scratch .app + .appex, unsigned arm64 binaries)

- `ldid -M -S<ent> X.app` signs every nested bundle with the same entitlements: the .appex got the main app's
  `application-identifier`.
- Signing an .appex first and then `ldid -M -S` on the .app overwrites the .appex's entitlements.
- `ldid -M` on a directory without `-S` is refused ("Only -S and -s can be used on directories").
- `ldid -s X.app` after per-binary `ldid -M -S<ent> <binary>` keeps each binary's own entitlements and writes
  `_CodeSignature/CodeResources` for the .app and the .appex. That is what the helper does now.
- installd with AppSync took the .appex both with no `application-identifier` and with the main app's. So extensions
  weren't what broke YouMod; the per-extension ID is just the correct signature. installd did refuse an .appex with
  no `CFBundleDisplayName` ("MissingBundleDisplayNameString").
- The test app (`com.example.b72test`) was uninstalled through installd afterwards; no `B72Test` container is left.

## What changed

- Helper (`native/helper/ipa.c`):
  - After unzipping, before ldid or installd, it compares `MinimumOSVersion` with `SystemVersion.plist`'s
    `ProductVersion`. A too-new app stops with exit 1: "YouTube 21.45.4 needs iOS 17.0 or later (its
    MinimumOSVersion); this iPhone has iOS 15.8.8".
  - installd's refusal is now the last `ifizbox-helper:` line, which is the one the app shows: "installd refused
    the app: <installd's words>", newlines flattened and the staging path cut down to `Payload/…`.
  - Fakesign: each binary without `application-identifier` (main + `PlugIns/*.appex` + `Extensions/*.appex`) gets
    its own `<team>.<its bundle id>` (team: the main binary's team-identifier, else its application-identifier
    prefix, else FAKESIGNED), then one `ldid -s` seals the .app.
  - `native/fake/ifizbox-helper` says the same refusal line.
- Web:
  - `screens/ipa-install.js ipaNeeds`: before AppSync or the download, the IPA's own MinimumOSVersion from
    `/api/ipainfo`, given 8 s and counted only when `from: "ipa"`, compared with this iPhone's iOS. Too new:
    one "Needs iOS 17.0" alert and nothing downloaded.
  - `markIpaNeeds`: the app page's jailbreak Install row subtitle becomes "Needs iOS 17.0 (this iPhone has
    15.8.8)".
  - `core/ipainstall.js ipaError` titles the helper's "needs iOS" line, and installd's "Have …; need …", "Needs iOS
    X".
- Tests: `native/helper/test_helper.py` (appex fakesign, min-OS check, installd's words, os_cmp, why_clean) and
  `web/app/screens/ipa-needs.test.js`.

## Not verified

(filled in below after the phone run)
