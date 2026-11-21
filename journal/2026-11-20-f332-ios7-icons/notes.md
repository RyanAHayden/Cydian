# F332: iOS 7 era icon set

`ICON_SETS.ios7` in `web/app/icons/rowicons.js`, after the Teehan+Lax iOS 7 kit (`ref/teehanlax/ios7/sheet.svg`,
its Settings table "Table View 1", and the Phone "Tab Bar"):

- **tile**: 29pt, corners 6.5pt (the kit's 58px tiles @2x with 13px corners), glyph 20pt across (the kit's glyphs
  are ~40px @2x).
- **rows**: every iOS 6 row, same glyph name, its colour mapped to iOS 7's palette (`C7`: #ff9500, #007aff,
  #4cd964, #8e8e93, #5856d6 are the kit's tile fills; red, pink, yellow, teal and sky are iOS 7's system colours;
  dark #4a4a4f and brown #a2845e are our picks since the kit has none).
- **glyphs**: all 44 redrawn as white lines (1.6-2.2 of 24 units), a few small dots filled. Our own drawings.
- **guides**: Copying Files' tiles in iOS 7 colours, line glyphs (the penguin keeps its filled body).
- **home**: the Why tile flat #ff9500 with a line star.
- **tabs / tabsSelected** (new kind): outline glyphs (the ones F201 had hand-written in ios7.css, unchanged) and
  the same shapes filled on the chosen tab. `tabGlyphTokens(style, "tabsSelected")` prints the `.active` rules;
  ios7.css now holds both sets as the map prints them, and the old `:not(.active)` rules are gone (the chosen tab used
  to fall back to iOS 6's filled glyph).

iOS 6 is unchanged (test "F332: iOS 6's tiles are as they were"; `ios6-settings.png`, `ios6-home.png`).

## Checks

- `node --test web/app/icons/rowicons.test.js`: 14 pass (4 new F332 tests).
- 3x shots (headless Chromium, `capture.mjs` from T12, `steps.json`, against `worker/node.mjs`): `shots/`
  White and OLED Black Home, Settings, General, Copying Files, Manage; iOS 6 Home and Settings.
  `shots/beside-kit.png`: the kit's Settings rows and tab bar beside ours.
- `tools/check.sh` via `run done`.

## Found, filed

- F339: Home's own tiles (home.css `.glyph-*`: Browse, Install, GitHub, Discord, …) still draw iOS 6 glyphs and
  colours in iOS 7; home.css was not in this task's files.
- B239: a live Style switch keeps Home's Settings tile and the Why tile CSS of the start-up style until reload
  (computed at module load in home.js / why.js).
- F338: the kit puts the tile 15pt in with the label 15pt after; ours is 12pt / 8pt, and style.css has no era hook
  for the row tile's margin.

## Not verified

- On a phone: no iOS 7-era build on a device in this run. The filled Changes tab uses an SVG `<mask>` inside a
  CSS mask image; Chromium draws it, WebKit on iOS 15 not checked.
- The chosen Sources / Changes / Installed / Search tab filled: only the Home tab is chosen in the shots (no tab tap
  step); the shapes are checked by the test text, not by eye.
