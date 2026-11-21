# B221: iOS 7 White's status bar and launch colour in the apps

## What was wrong

- `WebController.preferredStatusBarStyle` was always `.lightContent`: white status-bar text on White's #f7f7f7 bar.
- `applyTheme` sent the iOS 6 picks (`paletteFor("light", …)`, the raw `darkTheme`) as `lightPalette`/`darkPalette`
  whatever the era, so with Style iOS 7 the shell painted Classic's pinstripes (or the iOS 6 dark pick) behind the
  page and at the next launch.

## What changed

- `web/app/screens/settings.js`: `applyTheme` sends the era's own pair (`themeState` per tone: iOS 7 sends
  `lightPalette: "white"`, `darkPalette: "oled"`; iOS 6 sends its picks as before) and, while the palette showing
  is in `DARK_TEXT_BARS` (`white`), `statusBar: "dark"` in `app.theme`'s params. The key is left out otherwise, so
  every existing message (and an older shell) is unchanged.
- `native/Sources/Bridge.swift`: `app.theme` reads `statusBar`; `Theme.darkText` holds it, and before the page's
  first `app.theme` it starts from the saved theme (White in the launch tone → dark text). `Theme.apply` already
  calls `setNeedsStatusBarAppearanceUpdate`.
- `native/Sources/App.swift`: `preferredStatusBarStyle` returns `.darkContent` while `Theme.darkText`; `Launch.ground`
  knows `white`, a plain #f7f7f7 ground (window, web view, overscroll).
- Test: `settings.test.js` checks iOS 7's light and dark messages.

No launch set (`LaunchThemes/white`) exists, so `Splash.key("white")` is nil: no splash copy, no cover, and the
window's #f7f7f7 ground shows until the page draws. A White splash/cover set would be make.py work beyond this task.

## Not verified

See the end of this file (filled in after the device attempt).
