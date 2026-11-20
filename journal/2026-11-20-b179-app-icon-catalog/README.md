# B179: blank notification icon → Assets.car + every icon size

## Cause

Both builds' Info.plist had `CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconName = AppIcon`, an asset catalog name,
but the bundle had no `Assets.car` (the Linux build has no actool), and only the 60pt loose PNGs
(`AppIcon60x60@2x/@3x.png`). With `CFBundleIconName` set, iOS takes the icon from the catalog (that's why our own
signer, `sign/SignOptions.swift`, deletes the key when it swaps an app's icon for loose PNGs). The home screen still
falls back to `CFBundleIconFiles`, but the place that draws notification icons on iOS 26 evidently doesn't, and it
draws its blank grid placeholder. The re-signing side was not the cause: `SignOptions.apply` only touches the icon
keys when the user picks a new icon, and nothing in the signer drops `Assets.car`.

## Fix

- `tools/icons.sh` now also writes `native/icon/AppIcon{,Lite}{20x20,29x29,40x40}@{2x,3x}.png` and
  `AppIcon{,Lite}1024.png` (rerun: the existing icons came out byte-identical; the launch images it rewrites differ
  every run and were restored, they're not part of this task).
- `native/icon/assets.sh [mac-host]`: builds an `AppIcon.appiconset` (every iPhone size + ios-marketing 1024) and runs
  `actool` (Xcode 26.3, iOS SDK 26.2 on the MBA, `DEVELOPER_DIR=/Applications/Xcode.app/...` since the default is
  the CLT) for each build, writing the committed `native/icon/Assets.car` (plain) and `AssetsLite.car` (LITE sash),
  plus `assets.sources` (sha256 of the PNGs it compiled from).
- `native/build.sh` copies the build's `.car` as `Assets.car` and every loose size as `AppIcon<pt>x<pt>@<s>x.png`;
  `Info.plist` lists all four stems in `CFBundleIconFiles` (kept as the fallback for re-signers that drop the name)
  and keeps `CFBundleIconName = AppIcon`.
- `native/carfile.py`: a stdlib reader for Assets.car (BOM store → `RENDITIONS` CSI headers, `FACETKEYS` names). Its
  listing of `AssetsLite.car` matched `xcrun assetutil --info` on the MBA rendition for rendition (names, pixel
  sizes, scales). `carfile.icon_problems` is now what `mkdeb.py check` and `mkipa.py check` run for the icon: loose
  PNG at each size with the right pixel size, `CFBundleIconName`, `Assets.car` present, holds `AppIcon`, every
  20/29/40/60pt @2x/@3x and the 1024, and the right build's art (LITE in the IPA, plain in the .deb).
- `native/test_icons.py`: the committed catalogs hold every size, `assets.sources` matches the current PNGs (a stale
  `.car` fails the gate with "rerun native/icon/assets.sh"), and the checker catches the original bug (name, no car),
  a missing 20pt file, a 60pt-only plist, the other build's catalog and an unreadable car.
- Fixtures in `test_native.py`/`test_ipa.py` lay out the icon as build.sh does (`copy_icons`).

## Checked

- `make -C native package` built both: `mkdeb.py check` and `mkipa.py check` pass with the new icon rules. The built
  `iFizBox.ipa` has all four stems in `CFBundleIconFiles`, `CFBundleIconName = AppIcon`, the eight loose PNGs and an
  `Assets.car` whose renditions are the `AppIconLite*` files at every size plus the 1024.

## Not verified

- **On a phone.** Nobody installed the new IPA on iOS 26 to see the notification icon. The task names no phone and
  the user's iOS 26 phone is their daily one; the cause above is inferred from the bundle (a catalog name with no
  catalog), not seen on the device. Check by hand: install the sideload IPA, trigger a notification (e.g. an update
  check), and look at its icon, plus Settings > Notifications and Spotlight.
- The jailbreak .deb on the iPhone 7 (iOS 15) was not installed either; the task didn't ask for phone time.
- The 1024 px PNGs carry an alpha channel; actool printed no warning for it.
