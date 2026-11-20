# C44 Era readiness: look apart from layout (step 1)

Goal: make an era (F201 iOS 7, F202 iOS 13, F203 iOS 26) a clean stylesheet. This step: the spike, the choice between
overriding and tokenising, the real split for the nav bar, tab bar, grouped tables and bar buttons with no visible
change in iOS 6, `docs/eras.md` (Definition of clean), and C follow-ups for the rest.

## Spike

Wrote the same iOS 7 look (F201's spec: #f7f7f7 bars with a hairline, text-only #007aff buttons and a chevron back,
edge-to-edge white tables with hairlines on #efeff4, uppercase 13px #6d6d72 headers, flat tab icons) twice:

- `spike-override.css`: plain overrides over `ios6.css` as it was (cee6d94b).
- `spike-tokens.css`: token and hook values plus look-only rules over the split `ios6.css` / `style.css`.

Counted with the test's own parser (`cssRules`, `LOOK` from `web/app/ios6-css.test.js`):

| | override | tokens |
|---|---|---|
| rules with real declarations | 42 | 12 |
| declarations | 97 | 24 (+85 token values) |
| layout declarations | 17 | 0 |
| declarations tagged [D] (undo an iOS 6 decoration) | 46 | 4 |

Override also needed four extra heavy rules because the dark and red bar-button rules carry `:not(.back):not(.done)`
(specificity 0,4,1+). Decision: **tokenising** (written up in `docs/eras.md`). No `@layer` (Safari 15.4; we support
iOS 15.0).

The tokens spike was rendered in a scratch copy of `web/app` (an extra `<link>` and `data-style="ios7"`):
`spike-ios7-light.png` (Settings > Account, Classic) and `spike-ios7-dark.png` (Settings, OLED Black). Its first render
drew white tables under white text in dark: colour tokens on bare `html[data-style=ios7]` tie with `ios6.css`'s
`html[data-theme="dark"]` block and win by order. Fixed by putting hooks on `html[data-style]` and colours on
`[data-theme="light"]` / `[data-theme="dark"]`; that rule is in `docs/eras.md`.

## The split (shipped)

- `web/app/style.css`: new "Era hooks" section at the end: a `:root` of geometry hooks (`--bar-btn-h`, `--tab-item-h`,
  `--group-margin`, `--cell-min-h`, …, iOS 6 values) and every layout declaration moved out of `ios6.css`'s rules for
  the four components (nav bar pseudo-elements, bar button / back / bar-icon / share glyph box, tab, tab label,
  icon, badge, group margins, table reset, cell box, cell text truncation, count, icon, row-icon, chevron box,
  sel-ghost).
- `web/app/ios6.css`: those rules keep only paint and type, inside `/* ==== look-only { ==== */ … /* ==== } look-only
  ==== */` stretches (three: nav bar + bar buttons, tab bar + grouped tables, the Share glyph). iOS 6 decorations come
  from new tokens in a `:root` at the top of the first stretch (`--nav-bar`, `--nav-shadow`, `--bar-btn*`,
  `--bar-back*`, `--tabbar*`, `--tab-*`, `--badge*`, `--grouped-ground`, `--site-strip`). Selectors are unchanged
  (the dark `:not(.back):not(.done)` rules included), so the cascade is the same; the dark rules already read
  `--dk-*` tokens and stay as they were. `.pull-clip.grouped > .pull-refresh` now paints `var(--grouped-ground)`
  (same value) so the pull area follows a style's grouped ground.
- `web/app/ios6-css.test.js`: `LOOK` (the look property list), a parser that splits declarations outside quotes and
  parentheses (data: URIs hold `;`), and tests: the checker on fixtures; ios6.css's stretches paint only and the four
  components' selectors have no rule outside them; every look-only stretch in any `web/app/*.css` paints only and is
  closed (so the follow-ups only add markers in their own sheet); style.css's hooks are all used and the four
  components read them; any era stylesheet `web/app/ios<N>.css` sets no layout.
- Tests outside the brief's file list that read the moved CSS literally, pointed at the new homes (no behaviour
  change): `icons/rowicons.test.js` (row-icon margin, cell padding/gap now in style.css), `screens/storepage.test.js`
  (B41: group margin and cell padding hooks), `tabbar-gloss-css.test.js` (Classic's layers are now `--tabbar`'s value;
  it also checks `.tabbar` paints `var(--tabbar)`).
- `docs/eras.md`: Definition of clean, look vs layout, look-only stretches, the spike table, how to write an era
  (selector scoping, dark, palettes, order), the hook and token lists, what is clean today.
- `nav/navbar.js`, `nav/tabbar.js`: no change needed for this step (their markup classes are the hooks the CSS
  uses); the large-title and floating-tab-bar hooks are follow-ups.

## No visible change: how it was checked

`shots.mjs` (this folder) serves a `web/app` dir to headless Chromium at 390x844, deviceScaleFactor 3, animations
frozen, in the app shell (fake bridge, `data-shell="app"`) for Classic, Sepia, OLED Black, Gunmetal and Midnight over
Home, Settings, a Settings page pushed from it, Sources, Changes, Installed, Search, plus Home and Settings on the
website: 37 shots. Each writes the PNG and a dump of every computed property of every element and `::before`/`::after`
under the nav bar, tab bar and shown page. `--pressed` also sets `.is-pressed` on the first bar button, back button
and cell and shows the tab badges. `diff.py` compares two runs (pixels and computed styles, custom properties
skipped).

- base (scratch worktree at cee6d94b) vs base again: same (the harness is deterministic).
- base vs this branch: **same**, all 37 shots, 0 px and 0 computed-style differences; with `--pressed` too.
- `node --test web/app`: 2552 pass. `tools/check.sh`: see the done run.

## Tried and failed

- First `shots.mjs` crashed on a 404 (`writeHead` ran before the `readFile` that threw); fixed.
- Considered naming the light tokens after the palettes' `--lt-*` (`--lt-nav-bar`, `--lt-btn`): rejected, Sepia and
  Solarized set those, and `.bar-button.done` (which keeps the light border) would have picked up the palette's edge
  colour. The new tokens have their own names.
- The first follow-up for the floating tab bar was filed `--after` itself (a guessed id); corrected with
  `plan edit C52 --after C44,C45,C54`.

## Follow-ups filed

C45 rest of ios6.css; C46 packages.css; C47 sources/home/settings.css; C48 the small stylesheets; C49 palettes onto
tokens (and how an era outranks dark palettes); C50 nav/ overlays' JS-drawn art; C51 per-style icon map for JS SVGs;
C54 large-title hook (nav/navbar.js); C52 floating tab bar hook (nav/tabbar.js); C53 card sheet hook (nav/sheet.js).

## Not verified

- **On a phone (iPhone 7, iOS 15 WebKit) and in Safari**: the diff ran in Chromium only. The change only moves
  declarations between files and replaces values with custom properties that resolve to the same values; WebKit has
  supported both for years, but `border-image: var(--bar-back) 0 10 0 26 fill / …` (a var() inside the border-image
  shorthand) is the one construct worth a look on the 7. The task did not ask for the phone and the 7 is driven only
  when a task says so.
- **Pages not in the shot list**: package pages, sheets (`.navbar.sheet-bar`), the console, the website's sign-in
  flow, wide screens (wide.css) and landscape. They use the same rules; the fake bridge has no data to open a package
  page or most sheets.
- **Pressed and held states beyond the first bar button, back button and cell** (`.bar-button.red`, `.done`, the
  Share button, `:active` from a real touch): their rules were not restructured beyond token substitution.
- **Light palettes under an era**: not built; documented as not supported until C49.
