# F214: F200's palettes behind the page at launch and in overscroll (jailbreak/sideload app)

## What changed

- `native/Sources/App.swift` `Launch`: `striped(dark, light, plain:)` makes a ground from a palette's
  `--pin-dark`/`--pin-light` (the same 8 pt tile, 2.5 pt dark, as the kit's and Gunmetal's). New grounds:
  Midnight, Linen, Nord, Dracula (dark) and Sepia, Solarized Light (light), colours from `web/app/palettes.css`.
  The overscroll colour (`underPageBackgroundColor`) is each palette's `--pin-light`, as for Gunmetal and Classic,
  except Linen's: the base of its `--weave`, `#36383d`. `Launch.ground(dark:palette:lightPalette:)` now switches on
  every palette; an unknown name takes the tone's default (Classic, OLED Black).
- `native/Sources/Bridge.swift`: `app.theme` reads `lightPalette` (an older page sends none: Classic); `Theme.apply`
  paints with it and saves it in `ifizbox.shellTheme` beside `darkPalette`; `Theme.saved`/`launchGround` read it
  back, so a light cold launch paints Sepia's or Solarized Light's pinstripes, not the kit's blue-grey.
- `web/app/screens/settings.js`: `themeMessage(appearance, theme, darkPalette, lightPalette)` and `applyTheme`
  sends the light theme (normalised through `paletteFor`, so an unknown stored value goes as `classic`), in dark too
  (the shell needs it for the next launch whichever way Automatic goes).
- Tests: `web/app/screens/settings.test.js` (the new param, and a lightTheme change re-sends);
  `native/test_launch_grounds.py` (new): the Swift grounds' hex values match palettes.css' `--pin-*` (and Linen's
  weave base), and every palette Settings offers has a `case` in `Launch.ground`, so a future palette can't silently
  fall back to OLED Black/Classic again.

## Decisions

- Linen's launch pattern is its pinstripes (`#34363b`/`#383a3f`, what plain pages show), not the weave: the weave is
  four layered gradients; a pattern tile of it would be a new drawing for a sub-second ground. The overscroll uses the
  weave's base colour, which is what grouped pages (most of Settings) sit on.
- The launch image cover (`Launch.cover`, the website's launch PNGs) and Info.plist's `UILaunchScreen` stay the
  Classic pinstripes; they are static images read before any code runs (same note as F198). Out of this task's files.

## Checked

- `node --test web/app/screens/settings.test.js` and `python3 native/test_launch_grounds.py` pass.
- `native/build.sh all` builds both the .deb and the .ipa (0.9.7-1382) with the change.
- **iPhone 7, cold launch per palette** (installed the .deb over 0.9.7-1376, under the ui-7 lock): for each of Sepia,
  Solarized Light (Mode Light) and Midnight, Linen, Nord, Dracula (Mode Dark) I picked the theme in Settings > Theme,
  pressed Home, killed the app (`killall -9 iFizBox`, so the next open is cold) and opened `ifizbox://home` with a
  burst of `phonectl shot -` right behind it. The frame before the page paints (`launch-<palette>.png` here; some are
  mid launch-zoom, so a strip of the Home Screen shows at the left and the colours are slightly blended) shows the
  palette's own pinstripes or, mid-zoom, a blend of them (sampled at y=700): Sepia `e4d8bf/e8dec7`, Solarized
  `e4dfd0`, Midnight `323b4a` (blended navy; its next frame is already the page's boot screen, `0a1424/0c172a`),
  Nord `3e4450/3c424e`, Dracula `41444f`, Linen `34373a…3a3c41`; never the kit's blue-grey `cbd0da/ced3dc`, and the
  settled page matches palettes.css exactly (e.g. Nord `2e3440/313744`). Then the page's boot screen and Home in the same palette, with no flash between.
  The phone was put back to Light / Classic / OLED Black afterwards, and iFizBox 0.9.7-1382 (this branch) stays
  installed on it.

## Not verified

- **Overscroll (`underPageBackgroundColor`) on the phone:** the web view has `bounces = false`, so I found no screen
  where the under-page colour shows; it is set alongside the window colour that was checked above.
- **Sideload build (.ipa) on a phone:** built, not installed; no phone runs the sideload build here. Same code path.
- **Gunmetal and OLED Black:** unchanged code paths (only moved into the new switch), not re-shot.
- **Where UserDefaults keeps `ifizbox.shellTheme` on disk:** I didn't find the plist on the phone (`find` under
  /var/mobile for com.ryha.ifizbox.plist found nothing), but the cold launches above can only have read the palette
  from it, so it persists.
