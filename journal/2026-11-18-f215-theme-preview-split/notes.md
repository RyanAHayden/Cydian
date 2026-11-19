# F215 Theme preview as a movable split

Settings > Theme > Light / Dark: the preview pinned over the bottom of the page (5b257e0, a fixed 50vh) is now a
split with a divider you drag.

## What changed

- `web/app/screens/settings.js`
  - Pure sizing, exported and tested: `entrySplit(geo)` (the divider on the lowest row edge that leaves the preview at
    least `SPLIT_FLOOR` = 25% of the page; the footer's end, +10px, counts as an edge so a list that fits whole shows
    its footer too; if no edge fits, the 25% floor), `splitHeight(geo, { saved, tapped })` (saved wins; a tap gives
    max(entry, 50%)), `clampSplit` (a dragged preview keeps 64px, the list 44px), `savedSplit` / `saveSplit`
    (`ifizbox.themePreviewSplit`, a fraction of the page height, so a rotation keeps the proportion).
  - `geo` is measured once laid out (rAF): `top` = the page scroller's top + its padding (under the nav bar), `bottom`
    = the page's bottom minus the preview's computed `bottom` (the tab bar), `screen` = the page height, `edges` = row
    bottoms at scroll 0 (the last row uses the `ul`'s bottom, so its border counts).
  - Module state `split` carries the height across redraws: tapping a theme calls `pick()`, settings' onChange
    redraws the page with a new preview; it starts at the old height and animates from there. `render()` resets the
    state when a theme list opens, so each visit starts at the entry split (unless dragged).
  - Motion is transform only: lay the pane out once at the taller height, slide with `translateY` (WAAPI, 300 ms,
    UIKit's ease), then settle at the new height. A drag does the same: tallest layout at pointerdown, transform per
    move, height + spacer set on pointerup, saved if it moved. prefers-reduced-motion jumps.
  - The pane is now `.theme-preview` (fixed, flex column) with `.theme-preview-grip` and `.theme-preview-body` (the
    old inert sample, which keeps its own scroll). The list's spacer follows the preview's height so its end still
    scrolls clear.
- `web/app/settings.css`: the grip is UIKit's table grabber sampled from the 4S
  (`ref/4s/artwork/Shared@2x/UITableGrabber.png`, 38x34 @2x: per bar 2px #000 at 0x4f, 6px #bebebe at 0xad, 2px #fff
  at 0x82, 2px gap) as one repeating gradient, 19x17pt centred on a 25px strip of the preview's own ground. Nothing
  added (no glow, no pressed state: UIKit has no pressed grabber image). Its touch area reaches 12px above the strip.

## Checks

- `node --test web/app/screens/settings.test.js`: new F215 test (whole rows, the 25% floor, 50% on tap, the dragged
  position kept and winning over a tap, clamping, the storage key); the existing tests pass.
- Headless Chromium at 375x647 (the iPhone 7 web app), 3x, against `node worker/node.mjs` (`capture.mjs` + `shots.json`
  here; drag via CDP touch events). Readings from the run:
  - entry (Dark, six themes): rows end at 318, preview top 374, height 224 of 647 (the whole list and its footer show,
    preview 35% ≥ 25%) — `1-entry.png`
  - tap Gunmetal: mid-slide at 100 ms `2-tap-mid-animation.png`; settled at height 324 = 50%, transform none —
    `2-after-tap.png`
  - drag the grip 120px down: height 204, saved 0.3153 — `3-dragged.png`
  - then tapping Midnight kept 204; back to Theme and in again opened at 204; the preview body scrolled 288 of 288 and
    the list scrolled too (shots not kept, readings in the run log above).
  - grip zoomed at 3x matched the grabber's bands.

## Not verified

- On the iPhone 7 (the app or the Home Screen web app): the task didn't ask for the phone, and headless Chromium is
  not WebKit. Touch drag on iOS (pointer events with `touch-action: none` on the grip) and 120 Hz smoothness of the
  slide were not measured on a device.
- The native shell (`html.native`, bars drawn by UIKit, `--nav-h`/`--tab-h` may differ): geometry reads the scroller's
  padding and the preview's computed bottom, so it should follow, but it was not run.
- Landscape / rotation with a saved split: not shot; the fraction is clamped to the page on each layout.
- Light lists (three themes) were not shot; same code path as Dark.
