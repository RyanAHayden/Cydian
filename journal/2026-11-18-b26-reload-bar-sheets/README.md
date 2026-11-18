# B26: the reload bar no longer covers sheets

- Can a reload run while a sheet is open? Yes: the reload bar (nav/reloadbar.js) shows for background source
  refreshes, which keep running while the user opens a package page, depiction or the queue. So the fix applies.
- ios6.css, in the reload-bar block (after `html.has-banner .reload-bar`): `html.has-reload .sheet` gets
  `translate: 0 44px; bottom: 44px`, and `html.has-reload.has-banner .sheet` gets banner + 44 pt for both, mirroring
  the #navbar/#screens rules there and B25's has-banner .sheet rule. The existing `.sheet { transition: translate }`
  from B25 animates it; `translate` composes with the sheets' transform slide animations.
  Placed in the reload block rather than straight after B25's rule to keep the reload rules together; the
  two-class selector out-specifies `html.has-banner .sheet` either way.
- Test in web/app/ios6-css.test.js: both rules exist with the right values, and .reload-bar's z-index (49) is above
  .sheet's (25).

Nothing tried that failed.

**Not verified**
- No render in a browser or on the iPhone 7 of a sheet open during a reload: the task is CSS-only and an unattended
  run has no screen to check; the values copy the #navbar/#screens rules, which already work.
