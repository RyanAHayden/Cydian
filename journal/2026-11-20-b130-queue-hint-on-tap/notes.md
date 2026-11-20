# B130: the queue hint shows on a tap of Installed, never on queue add

## What changed
- `web/app/nav/queuehint.js`: `nextHint` takes `tapped`; the hint shows only when it is true (plus the old rules:
  badge up, never held, once per queued run). `update()` (every badge change, queue adds included) now only keeps the
  run state, the hold class and hides the hint when the badge goes; it never shows it. The hint listens for `click`
  on the tab bar itself and calls `tapped()` when the target is the Installed tab, so `screens/queue.js` and
  `screens/installed.js` needed no change. A hold's lift click is eaten at document capture by
  `menu.js swallowNextClick`, so a hold never counts as a tap.
- The hint module is built lazily by queue.js on the first badge change, i.e. before any tap that could matter; its bar
  listener runs after app.js's tab-switch handler (registered later), which is fine: a tab switch does not change the
  badge state the tap reads.
- `queuehint.test.js`: rules with `tapped`; queue adds show nothing; a tap on Installed shows it; another tab or an
  empty queue shows nothing; the hold's eaten click shows nothing. 14 tests pass.

## Decisions
- Kept "once per queued run" for the tap too, so every tap on Installed doesn't re-show it (the brief says when, not
  how often; showing on every tap would nag).

## Not verified
- Not checked on a device or in a browser (no phone task in the brief; the toast-vs-hint overlap is now impossible by
  construction since queue add never shows the hint). Covered by the node tests with a fake DOM only.
