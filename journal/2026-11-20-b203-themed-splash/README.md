# B203: the splash shows the current theme

## The bug

Since B180 the launch storyboard always drew the Classic frame (blue nav bar, light pinstripes), and so did the
in-app cover that holds it until the page draws. Gunmetal, OLED Black and every other theme opened on a blue splash.

## What changed

- **`native/launch/make.py`** has a `THEMES` table: each Settings palette's ground (pins), nav bar (bottom line, top
  highlight, gloss stops, shadow alpha) and tab bar (line, gloss, base), taken from `ios6.css` / `palettes.css`. It
  writes `native/launch/themes/<key>/` for all nine (classic, sepia, solarized, oled, gunmetal, midnight, linen,
  nord, dracula): the 12 launch PNGs plus a copy of `LaunchScreen.storyboardc` whose five colour views are the
  theme's. The colours are rewritten **in the compiled view nib**, in place: a small NIBArchive reader finds the
  `UIColor` objects (by Classic's values) and overwrites `UIRed`/`UIRed-Double` etc. at their offsets (same types,
  same sizes). So no Mac is needed (the MBA was offline all session). Classic's set is byte-identical to the
  top-level files, so `storyboard.sources` stays valid. ~576 KB for all nine in the repo; each set's SplashBoard
  estimate is tiny (tested < 1 MB, cap 25 MB).
- **Jailbreak build**: new helper verb `ifizbox-helper launch-theme <key>` (`native/helper/launch.h`, header-only
  so the build lists don't change; a 20-line branch in `main.c` after the caller check, like `udid`). It reads all
  13 files of `<app>/LaunchThemes/<key>/` first (regular files, no symlinks, ≤ 1 MB, key `[a-z0-9]{1,32}`), then
  writes each over the bundle's own by temp file + rename. `native/Sources/Launch.swift` (`Splash.follow`, called
  from `Theme.apply` in `Bridge.swift`) compares the bundle's files with the theme's and runs the verb only when
  they differ, on a serial background queue; then it drops this app's own SplashBoard snapshot entries if any exist
  (only entries named for the bundle ID: a jailbreak app's home is `/var/mobile`, whose SplashBoard folder is shared
  with the system apps).
- **Sideload IPA**: neutral splash. `Info-sideload.plist` sets an empty `UILaunchScreen` (iOS's own background:
  white in light, black in dark, no bars) and drops `UILaunchStoryboardName` through a new `IFIZBOX_REMOVE_KEYS`
  list that `mkipa.merge_plist` consumes.
- **Both builds**: the cover (`WebController.showCover`, one line in `App.swift`) is now `Splash.cover`, which loads
  `LaunchThemes/<key>/LaunchScreen.storyboardc` with `Bundle(path:)` as its own bundle, so its images resolve from
  that folder. If the set is missing: Classic falls back to the bundle's storyboard, any other theme gets no cover.
- `launch_check.py`: `lite=True` (mkipa) checks the neutral keys; both builds must carry every theme's set.
- `build.sh` copies `launch/themes` → `LaunchThemes/` in both bundles.
- Tests: `test_launch_grounds.py` (THEMES against the CSS, every Settings palette has a set, `themes/` is make.py's
  output, Classic = top-level files, nibs carry the colours, size cap, file lists agree across Python/Swift),
  `helper/test_launch_theme.py` (copies the set; missing file changes nothing; symlink refused; bad keys 64; other
  callers 77; file list = launch_check's), `test_ipa.py`/`test_native.py` updated for the new rules.
- `docs/native.md` "Launch screen" updated.

## Approach, in the brief's order

1. **Render every theme, point the launch screen at it, clear the snapshot.** Done for the jailbreak build. Found on
   the iPhone 7 (iOS 15.8.8): iOS keeps **no SplashBoard snapshot** for iFizBox (none under
   `/var/mobile/Library/SplashBoard/Snapshots`, no `.ktx` anywhere newer than the install; the switcher card is
   black too), and it draws the splash from the bundle at every launch. Proved by swapping `LaunchNavTop@2x.png` for
   red (the next cold launch's splash had a red top) and by patching only the nav line's `UIColor` in the view nib
   (red line on the next launch). So "clear the cached snapshot" is a no-op there; the code still drops this app's
   own entries in case a newer iOS keeps one. I didn't try a private `UIApplication` reset call: nothing to reset on
   the 7, and I couldn't check one on newer iOS.
2. **Lite**: can the cached snapshot alone be swapped? **Not checked**: no sideloaded build I may run (the 7 runs
   the .deb under the same bundle ID, the iPhone 15 is read-only) and no Simulator (MBA offline). So the IPA takes
   the brief's fallback, a neutral splash. The brief asked for a named colour with any/dark appearance close to
   the default grounds; that needs an asset catalog compiled on a Mac, so it's iOS's own background instead
   (white/black). The fade into the page is the existing cover fade, now themed.

## Tried and dropped

- Patching only the nib's `UIRed` floats did nothing: UIKit reads `UIRed-Double` when it is there. make.py writes
  both.
- Theme nibs first came out different for Classic too (the nib's doubles are rounded, make.py's were exact); it now
  leaves a colour that already matches untouched.

## Spec review (fixed)

- A palette with no set used to fall back to OLED Black / Classic. The helper could then copy another theme's
  frame, and the cover show one. Now `Splash.key` returns nil: nothing is copied and there is no cover. The cover
  no longer falls back to the bundle's own storyboard, so the IPA no longer ships the top-level storyboard and PNGs
  it never used (only `LaunchThemes/`).
- New test: `.tabbar::before` (the tab shadow, 18 %) has no per-theme override in the CSS, which make.py assumes.
- Kept as documented limits (not fixable without a Mac or two sets of files): the Automatic flip while closed, and
  the IPA's white/black fill instead of a named colour near Gunmetal. The review also flagged the IPA's step from
  the plain fill to the themed cover before the fade. I kept it: the bars come up in the theme with the ground, and
  then fade into the page. Without it, the bare ground would show and then the page's bars pop in.

## Known limits

- **Tab bar line 1 pt low** for OLED Black, Midnight, Nord and Dracula. Their tab bars have an opaque top line on
  the bar's first point. The storyboard's only view there is the bar itself, which also fills the home-indicator
  area, so the bar keeps its base colour and the line is drawn by the 1 pt colour view on the second point. It's a
  1 pt line one point lower than the page's.
- **Linen** draws its weave's base colour flat: a 1 pt-tall stripes image can't draw the weave.
- **Automatic, jailbreak build**: the splash is the resolved theme at the last change. If the iPhone switches
  appearance while the app isn't running, the next launch opens on the other tone's frame once (the files are one
  set). The cover is right, since it reads the appearance at launch.
- When F325's themes land they need a row in `THEMES` and `launch_check.THEME_KEYS`; `test_launch_grounds.py`
  fails until they have one.

## Checked

- **iPhone 7, .deb 0.17.1-2884 from this branch** (installed with apt; ui-7 lock): Theme > Dark ran the helper (the
  bundle's nib and PNGs became OLED Black's; md5 checked). The cold launch's splash was the OLED frame, then the
  OLED page. Dark > Gunmetal: the bundle became Gunmetal's, and the splash was Gunmetal. The frame right after it
  showed "Loading" faintly through a Gunmetal layer: the theme cover fading over the page, so `Bundle(path:)`
  loading works. Set back to Light: the bundle went back to Classic's (md5 = shipped). Earlier, a hand-copied
  Gunmetal set also rendered correctly. The phone is left on Light / Classic / OLED Black as I found it, with this
  branch's .deb installed.
- `native/build.sh deb` builds (Swift compiles; `mkdeb.py check` passes with the new launch check).
- `python3 -m unittest test_launch_grounds test_native test_ipa` and `helper/test_launch_theme.py` pass;
  `tools/check.sh` in `run done`.

## Not verified

- **MBA Simulator harness** (Classic, Gunmetal, OLED Black after switching and relaunching): the MBA was offline
  (`ssh mba`: connection timed out; `tailscale status`: offline). So nothing ran on iOS 16-26 or a notched screen.
  Unknown there: whether a newer iOS caches the jailbreak app's splash (then `clearSnapshots` should cover it, but
  untested) and how the theme nibs look with a Dynamic Island / home indicator (same storyboard as B180's, only
  colours changed).
- **The sideload IPA's neutral splash and themed cover on a phone**: no sideloaded build I may run (above). The
  empty `UILaunchScreen` is documented iOS 14+ behaviour, not seen here.
- **Lite snapshot swap** (the brief's step 2 question): not checkable without a sideloaded build or Simulator.
- **Sepia, Solarized, Midnight, Linen, Nord, Dracula on the phone**: only OLED Black and Gunmetal were launched;
  the others are covered by the CSS comparison test and by the same code path.
- **A .deb upgrade restoring the theme**: by design the page's first `app.theme` re-copies the set after an
  upgrade puts Classic's back. Not exercised (it would mean installing over this build with a theme set).
