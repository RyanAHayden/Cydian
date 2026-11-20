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
- Screenshots: SHOTS
- `tools/check.sh`: run by `run done`, which refuses to tick unless it passes.

## Notes

- `-webkit-box-reflect` (store icon, browse hero) paints, but the test's `LOOK` list does not name it, so it stays in
  the layout rules. Adding it to `LOOK` belongs in ios6-css.test.js (not this task's file).
- docs/eras.md's "What is clean today" still lists packages.css as not clean; left alone because every sibling
  cleanup (C45, C47…) edits that same line. Filed as a follow-up (below).

## Not verified

NOTVERIFIED
