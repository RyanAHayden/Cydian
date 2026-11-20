# C22: one sheet scaffold

The modal sheet (iOS 6's presentModalViewController: blue bar, `[left, title, right]` row, slide up 350 ms, down
300 ms) was built four times. Now `web/app/nav/sheet.js` `showSheet` is the only builder.

## What changed

- `nav/sheet.js` `showSheet` gained `left`, `right` (in place of Done; `null` for nothing), `cls`, `bodyCls`, an
  array `body` and `escape: false`. It still returns the close function (every old caller keeps working), now with
  `close.sheet / .h1 / .left / .right / .content`, `close.setTitle(t)` and `close.closed()`. `close()` returns a
  promise that settles once the sheet is removed and `onClose` has run; later calls return the same promise.
  `animate` is optional (fake DOMs, old WebViews): without it the sheet opens and closes at once.
- The left box is now `.sheet-left` everywhere (it was a bare div in showSheet's own sheets). The rule
  (`justify-self: start; display: flex`) changes nothing on screen: the shots are pixel-identical.
- `screens/queue.js` `modal()` is a thin wrapper over showSheet (same return shape, `escape: false`: Cancel clears
  the queue, so closing stays with the buttons, as before). Its unused `EASE` went.
- `screens/reviews.js` `writeReviewSheet` builds on showSheet (Escape still closes it, as before).
- `nav/progress.js` `openProgress` builds on showSheet (`escape: false`, as before); its close still runs the
  closers first, then slides down. hide()/show() keep their own slides (the page stays alive).
- `signing-sheet.js` uses `close.left` / `close.right` and `cls: "sign-sheet-modal"` instead of querying the DOM.
- New `web/app/nav/sheet.test.js` (6 tests).

The brief names `web/app/queue.js` and `web/app/reviews.js`; the sheets live in `web/app/screens/queue.js` and
`web/app/screens/reviews.js` (web/app/queue.js is the store, no DOM), so those were changed and no new file made.

## Checks

- `node --test "web/**/*.test.js"`: 2454 pass, 0 fail.
- Before/after at 402x874@3x in headless Chromium (`capture.mjs`, HEAD served from a scratch detached worktree):
  Confirm, Write a Review, the progress page and the Install sheet, each shot mid-slide (paused at 140 ms) and
  settled. `cmp.py`: all 8 pairs pixel-identical. The recorded slide is the same on both sides for all four
  (350 ms, `cubic-bezier(.25,.1,.25,1)`, `translateY(100%)` -> `none`). DOM shape identical apart from the Install
  sheet's left box gaining `.sheet-left`. `after-contact.png`: the four settled sheets and the Install sheet mid-slide.

## Not verified

- The slide down (close) was not shot in Chromium; it is covered by `sheet.test.js` (300 ms, `fill: forwards`,
  removed only after it ends) and the code path is the same one showSheet's Done sheets used.
- Not run on the iPhone 7 (the task doesn't call for the phone; the change is DOM-identical in Chromium).
- Dark appearance not shot: no colours or classes changed beyond `.sheet-left` on an empty-styled box.
