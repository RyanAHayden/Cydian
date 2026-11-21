# B238: push shows iOS's blank grid instead of the app icon

## Cause

iOS draws a notification's icon from a copy it caches per app, and only refreshes that copy when the iPhone
restarts. Updating the app (or reinstalling over it) and switching its alternate icon do not refresh it. Builds
before 0.17.1 had `CFBundleIconName = AppIcon` and no `Assets.car`, which gives the blank grid placeholder (B179's
diagnosis was right). A phone that showed a notification from one of those builds keeps the blank grid on 0.18.x
pushes until it restarts. The shipped 0.18.2 bundle is correct, so the user's fix is to **restart the iPhone**.

## What I checked

- **The shipped 0.18.2 IPA** (`gh release download v0.18.2`): `CFBundleIcons.CFBundlePrimaryIcon` has
  `CFBundleIconName = AppIcon` and `CFBundleIconFiles` with 20/29/40/60. The 18 MB `Assets.car` (listed with
  `native/carfile.py`) holds AppIcon (`AppIconLite*` and `AppIconLiteDark*`) at 20/29/40/60 @2x/@3x plus 1024, and
  all 74 alternate sets. The loose PNGs at every size are in the bundle.
- **F324**: `native/icon/glass.py` `CAR_SETS = ()`, so no `.icon` replaces the primary set. The committed
  `AssetsLite.car` is the one 0.18.2 shipped.
- **Re-signing**: the rig's zsign keeps `Assets.car` and the icon keys (`ios apps` on the phone shows the same
  `CFBundleIcons` as the IPA). In code, `native/sign/SignOptions.swift` only touches the icon keys when the user
  picks a new icon for an app.
- **Push data** (D1 `ifizbox-push`): every registered phone is on iOS 27.0.1 or 27.2 with a production token. The
  phone that updated to 0.18.2 six minutes after the 03:00 UTC push was most likely the user's.

## iPhone 15 Pro (iOS 27.0.1), test pushes through `/api/push/test`

All before a restart, so all of these showed the cached icon (worthless as evidence, as it turned out):
0.18.0 primary icon, the Classic/Midnight alternate, Clear, 0.17.0 (pre-B179) installed over it, and iOS Home
Screen set to Clear. Every one showed the full-colour LITE icon. A fresh v0.17.0 under a throwaway bundle ID showed
its icon in Spotlight (the Home Screen/Spotlight path falls back to `CFBundleIconFiles`; notifications do not).

After restarts (`ios reboot`):

| State | Notification icon |
| --- | --- |
| iFizBox's Clear icon picked (Theme > App Icon), restart | Clear (white square, thin globe: looks like the placeholder) |
| 0.17.0 installed, restart | **iOS's blank grid placeholder** (the user's screenshot) |
| 0.18.2 installed over it, no restart | still the blank grid (the user's case) |
| 0.18.2, restart | the LITE icon |

Screenshots: `ref/15/screens/b238-*.png` (main checkout's `ref/`, not committed): `b238-v170-nc2` (blank grid),
`b238-182-noreboot-nc` (blank on 0.18.2), `b238-182-reboot-nc` (fixed), `b238-reboot-nc` (Clear).

## Changes

- `tools/ui-15.sh ME reboot`: restarts the phone, waits for it, brings WDA back and unlocks (46 s here).
- `docs/iphone15.md`: the notification icon cache, and how to send a test push to the rig phone.
- `docs/push.md`: "A blank icon on the push": the cache, the pre-0.17.1 builds, restart to fix.

No app change: nothing the app can do refreshes iOS's notification icon copy (an update and an alternate-icon
switch both left it as it was).

## Tried and dropped

- In-app Upgrade (the app's own signer) on the 15: it needs a signing certificate, and the 15 has none imported
  (it installs through the Signing Server), so the on-phone re-sign path wasn't run.
- iOS Home Screen "Clear" style, iFizBox's Clear icon and an alternate before a restart: all "fine", but only
  because of the cache.

## Side effects on the 15

- iFizBox there is now 0.18.2 (was 0.18.0), installed with the rig's zsign; Theme back to Automatic,
  Classic/Gunmetal, Match Theme on; Home Screen style back to Default. Restarted five times.
- A throwaway `com.ryha.b238old` was installed and uninstalled.

## Found on the way (filed)

- Turning Match Theme back on (after Light icon = Clear) didn't switch the Home Screen icon back to the primary; no
  iOS alert came. Seen once. B243.
- iFizBox's Clear icon looks like iOS's blank placeholder in notifications and next to an app with no icon. B244.
- Home showed "Signing Needs Setup" while Installation & Signing said "Ready to Install" through the Signing Server.
  B245.

## Not verified

- **The user's phone.** I can't reach it. That its cached icon dates from a pre-0.17.1 build comes from the
  15's behaviour, not from their phone. Restarting it should fix it; if it still shows the grid after a restart,
  check Theme > App Icon (Clear looks like the placeholder).
- Whether anything other than a restart refreshes the cache (e.g. delete and reinstall, or a respring) wasn't
  tried: delete loses the app's data, and a respring needs a jailbreak.
- iOS 26 (the 15 runs 27.0.1). The registered phones are all on 27.x.
- The iPhone 7 / jailbreak .deb: not part of this bug (push is the sideload build's).
