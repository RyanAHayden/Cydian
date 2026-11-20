# F323 App icon follows the theme, with a dark and a Clear icon

Design: https://claude.ai/artifact/H1VJYpZ2Fak6dbLMg7cCQY (approved 2026-11-20). Clear after the concept
"iOS 26 Clear" on https://claude.ai/artifact/8bAJR6p72Na76io7Bs4LE1.

## What I did

- **Clear icon**: `native/icon/clear/clear.svg`, frosted light glass with the real icon's globe as white lines over a
  soft grey shadow (the concept's look on a white page, pre-rendered so iOS 15-25 show it). `native/icon/alternates.py
  render` writes `AppIcon*.png` at every size; the Lite files are the same pictures (no sash, user 2026-11-20).
- **Icon sets** (`native/icon/alternates.py`, one list for everything):
  - `AppIcon` (primary): Classic, with Gunmetal as its dark appearance, so a fresh install's icon is right on an
    iOS 18+ dark Home Screen without any switch.
  - `Icon-<light>-<dark>`: every light theme or Clear with every dark theme or Clear (58 pairs).
  - `Icon-<icon>`: each of the 15 icons alone (iOS 15-17, and override pairs that have no set).
  - `catalog` writes the xcassets (universal form: the old iphone-idiom form drops dark appearances as "unassigned
    children", seen in actool's warnings), `plist` writes Info.plist's CFBundleAlternateIcons block, `thumbs` the
    180 px icons for the page, `sources` the hashes `assets.sources` records.
- `native/icon/assets.sh` now builds both catalogs on Linux, compiles them on the Mac (`assets.sh mba`), and stops
  on any actool warning. Ran it: both .car files compiled clean.
- **Shell**: `native/Sources/AppIcon.swift`, bridge call `app.icon {light, dark, onScreen}`. iOS 18+: the pair set
  (or the primary for Classic/Gunmetal); no pair, or iOS 15-17: the one-icon set of the theme on screen. Jailbreak
  build: `-[UIApplication _setAlternateIconName:completionHandler:]` (no alert); Lite: the public call (iOS's alert,
  said in the Theme footers). Waits for didBecomeActive if the app isn't active. `AppScheme` serves
  `appicon/<icon>.png` from `AppIconThumbs/` (build.sh copies them; Lite's sashed).
- **Page**: core/settings.js `iconMatch` (toggle, default on), `lightIcon`/`darkIcon` (kind "icon", default "theme"),
  apps only (feature "app-icon", modes jailbreak + sideload), `APP_ICONS`, `iconFor`, `iconState`, `iconGroups`.
  `web/app/appicon.js` sends app.icon (once per change, never while a theme list's preview is up) and repaints the
  icons the page shows. screens/settings.js: Theme > App Icon group (switch + footer), the Light/Dark group with
  thumbnails that slides in when the switch goes off (nav/slide.js does the slide on `hidden`), the grid picker
  (Themes: this mode's; Special: Clear + the other mode's), and the preview's small Home header. Home's header shows
  the app's icon now (screens/home.js). The website keeps everything as it was.

## Measured: why 73 sets, not 225

On the MBA (actool, Xcode 26.3), 60pt @2x + @3x only:

| what | Assets.car |
|---|---|
| 1 pair set (any + dark) | ~244 KB |
| 1 one-icon set | ~122 KB |
| single-size (1024 only, actool makes every size) pair | ~1.1 MB |
| every light x dark pair of 15 icons (225 sets), estimate | ~55 MB |
| what shipped: primary at every size + 58 pairs + 15 singles | 19.8 MB (jailbreak), 18.0 MB (Lite) |

No deduplication: 9 pair sets of 3 icons cost 2.7x the 3 diagonal ones. actool also adds a 180 px @2x rendition for
every 60pt @3x in the universal form (the iPad's 83.5pt), which can't be turned off with `--target-device iphone`.
The .deb went from 8.4 MB to about 28 MB.

## Tried and dropped

- Old-style iphone-idiom icon sets with `appearances`: actool keeps only the light images ("has N unassigned
  children"). The universal form keeps both.
- `--compress-pngs` and `compression-type: lossy` on the sets: no change in size.

## Checks

- `native/test_icons.py` `Alternates`: every set in both .car files with its icons and its dark appearance (read back
  through carfile.py's new `icon_sets`, which follows FACETKEYS identifiers and APPEARANCEKEYS), the primary's dark
  is Gunmetal at every size, Lite's files only in the Lite car (Clear plain there), Info.plist lists exactly the
  sets, Clear at every size. carfile.icon_problems also flags an alternate Info.plist lists and the car lacks.
- `web/app/appicon.test.js`: iconFor/iconState with Match Theme on and off, website hides the rows, Lite footers say
  iOS shows an alert, the grid groups, tellIcon once per change and never on the website.
- Chromium, 402x874 @3x, fake bridge (`shots.mjs`): Home, Theme with Match Theme on, off (and mid-slide), the Dark
  Icon grid, Clear picked, Theme after the pick, Theme > Dark's and Light's previews, Home in Dark with Clear. The
  page sent app.icon as expected: defaults, then onScreen Gunmetal for Dark, then dark Clear, then Sepia.
