# C56: light palettes' App Store segmented control on tokens

## What changed

- `web/app/palettes.css`: the four rules the light palettes (Sepia, Solarized, Legal Pad, Brushed Metal) used to
  paint ios6.css's App Store segmented control (`.store-segmented`, `.store-segment:not(.selected)`, its divider
  and `:active`) are gone. The shared `html[data-theme="light"]:is(…)` block now sets ios6.css's tokens instead:
  `--seg: var(--lt-seg)`, `--seg-pressed: var(--lt-seg-pressed)`, `--seg-edge` and `--seg-divider:
  var(--lt-seg-edge)`, `--seg-text: var(--head)`. The selected segment's tokens are left alone (the kit's blue stays),
  and so are `--seg-shadow` and `--seg-emboss`, which the old rules did not change either.
- Why the tokens reproduce the old rules: the old `.store-segmented { border-color }` (0,3,1) lost to ios6.css's
  `:has(.selected:first-child/last-child)` edge rules (0,4,0), so a selected end segment kept its blue edge; with
  tokens it still does. The old divider rule only matched unselected-after-unselected, exactly where ios6.css's
  divider reads `--seg-divider` (a divider next to the selected one reads `--seg-selected-edge`). `--head` is only
  set on html, so `var(--head)` resolved on html equals the old rule's resolution on the button.
- `web/app/palettes.test.js`: the "no palette rule paints chrome" test now also forbids any rule naming
  `.store-segment*`, and checks the light block sets `--seg`, `--seg-pressed`, `--seg-edge`, `--seg-divider` from
  `--lt-*` tokens (ios6.css reading each) and `--seg-text` from `--head`.
- `docs/eras.md`: Palettes bullet and the "clean today" paragraph list `--seg*`; the "Not yet clean" list is
  dropped (this was its only item); "two palette rules still paint chrome" becomes one (Metal's etched text).

## Check

- `node --test web/app/palettes.test.js web/app/ios6-css.test.js`: 23 pass.
- `probe.mjs` (here): C49's probe plus a second segmented control with the selected segment in the middle and the
  last segment held (`:active` forced via CDP `CSS.forcePseudoState`). Run on a scratch worktree of main and on this
  branch for Classic, the four light palettes and OLED Black: `diff -r` identical. Spot-checked that the held
  segment shows the pressed gradient and Sepia's values differ from Classic's (so the probe sees the palette).
- C49's `shots.mjs` (routes; Settings shows the Mode segmented control) on main and branch for Classic and the four
  light palettes, compared with C44's `diff.py`: 37 shots (7 app routes × 5 themes + 2 site routes), all
  "0 px, 0 style differences", "same".
- Spec review (fresh subagent): no missing or wrong mapping; asked to re-wrap one overlong comment line in
  palettes.css (done). It noted `probe.mjs` keeps C49's unused helpers (DUMP, PRESS, ROUTES): left as copied.
- `tools/check.sh`: run by `done`.

## Slips

- Edited `palettes.test.js` once with a python heredoc instead of the edit tool (string replacements, checked
  each matched once).

## Not verified

- Dark palettes other than OLED Black (probe only): the change touches only the light block's selector, so the
  dark ones cannot match it.
- Not checked on a phone or in Safari: Chromium only. The change is plain custom properties, no new syntax.
- No era stylesheet exists yet, so an era overriding `--seg*` is not rendered, only implied by the token block's
  weight (pinned by the existing test).
