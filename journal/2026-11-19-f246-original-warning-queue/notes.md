# F246: original-app warning on the IPA queue's Install

## What changed

- `web/app/screens/altstore.js` `appPageAction`: in the sideload app, a fresh install (no record in the apps store)
  asks F243's question (`signing-client.js originalWarning`) before the job is queued. This covers the first Install
  and Version History's row. Cancel queues nothing. Install a Copy queues the job with
  `options: { edits: { keepBundleId: false } }`. Install queues the job as it was, and `originalWarning` remembers the app.
- New `queueOriginalCheck(job, warn)` does that step. It copies the job and keeps any edits it already has. If the
  check throws, the job is queued unchanged.
- No question for an installed app (it has a record; Modify's Upgrade/Reinstall), or for a queued or signed app
  without a record (Modify's sheet: it was already asked when it was queued, or iFizBox signed it).
- `queue.js` needed no change. Both runs already send a job's `options.edits`: `runAppQueueRun` through
  `signing-client.js prepareParams` (gives `{url, keepBundleId:false}`), and `runAppQueue` through `installCustom` →
  `customParams` (gives the same with no token). The test checks both.
- Test: `web/app/screens/originalqueue.test.js`.

## Choice made

I ask when the job is queued, not when Confirm runs. Asking then lets Cancel simply not add the app, and keeps the
Confirm list matching what will happen. If Confirm asked, the run would need a way to drop a job in the middle of a
run.

## Follow-up

- F249 (low): list rows' swipe/hold-menu Install (`browse.js` + `rowAppJob`) still queues without asking.

## Not verified

- On a phone (sideload IPA build with the App Store original installed): no device step in this task, and the iPhone 7
  runs the jailbreak build. Checked with unit tests and fakes only (`warn`, the queue, `installOnDevice`).
