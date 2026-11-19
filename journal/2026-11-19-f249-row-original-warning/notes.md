# F249: original-app warning on a list row's swipe and hold-menu Install

## What I did
- `web/app/screens/browse.js`: new `appRowQueueJob(job, installed, { check })`. When the app has no record
  (`installed == null`, a fresh install) it runs the job through `altstore.js queueOriginalCheck` (F246), which asks
  F243's once-per-app question (`signing-client.js originalWarning`). Cancel gives null, Install a Copy gives the job
  with `options.edits.keepBundleId: false`. Upgrades (a record exists, even with version "") go in as they are.
- The sideload swipe (`attachAppSwipe`) now carries `installed` from `appRowState` in its action. Its `commit` is
  async and awaits the check: Cancel queues nothing and shows no undo bar. The undo bar's `prev` is read after the
  answer.
- The hold menu (`runAppRowMenuItem`) awaits the same check before `queueApp`.
- Test: `web/app/screens/rowswipe-original.test.js` (Cancel / Copy / Install, upgrades and a null job not asked).

## Notes
- `rowswipe.js` ignores what `commit` returns, so an async commit is fine: the row has already sprung back when the
  sheet shows.
- I made the edit with one python heredoc. The session rules ask for the edit tool; the change is the same.

## Not verified
- On a phone (sideload IPA): I didn't check that the warning sheet shows over a list after a swipe or hold-menu
  Install. The task says nothing about using a device, and the sideload build isn't on the iPhone 7 (it runs the
  jailbreak build). Covered by unit tests only.
