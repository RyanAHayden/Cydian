# F225 Big screens: layout B + width rules D

## What changed
- New `web/app/wide.css`, linked last in `index.html` (after palettes.css) so it wins over the per-screen sheets at
  the same specificity; `wide-css.test.js` guards that and that every rule sits in `@media (min-width: 600px)`.
  I used a new file, not style.css/ios6.css, because the scrollers it touches live in five sheets (packages, progress,
  queue, reviews…) and a later-loaded file overrides them without edits there (cleaner merges with other slots).
- Width only, no device sniffing: a foldable switches live.
- 600px and up:
  - Tab bar full width, items `flex: 0 0 76px`, 20px side margins (40px between), centred.
  - Nav bar untouched (full width; the title's `calc(100vw - 180px)` cap still applies).
  - Every `.page-body` (pages, and the sheets whose scroller is a page-body: queue, manage QR, handoff, signing sheet,
    Browse's) pads its sides to `max(safe-area inset, (100vw - 640px) / 2)`. The scroller itself stays full width,
    so wheel/drag over the pinstripes scrolls, the iOS 6 scroll indicator stays at the window edge, and there is
    nothing to scroll sideways. Grouped tables keep their own 10px iOS 6 insets inside the column.
  - Plain (white) lists: pinstripes either side, white only under the 640px column (background on the scroller's
    box, which doesn't scroll, so the column runs full height).
  - Section index moved to the column's right edge. Sheet ground = pinstripes + plain column. Reviews sheet and
    console log scrollers padded the same way. Action sheet panel = the column's width, centred.
  - Alerts were already capped (340px) — unchanged.
- No plist change; native stays iPhone-only.

## Checks done (headless Chromium via `capture.mjs`, `node worker/node.mjs` on 127.0.0.1)
- Phone widths pixel-identical: Home, Settings, Signing, Sources, Search, Installed at 320x548 and 390x760 (2x,
  mobile UA), before vs after — `ImageChops.difference(...).getbbox()` was None for all 12.
- Desktop shots at 768x1024, 1024x768, 1440x900 (`*.png` here): content capped at 640 and centred, tab items
  centred. Also looked at a source page, package page, Browse, Theme, the About alert and an action sheet.
- Live resize (`resize.json`, Settings page) through 560…1200 and back to 599: `documentElement.scrollWidth ==
  innerWidth` and the page-body never overflows sideways at any step; the content column grows continuously with the
  window up to 640 and then centres (no jump at 600, since the gutter is 0 until 640).
- The tab bar does change mode at 600px (stretched 115px items → 76px clustered items): that switch is the brief's
  own rule, not a reflow glitch. I left it as a step rather than inventing an in-between.

## Not verified
- Real iPad / foldable iPhone / Safari: no such device here; Chromium only. Safari's `env(safe-area-inset-*)` with
  the gutter `max()` is standard CSS but untested on device.
- Dark themes at wide widths: not shot (the column uses the same `--plain`/`--pin-*` tokens the themes set, so it
  should follow).
- Package page "Related"/"Reviews" tabs, Search with results, progress/console screens at wide width: not shot
  (need network installs or a jailbroken backend); they are page-bodies or padded scrollers, covered by the same rules.
- Landscape iPhones (e.g. 844px) now also get the wide layout, by the width-only rule; not checked on a phone.
