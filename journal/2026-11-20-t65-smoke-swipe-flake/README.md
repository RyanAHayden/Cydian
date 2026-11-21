# T65: smoke swipe-back step flaky under load

## What I did
- Reproduced it: 8 `tools/smoke/smoke.mjs` runs at once, 1 failed with `swipe back pops (route #/home/settings/logs)`,
  `at the edge: DIV.edge-swipe`.
- Cause (from the code): `pushOne` waited for the hash to change, then `settle()`. The hash changes before the
  push slide starts (app.js onRoute shows a route only once its lazy modules are loaded), so under load `settle()`
  could pass with no slide running yet. The slide then began while the swipe was starting, and the strip's
  `canStart` (`!running`) refused the touch, so nothing was dragged.
- Fix in `tools/smoke/smoke.mjs`: `pushOne` now waits for the recorder to see the slide run (`__smoke.moves > 0`)
  before `settle()`, and the swipe step first checks `edgeLive()`: no `nav-moving`, no moving page or nav item,
  and `.edge-swipe:not(.off)` is the element at the touch's start point, still so two frames later. That is a
  check of its own ("the edge strip is live once the push is at rest"), so a real strip bug still fails the run.
- After the fix: 3 rounds of 8 parallel runs, 24 of 24 passed.

## Tried that failed
- nothing

## Not verified
- I did not separately confirm the cause with logging (the slide starting after `settle()`). It is what the code
  says, and the fix that waits for it ended the failures in 24 loaded runs, but the flake was 1 in 8, so a rarer
  second cause is still possible.
