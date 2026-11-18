# F179: reload bar shows only Cydia's few general steps

## What I did
- `web/app/nav/reloadbar.js`: the bar now only shows the four fixed steps (`PHASES`, from `core/reloadsteps.js`
  `STEP_TEXT`). `phaseOf()` maps "Downloading <anything>" to "Downloading Packages" and drops any other text, so no
  source name, URL, count or per-file text can reach the strip whatever a caller passes. Each step stays up at least
  `MIN_STEP_MS` (600 ms): later steps queue behind it, and `hide()` (the run's end) lets the queue play out before the
  slide. `hidden` turns true at once (the run is over, `set()` is ignored). Cancel and showing a new bar take it away
  at once (`dismiss()`), without the wait. Spinner, Cancel, the push-down and the animations are unchanged.
  `clock` and `minMs` options exist for the tests.
- `web/app/core/reloadsteps.js` (not in the task's file list, but it was where the per-source names came from): no
  more "Downloading <source>". It starts on "Updating Sources" whenever there are sources (app and website alike, as
  the brief's phase list says: the Release/Packages and AltStore JSON fetches), goes to "Downloading Packages" at the
  first answer, then Loading Data, Building Searcher Cache. `apt`/`name` options are still accepted and ignored so
  `screens/sources.js` needed no change.
- `web/app/app.js`: no change needed; `ctx.reloadBar` is still `showReloadBar` and gets the defaults.
- Tests (`nav/reloadbar.test.js`): with a hand-moved clock, a feed of names/URLs/counts only ever shows fixed step
  strings; a 30 ms refresh still shows every step >= 600 ms and the slide comes 600 ms after the last; a slow step
  changes at once; Cancel and a replacing bar don't wait; an old bar's timer doesn't clear the new bar's push-down.
  The F150 tests were updated for the new words (no names) and use the fake clock / `minMs: 0`.

## Not verified
- Not looked at on a phone or in a browser (no device step in this task): the timing is only checked in node with a
  fake clock. Whether 0.6 s reads well on the real refresh is the user's call.
