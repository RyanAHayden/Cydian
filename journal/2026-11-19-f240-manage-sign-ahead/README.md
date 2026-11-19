# F240: Manage's Re-sign / Update on the sign-ahead run

## What I did
- `web/app/screens/installed.js` `runManageJobs`: the jobs still go into the app queue. When the phone can sign ahead
  (sideload app: `localSigning()` and `prepareOnDevice`, the same check as queue.js's private `useAppRun`), they now
  run through `screens/queue.js runAppQueueRun` (the F235 black page with Apps | Log rows). The result's `left` is
  the jobs still queued once the run ends the first time: failed and cancelled rows stay queued, so B66's "Manage
  stays on with what didn't go through picked" works the same. `null` (the Signing walkthrough opened) leaves all
  picked. The website keeps `runAppQueue` with the bulk HUD labels.
- New options `ahead` (force the choice) and `aheadRun` (tests). When a test passes `run` and no `ahead`, the old path
  is used, so the existing tests keep their meaning.
- Two tests in `installed-manage.test.js`: the sign-ahead path (left = failed/cancelled, walkthrough, all through)
  and the website path.

## Decisions
- `left` is read at the run's first end (what `runAppQueueRun` resolves with). If the user then taps Retry All on the
  black page and those apps go through, Manage still shows them picked until the next load. Fixing that needs
  queue.js/apprun.js to expose the run's later ends (`onClose`'s result), which are outside this task's files. Small
  and harmless (the picked apps are just picked); not filed.
- Cancel on the black page reopens the app Confirm with the Manage jobs still queued (runAppQueueRun's own behaviour,
  as for Confirm's run). Kept as is: it's the same queue, and the footer says what happened.

## Tried and failed
- nothing

## Not verified
- On a phone: the sideload build wasn't run on a device (the task names no phone and the iPhone 7 runs the jailbreak
  build, where Manage isn't shown). Covered by unit tests with a fake run only.
