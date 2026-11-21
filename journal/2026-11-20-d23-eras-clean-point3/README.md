# D23: eras.md Definition of clean, point 3 gains C45's checks

Added two bullets to point 3 of docs/eras.md's Definition of clean, read off the two C45 tests in
`web/app/ios6-css.test.js` (not off the task text alone):

- "ios6.css sets no layout at all…": no layout property anywhere, no `@keyframes`/`@media`, every rule outside the
  look-only stretches is `body` or a `:root`/`html[…]` block of custom properties and `color-scheme`.
- "decorations come from tokens…": no `gradient(` and no `url()` except the Share button glyph; `text-shadow`,
  `filter`, `border-image(-source)` only `var(…)`, `none` or `brightness(…)`.

The task text said "only through a custom property"; the test also allows `none` and `brightness(…)`, and the doc
says what the test checks.

**Not verified**: none (docs only; the gate runs in `done`).
