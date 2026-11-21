# D21 docs/eras.md: packages.css and the rest of ios6.css are clean

## What I did

- Checked that the sibling cleanups had landed on main: C45, C46, C47, C48, C49, C50, C51, C53 have. C52 (floating
  tab bar) and C54 (large titles) are still open, but they are nav hooks, not cleanups of the clean list: they edit
  the "Nav hooks" section, which this task leaves alone. So I went ahead rather than wait.
- `docs/eras.md`, "What is clean today": the Clean list now names all of `ios6.css` (C44's four plus C45's switch,
  plain tables and section header, button pair, HUD, menu callout, queue hint, signing rows, banner, share sheet,
  reload bar, segmented control, undo bar, pull to refresh, placeholders and locked tab) and `packages.css` (C46).
  Both are gone from "Not yet clean"; the palettes' segmented-control line now says the control has `--seg*` tokens
  and the palette rules have not moved onto them (palettes.css's `.store-segmented` / `.store-segment` rules in the light palettes' block still paint it).
- "Look tokens (ios6.css)": C45's tokens per component (button pair, switch, segmented, HUD, menu and queue hint,
  signing rows, banner, share sheet, reload and undo bars, pull to refresh, placeholders, locked tab, section header,
  `--chevron-pressed`, `--bar-glyph-emboss`), plus a note on the `…-dark` tokens. Every name checked against
  `grep -o -- "--[a-z0-9-]*:" web/app/ios6.css`.
- New "Look tokens (packages.css)": the search bar, scope bar, Filter, action sheet and store header tokens from its
  `:root` (read off the file, matching C46's journal), how sheets paint, and the `-webkit-box-reflect` note (T61).
- Geometry hooks table: C45's 11 new style.css hooks with their values (read off style.css lines 108-114), and the
  components with no hook on purpose (the switch's `TRAVEL = 50` in nav/switch.js, checked).
- "Today only the four below do" now points at the clean list (it was false once the list grew).
- Overlays table: action sheet, reload bar, banner, undo bar and menu now say "tokens" instead of "literal".
- Palettes paragraph: the App Store segmented control has tokens now; the palettes still paint it with rules.

## Left for D22

D22 (open, same file) asks for the small stylesheets (C48), sources/home/settings (C47), palettes on tokens (C49)
and the lazily-loaded-sheets note. I left "the small ones" and the palettes line under "Not yet clean" for it, so
the two tasks don't do the same edit twice; noted on D22.

## Spec review

A fresh subagent saw only the diff and the brief. It found no wrong names or values.
- Reverted: an added Definition of clean bullet on C45's test checks, which the task didn't ask for. Filed as D23.
- Kept, though outside "What is clean today": the overlay rows (literal -> tokens), the palettes paragraph and
  "Today only the four". With packages.css and ios6.css listed as clean, each of them would have been false.
- C52/C54 not landed: they will edit the "Not yet clean" nav-hooks line when they land, as part of their own work.
  This list's cleanups are all in.
- Section index and row swipe stay "literal" in the overlays table: their colours are still literal look rules
  inside packages.css's stretches. The Clean bullet says so.

## Tried and failed

none

## Not verified

- Rendered markdown anchors (`#geometry-stylecss-era-hooks`, `#look-tokens-ios6css`, `#look-tokens-packagescss`):
  written by GitHub's slug rules, not opened in a renderer.
- The tests that read docs/eras.md (rowicons, ios6-css, sheet, spinner, palettes .test.js) pass: 46/46; the full
  gate runs in `run done`.
