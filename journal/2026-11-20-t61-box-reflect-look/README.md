# T61: -webkit-box-reflect is look

- `web/app/ios6-css.test.js`: `-webkit-box-reflect` added to `LOOK` (it paints the reflection, it takes no room).
  New test: packages.css has no `-webkit-box-reflect` outside a look-only stretch, and the three rules that set
  it (`.store-icon`, `.browse-hero-icon`, `.browse-hero.is-loading .browse-hero-icon`) sit in one.
- `web/app/packages.css`: the three declarations moved out of the layout rules into the Browse and store-page
  look-only stretches. Same selectors, each later in the file than before, and no rule between the old and new
  spot sets the property, so the cascade result is unchanged.
- `docs/eras.md`: the look list names `-webkit-box-reflect`; the "not in LOOK" caveat became a Reflections line in
  the decorations list.

Tests: `node --test web/app/ios6-css.test.js web/app/screens/storepage.test.js` pass; gate via `run done`.

Nothing tried that failed.

## Not verified

- No screenshot of Browse or the package page: the change only moves declarations to later rules with the same
  selectors (cascade reasoning above), so the render should be identical; not checked in a browser to save the
  shared Chromium slots.
