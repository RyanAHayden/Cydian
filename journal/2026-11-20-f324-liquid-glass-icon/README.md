# F324 Real Liquid Glass app icon on iOS 26+

## What I did

- Checked the MBA first: `xcodebuild -version` (with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`,
  since xcode-select points at the CommandLineTools) said **Xcode 26.3 (17C529)**, actool 26.3. No update needed.
- `native/icon/glass.py` (new, stdlib only): writes an Icon Composer document (`<set>.icon/icon.json` + `Assets/*.svg`)
  for every icon set: `AppIcon` and every `Icon-*` set `alternates.py` lists (74). Layers, after tools/icon.svg.in's
  globe, flat as Icon Composer wants: `grid` (front group: meridian, three parallels and the outline, in the theme's
  ink), `sphere` and `rim` (globe group, translucent); the background is icon.json's `linear-gradient` fill from the
  theme's own ramp. All layers `glass: true`, groups `specular: true`. Colours come from tools/icon_themes.py's
  THEMES (the PNG icons' table), so a theme's glass icon matches its picture icon; Clear is white glass lines on a
  frosted white fill. A pair set's dark appearance is the dark theme's layers and fill through
  `image-name-specializations` / `fill-specializations` (key names taken from real Icon Composer documents on GitHub:
  mastodon-ios, Ladybird, QuickLookVideo); a one-icon set names the same icon for both.
- `native/icon/assets.sh`: writes the .icon documents beside each catalog and passes them to actool with the
  .xcassets; `assets.sources` gets a `glass` digest line, so a changed colour or set means a rerun.
- `native/test_icons.py`: `Glass` checks one document per set, every layer image present, dark = the dark icon,
  layer order, colours per theme all different, SVGs well formed; the sources test includes the glass digest.

## Tried and failed

## Not verified
