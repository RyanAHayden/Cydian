# C60: drop the dead changes home glyph

Home's state tile (screens/home.js stateTile) has no `changes` kind since B266 (More Sources took the See What's
New slot), and nothing else builds `glyph-changes`. Removed:

- `changes` from the iOS 6 and iOS 7 home tile maps in `web/app/icons/rowicons.js` (the tab bar's `changes`
  glyphs stay: the Changes tab uses them);
- the `.glyph-changes` rules in `web/app/home.css` and `web/app/ios7.css`.

The optional part (move More Sources' inline tile icon into a `.glyph-more` rule) was already done by B266, so
`web/app/screens/home.js` is unchanged.

Checked: `grep glyph-changes` finds nothing left; rowicons and Home tests pass (they tie the CSS to the maps both
ways).

**Not verified**: none (no visual change: the removed rule had no element using it).
