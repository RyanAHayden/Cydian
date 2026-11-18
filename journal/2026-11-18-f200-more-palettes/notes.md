# F200: more iOS 6 palettes in the theme menu

Settings > Theme > Dark now lists OLED Black, Gunmetal, **Midnight, Linen, Nord, Dracula**; Theme > Light lists
Classic, **Sepia, Solarized Light**.

## What changed

- `web/app/palettes.css` (new, loaded last by index.html): one token block per palette keyed by
  `html[data-theme=…][data-palette=…]`. Dark blocks override OLED Black's tokens (ios6.css), so every token-driven
  dark rule repaints; no shape changes, gloss and bevels kept.
  - Linen: `--weave`, a CSS-drawn linen (light weft, dark warp, faint diagonal over #36383d), painted by one rule on
    the same four backgrounds that draw the pinstripe (`.page-body.grouped`, `.boot`, `.filter-drop-inner`,
    `.review-sheet`), with the kit's black bars.
  - Light palettes: the light rules use fixed kit colours for chrome, so I added `--lt-*` tokens set only by the
    light palette blocks, and rules scoped to `html[data-theme="light"]:is([data-palette="sepia"],
    [data-palette="solarized"])` for the nav bar, bar buttons, back arrow (re-coloured copies of the kit's SVG),
    `html` ground, the search/scope bar and Cancel, the package header band and the App Store segmented control.
    The blue Done, the selected blue segment and the black tab bar stay the kit's (iOS 6 kept those).
- `core/settings.js`: the new options (with swatches). `DARK_PALETTES`/`LIGHT_PALETTES` follow from them.
- `theme-boot.js`: palette lists instead of hard-coded names, plus each one's top-bar colour;
  `screens/settings.js` THEME_COLORS likewise (each palette's status-bar colour, the last layer of its nav bar).
- Tests: `palettes.test.js` (new): every menu theme has a block; dark blocks only override OLED Black tokens;
  light blocks set every `--lt-*` the rules read and the rules' palette list matches; **WCAG contrast**: body text
  ≥ 7:1 on table and plain list, subtitle/detail/header/field text ≥ 4.5:1, dark link/ok/bad/index ≥ 4.5:1.
  Existing tests updated where they listed only two themes.

## Decisions

- **Colours not from the mockup.** The artifact (claude.ai/artifact/DERxAzNHvs7E8seziw46EE) only serves a shell
  page; the content frame needs a signed-in browser (curl got the shell, the frame host returned 404), the same
  as F198/F199 found. I used each palette's published values (Nord's Polar Night/Snow Storm/Frost/Aurora,
  Dracula's spec, Solarized base/accents), iBooks 2012-like sepia paper and ink, and a charcoal Notification
  Center linen, put into OLED Black's and Gunmetal's steps.
- Contrast fixes off the published values: Nord red lifted to #eea2a8 (#bf616a is 2.5:1 on #3b4252), Dracula red
  to #ff7b7b (3.8:1), Dracula subtitles #a4abcf instead of its comment colour (2.5:1), Solarized detail #1b6fab
  (blue #268bd2 is 3.4:1 on base3), Solarized header #4d6168.
- Palette names are single words (`solarized`, not `solarized-light`): theme-palette.test.js's palette-block
  pattern is `\w+`.
- A separate file instead of growing ios6.css keeps merges with other tasks clean.

## Checks

- `node --test web/app/`: all pass (1222 tests at the time).
- 3x screenshots (390x844 @3x, headless Chromium through `node worker/node.mjs`, `capture.mjs` + `shots.json`
  here), reduced to 256 colours to keep the journal small: `<palette>-changes.png` and `<palette>-package.png`
  (Provenance) for all six, plus `dark-theme-list.png` and `light-theme-list.png`. Looked at each: text readable
  everywhere; Linen's weave shows behind grouped pages; Sepia/Solarized bars, search bar, header band and segments
  take the palette.
- Gotcha: port 8791 was already in use by another slot's server and my first run silently shot that server's
  (older) app; use a random high port and check the log prints `ifizbox: http://…` with this worktree's web path.

## Follow-up

- F214: the native shell's launch ground knows only oled/gunmetal (others start black, light ones start on the kit's
  pinstripes until the page paints).

## Not verified

- **The mockup's exact colours**: not readable without a signed-in browser (above); the palettes may differ from
  its phones.
- **On a phone**: not checked on the iPhone 7 (the task doesn't say to touch it); the jailbreak app's cold-launch
  ground is wrong for the new palettes until F214.
- **Pressed states** (bar buttons, back arrow, scope segments in Sepia/Solarized): drawn, not captured.
- Other pages (Sources, Queue sheet, action sheets, Reviews) not shot per palette; they use the same tokens.
