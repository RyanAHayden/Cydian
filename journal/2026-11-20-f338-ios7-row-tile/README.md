# F338 iOS 7 row tile position

What I did
- style.css Era hooks: `--row-icon-in` (-3px) and `--row-icon-after` (3px); `.cell-icon.row-icon` margin reads
  them. iOS 6 renders as before.
- ios7.css: `--row-icon-in: 0px; --row-icon-after: 7px`, so the tile sits at the 15pt cell padding and the label
  15pt after it (7 + `--cell-gap` 8), as in the Teehan+Lax iOS 7 kit's Table View 1 (tile x 30px@2x, label 118px@2x).
- ios7.css: the separator on a row-tile row starts at 15 + in + 29 + after + gap = 59pt, at the label. Rows with
  another `.cell-icon` (no row tile) keep the old 52pt rule. The theme swatch rule is unchanged.
- docs/eras.md hook table row; ios6-css.test.js F338 test.

Checked
- `node --test web/app/ios6-css.test.js`: 18 pass.
- A static page with style.css + ios6.css + ios7.css in headless Chromium (375px, a grouped table, two row-tile
  rows): iOS 7 gives tile left 15, label left 59, separator background-position 59px. iOS 6 gives tile 8, label 48
  (the same formula as before the change).

Tried and dropped
- One shorthand hook (`--row-icon-margin`): the separator rule can't read the parts of a shorthand, so I split it in two.

**Not verified**
- The real Settings screen on a phone or in the full app: I measured only a static page with the same markup and
  stylesheets. The home.css / packages.css rules that set the margin to 0 still win over the hook, as they did before.
