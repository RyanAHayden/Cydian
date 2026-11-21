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

Spec review flagged one extra: an early version also sent iOS 7's `darkPalette: "oled"` (not asked). Reverted;
filed as B231 together with the missing White launch set.

## Device checks

- iPhone 7 (jailbreak .deb 0.17.3-3159, binary md5-checked as this build): Style iOS 7 + Light → dark status-bar
  text on White's bar; Dark → light text on OLED Black; closed in the switcher and reopened → dark text from the
  start. Put back to iOS 6 (light text on Classic). Shots: ref/7/screens/b221-ios7.png, b221-dark.png,
  b221-relaunch1.png, b221-back6.png.
- iPhone 15 Pro (sideload IPA via ui-15.sh): iOS 7 + Light → dark text; iOS 6 / Automatic (dark) → light text as
  before. Put back to iOS 6 Automatic. Shots: ref/15/screens/b221-15-light.png, b221-15-auto.png.
- Seen on the way: the self-update banner and Downloading Packages bar keep their iOS 6 look in iOS 7 with blue text
  on blue buttons: filed B230.

## Not verified

- The #f7f7f7 launch ground itself on a phone: the splash/cover hand-over is too quick for ui-7/ui-15 screenshots,
  and the jailbreak splash still shows the last iOS 6 theme's bars (no White set, B231). Checked only by code
  (`Launch.ground` → `white`).
- The phone checks ran the build from before the darkPalette revert (it changes only what dark launches paint, not
  the status bar); the gate builds the final code.
