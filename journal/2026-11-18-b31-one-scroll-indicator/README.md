# B31: only the iOS 6 scroll indicator, and it fades

## What drew the second indicator

Not the WKWebView's own scroll view (it never scrolls) and not every pane: `.page-body` already had
`::-webkit-scrollbar { display: none }`, and on iOS 15.8 WebKit honours that by turning off the indicators of the
pane's WKChildScrollView. On Sources > All Sources > Sections only our indicator showed, before any change.

The doubles came from the other scrollers nav/scroller.js follows, the `[data-scroller]` ones (Search's results,
Search's Filter panel, an action sheet's list), which had no such rule (only `.action-list` had one).
`before-search-scroll-doubled.png`: on Search results the native 3 pt indicator sits inside ours. A pixel row across
it reads `127 127 | 82 82 83 82 83 83 | 127 127` (ours alone is a flat 127 on white; 82 is both layers).

Fix: `web/app/ios6.css` hides the scrollbar on `[data-scroller]` too. CSS rather than Swift, so the Home Screen web
app and the sideload build get the same thing, and scrollers our indicator doesn't follow (progress, console,
reviews, queue) keep the native one rather than having none.

## Why it showed all the time

`nav/scroller.js`: a touch that starts on the bar (a finger-sized area around it) clears the fade timer while it
decides between a grab and a scroll. If that touch ended without either (a tap by the right edge, a touch that
stopped a fling there), nothing restarted the timer and the bar stayed for good. Worse when the tap opened a row: the
row's touchend never reaches document listeners (its target leaves the DOM), and the bar stayed over the next page.
`before-tap-stuck-3s.png` (old build): 3 s after such a tap the bar is still over the package page.

Fix: one `fadeSoon()` that every path ends in: a scroll, the end of a touch (grab or not), a touch that moves past
the slop (an ordinary scroll), and `draw()` when its list has left the page now hides it instead of leaving it on.

## Checked on the iPhone 7 (0.9.4-1239, built from this branch, installed with apt)

Pixel rows read off the screenshots (x 730-749):

- `b31-scroll-after.png`: Search results mid-swipe: one 10 px layer, flat 127. Before it was doubled.
- `b31-grab-after.png`: held still on the bar on Search results: 14 px (the grabbed width), flat 127, no native one.
- `b31-sections-scroll.png`, `b31-sections-grab.png`: the same on Sources > All Sources > Sections (a .page-body).
- `b31-sections-faded.png`: 4 s after letting go of the grab: no indicator.
- `b31-tap-0s.png`, `b31-tap-3s.png`: tap on the bar right after a swipe (it opened a row): shown at 0.4 s, gone at 3 s.
- A package list (Chariz > All Packages) shows its A–Z index instead of a bar (by design) and no native indicator.

## Tried and dropped

- Hiding indicators natively (walking the web view for WKChildScrollViews, or swizzling their setters): not needed
  once the source was found, and it would also take the indicator off panes ours doesn't draw on.

## Seen, not mine

- `tools/ui-7.sh open ifizbox://…` with iFizBox not running showed the launch zoom and went back to the Home
  Screen (twice, also with the old build). Tapping the icon opened it; `open` worked once it ran. Filed as B38.

## Not verified

- Search's Filter panel and an action sheet's list on the phone: same `[data-scroller]` rule as Search's results,
  which was checked; not driven separately (typing filters and opening a long sheet through phonectl is slow).
- The sideload IPA build: not built or installed here (no sideloaded copy on the iPhone 7). It runs the same
  `web/app/` CSS and JS, and no Swift changed.
- The Home Screen web app / Safari on a phone: not opened. The change there is the same CSS rule (Safari 18.2+ also
  reads `scrollbar-width: none`) and the fade fix, which only makes the bar hide in more cases.
- Grabbing and dragging the bar (scrubbing) on the phone: phonectl's swipe can't hold still and then move in one
  touch; the hold-to-grab was checked, the drag code is unchanged.
