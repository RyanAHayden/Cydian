# F340 iOS 7 Home glyph tile geometry and Signing's app offer

- `web/app/ios7.css`: under `html[data-style="ios7"]`, `.home-glyph` gets the row tiles' 6.5pt corners
  (`border-radius: 6.5px`, rowicons.js ICON_SETS ios7 `tile.radius`) and a 20pt glyph (`background-size: 20px 20px`,
  `tile.glyph`); `.app-offer .home-glyph` (Settings > Signing's Install iFizBox App row) is `#4cd964`.
  Both are look properties, so ios6-css.test.js's "era sets no layout" check still passes.
- The `.glyph-install` iOS 7 rule already outranked home.css's `.app-offer .home-glyph { #37a94a }` by
  specificity, so the offer was likely green already; the explicit rule keeps it green whichever glyph class the
  row gets.
- Checked in headless Chromium (a scratch page linking style.css, ios6.css, home.css, ios7.css with
  `data-style="ios7"`): Home sources tile, jailbreak tile (whose iOS 6 rule has a two-layer background-size) and
  the app offer tile all compute radius 6.5px, size 20px 20px; the offer's colour is rgb(76, 217, 100).
- `node --test web/app/ios6-css.test.js web/app/icons/rowicons.test.js`: 35 pass.

**Not verified**
- No screenshot of the real app pages (Home, Settings > Signing with a working certificate) in iOS 7 style, on
  the phone or in the smoke browser: the Signing app offer only shows with a valid certificate loaded, which the
  fake bridge does not give; computed styles on a scratch page stood in for it.
