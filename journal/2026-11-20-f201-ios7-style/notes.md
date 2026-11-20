# F201 iOS 7 style (era) in the theme menu

## What was done

- **The spike** the brief asks for was already done by C44 (`journal/2026-11-20-c44-era-readiness/`): tokenising won
  over overriding (12 look-only rules vs 42, 0 layout declarations vs 17). This task builds on C44's split and its
  `spike-tokens.css`.
- `web/app/ios7.css` (new): hooks on `html[data-style="ios7"]` (bar button and back heights, tab item, edge-to-edge
  groups, 15pt cell padding), the White tone block (`[data-theme="light"]`) and the OLED Black tone block
  (`[data-theme="dark"]`) setting ios6.css's and packages.css's tokens (nav bar, bar buttons, back chevron, tab bar,
  badge, grouped tables, chevron, pinstripe grounds made flat, search bar, scope bar, action sheet, store header), and
  look-only rules: 17pt semibold title, tinted text bar buttons that dim to .3 when held, a tinted outline Share glyph,
  outline tab glyphs (filled ios6.css glyph when the tab is chosen), uppercase 13pt `#6d6d72` group headers,
  left footers, hairline-edged tables with separators inset 15pt (painted on the cell so a pressed row covers them),
  grey `#d9d9d9` press with text kept dark, blue check, flat plain section bar, flat green switch (no ON/OFF), tinted
  outline segmented control and scope bar (selected filled, white text), 5pt search field, regular-weight action
  sheet. Only look properties: `ios6-css.test.js`'s "an era stylesheet sets no layout" passes on it.
- `web/app/index.html`: links `ios7.css` after `palettes.css`, before `wide.css`.
- `web/app/core/settings.js`: `style` setting (Theme > Style, a choice: iOS 6, the default, or iOS 7; stored at
  `ifizbox.style`; travels to the app with the other theme settings), a `style` field on the Light and Dark theme
  rows so they show only in iOS 6 (iOS 7 has its own pair), `STYLES`, `STYLE_DEFAULT`, `STYLE_KEY`,
  `STYLE_PALETTES` (`ios7: { light: "white", dark: "oled" }`), and `themeState` now returns `style` and ignores the
  theme picks and previews under iOS 7.
- Outside the brief's file list, needed to make it work (no other way to put `data-style` on `<html>`):
  `web/app/theme-boot.js` (reads `ifizbox.style` before first paint, sets `data-style`, White / OLED Black, and the
  `#f7f7f7` top-bar colour) and `web/app/screens/settings.js` (applyTheme sets `data-style`, `THEME_COLORS.white`,
  repaints on a `style` change, the Automatic meta follows the era's pair).
- Tests: new F201 tests in `theme-palette.test.js` (themeState and theme-boot.js agree for every style, Mode, system
  and preview; ios7.css linked after palettes.css and every selector scoped to `html[data-style="ios7"]`) and
  `screens/settings.test.js` (Style rows, Themes rows hidden under iOS 7, `data-style`/palette on `<html>`); the
  settings key/section lists in `core/settings.test.js` and the Theme page tests gained Style; the dark-token test
  accepts an era's dark tone block as a palette block.

## Screenshots (3x, 402x874, headless Chromium)

`shots/`: White and OLED Black of Home, Changes, a package page (openMX), Settings, Settings > Theme and Search, plus
the iOS 6 Theme page with its new Style group. Taken with `journal/2026-11-18-t12-readme-shots/capture.mjs` against
`worker/node.mjs` (real sources through `/api/fetch`), steps in `steps.json`.

First run's package shots were empty: the rows' hrefs are `package%3A…` (encoded), so the selector for `package:`
found none; the second run goes straight to `#/changes/package%3Aio.github.fizl0.openmx`. The first dark Changes shot
showed the scope bar's selected segment as blue text on blue: the scope bar has its own rules (packages.css) that
the segmented rules don't reach, so ios7.css got scope-bar rules too.

## 120 Hz

ios7.css adds no transition, animation, backdrop-filter or filter; the only state change is `opacity` on a held bar
button. The switch and segments keep ios6.css's transform-only motion.

## Choices

- iOS 7's light theme is a palette value `white` with no palette block (ios6.css's light tokens, then ios7.css's), its
  dark one is `oled` (ios6.css's dark base block). So no palette rule (Sepia's chrome rules etc.) ever runs under iOS 7,
  as docs/eras.md requires until C49.
- Style is a plain choice group (two rows, checked), not the swipeable mini-phone tiles F199's first mockup had: two
  options, and the tiles need art per era.

## Not verified

- **On a phone (iPhone 7 / iPhone 15 Pro, WebKit)**: Chromium only. The task did not ask for a phone run.
- **The app's status bar under White**: `native/Sources/App.swift` always returns `.lightContent`, so in the apps the
  status bar text is white on the `#f7f7f7` bar. Native code is outside this task's files; filed as a follow-up.
- **iOS 6 pixel diff against main**: not run. Every ios7.css selector is scoped to `html[data-style="ios7"]` (a test
  checks it), and iOS 6 only gains `data-style="ios6"` (no rule reads it) and the Style group on Theme (in the iOS 6
  Theme shot).
- **What is still iOS 6 under iOS 7**: everything not clean yet per docs/eras.md: Home's tiles and inset layout
  (home.css, C47), the HUD, alerts, share sheet, reload bar, undo bar, pull to refresh (C45, C50), JS-drawn icons
  (C51), the store header's icon reflection, the switch's 77 x 27 size (iOS 7's is 51 x 31; no hook until C45) and
  Settings' Mode control running edge to edge (settings.css margin 0 inside a now edge-to-edge group; layout, so not
  ios7.css's to change). Separators inset 15pt everywhere, not to the label on icon rows.
- **Pressed states beyond a look in the shots**: bar buttons, rows, segments and the action sheet were not pressed in
  a capture.
- **The app shell's status strip** (`data-shell="app"` nav bar `::before`): not captured in the app shell; the site
  strip is `#f7f7f7` / black in the shots.
