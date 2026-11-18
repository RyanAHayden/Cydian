# C6: collapse repeated status lines in the install console

apt's Status-Fd sends `dlstatus:` once per percent step with the same text ("Retrieving file 1 of 3"), so the
console showed that line five or six times in a row (iPhone 7, N6 screenshots).

## What I did
- `web/app/core/queue.js`: `createRepeatFilter()`, a pure `(type, text) -> keep?` that drops a **status** line
  identical to the status line just before it. Only status lines: plain apt/dpkg output and errors can repeat on
  purpose, and an info line in between resets it (the same status after other output shows again).
- `web/app/screens/queue.js`: the console's `line()` runs every line through it, so the screen and the kept log
  (Settings > Console Logs) both get one copy. The status text under the bar and the progress bar still update on
  every status line, so the percent keeps moving.
- Test in `web/app/core/queue.test.js` (own dynamic import, to leave the shared import line alone for merges).

## Tried and failed
Nothing.

## Not verified
- On the iPhone 7: the task didn't call for driving the phone, so the fix is checked by the unit test only, not
  on a real apt download.
