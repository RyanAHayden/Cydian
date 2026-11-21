# F335: iOS 7 undo bar

The undo bar after a row's swipe (nav/undobar.js) kept ios6.css's semi-transparent black bar and embossed white
text under the iOS 7 style. `web/app/ios7.css` now sets `--undo-bar`, `--undo-text` and `--undo-emboss` beside the
reload bar's tokens, with the same values: White is #f7f7f7 under a hairline with black text; OLED Black is #000
under a hairline with white text; no emboss in either. The message gets the reload bar's type too (15px, semibold).
The Undo button was already text-only (B230's `--done-btn*` tokens), so it is unchanged.

Checked: a scratch page that links style.css, ios6.css, sources.css, palettes.css and ios7.css with a shown
`.undo-bar`, shot in headless Chromium for ios6/ios7 × light/dark. iOS 7 White and OLED show the flat bar, and
iOS 6 still shows the black gradient bar with the blue Undo button.

**Not verified**
- On a phone: the 15 Pro/7 rigs weren't used for a CSS token change this small. Only the Chromium shots were taken.
- The bar as it slides in the real app (swipe a row): only the static shown state was shot.
