# T51 Browser smoke test

## What I did

- `tools/smoke/smoke.mjs` (+ `tools/smoke/README.md`): one self-contained script on the README-shots Chromium route
  (headless Chromium over CDP, iPhone UA, 390x844). It serves `web/app` (or a directory given as the argument) on a
  random 127.0.0.1 port, opens it as the jailbreak app with a fake `ifizboxNative` (every call answers null), or as
  the website with `--site` (`ifizbox.firstVisit=later`), and checks:
  1. push: Home's Settings row, then Settings' first row: route changed, a `.page.is-moving` slide ran;
  2. pop: nav bar Back: route back, slid;
  3. swipe back (app only; the site's edge strip is off): CDP touch events from x=4 to 280: route back, dragged;
  4. sheet: `showSheet` from `nav/sheet.js` (the one scaffold every sheet uses), closed by tapping Done.
  All along, a recorder injected before page scripts logs `transitionrun`, `animationstart`, every
  `document.getAnimations()` entry (polled each frame) and every `Element.animate` call with its keyframe
  properties. It fails on any layout property (height, width, min/max sizes, top/right/bottom/left, inset, margin,
  padding, flex/grid, font-size, line-height, border widths, `all`), on page exceptions, and on any step that
  didn't land. Exit 0/1, 2 when Chromium won't start.
- `docs/native.md` Feel: one line pointing at it. Not in `tools/check.sh` (the brief says so).

## Checked

- On this branch (main as of 39d910d5, nothing else changed in `web/app`): app mode passes (45 animations, all
  transform/opacity), `--site` passes (44). Three runs in parallel all passed (~7 s each).
- Fails when a height transition is added: a copy of `web/app` with
  `.page .cell-inner { height: 44px; transition: height .2s } .page .cell-inner.is-pressed { height: 50px }`
  → `FAIL no layout property animated` (transitionrun/CSSTransition `height` on the pressed row), exit 1.
  A copy whose sheet also ran `bar.animate([{maxHeight:"0px"},{maxHeight:"44px"}])` → fails on `max-height`.

## Tried and dropped

- Swipe back with CDP mouse events (press at x=4, moves, release): the edge strip got the press but no swipe
  started (route stayed on the pushed page). CDP touch events work, and match a phone anyway.
- A height transition on `.sheet-bar` keyed to `.sheet.is-moving`: the sheet has no such class, so nothing changed
  and no transition ran; a test of the test that proves nothing. Switched to the pressed-row state.

## Not verified

- The sheet is opened through the scaffold from an eval, not a real button: with the fake bridge's empty state
  there's no data for any screen that opens one (QR Code, Write a Review, Confirm need a source/package/queue).
  The sheet's own slide-in/out and Done are real; a screen's own sheet content isn't covered.
- Alerts, action sheets and popups aren't driven.
- Chromium only; iOS WebKit may run animations the desktop doesn't (and vice versa). No phone run (not in the
  task).
