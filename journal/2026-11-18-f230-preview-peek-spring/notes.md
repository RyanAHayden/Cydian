# F230 Theme preview split: one visit only, a 100px peek, a spring on the first tap

Follow-up to F215 (Settings > Theme > Light / Dark, the movable preview split).

## What changed

- `web/app/screens/settings.js`
  - (1) No stored position. `savedSplit` / `saveSplit` / `SPLIT_FLOOR` are gone. A drag sets `split.dragged` (px) in
    the in-memory state; `resetSplit()` (now exported) clears it when a theme list opens (`render()`), so Back /
    another tab and in again starts at the peek. Within a visit `splitHeight(geo, { dragged, tapped })` puts the drag
    first, so it still wins over the tap size across the redraw a tap causes. `dropStoredSplit()` removes F215's
    `ifizbox.themePreviewSplit` once per launch (module flag), called from the same spot in `render()`.
    State changes are small exported functions (`splitTapped`, `splitDropped`, `splitNow`) so the tests drive them
    without a DOM.
  - (2) `entrySplit`: the preview starts as `SPLIT_PEEK` = 100px (25px grip + 44px sample nav bar + a bit). If a row
    edge (or the footer's end) lies within one row (44px) above that line, the divider snaps up to it so no row is
    cut (preview 100–143px); otherwise it is exactly 100 (Dark's 6 and Light's 3 themes end well above it).
    Decision: a short list now leaves page ground between its footer and the peek, rather than the preview filling
    everything under the footer as F215 did, since the brief asks for a peek "instead of a quarter of the screen".
  - (3) `springSplit`: when the height grows (only the first tap of a visit without a drag does that), the pane is
    laid out once at `to + overshoot` (6% of the rise, 4–14px), rises by `translateY` past the line at 65% of 380ms,
    and settles down onto it; then the real height is set. Transform only. Reduced motion: the existing early return
    jumps. Later taps compute the same height, so nothing moves.
- `web/app/settings.css`: the preview and its spacer start at 100px (was 50vh) so the first frame before the rAF
  measurement matches the peek instead of flashing half the screen.

## Checks

- `node --test web/app/screens/settings.test.js`: 17 pass. F215's split test is replaced by two F230 tests: peek
  height and snapping (6, 3, 12 rows; edge on the line), tap -> half, drag beats tap, clamping; and a visit test via
  `render()` of the theme lists: entry peek, tap half, later tap same, drag then tap keeps drag, Back to Theme keeps
  state, re-enter -> peek, drag before tap wins, Light list -> peek; a fake `localStorage` (installed at the top of
  the file) shows the stale key removed exactly once and no `setItem` at all.
- Headless Chromium 375x647 @2x against `node worker/node.mjs` (`capture.mjs` copied from F215, `shots.json` here),
  with a stale `ifizbox.themePreviewSplit=0.4` planted first:
  - entry: preview top 498, height 100; rows end at 318; stored key null (removed) — `1-entry.png`
  - tap Gunmetal, preview top per frame (ms:top): 19:498 … 132:286 … 249:261 (overshoot, 13px past) … 382:274, then
    steady at 274 = height 324 = 50%, transform none — `2-after-tap.png`
  - re-entry, tap Midnight, shot at ~250ms — `3-spring-overshoot.png`
  - drag 120px down: height 204, stored key still null; tap Nord after: 204 — `4-tap-after-drag.png`
  - Back to Theme and in again: 100 — `5-reopened.png`; Light list entry: 100 — `6-light-entry.png`
- `tools/check.sh` via `agent-runner done`.

## Not verified

- On the iPhone 7 (app or Home Screen web app): the task did not ask for the phone; headless Chromium is not
  WebKit, so the spring's smoothness at 120 Hz and the feel of the overshoot on a device were not measured.
- Reduced motion: the jump path is the unchanged early return in `layoutSplit`; not run with the media emulated.
- The native shell's geometry (`html.native` bars): not run, same as F215.
