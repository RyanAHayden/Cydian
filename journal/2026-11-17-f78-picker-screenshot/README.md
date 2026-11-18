# F78: the certificate step shows the user's Files picker screenshot

## What I did
- `web/app/screens/signing.js`: removed the drawn iOS 26 picker (`modernPicker`) and the old "try
  select-files.png, fall back to the drawing" loader. `picture()` now always shows one `<img class="step-shot">`
  whose src is `shotFor(<html data-theme>)`: `icons/steps/select-files-light.jpg` or `-dark.jpg` (light when the
  attribute is missing). A single MutationObserver on `data-theme` swaps the src of any shown `.step-shot`, so
  Automatic appearance flipping with iOS while the page is open follows too.
- `web/app/signing.css` (not `ios6.css` as the brief's file list said: every walkthrough style, the old picker's
  included, lives in signing.css, which signing.js loads itself; putting it in ios6.css would split the step's
  styles across two files): dropped all `.mp-*` and `.mock-tap` rules (nothing else used them) and styled the
  screenshot as an inset: 240 px wide, 12 px radius, 1 px border (dark translucent in light, light translucent in
  dark).
- Test: `screens/signing.test.js` "the certificate step's picture is the screenshot for <html data-theme>": both
  files exist, `shotFor` maps themes, and `picture()` under a stub document builds one img with the theme's file.

## Checked
- `node --test web/app/screens/signing.test.js`: 8 pass.
- Headless Chromium at 3x, a bare page with ios6.css + signing.css: both themes show the right image with rounded
  corners and the thin border.

## Not verified
- The real walkthrough page on a phone or in the full app (the 3x render was a bare page, not Settings > Signing):
  no device step in this task, and the 4S runs iOS 6, not the sideload build.
- The live theme swap through the MutationObserver was not exercised in a browser (only reasoned through); the
  node test covers the draw-time choice.
