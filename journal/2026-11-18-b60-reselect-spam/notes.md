# B60: tab bar reselect spam

## Problem
B57's `scrollToTop` (web/app/nav/tabbar.js) replaced a running slide on every call: each new tap stopped the last
slide, ran the overflow toggle (momentum stop) again and started a fresh 300 ms ease-out from where the list was.
Spamming the tab made the list lurch and restart, and `tapTab` ran the screen's `reselect()` on every tap
(Search refocused its field each time).

## Fix
- `scrollToTop(body)`: if a slide is already running on that body, it returns `true` and does nothing (no stop, no
  overflow toggle, no restart). The check comes before the "already at the top" check, so a call mid-slide is
  always a no-op. The status-bar tap (statusbar.js, same function) gets the same behaviour, which I think is right:
  one tap = one slide, a second tap while it runs adds nothing.
- New `isSliding(body)`: true while a slide runs (the WeakMap entry, removed when it lands or a touch stops it).
- `tapTab(..., { sliding })`: at the root of the current tab, if `sliding()` is true it returns `"busy"` without
  calling `scrollTop` or `reselect`. Without `sliding` it behaves as before.
- app.js passes `sliding: () => isSliding(stacks.top()?.page.body)`.
- Unchanged: a touchstart on the list still stops the slide (and then the next tap slides again); at the top a tap
  doesn't move the scroller, and `reselect()` still runs there (Search focuses, as today). The reduced-motion jump
  and the no-rAF `scrollTo` fallback register no slide, so nothing is ignored there.

## Tests (web/app/nav/tabbar-slide.test.js)
- B57's "a second tap mid-slide replaces the first" became "a second call mid-slide is ignored" (no extra
  scrollTop write, no second overflow toggle, one frame pending, lands on 0).
- 5 quick reselects through `tapTab` 40 ms apart: results `reselect, busy, busy, busy, busy`, `reselect()` once,
  one momentum stop, writes never go back down, ends at 0; a tap at the top afterwards doesn't touch the scroller.
- After a touch stops the slide, the next call slides again to 0.
