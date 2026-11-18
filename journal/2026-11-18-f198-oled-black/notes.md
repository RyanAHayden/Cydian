# F198: OLED Black dark theme (2026-11-18)

OLED Black is now the dark palette, used for Dark and for Automatic on a dark iPhone. F13's gunmetal dark stays as
a second palette (Gunmetal) for F199's theme menu.

## What changed

- **Tone and palette.** `<html data-theme>` is the tone (light/dark), and `<html data-palette>` is now the palette
  beside it: `classic` (light), `oled` (the default dark) or `gunmetal`. `core/settings.js` gains `paletteFor(theme,
  darkTheme)`, `DARK_PALETTES` and `DARK_THEME_KEY` (`ifizbox.darkTheme`). The value is stored raw, the same way
  `ifizbox.appearance` is. No SETTINGS row yet: F199 adds the menu and should turn that key into a real setting
  (`darkTheme`), keeping the key name so stored choices carry over. To try Gunmetal today, run
  `localStorage.setItem("ifizbox.darkTheme", "gunmetal")`.
- **Tokens.** In `ios6.css`, `html[data-theme="dark"]` now holds OLED Black's values: the existing tokens plus about
  45 new dark-only `--dk-*` ones (bars, tab bar, buttons, back arrow SVG, switch, search/scope bar, status colours,
  links, store page, placeholders, warning/issue tables). A page with no `data-palette` therefore gets OLED too.
  `html[data-theme="dark"][data-palette="gunmetal"]` overrides only the tokens whose value differs, using F13's exact
  values. Every `html[data-theme="dark"]` rule in web/app/*.css now uses tokens (scripted swap, one exact match per
  rule: ios6, packages, home, queue, reviews, altstore, guides, myipas). Left as literals on purpose: pure black
  edges, black shadows, `rgba(255,255,255,.15/.18)` overlays, and the kit's UIAlertSheetBlack action sheet (the
  kit's own black art, which fits both palettes). `theme-palette.test.js` enforces this.
  - Small deliberate drift in Gunmetal: `.review-report` was `#8fb0ea` and now shares `--dk-link` `#8fb0e8`.
  - OLED values from the brief: ground, status bar and tab bar #000 (tab bar has a #1c1c1e top hairline); nav
    gradient #333336 > #151517 50% > #070708 51% > #000, top highlight .16 white, base line #1a1a1c, no shadow;
    buttons #3a3a3e>#121214 with a #000 edge; tables #0e0e0f with a #1f1f22 edge, dividers #1c1c1f and no highlight
    (`--divider-hi: transparent`), no emboss (`--table-inset: transparent`); header #d6d6db with `--emboss: none`;
    subtitle #8d8d93, detail #5fa2ff, chevron #55555b; no pinstripe (both pin colours #000). Values the brief
    didn't give (switch, search bar, store head, status tables, etc.) are my choices, a near-black step from the
    table colours. The mockup artifact was not opened again: I worked from the brief's numbers.
- **theme-boot.js** sets data-theme, data-palette and the bare `theme-color` meta before first paint.
- **screens/settings.js**: `applyTheme` sets `data-palette`. `THEME_COLORS` is keyed by palette (`oled` is `#000`).
  A meta with no media query (index.html has one) gets the colour of the palette showing; before this, under
  Automatic it always got the light colour. `app.theme` now also sends `darkPalette`.
- **Native shell**: `Theme.apply` paints the window and web view (background, scroll view, underPage) with the
  palette's ground and saves `{style, darkPalette}` under `ifizbox.shellTheme` in UserDefaults. At launch,
  `SceneDelegate` / `Web.make` read it back (`Theme.launchGround`): black for OLED, gunmetal pinstripes for Gunmetal,
  and the light pinstripes otherwise or on first run. The window's interface style also starts from the saved style
  instead of always `.light`.

## Checks

- `node --test` on the touched suites: pass. New `web/app/theme-palette.test.js` covers paletteFor, theme-boot.js in
  a vm for every Appearance × dark theme × system combination (checked against themeFor/paletteFor and
  THEME_COLORS), applyTheme's palette and metas, the OLED token values from the brief, Gunmetal overriding only known
  tokens, and no fixed colours left in dark rules.
- `make -C native package` built the .deb and the IPA (swift toolchain on this machine).
- 3x screenshots (headless Chromium, 390x844 @3x, the site through `node worker/node.mjs`; `capture.mjs` here is
  F174's driver plus SHOT_W/SHOT_DPR and a touch `tap` step): `oled-home.png`, `oled-changes.png`,
  `oled-package.png` (Provenance), `oled-queue.png` (the Confirm sheet with two jobs queued through
  `screens/queue.js` queueApp, since a tap on the site's Install didn't open it headless), plus `gunmetal-package.png`
  showing Gunmetal unchanged.
- Grey flash (site): a capture 120 ms into a dark reload, at 1x, has only black and near-black pixels. The page had
  already replaced #boot by then, and `html` and #boot both compute to black under OLED.

## Not verified

- **On the iPhone 7 (the app):** the task didn't say to drive the phone, so I didn't. Not checked there: the
  window and web view going black on a dark launch, `UserDefaults` carrying `ifizbox.shellTheme` between launches,
  and Theme.apply repainting live when Appearance changes. It compiles; it hasn't run.
- **iOS launch screen in dark:** Info.plist's `UILaunchScreen` images are still the light pinstripes (static, read
  before any code runs), so a dark launch still goes light launch screen → black window. Making it follow the
  palette would need dark launch images or an asset catalog with a dark variant (docs/native.md, "Launch screen").
  Not in this task's files.
- **Real Safari/WebKit:** screenshots are Chromium. Not checked: `env()` inside the `--dk-nav-bar` custom property
  on iOS WebKit (it should work: var() substitution happens at computed-value time), and Safari's top bar picking up
  the boot-time theme-color.
- **Mockup side-by-side:** I didn't reopen the artifact to compare pixels. Values come from the brief's text.
