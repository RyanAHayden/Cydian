# B203 on iOS 26: Simulator notes (R46)

Checked on the MBA's iOS Simulator (iOS 26.3, iPhone 17: Dynamic Island, 1206×2622 @3x), Xcode 26.3. Harness and
how to rerun it: `journal/2026-11-20-r46-ios26-splash/` (`sim/r46.sh`, `sim/main.swift`). Colours below are pixels
sampled from the screenshots: top of the nav bar, the ground, the tab bar.

## 1. Jailbreak-style splash: the helper's copy, then relaunch

The test app is built like the .deb (`UILaunchStoryboardName` = LaunchScreen, the top-level Classic files,
`LaunchThemes/`). "Switching theme" is `launch-theme`'s copy: the 13 files of `themes/<key>/` written over the
bundle's own in the installed app.

**iOS 26 caches the splash, and the theme switch alone never shows.**

- The first launch writes two snapshots, light and dark, to the app's data container:
  `Library/SplashBoard/Snapshots/<bundle id> - {DEFAULT GROUP}/<UUID>@3x.ktx`. Every later launch draws those
  files, not the bundle.
- After copying Gunmetal over the bundle, the next launch was **pixel-identical to Classic**. Rebooting the
  Simulator didn't change it either (the files stay).
- Deleting the snapshot folder (what `Splash.clearSnapshots` does) after the copy made it worse: SplashBoard
  regenerated the image from the bundle, checked the launch resources against the code signature, and refused them:
  `Resource validation error: Security error errSecCSBadResource reading resource from bundle` →
  `Noting that the application ... has a bad launch image until it is updated` → `rejected due to the app being
  denylisted`. From then on every launch was **black**, whatever was copied back, including Classic, and also after
  the app deleted `Library/SplashBoard` itself. A denylisted bundle ID stays black until it is reinstalled.
- **Copying, then re-signing the bundle** (`codesign -s -`, which stands in for `ldid -S` on a phone) avoids the
  denylist. But clearing the snapshot still left Classic: SpringBoard regenerated it synchronously
  (`CALLED IMAGE GENERATOR ... last resort`) and drew **Classic again** (slightly different pixels, so a new
  render, but from cached launch resources). That was true for Gunmetal and for OLED Black.
- **Clear + re-sign + restart SpringBoard** (a Simulator reboot) finally showed **OLED Black**. Clear + re-sign
  without a restart didn't, and neither did a reboot without the clear.
- An app-update install over it (the same bundle with Gunmetal copied in and re-signed, the same CFBundleVersion and
  then a bumped one, with the snapshots cleared too) kept showing the previous snapshot (OLED Black). So whatever
  `uicache` triggers on a jailbroken phone is not likely to be enough either. Not tried on a phone.
- Symlinks out of the bundle (the 13 files pointing to a folder the app could rewrite): `simctl install` refuses
  them (`invalid symlink`). Made in the installed copy and re-signed there, they behaved like the re-sign case: no
  denylist, but still Classic after clearing (a respring wasn't tried with them).

So on iOS 26, B203's jailbreak route (copy the theme over the bundle, then `clearSnapshots`) gives one of two
results. If the jailbreak doesn't bypass SplashBoard's resource validation, the app is denylisted and the splash goes
**black** after the first theme change. If it does bypass it, the splash stays on the **old theme** until the next
respring. Neither was seen on a jailbroken iOS 16+ phone (none here). On the iPhone 7 (iOS 15) B203 found no
snapshot at all and the bundle copy worked.

**The themed cover works on iOS 26**: `cover <key>` (Splash.cover's `Bundle(path:)` load of
`LaunchThemes/<key>/LaunchScreen.storyboardc`) drew the right frame for Gunmetal and OLED Black, safe areas included,
on the Dynamic Island screen.

## 2. Sideload IPA's neutral splash (empty `UILaunchScreen`)

- Light: plain **white**, no bars. Dark: plain **black**. Both as documented.
- **The status bar is invisible on the light one**: the IPA inherits `UIStatusBarStyle` = LightContent from
  `native/Info.plist`, so the clock and icons are drawn white on white during the light splash (seen in the shot:
  only the green battery shows). In dark it's fine. Filed as B212.
- The themed cover on top (Gunmetal in light, OLED Black in dark) drew correctly once the app ran.

## 3. Can a sideloaded app swap its own cached snapshot? **Yes, on the Simulator.**

- **Copying in a snapshot file**: the Lite test app (empty `UILaunchScreen`) copied another app's OLED Black
  snapshot over both of its own `.ktx` files, from inside its own process, in place (same names). The next
  launch showed **OLED Black** instead of white, and it still did after a reboot.
- **Rendering one itself**: the files aren't real KTX. They start `AAPL\r\n\x1a\n`, Apple's ATX texture
  container, at the screen's pixel size (1206×2622 here) with no status bar. ImageIO writes that type
  (`CGImageDestinationCopyTypeIdentifiers()` includes `com.apple.atx`). The Lite app put the Gunmetal cover on its
  window, rendered it with `drawHierarchy` at screen scale, and wrote it with
  `CGImageDestinationCreateWithURL(url, "com.apple.atx")` over each of its `.ktx` files. The next launch was
  **Gunmetal**, in the same boot with no respring, and still after a reboot. Then Classic, written the same way,
  showed on the next launch in the same boot. So unlike the bundle route, SpringBoard reads these files again at
  each launch.

What that means for the IPA: the app could give the *next* launch the theme's frame by writing the theme cover into
its own snapshot files whenever the theme changes. The first launch after an install or update would still be the
neutral splash, because SplashBoard regenerates from the bundle then. The same write would also work for the
jailbreak build on iOS 16+ instead of touching the bundle (its snapshots live under mobile's
`Library/SplashBoard/Snapshots/<id> - {DEFAULT GROUP}/`). Filed as F330, not built here.

## Limits of these findings

- **Simulator only.** It doesn't enforce the app sandbox the way a phone does. On a phone the folder is in the app's
  own data container (apps are known to be able to delete `Library/SplashBoard` there), but whether an app may
  *write* those files, and whether SplashBoard on a device accepts an app-written ATX, is unchecked.
- Which of the two files is the light and which the dark snapshot isn't visible from the app (SpringBoard keeps the
  manifest). The test wrote the same frame to both, which is right for a fixed theme. Automatic would need the
  mapping, or both frames rendered per appearance.
- When iOS reaps or regenerates snapshots (install, update, language or display changes, storage pressure), the
  neutral splash comes back until the app writes again.
- Only the iPhone 17 (Dynamic Island) was run. The other screen shapes weren't, since B180 already covered the
  storyboard's geometry on them.
