# B180: the launch screen matches the first frame's strips

## The bug

Since B132 the app's first frame draws the nav bar's gloss up through the status-bar strip and the tab bar's black
down over the home indicator. The launch screen was still N10's `UILaunchScreen` plain fill in `--pin-light`, so a
cold launch went from a flat grey screen to bars that appeared out of nowhere. `UILaunchScreen` can't draw those
strips: its bar images are stretched to bars whose height depends on the phone, and its image is drawn centred at
its own size. That's why N10's bar version came out cut off and offset and was dropped.

## What changed

- **A launch storyboard** (`native/launch/LaunchScreen.storyboard`), compiled with `ibtool` on the MBA by the new
  `native/launch/storyboard.sh mba` into `LaunchScreen.storyboardc`, which is committed (same pattern as
  `native/icon/assets.sh`). Auto Layout against the safe area. The nav gloss's top half runs from the screen top
  to safe top + 22 and its bottom half fills the last 22 pt, exactly as `.navbar::before` does with
  `data-shell="app"`. The 1 pt highlight is at y 0, the bottom edge on the bar's last pt, and 2.5 pt shadows sit
  under the nav bar and over the tab bar. The tab bar is black from safe bottom − 49 to the screen bottom, with the
  48 pt gloss from 1 pt down and the white 10 % line. The pinstripes run from the left edge, as `.boot` draws them.
- `native/launch/make.py` now writes those images (stdlib, sRGB-tagged PNGs, colours from ios6.css) instead of
  `LaunchLoading`. `storyboard.sources` records the hashes the .storyboardc was compiled from.
- `native/Info.plist`: `UILaunchStoryboardName LaunchScreen` replaces `UILaunchScreen`. `build.sh` copies the
  .storyboardc and the PNGs into both bundles.
- `native/Sources/App.swift`: the cover is back. `Launch.cover()` instantiates the same storyboard, and
  `SceneDelegate` puts it on the window right after `makeKeyAndVisible` through `WebController.showCover(in:)`.
  The existing `dropCover` fades it 0.1 s after the load event. This bridges the gap between iOS's splash and the
  page's first paint, which otherwise showed bare window pinstripes with no bars. Touches pass through it.
- `native/launch_check.py` (mkdeb/mkipa check) checks the storyboard key, that `UILaunchScreen` is gone, that the
  .storyboardc is compiled, and that every image is there at @2x/@3x. Tests in `test_native.py`/`test_ipa.py` cover
  the bundle checks. They also check that the storyboard's image names match `launch_check.IMAGES` and make.py's
  output, that the .storyboardc is up to date with its sources, and that the images stay far under SplashBoard's
  size limit.
- `docs/native.md` "Launch screen" rewritten.

## Tried and dropped / found on the way

- **A full-screen stripes image broke the launch screen.** The first build used an 1800x3600 px stripes image
  drawn from the top left. On the Simulator the splash was black, and `splashboardd` logged "Estimated size
  (25924736) is over limit (25000000)" and then denylisted the app's launch image. The stripes are constant down a
  column, so the image is now 600x1 pt, stretched down at its own width (total image estimate ≈ 0.03 MB). A test
  guards the total.
- **The cover inside the web view had no safe area.** Added as a subview of the WKWebView in `viewDidLoad`, its
  frame doubled (autoresizing from a zero-size web view) and its `safeAreaInsets` stayed 0 while the web view's were
  62/34. So the nav bar came out 44 pt and the tab bar had no strip. On the window it lays out correctly.
- An sRGB chunk in the PNGs didn't change the Simulator's colour shift (below). Kept anyway, since it's correct.

## Checked

- **iOS Simulator on the MBA** (`sim/`: `main.swift` holds the system splash 6 s, then shows `index.html`
  without app.js, so `#boot` stays, in a WKWebView set up like the app's; `run.sh` screenshots splash, page and the
  window cover). Devices: iPhone 17 (Dynamic Island, 62/34), iPhone 16e (notch, 47/34), and an SE 3rd gen
  (20/0, the iPhone 7's geometry). A column at x = 5 through every row of every pair: no strip edge out of place.
  The worst row is a single row in the 2.5 pt tab shadow, 9–10 levels. The cover against the page is within 1–2
  levels everywhere else. Screenshots aren't committed (they carry iOS's status bar). To rerun: copy `sim/*`,
  `native/launch/Launch*.png`, `LaunchScreen.storyboardc` and `web/app/` minus `app.js` into one folder on the
  Mac, then `bash run.sh` there.
- **iPhone 7, jailbreak .deb** (0.17.0-2823 built from this branch, installed with apt, cold open with a burst of
  phonectl shots under the ui-7 lock). One frame caught the splash or cover during the launch zoom. Its nav bar's
  bottom edge (rows 126–127) and the tab bar's top (row 1236) sit on the same rows as Home's. Every colour is the
  same ~3.5 % darker, grey and blue alike (the zoom's dimming), so no hue shift on the device.
- `native/build.sh deb` builds (the Swift compiles); `python3 -m unittest test_native test_ipa` passes; the gate
  (`tools/check.sh`) runs in `run done`.

## Not verified

- **The sideload IPA on a notched iPhone**: no notched phone I may drive (the iPhone 15 is the user's daily phone,
  read only). The Simulator covers notch and Dynamic Island geometry with the same storyboard and the same
  `SceneDelegate` path, and both builds share them. The user's cold-launch screenshot on their phone is the
  remaining check. If the old flat launch still shows, iOS kept its cached splash: delete and reinstall, or reboot.
- **Colour of the system splash on newer phones**: on the Simulator (iOS 26.3) the system-rendered splash was up to
  ~7 levels more saturated on the blue gloss than the in-app render (greys within 1). On the iPhone 7 (iOS 15)
  there was no such shift. I didn't compensate, since that would be wrong wherever the device renders exactly. If
  the user sees a slight colour step at the hand-off on an iOS 26 phone, this is why.
- **A fully settled splash on the 7**: the one frame caught was mid launch-zoom (dimmed), and I couldn't tell
  whether it was iOS's splash or the app's cover. They are the same storyboard, and the Simulator showed both.
- **Dark runs**: the splash and cover stay light (as before, the storyboard has no dark variant), then fade to the
  dark page. Not rendered.
- Left on the MBA: `~/b180sim` (the harness's working copy) and a "B180 SE" simulator. I didn't delete them,
  because this run deletes only inside its worktree.
