# B237: iOS 13's White gets a launch set of its own (white13)

## What I did
- `native/launch/make.py` THEMES: `white13`. Its values come from ios13.css's light block: a #f2f2f7 ground
  (`--pin-dark`/`--pin-light`), flat #f9f9f9 bars (`--i13-bar`), and the rgba(0,0,0,.3) hairline laid over the
  bar (#aeaeae) as the 1 pt line. No gloss and no shadows. I ran `make.py`, which added `native/launch/themes/white13/`;
  no other theme's files changed.
- `native/launch_check.py` THEME_KEYS: `white13`.
- `native/Sources/App.swift` Launch: `white13` Ground. It is plain #f9f9f9, the same colour as its bar, because B221
  gave iOS 7's White its bar colour (#f7f7f7) rather than its ground. Light `ground()` maps `"white13"` to it.
- `web/app/core/settings.js` STYLE_LAUNCH: `ios13: { white: "white13" }`. The page keeps data-palette "white". Only
  the shell's `lightPalette` carries the launch key. `DARK_TEXT_BARS` still checks the palette ("white"), so
  status-bar text is dark as before.
- `native/test_launch_grounds.py` eras table: `white13` → (ios13, light, i13). The test reads the set's values
  from ios13.css and checks them against make.py.
- `web/app/screens/settings.test.js`, which is not on the task's file list: the iOS 13 assertion now expects
  `lightPalette: "white13"`. Without this, the gate fails on the new mapping.

## Checks
- `python3 -m unittest native/test_launch_grounds.py`: 10 OK
- `python3 native/launch_check.py`: OK
- `node --test web/app/screens/settings.test.js`: 23 pass
- `tools/check.sh` runs through `done`.

## Not verified
- I did not see the splash on a device or in the Simulator. That needs the MBA (storyboard.sh / sim) or a phone,
  and this unattended run has neither. The nib is the same one make.py patches for every theme, and launch_check
  checks it.
- I did not compile the Swift change here, because this Linux machine has no Swift toolchain for the app. It adds
  one `static let` and one `case`, written the same way as the lines around them.
