# B225 Concept frame: dark status-bar glyphs over a light app bar

## What changed
`tools/concept/frame.html` paintBars:
- Status-bar glyphs: `darkText = lum(stripColor) > 0.6` in every mode, not only Website. stripColor is the app's
  theme-color (theme-boot.js / settings.js THEME_COLORS), which is the palette's bar colour in the apps too, so
  iOS 7 White (#f7f7f7) and Brushed Metal (#9aa0a9, lum 0.62) now get dark glyphs in Jailbroken and Lite.
- Home bar: Website as before (dark over Safari's light bar). In the apps it sits on the tab bar, which is black in
  every theme except iOS 7 White (ios7.css `--tabbar: #f7f7f7`); Brushed Metal keeps the black tab bar. The frame
  only sees the theme-color (postMessage, shell.js is not this task's file), so it uses it as the proxy with a
  stricter threshold: dark home bar when lum > 0.9 (White 0.97, Metal 0.62 stays light).

## Checked
- `tools/concept/build.py --standalone --before none`, then `check.mjs` on iPhone 17 Pro Max, themes
  ios7:light:white, light:metal, light:classic, ios7:dark:oled, modes jailbreak + site: all clean.
- Screenshots: Jailbroken White: dark glyphs, dark home bar over the white tab bar. Jailbroken Metal: dark glyphs,
  light home bar over the black tab bar.

## Not verified
- Lite (sideload) mode not run separately: same code path as Jailbroken in paintBars (only `site` differs).
- A future light theme whose tab bar is light but whose theme-color is under 0.9 would keep a light home bar; the
  proxy is by colour, not by the real tab bar (reading it would need shell.js to post it).
