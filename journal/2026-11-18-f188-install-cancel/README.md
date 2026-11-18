# F188: Cancel at the top right of the running IPA install

User 2026-11-18: iOS's own "Install?" prompt can be cancelled, which left the install page waiting for ever; the
running install must always have Cancel at the top right.

## What changed

- `web/app/nav/progress.js`: `page.stoppable(fn)` puts Cancel in the nav bar's right slot from then until
  `finish()`, which swaps in Done (Close stays for pages that aren't stoppable: the apt queue's, whose own Cancel is
  at the top left and unchanged). Cancel's tap runs `fn` and closes the page (back to the page under it); Done after
  the end only closes. `progressHUD` (every sideload and website install) is always stoppable: `h.cancelled`,
  `h.signal` (AbortController), `h.onCancel(fn)`, and every set/done/fail after Cancel is ignored.
- `web/app/signing-client.js`: `untilCancel(h, p)` ends the wait the moment Cancel is tapped.
  - Sideload (`installOnDevice`, `installFromLibrary`): returns false at once, no alert, no `onInstalled`, no
    followInstall, the one-install lock comes free; asks the shell for `signing.cancel` (does not exist yet, see below).
  - Website (`signInBrowser`): the signal aborts the download fetch, terminates the zsign Web Worker
    (`runInWorker({ signal })`), stops the upload between parts; `retrying` no longer retries an aborted request.
- `web/app/ipa-install.js` / `screens/ipa-install.js` (jailbreak build): `runIpaInstall({ signal })` resolves
  `{ cancelled: true }` without waiting for ipa.install, drops its later lines; the run is still logged in Console
  Logs (ending "» Cancelled").
- `web/app/websign-job.js` and `core/ipainstall.js` (on the task's file list) needed no change: terminating the
  worker stops zsign.
- Test: `web/app/install-cancel.test.js` (fake DOM for the real page; Cancel in every state, Done at the end, each
  flow's stop).

## Decisions

- Done is drawn as the plain bar button (same as Close was), not the blue Done style: the page's nav bar is black.
- Native has no call to stop a signing or ipa.install job (checked SignBridge.swift, Sideload.swift, Apt.swift:
  helper.cancel only reaches apt's apply-ask). Filed **F196** for `signing.cancel` / `ipa.cancel` in the shells; the
  JS already sends `signing.cancel` and ignores the refusal.

## Tried and failed

- First run of the new test hung: a fake fetcher listened for "abort" on a signal that was already aborted. Fixed in
  the test.

## Not verified

- On a phone (sideload app, jailbreak app, Safari on the website): no device run in this task. The page's DOM is
  tested against a fake DOM only; the right-slot look of Cancel/Done not checked in a 3x render.
- The native job really stopping on Cancel: it doesn't yet (F196). Until then the shell's download/signing, local
  server and keep-alive run out on their own after Cancel; on the jailbreak build a second IPA install can start
  while the first ipa.install still runs in the shell.

## Second run (2026-11-18)

- The first attempt (wip/F188) was left for a human because the gate failed after the merge. Its repair
  session found the failure was main's own (`test_release` vs altsource `KEEP` = 20 after 0.9.1), not F188's;
  main has since fixed it (test_release now expects `KEEP - 1` earlier versions).
- Re-applied wip/F188's diff (web/ and journal/ only; its plan/ edits left to the runner) on current main. One
  conflict in `signing-client.js` installOnDeviceOnce: main had added `h.page?.raw?.(ev.log)` (the shell's console
  lines) in the signing.install callback; kept it inside F188's `untilCancel(...)` wrapper.
- The native follow-up (signing.cancel / ipa.cancel) the first run named F191 was never filed (`plan F191`
  found nothing); filed it with `plan add` as F196.
- `node --test` on install-cancel, signing-client*, nav tests: 122 pass. Full gate runs in `done`.

The **Not verified** list above still applies.
