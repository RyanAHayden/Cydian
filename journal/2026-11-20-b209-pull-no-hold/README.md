# B209: pull to refresh springs back; the spinner is seen only by pulling again

User 2026-11-20: B188's hold-open (an armed release slid the list to 60 pt and held it while refreshing) was
jittery and moved the rows. Wanted: the list springs straight back to the top, the hidden area above it shows the
spinner + "Refreshing...", and a pull during the refresh reveals it (never blocked) and runs nothing.

## What changed

- `web/app/nav/pullrefresh.js`
  - All of B188's hold is gone: `holdOpen`, `setHold`, `slideHold`, `settleBounce`, `close`, `bounceHold`, `HOLD`,
    and the MutationObserver that re-applied the hold to rows a redraw added. Every lift now does what a lift under
    the trigger always did: script path `springBack(pull)` (rows animate to `none`), native path nothing (iOS's own
    bounce; the scroll listener hides the area once scrollTop is back at 0).
  - `pullTracker` keeps its states (idle, pull, armed, refreshing, closing) and B197's haptics (tick on arm, tap on
    the armed release). `held` is now `refreshing`, and a new `spinning` getter says the area shows the spinner:
    this pull's refresh runs, or the gesture began while one ran (`blocked`). A blocked gesture is no longer stopped
    by the DOM side: touchmove no longer returns on `blocked`, touchstart and the scroll listener always show the
    area. The tracker still keeps it from arming or running anything.
  - `paint()` sets the area's look from the tracker (`spinning` -> `.refreshing` + "Refreshing...", else the arrow /
    "Release to refresh..."); called on every state change and on touchstart (a pull during another refresh, e.g.
    the launch refresh or the nav button, shows the spinner too).
  - An armed release freezes the area's look ("Release to refresh...", arrow turned) while it springs away; it
    switches to the spinner once out of sight (`show(false)`), or at once if a touch catches it on the way up. Added
    after the spec review: the first version painted the spinner at the lift, so it was seen sliding away (shot 2 of
    `iphone7.png`), against "only if you scroll up out of view again".
  - "closing" (refresh ended) goes to "idle" (arrow) as soon as the area is out of sight: at once if it already is,
    else in `show(false)`. `show()` now caches its state so the per-frame scroll event writes no class.
  - Jitter: with the hold gone, nothing on the native path moves the list by script (B188's per-scroll-event
    child transforms fought iOS's bounce). The script path's rubber band now uses the scroller height read once in
    `ensure()` (per touch) instead of `clientHeight` per touchmove, and no longer reads `scrollTop` per move once in
    script mode. Rubber math unchanged (UIScrollView's `(1 - 1/(x*0.55/d + 1))*d`, checked by the existing test).
- `web/app/ios6.css`: `.pull-refresh` gets `will-change: transform` (its own layer: following the finger repaints
  nothing); the spinner block's comment describes the new behaviour (rules unchanged).
- `pullrefresh.test.js`: tracker tests use `refreshing`/`spinning`; bounceHold test removed; the DOM regex test now
  asserts no hold code is left. Two new tests drive `pullToRefresh` on a stand-in DOM with mocked timers (each
  imports its own copy of the module so the native/script guess starts fresh):
  - native: scroll events below 0 arm it, the lift + bounce leave the rows untransformed, onRefresh ran once,
    area hidden and spinning; a second pull shows it with "Refreshing..." (not armed), its lift runs nothing; once
    the refresh ends the area is the arrow again.
  - script: rows follow every touchmove (strictly increasing, no stall), the lift springs them to `none` (no hold),
    a pull during the refresh moves rows and shows the spinner, its lift runs nothing; then back to the arrow.
  Checked that these fail against main's B188 file (6 tests fail there).

## Checks

- `node --test web/app/nav/pullrefresh.test.js`: 26 pass.
- iPhone 7 (iOS 15.8.8, native rubber band) under `tools/ui-7.sh lock B209`: phone's `nav/pullrefresh.js` was
  identical to main's, its `ios6.css` differed from main, so I swapped in this branch's `pullrefresh.js` and the
  phone's own `ios6.css` plus the one `will-change` line, with backups. App closed (it wasn't running), opened on
  Sources, waited out the launch refresh. Then on the phone in one ssh command: a 2 s pull (375,400 -> 375,1000)
  with shots during it and after the lift, then a second 2 s pull while the refresh ran, then (40 s later, refresh
  over) a short pull. `iphone7.png`, left to right:
  1. mid-pull, armed: arrow turned, "Release to refresh...", Last Updated 5:30.
  2. ~0.4 s after the lift: caught mid-bounce, the list springing up with the spinner + "Refreshing..." going out
     of sight (no hold).
  3. 1.8 s after: list at its top (All Sources at the same y as before the pull), the refresh running below
     ("Downloading Packages").
  4. second pull during the refresh: spinner + "Refreshing...", Last Updated kept.
  5. after its lift: back at the top, the same refresh still running (no second refresh started; the bar and the
     row spinners carried on).
  6. after the refresh ended: a short pull shows the arrow again, Last Updated now 5:31.
  Files restored (md5 back to the originals), temp files removed, app closed from the switcher, lock released.
- iPhone 7 again after the freeze fix (same swap, restored the same way): a 1 s pull, then 4 shots right after the
  lift and one a second later. `iphone7-release.png`: armed, then two frames of the list springing back with the
  area still "Release to refresh..." (no spinner), then the list at its top with the refresh running. The list's
  top climbs steadily back to its rest position, with no hold and no overshoot. An earlier run that time also had a
  second pull during the refresh show the spinner + "Refreshing...".
- Spec review (fresh subagent on the diff + brief): fixed the spinner showing during the first spring-back (above).
  Left as designed: the arrow comes back only once the area is out of sight (no look flip on screen).

## Not verified

- Smoothness itself (120 Hz, no jitter while tracking) on a device: the iPhone 7 is a 60 Hz screen and there is no
  screen recorder for it; stills show the area tracking the content edge, not frame pacing. No ProMotion phone
  with the jailbreak build was available to this session. The code side is checked (transform only, no per-frame
  layout read, nothing moving the list on the native path).
- That the second pull's release started no second refresh is read from the phone only indirectly (the same
  refresh carried on, nothing restarted); the unit tests check it directly.
- The script path (Chromium/Android, no rubber band) only in the stand-in DOM test, not in a real browser.
- Changes' and Home's pulls on the phone: same code path as Sources; not driven.
- Corner case left as is: a pull that starts during *another* refresh (nav button, launch) keeps showing the
  spinner if that refresh ends while the finger is still down; the next touch repaints it. No refresh-ended event
  is wired into paint() for that; not seen on the phone.
