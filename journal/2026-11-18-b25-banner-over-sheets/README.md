# B25: the banner no longer covers sheets

## What
- `web/app/ios6.css`, after the has-banner #navbar/#screens rules: `html.has-banner .sheet { translate: 0 var(--banner-h); bottom: var(--banner-h); }`
  and `.sheet { transition: translate .3s … }`. Every full-screen sheet carries `.sheet` (nav/sheet.js showSheet,
  screens/queue.js modal() for the queue/confirm sheets, nav/progress.js, screens/reviews.js; the signing sheet goes
  through showSheet), so one rule covers all of them. `bottom` shortens the sheet by the same height, so its foot
  (the progress bar / finish button) stays on screen, as #screens already does.
- Why `translate` and not `transform`: the sheets slide in/out by Web Animations on `transform`. A CSS transform
  would be overridden during the slide and snap at its end; the individual `translate` property composes with it,
  is still composited (120 Hz rule) and Safari has it since 14.1 (app floor is iOS 15). A sheet opened while the
  banner shows gets the translate at once (no transition from nothing), so it starts below the banner.
- z-index: the banner was already 50 over the sheets' 25; the new test asserts it stays that way.
- `web/app/ios6-css.test.js`: test that a `html.has-banner .sheet` rule translates by --banner-h, sets bottom, and
  banner z-index > .sheet z-index (packages.css).
- queue.css / progress.css / banner.js needed no change.

## Checked
Headless Chromium (390x844) on a scratch page loading style/ios6/packages/queue/progress.css and the real
banner.js, progress.js, sheet.js, with Web Animations finished before each measurement (virtual time in headless
didn't advance them; `finish()` throws on the infinite cursor blink, so those are skipped):
- banner shown over an open progress page: banner 0–49, progress page 49–757 (viewport 757), its nav bar 49–93,
  elementFromPoint at its Cancel hits Cancel; a second showSheet sheet: 49–757, its Done tappable.
- banner shown before opening: same numbers.
- banner hidden: both sheets back at 0–757.
- Screenshot: Running bar under the Upgrade banner, progress track visible at the bottom.

## Follow-up
B26 (low): the reload bar (z 49, has-reload) can cover sheets the same way.

## Not verified
- On the iPhone 7 / iOS Safari: the task didn't call for the phone; `translate` with `transition` relies on
  Safari 14.1+ support (documented, not tried on device).
- The live app's real Upgrade banner flow (needed a newer release published); the harness used showBanner directly.
