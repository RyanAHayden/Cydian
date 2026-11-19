# F211: Home always starts at the top

## What changed

- New `web/app/nav/hometop.js`: `createHomeTop({ homeRoot, current, overlayUp })` with
  - `opened()`: when the route on screen is Home's root and no alert/sheet/HUD is up (app.js `OVERLAYS`), Home's
    root `.page-body` jumps to scrollTop 0.
  - `tabTapped(tab)`: a Home tab tap while the screen is not Home's root (another tab, or a page pushed on Home)
    jumps Home's root to the top while it is hidden, so it shows there after the switch or the pop slide. A tap on
    Home's root itself is left to tabbar.js `tapTab`'s existing slide (F148).
  - `homeRootOf(stacks)`: Home's root body from nav/stack.js (the entry whose path is `[]`).
- `web/app/app.js`: calls `homeTop.tabTapped(tab)` in the tab bar click handler before `tapTab`, and
  `homeTop.opened()` at launch, on `visibilitychange` to visible (any time away, not only after Return to Home After)
  and on `pageshow` with `persisted` (Home Screen web app out of the back/forward cache). The existing Return to
  Home After block is untouched: it still routes to Home and scrolls there itself.
- Back / swipe back to Home needed no change: each page keeps its own scroller, and nothing above resets it on a
  pop. A test pins it.
- Other tabs: unchanged (a test checks Sources keeps its place across tab switches).

Decisions (unattended, no one to ask):
- Resume scrolls Home to the top after any time in the background, as the brief says "back from the background";
  a page pushed on Home or another tab is left as is (the app isn't "opening on Home").
- Not while a popup or sheet is up, matching the Return to Home After rule.
- The jump is instant (the page is hidden or the app was away); only the on-Home-root tab tap slides.

## Tests

`web/app/nav/hometop.test.js`: the real router, stacks and tapTab with fake page scrollers: launch, resume (and
not with a popup up), resume on another tab / pushed page leaves Home alone, tab tap from another tab (other tab
keeps its place), tab tap on Home's root, tab tap on Home below its root (pop + top), Back keeps the position, and
a source check that app.js wires all of it.

## iPhone 7

The phone's `web/app.js`, `nav/tabbar.js`, `nav/stack.js` and `router.js` matched this branch's base (md5), so I
swapped in the new `app.js` and added `nav/hometop.js`, cold-launched the app, and checked (screenshots in
`ref/7/screens/f211-*.png`, not committed):
- cold launch: Home at its top;
- scrolled to the bottom, Sources, Home tab: Home at its top;
- scrolled down, Settings, Back: Home still at the bottom;
- Settings, Home tab: popped to Home at its top;
- scrolled down, Home button, iFizBox icon (same process, started at the cold launch): Home at its top.
Then restored the original `app.js` (md5 back to the base), removed `hometop.js`, and closed the app from the
switcher.

## Not verified

- The Home Screen web app's `pageshow` (persisted) path and a resume in Safari: only the jailbreak app was checked on
  the phone; the web case is covered by the node test of `opened()` and the wiring check only.
- A Home tab tap on Home's root on the phone (the F148 slide): unchanged code, not re-checked.
- The sideload (Lite) build: not on the phone; same web code.
