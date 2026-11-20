# C46 Era readiness for packages.css

Goal (docs/eras.md, after C44): packages.css's look in look-only stretches, its mixed rules split with the layout kept
in its own rules in packages.css, and iOS 6's decorations for the search bar, scope bar, Filter, store header, action
sheet and sheets behind tokens, with no visible change.

## What changed

- `web/app/packages.css`, every section (the blank-line-separated blocks under each `/* ---- … ---- */` header):
  its layout rules first, then one `/* ==== look-only { ==== <section> */ … /* ==== } look-only ==== */` stretch with
  its look rules. A rule that set both is now two rules with the same selector, its layout half in place among the
  layout rules and its look half in the stretch. 36 stretches plus the token stretch. Done by `split.py` (this
  folder), then the tokens by hand.
  - Why the order is safe: look and layout properties (the test's `LOOK` list) are disjoint and no shorthand spans
    both (`font` and `line-height` are both look, `inset`/`flex`/`overflow` all layout, `border*`/`background*` all
    look), so only the relative order of declarations within each group decides the cascade, and both groups keep
    their source order. `cascade.py` proves it on the file (below).
- A `:root` token block at the top of packages.css (its own look-only stretch), 62 tokens with iOS 6's values:
  - search bar `--search-bar`, `--search-bar-scoped`, the field `--search-field` (white + the magnifier),
    `--search-field-edge(-top)`, `--search-field-shadow`, `--search-text`, `--search-hint`, the clear button
    `--search-clear`, Cancel `--search-cancel(-pressed)`, `--search-cancel-edge(-top|-bottom)`, `-text`, `-emboss`,
    `-shadow`;
  - scope bar `--search-scope`, segments `--scope-seg`, `--scope-seg-edge(-top|-bottom)`, `--scope-seg-divider`,
    `-text`, `-emboss`, `-shadow`, selected `--scope-seg-selected`, its edges and divider;
  - Filter: Done `--scope-done(-pressed)`, `--scope-done-edge(-top)`; the panel `--filter-ground`, `--filter-shadow`;
  - action sheet `--action-dim`, `--action-sheet`, `--action-title(-emboss)`, `--action-btn`, `-text`, `-emboss`,
    `-edge`, `-shadow`, `--action-btn-pressed(-text|-emboss)`, `--action-destructive(-text|-emboss)`,
    `--action-cancel(-pressed|-text|-emboss)`, and the dark style's `--dk-action-sheet`, `--dk-action-btn`,
    `--dk-action-cancel` (the dark rules now read them, as ios6.css's dark rules read `--dk-*`);
  - store header `--store-head`, `--store-head-edge`, `--store-head-emboss`.
  - Sheets (nav/sheet.js): already on tokens, nothing literal to move: `.sheet` paints `var(--plain)` and its bar is
    a `.navbar` (ios6.css's `--nav-bar` and bar-button tokens). The depiction iframe's `#fff` is the web page's own
    ground, not an iOS 6 decoration, so it stays.
  - Corner radii stay literal (an era restyles them in a look rule; they are not decorations to undo).
- Tests that read one packages.css rule for both layout and look, pointed at both halves (no behaviour change):
  `browse-hero-press.test.js` (`rule()` joins every rule of the selector), `nav/spinner.test.js` (the spinner's
  image may sit in the same selector's look-only rule), `screens/storepage.test.js` (F195's `.store-tiles` card,
  B41's related-icon image).

## Checks

- `cascade.py <main's packages.css> <this one>`: puts every token defined on the new `:root` back in place of its
  `var()` and compares the look and the layout declaration sequences (selector, property, value, in order):
  `look: 596 declarations, same order, same values`, `layout: 891 declarations, same order, same values`. It was
  checked on fixtures first (a moved look rule that changes the order is caught; a moved one that keeps it passes).
- `node --test web/app`: 2575 pass, 0 fail (ios6-css.test.js's "every look-only stretch in web/app/*.css paints only,
  and every one is closed" now covers packages.css's 37 stretches).
- Screenshots: `shots.mjs` (this folder, C44's harness plus four routes: Search with text typed, Search with the
  Filter panel open, an action sheet with a red button over Search, a modal sheet holding the store header) over
  a scratch copy of `web/app` with main's packages.css vs this branch, 6 palettes x 11 routes + 2 site shots = 68,
  compared with `journal/2026-11-20-c44-era-readiness/diff.py`: **same**, 0 px and 0 computed-style differences in
  every shot. (A first base run used the sheet route without `sheet-scroll page-body`, which put the header under
  the nav bar; both sides were rerun with the fixed route.) The two dark scope tokens were renamed after this run
  (same values, same rules); cascade.py was rerun on the final file and still matches.
- `tools/check.sh`: run by `run done`, which refuses to tick unless it passes.

## Notes

- `-webkit-box-reflect` (store icon, browse hero) paints, but the test's `LOOK` list does not name it, so it stays in
  the layout rules. Adding it to `LOOK` belongs in ios6-css.test.js (not this task's file).
- docs/eras.md's "What is clean today" still lists packages.css as not clean; left alone because every sibling
  cleanup (C45, C47…) edits that same line. Filed as a follow-up (below).

## Not verified

- Pixels of the pages the harness can't reach without package data (package rows, Sections, the package page,
  depictions, Version History, Browse, Roulette, Manage, the store page's tiles, reviews and related rows): the
  fake bridge has no sources. They are covered only by `cascade.py`'s declaration-order proof, which is exact for
  this kind of change but is not a render.
- Pressed looks (`:active` on scope segments, Cancel, action buttons): headless Chromium can't hold `:active`, and
  the C44 `--pressed` option only presses bar buttons, cells and the badge. cascade.py covers their rules.
- The phones: no device run; a CSS change with identical computed styles needs none.

## Spec review

Fresh subagent, diff + brief only. Fixed: the dark scope bar's literal `#000` selected edge and divider now read
`--scope-seg-dark-selected-edge` / `--scope-seg-dark-divider` (first named `--dk-…`, which theme-palette.test.js
refuses: every `--dk-*` token a dark rule reads must come from the palettes; black is the same in all of them);
screenshots were still running at review time and are
recorded above. Not changed: the three test edits (needed: they read one rule for both halves); the dark action
sheet tokens (dark rules read `--dk-*` tokens, as docs/eras.md asks); `.store-btn` (Browse's price button, not the
store header); palettes.css's own search bar / store header rules (docs/eras.md's known palette limit, outside this
file); `-webkit-box-reflect` filed as T61. Follow-ups: D21 (docs/eras.md's clean list), T61.
