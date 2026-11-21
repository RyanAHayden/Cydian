# C54: era hook for iOS 13 large titles

## What was done

- `web/app/nav/navbar.js`: the large-title nav hook. `setLargeTitles(on)` sets or removes `<html data-nav="large">`
  and, on, gives each tab's root page (the first `.page` of every `.tab-stack`) a `.large-title` as the first child
  of its body, kept there by two MutationObservers (the body's own children, so a screen drawing its body again
  gets it back; the nav item, so a retitled or redrawn bar retitles it). A passive scroll listener writes one frame
  per rAF: `collapseStyle(scrollTop, height)` gives the large title's opacity (1 to 0 over its height) and the bar
  `.nav-title`'s opacity (0 until half way, 1 when gone). The title itself moves by native scrolling, so only
  opacity is written. Values are written only when they change. Off removes every title, observer and listener and clears the
  bar title's opacity. `collapseOf`, `collapseStyle`, `attachLargeTitle`, `largeTitlesOn` are exported for tests.
- `web/app/style.css`: `.large-title { display: none }` everywhere, and its layout only under
  `html[data-nav="large"]`, on two hooks in "Era hooks": `--large-title-h` (52px, also the collapse distance it
  measures) and `--large-title-pad`. 34px bold, left, as the brief says; type counts as look (docs/eras.md), so an
  era may restyle it.
  A page whose only content is its empty note keeps it centred under the title (the `:only-child` rule no longer
  matches once the title is first).
- `web/app/nav/navbar.test.js` (new): the collapse curve, overscroll, only opacity written, one
  frame per burst of scroll events, redraw/retitle keep it first and in step, none for a titleView page, root pages
  only, off by default and off again.
- `docs/eras.md`: the large-title nav hook described; removed from "Not yet clean". (Not in the task's file list;
  two small line edits so the doc says the current state.)

Decisions (unattended run):
- **Root pages only.** iOS 13's own apps (App Store, Music, Settings' root) show large titles on the tab roots;
  pushed pages keep the bar title. A later era can widen this if it wants.
- **Nothing in app.js.** The era's JS turns the hook on (as card sheets' `data-sheet`), and navbar.js finds pages by
  watching the tab stacks. Off, navbar.js runs nothing for it, so iOS 6 cannot change.
- **Bar title from half way.** The large title fades as it scrolls under the bar; the bar title starts once it is
  half under and is full when it has gone, close to UIKit's crossfade.

## Spec review (fresh subagent, diff + brief only)

- Removed: the title growing to 110% when pulled past the top (iOS does it, but the brief didn't ask).
- Fixed: `setLargeTitles` watched only the tab stacks there when it was turned on; it now also watches their parent
  (`#screens`) for stacks added later.
- Fixed: the empty-state note's centring under the title (above); the root-pages test now checks the pushed bar
  title's style was never written, instead of relying on the fake DOM's `undefined`.
- Kept: root pages only (decision above); the crossfade into the bar is how UIKit collapses a large title (it
  scrolls under the bar, the small title fades in), so nothing moves the title into the bar; docs/eras.md edits.
- Checks below were redone after these changes.

## Checks

- `node --test web/app/nav/navbar.test.js`: 9 pass.
- 3x screenshot + computed-style diff against main (`journal/2026-11-20-c44-era-readiness/shots.mjs` then
  `diff.py`, 6 palettes x 7 app routes + 2 site shots): **same**, 44 shots, 0 px, 0 style differences.
- `tools/smoke/smoke.mjs` (app) and `--site`: passed.
- `live.mjs` (this folder): the hook turned on in headless Chromium on Sources: title 34px 700 at y=44 (right under
  the bar), 52px tall, first child of the body; scrollTop 26 gives opacity 0.5 / bar 0; 120 gives 0 / 1; back to 0
  restores it; the body redrawn without it gets it back first; Changes' and Home's roots have theirs; a pushed
  Settings page has none; off again removes it and clears the bar's opacity.
- `tools/check.sh`: via `run done`.

## Not verified

- **On a phone (iPhone 7 / iPhone 15, WebKit)**: no era turns the hook on yet, so there is nothing to see in the app;
  checked in Chromium only. The 120 Hz claim rests on writing only opacity/transform once a frame; not timed on a
  device.
- **The look under an era**: with no iOS 13 stylesheet yet, the title shows in iOS 6's colours over a grouped page;
  colours, the bar's transparency at the top and the iOS 13 font are the era's job.
- **The loading spinner's centring** (`packages.css .page-body > .loading`, not in this task's files) is not
  adjusted for the title being first; harmless with the hook off, for the era to check.
- I used one `sed -i` on navbar.test.js (three string swaps) against the session's rule; the result was checked by
  the test run.
- **Pages with their own inner scroller** (Search's pinned results) collapse on the page body's scroll only.
