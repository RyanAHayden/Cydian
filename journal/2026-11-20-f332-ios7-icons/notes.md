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

## Spec review, fixed

- Chosen Search and Installed tabs were thicker outlines, not filled: now a filled lens and a filled arrow.
- The filled Changes tab used an SVG `<mask>` inside the CSS mask image (unchecked in WebKit): now an even-odd path.
  The test fails if a chosen glyph's root is `fill='none'` or uses `<mask>`.
- iOS 6's purple and indigo both became #5856d6: purple is now #c86edf, and the test checks the 13 colours map
  one-to-one.
- The Linux guide tile kept iOS 6's filled penguin: redrawn in lines. Its first colour, #1c1c1e, vanished on OLED
  Black's #1c1c1e table (seen in `oled-computer.png`'s first shot); now #48484a.
- Shots of every chosen tab: `shots/tabs-chosen.png` (from `steps-tabs.json`), and `white/oled-computer.png`.
- Not changed: the outline tab glyphs are F201's (drawn after this kit already), moved into the map as they were.
  The kit has no Home screen, so Home's shots stand alone (Home's own tiles: F339).

## Found, filed

- F339: Home's own tiles (home.css `.glyph-*`: Browse, Install, GitHub, Discord, …) still draw iOS 6 glyphs and
  colours in iOS 7; home.css was not in this task's files.
- B239: a live Style switch keeps Home's Settings tile and the Why tile CSS of the start-up style until reload
  (computed at module load in home.js / why.js).
- F338: the kit puts the tile 15pt in with the label 15pt after; ours is 12pt / 8pt, and style.css has no era hook
  for the row tile's margin.

## Not verified

- On a phone: no iOS 7-era build on a device in this run; every shot is headless Chromium, not WebKit.
- The Settings tab's filled glyph: the web tab bar in the shots has no Settings tab, so it was not seen.
