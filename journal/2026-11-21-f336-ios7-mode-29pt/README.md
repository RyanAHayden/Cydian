# F336: iOS 7 Theme's Mode at 29pt

- New era hook `--settings-seg-h` in style.css (iOS 6: 44px, a grouped row's height); settings.css's
  `.settings-segmented` reads it for its height, and its segment line-height follows (`calc(hook - 2px)`, inside the
  1px borders) so the label stays centred at either height. ios7.css sets 29px.
- The 13px type and 4px corners already came from ios7.css's segmented-control rules (`html[data-style="ios7"]
  .store-segment` / `.store-segmented` outweigh settings.css's 15px and 9.5px), so nothing new was needed there.
- ios6-css.test.js: an F336 test pins the hook, both reads and iOS 7's value.
- Checked with a headless Chromium render of the control under data-style="ios7" (scratch page linking the real
  CSS files): 29px tall, 13px label centred, 4px corners, 15px inset.

**Not verified**
- On a phone or in the full app's Settings > Theme page: only the isolated control was rendered (scratch page with the
  real stylesheets), not the page with its group header above it; spacing between the header and a shorter control
  was not judged against a real iOS 7 device.
