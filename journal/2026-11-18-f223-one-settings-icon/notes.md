# F223 One Settings icon

The user's note on the task (2026-11-18) decided it: use Settings > General's gear (icons/rowicons.js `general`:
grey tile, 8-tooth gear), drop Home's dashed-ring `.glyph-settings`, no comparison or redraw. So the comparison against
the iOS 6 reference sheet that the brief first asked for was skipped on purpose.

## What changed

- `web/app/screens/home.js`: `SETTINGS_ICON` is now `rowIcon(PAGE_ICONS.general)`, the same call Settings' root uses
  for General's row, so the gear has one source. Home's Settings row passes it as its `icon` (a `.row-icon` `<img>`
  instead of a CSS-background span).
- `web/app/home.css`: `.glyph-settings` (the dashed-ring gear) is gone. New rule
  `.home-settings-row .cell-icon.row-icon { margin: 0; }`, which cancels `.row-icon`'s Settings-table nudge
  (`margin: 0 3px 0 -3px`, ios6.css) so the row's own tile inset and gap still place it. In the 3x shot the tile's
  left edge is at x=52, the same as the tiles above it.
- Tests: `rowicons.test.js` has a new test checking that Home's Settings row icon deep-equals `rowIcon(PAGE_ICONS.general)`
  and that home.css has no `.glyph-settings` left. `home.test.js` and `homefeatured.test.js` (F159's tests, not in the
  brief's file list, but they asserted the old class) now expect the `.row-icon` tile with its `<img>`, plus the margin reset.

## Shots

`home-vs-general-3x.png`: the website at 320pt wide with deviceScaleFactor 3 (headless Chromium, F174's
capture.mjs set to 3x, against `node worker/node.mjs`). Top: Home's Settings | Theme row. Bottom: Settings > General.
They draw the same tile.

One small difference you can see: Home's Theme half next to it still uses a `.home-glyph`, which draws a 21px glyph,
while rowicons draws its glyph at 19pt. So the gear is a little smaller than the Theme disc beside it. This was left
alone because Theme isn't part of this task.

## Not verified

- I didn't check it on a phone (iPhone 7 / jailbreak app) because the task doesn't ask for the device. The change is
  plain web CSS/JS, the same in every build, and I checked it in Chromium.
- Dark theme: I didn't take a screenshot. rowicons tiles are the same in both themes by design (F205). The old
  `.glyph-settings` had no dark override either.
