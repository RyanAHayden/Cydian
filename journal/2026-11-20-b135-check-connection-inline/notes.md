# B135: Check Connection answers on its button

## What changed

- `web/app/screens/installroute.js`
  - `checkMark(inner)`: a button's answer drawn in place. `show(true)`: a ✓ and "Successful" in green replace the
    label; `show(false)`: a red ✕ before "Check Connection". Gone after `CHECK_RESET.ms` (3 s) or on the next tap
    (`check()` calls `reset()` first). The failure's timer starts only once its alert is closed (`expire()`), so the ✕
    doesn't vanish behind the alert. State is a `data-check` attribute (`ok` / `fail` / empty).
  - `check()`: no "Connected" alert on success any more; the failure alerts are as before (Turn On LocalDevVPN, or
    Pairing Didn't Work with Pair Again).
  - Both Check Connection buttons get it: the paired Pairing page's (the task's) and the main page's action row,
    which runs the same `check()`, so without it a success there would have shown nothing. The main page's status
    repaint keeps the answer while the action is still Check Connection and clears it if the action changes.
  - `check()` now writes the install route only when it changes: `store.set` fires Settings' onChange, which redraws
    every open Settings page even for the same value, and that redraw threw the mark away (found in Chromium: the
    Pairing page's success never showed).
- `web/app/settings.css`: `.check-mark`, `[data-check]` colours (the status tile's green #2f9a2a and red #c4161c in
  light; `--dk-ok` / `--dk-bad` in dark). Outside the task's file list, but CSS belongs there; added as a new block
  after the action row rules.

## Tried and failed

- First cut used fixed dark colours (#6fd35e / #ff5a52): the gate's `theme-palette.test.js` refuses fixed colours in
  dark rules. Switched to the ios6.css status tokens, which every dark palette repaints; Chromium re-run 24/24.

## Checks

- `web/app/screens/installroute-check.test.js` (new, 4 tests): Pairing page success (no alert, ✓ Successful, plain
  after the reset), failure (alert + ✕, kept while the alert is up, then plain), the next tap clears it, and the main
  page's row. `installroute-busy.test.js`'s Check Connection test now expects no alert.
- Chromium with a fake sideload bridge (`shot.mjs`; `node shot.mjs http://127.0.0.1:<port>/ <outdir>` with web/app
  served): 24/24 PASS — both pages × light/dark × success (label, green computed colour, no alert), plain again after
  3 s, failure (alert + ✕), ✕ still there just after OK, next tap clears. `sheet.png`: light Pairing success and
  failure (dark), main page success and failure (dark).

## Not verified

- On a real phone with the Lite IPA: the task asked for Chromium; the sideload phones here are read-only daily phones.
- Other dark palettes than OLED Black on screen: they use the `--dk-ok` / `--dk-bad` tokens, but only the default
  dark theme was rendered. `sheet.png` was shot before the token change (dark green then #6fd35e, now #7fcf6f).
