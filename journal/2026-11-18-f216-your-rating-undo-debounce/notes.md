# F216: Your Rating can be removed, and is sent debounced

## What changed
- `starPicker(…, { clearable })`: tapping the star that is already the value sets 0. Only the tab's Your Rating
  picker uses it (the Write a Review sheet needs stars).
- reviewsTab, Your Rating row: label, status, a small **Remove** (hidden while no stars), the picker.
  - Each tap updates the stars and the label (Your Rating / Tap to Rate) and Remove at once.
  - The send waits `rateDelay` (1500 ms) after the last tap; each tap restarts it. pointerdown/touchstart on the
    picker cancels the timer and holds it; pointerup/cancel/touchend restart it.
  - At send time: final value equal to the server's (`mine.stars`) → nothing; 0 → the existing `removeMine()`;
    else post with the review's words kept. "Sending…" only then. On failure the status shows the error and the
    stars go back to `mine.stars`.
  - Clearing with a written review (title or text) asks `confirmDelete` right away (at the tap, not 1.5 s later,
    so the question follows the finger). Cancel restores the last non-zero value tapped (so a change made just
    before still goes out); OK lets it clear and the delete goes out after the debounce.
  - pagehide (window) and visibilitychange→hidden (document) flush a waiting change. The listeners are added only
    while a change waits and removed on flush, so redrawn tabs leave none behind. `win`/`doc` are options for tests.
  - Write a Review flushes first, so the sheet opens with the stars the server has.
  - The tab returns `rating: { picker, flush }`.
- reviews.css: `.review-tap-remove` (Report's link look, dark theme link colour).
- Tests: `screens/reviews-rating.test.js` with node:test fake timers (5 taps → one post with the last value;
  same star clears → remove; Remove; written review asks, Cancel restores, OK removes; back to the start sends
  nothing; finger down holds; pagehide and hidden flush; Write a Review flushes; failure falls back). The old
  Tap to Rate test in reviews.test.js passes `rateDelay: 0`.

## Decisions
- In-app navigation (Back off the package page) has no teardown hook in nav/stack.js. It isn't needed: the
  debounce timer is not tied to the pane, so a popped page's pending change still goes out 1.5 s later. Only
  leaving the web page/app (pagehide, hidden) needs the immediate flush, and has it.
- Taps on the old picker while a send is in flight are dropped by the redraw that follows the send (as before
  F216, where every tap redrew). Acceptable: the status says Sending… during that short window.

## Tried and failed
- nothing notable; the tests passed on the first run.

## Not verified
- Not looked at in a browser or on a phone (no task permission to drive the iPhone 7, and no headless browser
  step in the gate): the Remove link's placement in the 43 px row on a narrow screen, and whether real iOS fires
  pointerup reliably after a tap in the WKWebView (if it didn't, `down` would stay true and the send would wait
  for pagehide; touchend is also listened to, which iOS always sends).
