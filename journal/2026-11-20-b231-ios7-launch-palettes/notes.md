# B231: iOS 7 style's launch palettes

## What changed

- `web/app/screens/settings.js` applyTheme: app.theme's `darkPalette` is now the era's dark palette
  (`themeState({ style, appearance: "dark", … }, true).palette`), as B221 does for `lightPalette`. Under Style iOS 7
  (and iOS 13) that is `oled`, so a dark launch paints OLED Black's ground, not the iOS 6 dark pick's (Gunmetal's
  pinstripes). iOS 6 still sends the pick. Test in `settings.test.js` (iOS 7 light and dark send `oled`; back to iOS 6
  sends `gunmetal` again).
- `native/launch/make.py`: a `white` launch set (iOS 7's White from `web/app/ios7.css`): a flat #efeff4 ground, flat
  #f7f7f7 bars, no highlight, gloss or shadows. A new optional `tab_shadow` key (default 0.18) so White's tab bar
  draws no shadow. `native/launch/themes/white/` is make.py's output; the other themes' files did not change.
- `native/launch_check.py` THEME_KEYS gets `white` (the .deb/IPA check now requires its set).
- `native/test_launch_grounds.py`: the palettes that need a set now include the eras' own (STYLE_PALETTES), and
  `css_theme("white")` reads ios7.css's light block to check make.py's White against it.

Nothing in Swift needed changing: `Splash.key` takes any key with a set in LaunchThemes/, and App.swift's Ground
already knows `white` (B221).

## Choices

- The storyboard's line views are 1 pt and opaque-coloured; iOS 7's hairlines are .5 pt black at 30 %. They are
  drawn as 1 pt #adadad (30 % black flattened over #f7f7f7). Half a point thicker than the page's line; the storyboard
  can't draw half a point without a Mac recompile.
- iOS 7's dark theme uses the existing `oled` set, which is iOS 6's OLED Black frame (its bars have a dark gloss and a
  #1a1a1c line, where iOS 7's are flat black with a #262626 hairline). Filed as a follow-up rather than changing
  STYLE_PALETTES' keys here.

## Not verified

- The white set on a phone (iPhone 7 splash after picking Style iOS 7 + Light): the task said nothing of touching the
  phone, and the .deb on it is shared with other slots. Checked only by the unit tests (colours match ios7.css, the
  recoloured nib carries White's colours, files equal make.py's output).
- The rendered White storyboard (Simulator on the MBA, launch-screen-sim-check): not run; the colours are written into
  the compiled nib the same way as every other theme's.
