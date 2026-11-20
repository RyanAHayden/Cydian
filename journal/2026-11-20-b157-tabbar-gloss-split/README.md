# B157: tab bar gloss split back at the bar's half

## What changed

- B132 sized the tab bar's gloss layer `100% calc(100% - 1px)`, so on phones with a home indicator it stretched over
  49 pt + `--safe-bottom` and its hard split landed at half of that (41.7 pt down on a 34 pt inset), through the
  icons. The gloss is back to `0 1px / 100% 48px`: the kit's 49 pt bar from the top, split at the bar's own half.
  Changed in `.tabbar` and Gunmetal's `--dk-tabbar` (`web/app/ios6.css`) and Linen, Nord and Dracula's `--dk-tabbar`
  (`web/app/palettes.css`).
- The strip over the home indicator is the bar's base colour. In every theme that colour is the gloss's last colour
  (`#000` for Classic, Gunmetal and Linen; `#2b303b` Nord; `#21222c` Dracula), so the bottom half runs on over the
  strip with no seam. OLED Black and Midnight have no gloss (a top line over a flat colour) and were not changed.
- New test `web/app/tabbar-gloss-css.test.js`. It finds all 7 tab bar backgrounds and checks that each gloss is
  `0 1px / 100% 48px` (never sized by % or calc) and that the base colour equals the gloss's last colour stop.
  `ios6-css.test.js` and `theme-palette.test.js` had no assertion on the gloss size, so they needed no change.

## Checked

`shots.mjs` (B132's script, cut down to the app shell in Classic, Gunmetal and Linen): headless Chromium at 390x844,
DPR 3, safe areas 47/34, rendered for three trees: before B132 (`a36427d3^`), B132 (main at task start) and this
branch. Pixel column at x = 3 px through the tab bar (83 pt):

| build | colour steps below the bar top |
|---|---|
| before B132 | 1 pt, 2 pt (top lines), **24.67 pt** (split) |
| B132 | 1 pt, 2 pt, **41.67 pt** |
| B157 | 1 pt, 2 pt, **24.67 pt**, then flat to the bottom edge (no seam at 49 pt) |

The same in all three themes. 24.67 pt is the 1 px top line plus 49.5% of 48 px, the bar's 24.5 pt half on the 3x
pixel grid. Before B132 vs B157, the whole tab bar region (bar + shadow) is pixel-identical (`ImageChops` bbox
None) in all three themes, so icons and labels sit exactly where they did before B132. Before B132 vs B132
differs only in background rows 13–134 px: B132 never moved the icons. The user saw them "lower" because the
split, which the icons' look leans on, had moved down.

3x bottom crops (130x100 pt): `b157-*-bottom.png` (fixed), `b132-*-bottom.png` (the bug), for classic, gunmetal and
linen.

## Not verified

- On a phone: no device step in this task, and other slots overwrite the iPhone 7's .deb. The iPhone 7 has no home
  indicator in any case. The fix has the same geometry as before B132, which was on phones before.
- Nord, Dracula, Midnight, OLED Black were not rendered. They are covered by reading palettes.css and by the new
  test's last-stop = base-colour check.
- The website shell (no `data-shell`) was not rendered separately: the tab bar CSS has no shell-specific rule.
