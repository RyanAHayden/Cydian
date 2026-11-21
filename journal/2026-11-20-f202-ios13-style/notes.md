# F202 iOS 13 style (era) in the theme menu

## What was done

- `web/app/ios13.css` (new), built like F201's `ios7.css` (docs/eras.md): geometry hooks on `html[data-style="ios13"]`
  (inset grouped: `--group-margin: 20px 16px 0`, headers and footers 16pt in, 16pt cell padding, 44pt bar buttons,
  tab item, 32pt segmented control), a White tone block and an OLED Black tone block setting ios6.css's and
  packages.css's tokens, and look-only rules: system font (`-apple-system, system-ui`), 17pt semibold bar title,
  tinted text bar buttons, a round-ended chevron back button, rounded 10pt white tables with no outline on `#f2f2f7`,
  separators inset 16pt, uppercase 13pt `#6d6d72` headers, left footers, flat tinted tabs with ios6.css's own filled
  glyphs (no outline set, unlike iOS 7), flat green `#34c759` switch, iOS 13's segmented control (grey track, white
  pill, semibold chosen) for both the App Store control and the scope bar, 10pt search field, 13pt-rounded action
  sheet buttons. The ios6-css.test.js "era stylesheet sets no layout" test passes on it.
- Large titles that collapse on scroll and card sheets: the nav hooks already exist (C54: `nav/navbar.js`
  `setLargeTitles`, `nav/sheet.js` + `html[data-sheet="card"]`), so the audit's "needs nav/ code" was already done;
  this task only turns them on. `core/settings.js` gained `STYLE_HOOKS` (`ios13: { nav: "large", sheet: "card" }`)
  and `hooksOf()`; `screens/settings.js` `applyStyleHooks()` (called from `applyTheme`) sets `data-sheet` and loads
  `nav/navbar.js` with a dynamic import only when large titles go on or off, so iOS 6's startup module set is
  unchanged (module-graph.test.js was at its 117 limit with a static import).
- `core/settings.js`: Style's third option `iOS 13`, `STYLE_PALETTES.ios13` = White / OLED Black (the same palette
  values as iOS 7: no palette rule runs under it), footer names both eras.
- `theme-boot.js` (outside the brief's file list, as in F201: the only place `data-style` is set before first
  paint): reads `ios13`, White / OLED Black, and sets `data-sheet="card"` early.
- `index.html`: links `ios13.css` after `ios7.css`, before `wide.css`.
- Tests: theme-palette.test.js (themeState and theme-boot.js agree for iOS 13 in every Mode, system and preview;
  `STYLES`, `hooksOf`; ios13.css linked in order, every selector scoped, no glyph tokens, nothing animated);
  screens/settings.test.js (iOS 13 row, Themes rows hidden, data-style/palette, data-sheet and data-nav on and off).
  `node --test` in web/app: 2659 pass.

## Screenshots (3x, 402x874, headless Chromium)

`shots/`: White and OLED Black of Home (top, 40px scrolled, 120px scrolled: the large title fades into the bar),
Changes, a package page (openMX), Settings, Settings > Theme and Search. Taken with
`journal/2026-11-18-t12-readme-shots/capture.mjs` against `worker/node.mjs` on 127.0.0.1:8915, steps in `steps.json`.

## Choices

- Nav bar is `#f9f9f9` with a hairline everywhere (iOS 13's standard appearance), not the mockup's `#f2f2f7`
  borderless bar: hiding the hairline only at the scroll edge needs JS in the nav hook. The browser top-bar colour
  stays `THEME_COLORS.white` (`#f7f7f7`, shared with iOS 7); the 2-level difference does not show.
- Filled tab glyphs reuse ios6.css's set, which is already filled; no `ICON_SETS.ios13`.

## 120 Hz

ios13.css adds no transition, animation, backdrop-filter or will-change (a test holds it); held bar buttons change
`opacity` only. The large title collapse is the C54 hook's opacity-only, once-a-frame code. Not measured on a phone.

## Spec review (fresh subagent, diff + brief only)

- Fixed: removing the static navbar.js import had glued `import { showAlert, alertOK }` onto a comment line in
  screens/settings.js, so every alert path on Settings would throw a ReferenceError (no test drew one). Fixed, and the
  F202 test now fails on an import glued to a comment. A ios13.css comment that misstated the section header size.
- Kept: theme-boot.js and screens/settings.js changes outside the brief's files (the only way to set data-style
  before first paint and to turn the nav hooks on). Large titles arrive a tick after first paint under iOS 13 (the
  dynamic import), by choice, to keep iOS 6's startup set unchanged.
- tools/check.sh: run by `run done`, which refuses to tick unless it passes.

## Not verified

- **On a phone (WebKit) and frame rate**: Chromium only; the task did not give phone access and 120 Hz is argued
  from the code, not measured.
- **Card sheets on screen**: `data-sheet="card"` is set (test + boot), but no sheet was opened in a capture.
- **Still iOS 6 under iOS 13** (as under iOS 7, not clean per docs/eras.md): Home's tiles and the GitHub/Discord
  pair (home.css), the HUD (visible fading in the Settings shot), alerts, share sheet, package rows' bold names
  (packages.css), the switch's 77 x 27 size, separators not inset to the label on icon rows. F331 already tracks the
  hook work for these after C45/C47.
- **App status bar under White**: native always uses light content (B221, filed by F201), same for iOS 13.
- **Pressed states**: not pressed in a capture.
