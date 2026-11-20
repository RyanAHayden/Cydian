# C49: light palettes on tokens

## What changed

- `web/app/palettes.css`: the light palettes' (Sepia, Solarized, Legal Pad, Brushed Metal) rules on `.navbar`,
  `.bar-button:not(.back):not(.done)` (+ pressed), `.bar-button.back` (+ pressed) and `.bar-button.red` (+ pressed)
  are gone. Their shared `html[data-theme="light"]:is(…)` block (which already set the ground) now maps the `--lt-*`
  colours onto ios6.css's look tokens: `--nav-bar`, `--bar-btn`, `--bar-btn-edge(-top)`, `--bar-btn-pressed`,
  `--bar-btn-pressed-edge(-top)` (= the unpressed edges, as the old rule left them), `--bar-back`,
  `--bar-back-pressed`. The red button needs no mapping: ios6.css's red rule already reads `--lt-red*`, which every
  light block sets; the old palette red rule only existed to beat the old palette bar-button rule.
- Kept as rules (no tokens to set yet): the search bar, scope bar, scope segments, Cancel, the package header band,
  the App Store segmented control (packages.css / ios6.css segmented are not tokenised; separate queued cleanups),
  and Brushed Metal's etched text (its dark text skips Done and the red button, which a shared token cannot do).
- `web/app/palettes.test.js`: two tests. No palette rule (other than Metal's text) names `.navbar` or `.bar-button`,
  and the light block sets each token ios6.css reads from an `--lt-*`. Every token block's selector is at most html
  plus two attributes, and any `ios<N>.css` linked in index.html comes after palettes.css.
- `docs/eras.md`: the Palettes bullet and "What is clean today".

## Decision: how an era's dark block outranks the dark palettes

It already does. A dark palette block is `html[data-theme="dark"][data-palette="x"]` (0,2,1); an era's tone block
`html[data-style="ios7"][data-theme="dark"]` is also (0,2,1) and is linked after palettes.css, so it wins on order.
The same now holds for light, since the light palettes paint nothing on the tokenised chrome. The test pins both
halves (block weight, link order). What does not work is mixing: tokens the era leaves alone (pinstripe, table,
text…) still come from the palette, so an era would draw half a palette. Decided: **eras offer only their own
themes**; the menu hides palettes under an era and the app sets no `data-palette` there. Written in docs/eras.md.
Not making the era heavier (e.g. `:root:root` or doubling attributes) because it buys nothing over order and
invites specificity creep.

## Behaviour changes found outside the screenshots

The old palette rules (0,5,1) also beat two component rules that were never meant to lose to them; with tokens those
rules win, as they already do in Classic and every dark theme:

- the console sheet's black bar and grey buttons (queue.css `.console .navbar.sheet-bar`, `.console .bar-button`)
  were brown/green etc. under a light palette; now black like every other theme.
- My IPAs' toolbar Delete (packages.css `.manage-delete`) was the palette's button colour under a light palette; now
  red like every other theme.

Done (sources.css `.bar-button.done`, later in the cascade than ios6.css's pressed rule) is unaffected.

## Check

- `node --test web/app/palettes.test.js`: 6 pass.
- Screenshot + computed-style diff against main (`shots.mjs` here is C44's with Legal Pad and Brushed Metal added and
  a `PALETTES=` filter; compared with C44's `diff.py`): Classic, Sepia, Solarized, Legal Pad, Brushed Metal, OLED
  Black × 7 app routes + 2 site routes = 44 shots, "same" (0 px, 0 style differences). With `--pressed` (first bar
  button, back button and cell pressed, badge shown), the five light themes, 37 shots: "same".
- `tools/check.sh`: run by `done`.

Failed along the way: nothing; one slip: edited this folder's shots.mjs header with `sed -i` instead of the edit tool.

## Not verified

- The two behaviour changes above (console bar, My IPAs' Delete under a light palette): worked out from selector
  weights only (old palette rule (0,5,1) / (0,3,1) against `.console .bar-button` (0,2,0), `.console
  .navbar.sheet-bar` (0,3,0), `.manage-delete:not(.back):not(.done)` (0,5,0)); neither screen is in the harness's
  routes and I did not render them.
- The red bar button (Confirm's Cancel) under a light palette: not in any shot; same reasoning (ios6.css's red rule
  (0,4,0) now beats `.bar-button` and reads the `--lt-red*` each light block sets, the values the dropped rule used).
- Dark palettes are untouched by the diff (only one dark theme, OLED Black, in the shots as a control).
- No era stylesheet exists, so "an era's tone block wins" is checked by selector weight and link order in the test,
  not by rendering one.
