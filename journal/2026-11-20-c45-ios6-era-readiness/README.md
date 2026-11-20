# C45 Era readiness: the rest of ios6.css look-only

Goal (docs/eras.md, after C44): everything in `web/app/ios6.css` that C44 left (switch, plain tables and section header,
button pair, HUD, menu callout, queue hint, signing rows, banner, share sheet, reload bar, segmented control, undo bar,
pull to refresh, placeholders, locked tab, and the odds and ends between them) painted in look-only stretches, its
layout in `style.css` with hooks for the geometry an era would change, iOS 6's decorations behind tokens, and no
visible change.

## What changed

- **Layout to style.css, mechanically** (`split.py`, this folder): for every blank-line section of ios6.css after
  C44's first stretch (C44's other stretches kept whole), every layout declaration (the test's `LOOK` list decides),
  layout half of a mixed rule, `@keyframes` (`hud-spin`, `ph-pulse`) and `@media (prefers-reduced-motion)` rule went
  to the end of style.css in source order; the comments and look halves stayed in place inside one look-only stretch
  per section. Then by hand: section headers in style.css, and the comments that explain layout (F166 spinner
  timing, B164 rows, B31 scrollers, the rubber band, zoom, tap flash, the indicator's `scale`) moved with their rules.
  - Why the order is safe: style.css loads right before ios6.css (index.html), nothing in style.css comes after the
    appended rules and all of ios6.css comes after them, and look and layout properties are disjoint with no shorthand
    spanning both. So the two sheets read as one keep both declaration sequences. `cascade.py` (this folder, C46's
    extended to two sheets, at-rules and tokens the old sheets already had) proves it on the files.
  - ios6.css now has no layout at all: outside its stretches only the token blocks (`:root`, the dark palettes) and
    `body`.
- **Decorations behind tokens** (ios6.css, a `:root` at the top of each section's stretch, iOS 6's values; 109 new):
  - button pair `--pair-delete(-pressed|-text|-emboss|-edge|-edge-bottom|-shadow|-shadow-dark)`;
  - switch `--sw-edge(-on)`, `--sw-track`, `--sw-on`, `--sw-on-label` ("ON"), `--sw-on-text`, `--sw-on-emboss`,
    `--sw-off-label` ("OFF"), `--sw-off-text`, `--sw-knob(-held|-edge|-edge-bottom)`, `--sw-track-shadow-dark`;
  - section header `--section-head-text`, `--section-head-emboss` (the bar is C44's `--category`);
  - HUD `--hud`, `--hud-text`, `--hud-emboss`; scroll indicator `--scroll-thumb`, `--scroll-thumb-ring`;
  - menu `--menu`, `--menu-drop`, `--menu-edge`, `--menu-shine`, `--menu-text`, `--menu-emboss`, `--menu-divider(-hi)`,
    `--menu-pressed`, `--menu-arrow(-below)`; queue hint `--callout`, `--callout-drop`, `--callout-edge`,
    `--callout-text`, `--callout-emboss`, `--callout-arrow`; a selected row's white chevron `--chevron-pressed` (C44's
    pressed cell and F192's held package row now both read it);
  - signing `--field-caret`, `--field-ring`, `--field-active`, `--pw-right`, `--pw-wrong`;
  - banner `--banner`, `--banner-shadow`, `--banner-edge`, `--banner-icon-shadow`, `--banner-emboss`, `--banner-title`,
    `--banner-text`, `--banner-timer`;
  - share sheet `--share-dim`, `--share-sheet(-shadow)`, `--share-icon-shadow`, `--share-system(-metal|-glyph|-glyph-emboss|-shine)`,
    `--share-app-gloss`, `--share-app-shine`, `--share-letter(-emboss)`, `--share-pressed`, `--share-label(-emboss)`,
    `--share-dot(-on)`, `--share-cancel(-edge|-shadow|-text|-emboss|-stroke|-pressed)`;
  - reload bar `--reload-bar`, `--reload-text`, `--reload-emboss`; undo bar `--undo-bar`, `--undo-text`, `--undo-emboss`;
  - segmented `--seg`, `--seg-edge`, `--seg-shadow`, `--seg-divider`, `--seg-text`, `--seg-emboss`, `--seg-pressed`,
    `--seg-selected(-text|-emboss|-edge)`;
  - pull to refresh `--pull-arrow`, `--pull-text`, `--pull-emboss(-dark)`; placeholders `--placeholder`; locked tab
    `--tab-lock` (the padlock), `--tab-locked` (the dimming).
  - Names: none starts with `--dk-` (theme-palette.test.js wants every `--dk-*` a dark rule reads to come from every
    palette), and the three literal decorations the dark rules had (the sunken switch track, the delete button's
    emboss, the pull text's emboss) are `…-dark` tokens defined with the light ones. Corner radii and flat type stay
    literal, as in C44/C46: an era restyles them in a look rule.
- **Hooks** (style.css "Era hooks" `:root`, iOS 6's values): `--plain-cell-pad-y` (4px), `--section-head-h` (23px),
  `--section-head-pad` (0 12px), `--pair-h` (44px), `--pair-gap` (9px), `--seg-h` (30px), `--seg-margin`
  (10px 10px 0), `--hud-w` (180px), `--hud-pad` (28px 12px 22px), `--callout-h` (38px, menu and queue hint),
  `--banner-pad` (6px 12px 7px). No hook, on purpose: the switch (nav/switch.js's `TRAVEL = 50` is in JS, so its
  77 x 27 box can't move from CSS alone), the reload and undo bars' 44pt (B40's tests and the scrollers' 44pt end room
  are tied to it, and iOS 7+ toolbars are 44pt too), the share sheet's grid, the pull area's geometry, the placeholders.
  A hook goes in the first time an era needs one (docs/eras.md).
- **Tests** (`web/app/ios6-css.test.js`): three C45 tests: ios6.css sets no layout at all and every rule outside its
  stretches is a token block (or `body`); no gradient, `url()` art, text emboss, filter or border-image written into a
  rule of ios6.css (only in custom properties; the Share glyph is the one allowed `url()`, an icon for C51); style.css
  holds the moved rules and the new hooks drive them. The B4, F204 banner, B40 and B154 tests read style.css and
  ios6.css as one sheet, layout first. Tests elsewhere that read the moved CSS literally, pointed at both files (no
  behaviour change): `nav/pullrefresh.test.js`, `nav/reloadbar.test.js`, `nav/spinner.test.js` (style.css and ios6.css
  count as one sheet for "the image may sit in the same selector's look rule"), `screens/myipas-signoptions-layout.test.js`,
  `section-index-css.test.js`. pullrefresh's "transform and opacity only" test sliced ios6.css between two markers
  that are now in style.css, so it would have passed on nothing; it now reads style.css and asserts it found
  transitions.
- **docs/eras.md not edited**: D21 (filed by C46, low) rewrites "What is clean today" and the token lists once the
  sibling cleanups land, so the one list is edited once. Noted on D21: this journal holds C45's hook and token lists.

## Checks

- `cascade.py <main style.css> <main ios6.css> <new style.css> <new ios6.css>`: `look: 704 declarations, same order,
  same values`, `layout: 707 declarations, same order, same values`, `new :root tokens and hooks: 120`. It catches a
  changed hook value and a changed token value (tried both on scratch copies).
- `node --test web/app`: 2579 pass, 0 fail.
- `python3 -m unittest native/test_launch_grounds.py` (reads ios6.css's bars and tokens): OK.
- Screenshots and computed styles: below.
- `tools/check.sh`: run by `run done`, which refuses to tick unless it passes.

### No visible change: 3x screenshots and computed styles

`shots.mjs` (this folder: C46's harness, C44's lineage, with C45 routes; `ONLY=<word>` limits it to routes whose name
holds the word) over a scratch copy of this branch's `web/app` with main's `style.css` and `ios6.css` put back (the
only runtime files that differ), against this branch, compared with `journal/2026-11-20-c44-era-readiness/diff.py`.
6 palettes (Classic, Sepia, Solarized, OLED Black, Gunmetal, Midnight) x 15 routes + 2 website shots = 92 per side.
Routes: Home, Settings, a pushed Settings page, Sources, Changes, Installed, Search, the HUD, the menu callout with a
queue hint, the banner with its Upgrade button, the share sheet (two system icons, two letter icons), the reload bar,
the undo bar, a "controls" page (segmented control; ON and OFF switches; signing rows with Choose buttons, an empty
value and a server field; the button pair with Remove Certificate; the password field waiting with all four glyphs,
Read From a .txt File and "Wrong password."; a plain table with a section header and a chevron row; both
placeholders; the empty-state note), and Home's pull area shown at its foot on the pinstripe and on a plain ground.
The website shots show the locked tab bar.

- Base vs branch: 81 of 92 shots identical, 0 px and 0 computed-style differences. The 11 others differ only in
  animation timing: the placeholders' `ph-pulse` opacity (0.80258 vs 0.790032, at most 2 levels of pixel value, only
  inside the placeholder box) on the controls page, and the banner timer's scale (set from JS, 0.968335 vs 0.968334).
  A second base run against the first shows the same two differences on the same routes (base vs base, 10 shots), so
  they are the harness, not the CSS.
- The pull route found nothing on the first run (pullrefresh.js adds its area on the first touch); the route now
  builds the same markup, and its rerun (both sides, 6 shots each) is identical.
- `--pressed` (first bar button, back button and cell pressed, badge shown) over the five Settings routes (Settings,
  pushed page, HUD, menu, controls) x 6 palettes, 30 per side: 0 computed-style differences except the placeholders'
  pulse (as above). Pixels: the same placeholder noise, and the HUD's spinner one 30° spoke apart in two shots. A
  rerun of the HUD route put it the other way: base's first run equals the branch's second, and the branch's first
  equals base's second. So the spinner had advanced a step before the freeze, which is timing.
- The Share glyph's emboss went onto `--bar-glyph-emboss` after the review, past these runs; cascade.py reran on the
  final files and still matches (121 new tokens and hooks).

## Spec review

Fresh subagent, diff + brief only. Fixed: the Share glyph's literal `drop-shadow` emboss (C44's stretch) is now
`--bar-glyph-emboss`, and the decorations test exempts only that rule's `url()` glyph, not its filter; the journal's
screenshot results (still running at review time) are recorded above. Kept, and why: the five test files outside the
brief's list (they read the moved CSS literally; pointed at both files, no behaviour change), the new assertion in
pullrefresh's transition test (its old slice would have passed on nothing), this folder's own harness (C46's plus
routes for these components). Not changed: flat literal colours in rules (`color: #fff` on pressed and held rows and
the badge, `.cell-icon`'s `#8c99b3`): the brief asks for decorations (gradients, glosses, embosses, border-images)
behind tokens, and an era restyles a flat colour in a look rule without undoing anything.

## Tried and failed

- First version of the HUD edit missed: the split had put the `.hud-spinner` look rule between `.hud` and the F166
  comment, so the old string didn't match; redone on the real text.
- The first grep for name clashes used `--include=*.css` with ugrep, which ignored it; redone without.

## Not verified

- **On a phone and in Safari/WebKit**: the diff runs in headless Chromium only. The change moves declarations between
  two sheets loaded back to back and replaces values with custom properties that resolve to the same values; `content:
  var(--sw-on-label)` (a string through a custom property) is the one construct new to this codebase, supported by
  WebKit since custom properties shipped. No device run was asked for.
- **Pages and states the harness can't reach**: package pages, the console, wide screens (wide.css), landscape,
  `:active` from a real touch (menu item, share item and Cancel, segment, delete button pressed), a dragging switch, the
  pull area while refreshing (spinner) and armed (turned arrow). cascade.py's proof covers their rules, which is exact
  for this kind of change but is not a render.
- **tools/og.html** loads ios6.css without style.css; it styles its own `.bar-button` and uses none of the moved
  components, so it was not rendered.
