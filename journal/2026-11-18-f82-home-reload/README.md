# F82 Home's Reload like Cydia's

## What changed
- `screens/home.js`: Reload no longer calls `location.reload()`. `reloadHome(button, ctx)` turns the button into
  the spinner (`withReloadSpinner`: class `is-reloading`, disabled, `aria-busy`, label "Reloading"), refreshes the
  sources the way Settings' Refresh on Launch does (`sources.js refreshInBackground`: the Sources tab's spinning
  badge, no HUD; when a refresh is already running it waits for that one through `untilRefreshed`, capped at two
  minutes), then calls the root page's `state.redraw`. The redraw changes nothing until the new parts are ready, then
  updates each part where it is: the hint, Themes/Signing, the Install Cydian App offer, the green tile
  (`refreshState`), and the featured banners, swapped for the new box only once its banners are drawn. Then the
  button is Reload again, even after a failure. A tap while it spins does nothing.
- `screens/extras.js`: `homeFeatured()`'s box has `.ready`, which settles once its banners are drawn (or there are
  none), so the swap never shows an empty box. This is an additive one-liner.
- `home.css`: `.bar-button.is-reloading` is UIKit's small white spinner (`UIActivityIndicatorViewStyleWhite`,
  measured from `ref/4s/artwork/Shared@2x/UIActivityIndicatorViewStyleWhite.0.png`: 20 pt, 12 spokes from r 4.5 to
  9.5 pt, the brightest at 9 o'clock with five fading behind it, the rest about 27%). It has no bezel and sits at
  the right end of the button's spot, and turns a spoke at a time (`hud-spin`). The title doesn't move: the nav
  item is a 3-column grid. I checked a 3x Chromium render of the bar before and during the reload.
- Test: `screens/homereload.test.js` checks that the spinner shows at once, the page's content stays the same
  object while the sources reload, the order is refresh, settled, redraw, the button comes back (also after a
  failure), a second tap is ignored, the nav's onClick never calls `location.reload`, and `untilRefreshed` waits for
  a running refresh and then gives up at its cap.

## Decisions
- The brief's file list names queue.js, altstore.js, changes.js and signing-sheet.js. None of them has a Reload:
  the IPA (sideload app) and the website both run Home from `web/app/`, so changing home.js covers both. I left
  those files alone.
- What we lose: `location.reload()` also picked up a newer website build (the server sends no-cache). Reload no
  longer does that. The site picks up new files on its next launch or a Safari reload, and the apps update through
  Settings' Check for Updates and the Essential Upgrade alert, as before. If the user wants Reload to fetch new code
  too, that needs a version stamp to compare against (not built here).
- The spinner is right-aligned where the button ends, as a UIBarButtonItem custom view sits in iOS 6 (Cydia sets
  the indicator as the right item's custom view).

## Not verified
- On the iPhone, in the IPA and in Safari: not tried. The brief says the user tries it, and I had no device.
- I didn't watch Cydia's own spinner on the 4S (no screen lock taken, since the task doesn't say to drive the
  device). The look comes from the 4S's UIKit spinner art, and the placement (right-aligned) from how UIKit lays out
  a custom right bar item. Neither was compared against a live screenshot.
- The in-place redraw (`state.redraw`) has no automated test with a real DOM. The test fakes it. Its parts
  (`refreshState`, `drawApp`, `homeFeatured`) are the ones Home already uses, and only the order and the swap
  are new.
