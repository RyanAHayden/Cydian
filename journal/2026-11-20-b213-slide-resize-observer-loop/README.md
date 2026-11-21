# B213: slide watcher's ResizeObserver loop warning on a viewport resize

## What I did

- `web/app/nav/slide.js`: while the ResizeObserver callback runs `update(root)` (flag `reporting`), boxes the new
  measure finds are not observed there; they go in `pending` and are observed on the next animation frame
  (`requestAnimationFrame`, a 16 ms timeout without one). Observing them inside the report put their first report at a
  shallower depth in the same broadcast, which is what Chromium reports as "ResizeObserver loop completed with
  undelivered notifications". Outside a report (MutationObserver batches, `slideChange`) boxes are still observed at
  once, as before.
- A box observed a frame late could change size in that frame, and its first report was always skipped. `firstSeen`
  now keeps the measured height: the first report is skipped only when `borderBoxSize` matches it (within 1 px), or
  when the browser gives no `borderBoxSize` (older Safari: the old behaviour). A box that grew in the wait counts as a
  change and its root is measured and slid.
- Unobserving a box (it left the measure, or its root went) also drops it from `pending`.
- `web/app/nav/slide.test.js`: a test installs the watcher with fake observers and checks that a resize report
  observes nothing inside the report, observes the new box on the next frame, and that the late box's first report is
  skipped at the same size and re-measures when it grew. It fails on the old slide.js (checked against a copy of HEAD's
  file) and passes now. FLIP sliding itself is unchanged (plan/measure tests untouched and passing).

## Tried

- The browser check the brief suggests: built the concept page twice (this branch, and HEAD's web/app via
  `git archive`) with frame.html's fresh-iframe-per-device `load()` commented out locally (restored before commit), and
  ran `tools/concept/check.mjs` (default route, and `--route '#/home' --drag-route none` over three devices). Both
  builds came out clean: the warning did not reproduce even without the fix, so this run proves nothing either way.

## Not verified

- The fix in a real browser resize: the warning would not reproduce in headless Chromium on the old code (above), so
  there was no failing case to show passing. The node test covers the mechanism (no observe() inside a report).
- frame.html's workaround is left in place: removing it is outside this task's files, and with no repro there is no
  evidence it can go.
- iPad rotation / Split View on a device: no iPad here.
