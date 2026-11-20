# C49: light palettes on tokens

## What changed

- `web/app/palettes.css`: the light palettes' (Sepia, Solarized, Legal Pad, Brushed Metal) rules on `.navbar`, bar
  buttons (+ pressed), the back arrow (+ pressed), the red button (+ pressed), the search bar (+ scoped), scope bar,
  search field, scope segments / Filter / Cancel (+ selected/pressed) and the package header band are gone. Their
  shared `html[data-theme="light"]:is(…)` block (which already set the ground) now maps the `--lt-*` colours onto
  the look tokens those components read: ios6.css's `--nav-bar`, `--bar-btn*`, `--bar-back*`, and packages.css's
  (C46) `--search-bar(-scoped)`, `--search-scope`, `--search-field-edge(-top)`, `--search-cancel*`, `--scope-seg*`,
  `--store-head(-edge)`. Values chosen to reproduce the old rules exactly: a pressed button / segment / Cancel keeps
  its unpressed edges, and bottom edges and segment dividers take the one edge colour (the old rules' `border-color`
  beat packages.css's divider rules on weight).
- The red button needs no mapping: ios6.css's red rule already reads `--lt-red*`, which every light block sets; the
  old palette red rule only existed to beat the old palette bar-button rule.
- Kept as rules: the App Store segmented control (ios6.css's has no tokens yet; C45 covers that part of ios6.css)
  and Brushed Metal's etched text (its dark text skips Done and the red button, which a shared token cannot).
  Metal's rule now also skips `.manage-delete` and anything inside `.console` (see below).
- `web/app/packages.css`: one comment that said palettes.css paints the search bar with its own rules.
- `web/app/palettes.test.js`: two tests. No palette rule names the nav bar, bar buttons, search/scope/field/Cancel
  or header band except Metal's, which may set only color, text-shadow and filter; the light block sets each of the
  31 tokens from an `--lt-*` and ios6.css/packages.css read each one. Every token block's selector is at most html
  plus two attributes, and any `ios<N>.css` in index.html is linked after palettes.css.
- `docs/eras.md`: the Palettes bullet and "What is clean today".

## Decision: how an era's dark block outranks the dark palettes

It already does. A dark palette block is `html[data-theme="dark"][data-palette="x"]` (0,2,1); an era's tone block
`html[data-style="ios7"][data-theme="dark"]` is also (0,2,1) and is linked after palettes.css, so it wins on order.
The same now holds for light, since the light palettes paint none of the tokenised chrome. The test pins both
halves (block weight, link order). What does not work is mixing: tokens the era leaves alone (pinstripe, table,
text…) still come from the palette, so an era would draw half a palette. Decided: **eras offer only their own
themes**; the menu hides palettes under an era and the app sets no `data-palette` there. Written in docs/eras.md,
for whoever builds the first era (no era or era picker exists yet, so nothing to change in code now). Not making
the era heavier (`:root:root`, doubled attributes): it buys nothing over order and invites specificity creep.

## Behaviour changes (intended)

The old palette rules (0,5,1) / (0,3,1) also beat two component rules that were never meant to lose to them; with
tokens those rules win, as they already did in Classic and every dark theme:

- the console sheet's bar and buttons (queue.css `.console .navbar.sheet-bar` (0,3,0), `.console .bar-button`
  (0,2,0)) were the palette's under a light palette; now black and grey like every other theme.
- My IPAs' toolbar Delete (packages.css `.manage-delete:not(.back):not(.done)` (0,5,0)) was the palette's button
  colour under a light palette; now red like every other theme.

Under Brushed Metal that would have put its dark etched text on the black console bar, the grey console buttons and
the red Delete (the probe showed #2f343b on them), so Metal's text rule now skips `.manage-delete` and `.console *`;
they keep white text, as in Classic.

## Check

- `node --test web/app/palettes.test.js web/app/ios6-css.test.js`: 18 pass.
- Screenshot + computed-style diff against main (`shots.mjs` here is C44's with Legal Pad and Brushed Metal added and
  a `PALETTES=` filter; compared with C44's `diff.py`), on the final CSS: Classic, Sepia, Solarized, Legal Pad,
  Brushed Metal, OLED Black × 7 app routes + 2 site routes = 44 shots, "same" (0 px, 0 style differences). With
  `--pressed` (first bar button, back button and cell pressed, badge shown), the five light themes, 37 shots: "same".
- `probe.mjs` (here): the chrome no route shows, as a fixture on Search, computed paint compared on main and branch
  for Classic and the four light palettes. Identical: plain, back, Done, red and red pressed bar buttons, search bar
  (scoped and plain), field, Cancel, three scope segments (selected, after selected, plain), Filter, Filter's Done,
  store header, App Store segmented. Different only where intended: the console bar, its button and (Metal) its
  title, and Delete, which now equal Classic's.
- `tools/check.sh`: run by `done`.

Failed along the way: the first version left search/scope/header as rules, assuming packages.css had no tokens;
C46 had already landed them, so they moved too. The first probe found the Metal dark-text regression above. One
slip: edited this folder's shots.mjs header once with `sed -i` instead of the edit tool.

## Not verified

- Pressed states of the scope segments and Cancel other than `.selected` (`:active` is not forced in the probe);
  they read the same token as `.selected`, which matched.
- Dark palettes are untouched by the diff (only OLED Black in the shots, as a control).
- No era stylesheet exists, so "an era's tone block wins" is checked by selector weight and link order in the test,
  not by rendering one.
- Not checked on a phone (Safari's `:not(.console *)` is fine on iOS 15, the oldest supported; Chromium rendered it).
