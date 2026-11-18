# F84: Install and Custom Install through the queue

## What I did
- Install (the app page's nav button and Install row) already queued with no sheet and opened Confirm (F80's
  `appPageAction`; Confirm runs `installOnDevice` with no look-first sheet). I left it as is and added a test for it.
- `core/appqueue.js`: jobs carry `options` (Custom Install's: the `signing.inspect` token and when it was taken, the
  edits, the name to show, the ID iOS will know it by). A new `customParams(job, now)` builds `signing.install`'s params
  from them: `{token, ...edits}` while the token is under 14 minutes old, else `{url, ...edits}`. This file wasn't on
  the task's file line (its `core/queue.js` looks like a slip for it), but it is the queue model, so the field had to
  go there.
- `signing-sheet.js`: `inspectToQueue` is the same look and sheet as before, but its Install hands the options to a
  `queue` callback and closes instead of signing. `customInstall(opts)` uses it when `opts.queue` is given. A shell
  without `signing.inspect` queues the app plain.
- `screens/altstore.js`: `appPageCustom(pkg, source, opts)` is the app page's Custom Install. In the sideload app it
  builds the job (`appJob`) and queues it with the sheet's options, which opens Confirm through `queueApp`. Anywhere
  else, or when there's no job, it does F81's immediate custom install. `renderApp` passes it to `installRows` as
  `customize`. The footer now says Install queues and opens Confirm.
- `screens/queue.js`: Confirm's `installApp` sends a job with options to `installCustom`, which calls
  `installOnDevice` with the job's own params and follows iOS's progress (`followInstall`), as the sheet did. A token
  goes with one try only (the phone deletes the prepared IPA when it takes it), so if a run fails and the job stays
  queued, the next Confirm downloads by url again. The Queue row's subtitle adds "Custom: as "Name", com.id, N
  extensions left out".
- `docs/signing.md`: a paragraph on the queue path.
- Tests: `screens/queueinstall.test.js`. It covers: Install queues with no sheet and opens Confirm; Custom Install
  queues with its options and opens Confirm; options stay per job in a mixed queue and each install gets its own
  params; the token-or-url rule and the spent token; `customInstall`'s routing; `inspectToQueue` with Install and
  with Cancel.

## Decisions
- A queued Custom Install job can wait in the queue longer than the phone keeps the looked-at IPA (15 minutes,
  `Sideload.swift`). Rather than change the native side, the job falls back to `url` plus the same edits
  (`signing.install` takes `url | token` with the edits either way). The cost is a second download.
- Queuing an app again from the plain Install or Modify replaces the job, so its custom options go too. That's
  Cydia's rule: a new mark replaces the old one.
- Version History's per-version Install and Custom Install (browse.js, not on this task's file line) still sign
  straight away. Filed as F85.

## Tried and failed
- Nothing failed.

## Not verified
- On the iPhone: Install and Custom Install through Confirm in the sideload build. No modern iPhone can be driven
  from here; the user is to try both.
- The token fallback against the real signer (a job queued for more than 14 minutes). The fallback is only covered
  by node tests.
- No browser render: the only visible changes are a footer text and a Queue row subtitle in the existing Confirm sheet.
