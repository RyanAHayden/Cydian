# F23: the shell follows the Appearance setting

## What the brief assumed vs. the code
The brief says html.native hides the web bars and the Swift shell draws UINavigationBar/UITabBar. It doesn't:
R3 chose (a), and `native/Sources/App.swift` is one WKWebView; nav bar, tab bar and back swipe are all web/app/'s,
and nothing sets `html.native`. Those bars already turn black with `<html data-theme=dark>` (F13's CSS). So there
are no native bars to restyle. Decided (unattended) to do the part that does exist: the bridge message, and the
native UI the page can't style.

## What I did
- `web/app/screens/settings.js`: `applyTheme()` now also posts `{method: "app.theme", params: {style, theme}}` to
  `webkit.messageHandlers.cydian` when it exists (only on change). `style` is `auto` while Appearance is
  Automatic. `themeMessage()` exported for the test. No handler (the site) = no-op.
- `native/Sources/Bridge.swift`: `app.theme` handler → `Theme.apply`: sets the window's
  `overrideUserInterfaceStyle` (dark/light/unspecified) so the keyboard, `<select>` pickers, alerts and menus match,
  and asks for a status bar update.
- Why `auto` → `.unspecified` and not the resolved theme: WKWebView's `prefers-color-scheme` follows the window's
  traits. Pinning `.light` while Automatic would freeze the media query and the page would stop following the system.
- Status bar: stays `.lightContent` in both themes (white text on the blue bar in light, on the gunmetal
  "Status Bar (Black)" in dark), so `preferredStatusBarStyle` is unchanged.
- Test: `web/app/screens/settings.test.js`. The native build (`make -C native package`) compiles it.

## Not verified
- On a phone: no iOS 15+ jailbroken device here (the 4S runs iOS 6 and can't run the app), so I could not check
  that the keyboard/pickers turn dark, or that Automatic still follows the system after a fixed choice is undone.
- The JS bridge client (`backend-native.js`, N3) doesn't exist yet; this posts to the raw message handler with
  id 0. When N3 lands, it may want to route this through its client.
