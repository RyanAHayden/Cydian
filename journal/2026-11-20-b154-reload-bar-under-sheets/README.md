# B154: the reload bar goes under modal sheets

## What was wrong
`ios6.css` had `body:has(.sheet) .reload-bar { z-index: 26; translate: … }`: while a sheet was open the strip was
lifted over it (the sheets are z-index 25) and moved to the sheet's bottom. That is the user's screenshot: the
Confirm sheet with "Loading Data" + Cancel over its Install button. On iOS 6 a modal sheet covers everything.

## What I did
- `web/app/ios6.css`: dropped that rule. The strip keeps its own z-index 2 (over the screens, under the tab bar),
  so any `.sheet` (z 25, appended to body by `nav/sheet.js`) and the dark action sheets' scrim (z 30) cover it. It
  stays in the DOM and keeps running, so it shows again where it was when the sheet slides away.
- `web/app/nav/reloadbar.js`: header comment updated (no code change).
- Tests: `ios6-css.test.js` drops the "over a sheet" assertions and adds "B154: modal sheets cover the reload bar"
  (z under `.sheet` and `.action-scrim`, no other reload-bar rule sets a z-index, none moves it onto a sheet);
  `nav/reloadbar.test.js` asserts the lifting rule is gone.
- `web/app/app.js` (named in the brief) needed no change: the stacking is all CSS.
- Left the `html.has-reload … .sheet-scroll::after` 44 pt end room alone: harmless under a covered strip, and
  `.sheet-scroll` is usually also `.page-body`, so removing it would not change much.

## Check
3x render, headless Chromium with the real CSS (style, ios6, sources, packages, home, queue), a scratch page with
`html.has-reload`, a showing `.reload-bar` and a `.sheet`: `sheet-up-3x.png` — Confirm sheet up, no strip over
its bottom; `no-sheet-3x.png` — no sheet, the strip shows on the tab bar. A third shot with the sheet half slid
down also had the sheet over the strip's spot.

## Not verified
- On a phone (the 7 or an 18 Pro): no device run in this session; the change is one CSS rule's removal and the
  render above uses the same stylesheets.
- The render page is hand-built markup, not the running app opening Confirm during a real reload.
