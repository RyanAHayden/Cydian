# N10: native launch screen (2026-11-17)

Goal: opening the app shows Home as it loads (nav bar titled Cydian, pinstripes with Loading, tab bar with Home
selected), not black, and no black flash before the first page. Findings and the design are in docs/native.md,
"Launch screen".

## Done

- `native/Info.plist`: `UILaunchScreen` now names loose images: `UIImageName` LaunchLoading (pinstripes with Loading,
  oversize so centred it fills any screen), `UIImageRespectsSafeAreaInsets` false, `UINavigationBar`/`UITabBar`
  background images LaunchNavBar/LaunchTabBar. The empty `UIColorName` (the old black launch) is gone: a colour can
  only come from an asset catalog.
- `native/launch/make.py` (stdlib PNG read/write) cuts the six PNGs from the website's launch images
  (`launch-828x1792.png` for @2x, `launch-1179x2556.png` for @3x), keeping the pinstripes' phase across the
  pasted Loading block. `build.sh` copies them into both bundles.
- `native/Sources/App.swift`: the window and the web view's backgrounds are the pinstripes (pattern colour) instead of
  black, `underPageBackgroundColor` the light stripe; a native cover (`Launch.cover`) shows this screen's exact
  website launch image (`web/icons/launch/launch-<W>x<H>.png`, picked by `nativeBounds`) over the web view until
  the first load ends, then fades out (opacity, 0.2 s) onto `#boot`, which looks the same.
- `native/launch_check.py`, called from `mkdeb.py check` and `mkipa.py check`: the UILaunchScreen keys, every
  image at @2x and @3x, no `UIColorName`, and at least one `web/icons/launch/launch-*.png`. Tests in
  `test_native.py`/`test_ipa.py`, including one that reruns make.py and compares with the committed PNGs.
- `make -C native package` built and checked the .deb and the IPA here (Swift compiled, both checks pass).

## Decisions

- No title or tab icons in the bar images: UIKit stretches a bar's background image to the bar, whose height
  depends on the status bar (44-62 pt), so baked-in text would be squashed on some phones. The cover adds them as
  soon as the app's first frame is up.
- No Assets.car: only Apple's actool writes one. docs/native.md has the one-Mac-run recipe if loose PNGs turn out
  not to work.
- No postinst cleanup of SplashBoard's snapshot cache: I don't know its path for a containerless jailbreak app on
  each iOS version, and a wrong `rm` in a postinst is worse than a reinstall. The docs say to reinstall or reboot.

## Tried and dropped

- make.py's first try took the stripe reference row near the top of the page. The nav bar's shadow is there, so
  every row looked like it was part of the "Loading block" and the paste broke the image. It now takes a row 60 pt
  above the middle and looks for the block within 40 pt of the middle.

## Not verified

- **Everything on a phone** (no iPhone with iOS 15+ in this run; the 4S is iOS 6, which has no UILaunchScreen):
  - whether SpringBoard's launch-screen renderer loads loose `Name@2x/@3x.png` for `UIImageName` (Apple's docs
    only say "asset catalog"). If the launch comes up white with white bars, it didn't; see docs/native.md,
    "If it doesn't work".
  - whether the bar images are stretched (as assumed) or tiled, and how they meet the status bar and home
    indicator areas;
  - that the cover lines up with the page's `#boot` and the fade shows no flash; that `didFinish` comes after
    `#boot` is on screen (0.1 s margin is a guess).
  The user opens the app on their iPhone and reports (the task's own test plan).
- The dark theme: the cover is light, so a Dark Appearance shows light until the cover fades. Not changed: the native
  side can't read the web view's stored theme before the page loads.
