# F235: the IPA queue's run, signed ahead and installed one at a time

## What was built

- **Native: the install split into two halves.** Before this, `signing.install` downloaded, signed, served and opened
  iOS's prompt in one call, so nothing could be signed ahead. The new file `native/Sources/SignAhead.swift` adds:
  - `signing.prepare {url | record: bundleId | library: file, edits…, tag}` downloads and signs, then keeps the signed
    IPA for 30 minutes. It replies `{token, bundleId, name, version, expires, device}`. The signing part copies
    `Sideload.signAndOpen`'s first half (the same certificate, profile and device checks, and the same logs). I
    copied it rather than refactoring `signAndOpen`, so Sideload.swift stays mergeable with the other slots.
  - `signing.open {token, manifestServer, host?, tag}` hands the kept IPA to iOS through `Sideload.serveAndOpen`, or
    through `hostAndOpen` for iFizBox's own IPA.
  - `signing.discard {token}`.
- **Native: per-app cancel.** `SignJob` (native/sign) has tagged jobs: `begin(tag:)`, `cancel(tag:)` and
  `wasCancelled(tag:)`. A tagged job never becomes `current`, so the single-install page's untagged Cancel leaves the
  queue alone. A tag cancelled before its job begins starts that job cancelled (a Stop tapped just as the call goes
  out). `signing.cancel {tag}` cancels that app only. `signing.progress` takes `wait` (seconds to wait for the
  Install tap; it was a fixed 45 s) and `tag` (its watch ends on that tag's cancel). There is a host test in
  native/sign/tests/sideload ("F235: a tagged job stops alone").
- **`web/app/core/apprun.js`** (pure, tested in `core/apprun.test.js`): the rows and the scheduler. The signing lane
  signs 2 apps at a time, in order. The install lane hands one app at a time to iOS, strictly in order (iFizBox
  last, from `runOrder`), and waits for iOS's install before the next. `stop(id)` aborts one app in any phase and
  frees its signed copy. `cancel()` abandons everything not finished. There are also `retry` and `retryAll`. A
  download or signing phase with no progress for 3 minutes fails its row ("stopped at Signing 50%: nothing moved
  for 3 minutes") and aborts its job, so the queue moves on. The log gets one line per phase per app.
- **`signing-client.js`**: `prepareParams`, `prepareOnDevice`, `openPrepared` and `discardPrepared`. On abort, they
  send `signing.cancel {tag}` and reject at once. So Cancel really cancels (B66): the shell's job is stopped, not
  left running underneath. Errors go through `deviceError`, so a row's "Failed: …" reads the same as the alerts.
- **`web/app/screens/apprun.js`**: the page. It is nav/progress.js's black page with Apps | Log, and it reuses F234's
  `.qr-*` rows (progress.css). The round stop button shows on working rows. Tapping a failed or cancelled row after
  the run retries it; tapping any other row opens the Log filtered to it. Top right is the red Cancel, then Retry
  All (with Close at the left) or Done. The finish button is Return to iFizBox, or the locked "Closing iFizBox"
  (B49) once iFizBox's own IPA went to iOS. Apps iOS took leave the queue and are recorded (recordApp) as they
  finish.
- **`screens/queue.js`**:
  - The app Confirm's Confirm runs `runAppQueueRun` in the sideload app (`localSigning()`). The website keeps
    `runAppQueue`.
  - `openAppConfirm(queue, { footer })` shows Cancel's "Stopped. N installed and cleared from the queue."
  - Re-sign All already queues re-sign jobs into this Confirm (signed-apps.js `queueResignAll`), so it gets the
    new page too.
- `queue-confirm.test.js`'s red-button rule now allows `apprun.js`'s Cancel too (the brief asks for the same red
  Cancel).
- docs/signing.md: a "The queue's run" bullet.

## Judgement calls

- **Sign 2 ahead, not all at once.** The shell's signer runs on one serial queue (`SignBridge.queue`), so more lanes
  would only stack downloads. With two, one app downloads while another signs. All of them are still signed before
  their install turn comes, unless iOS's prompts go faster than the signing.
- **Stop shows on every working row** (downloading, signing, signed, asking, installing), not only the one with iOS.
  With signing ahead, several rows work at once. A Waiting row has no stop: Cancel or Confirm's Clear covers it.
- **iOS's answer is `null`** when `signing.progress` can't tell, for example on an iOS without the private API. The
  row then ends "Sent to iOS" and counts as installed, as the old run did (it cleared a job once iOS was asked). A
  `false` (no install within `wait`, 600 s) fails the row with "iOS didn't install it", and Retry asks again.
- **A Custom Install job signs from its url with its edits.** The look's 15-minute token isn't used here: it may be
  spent or stale by the time its turn comes.
- **No Hide or strip on this page.** The brief asks for the same top-right rules as F234. F234's Hide is top-left and
  drives the jailbreak build's Installed badge.

## Tried and dropped

- Nothing went wrong that needed undoing. One slip of my own: a no-op `cat > /dev/null` I ran by mistake hung on
  stdin, and the tool moved it to the background. I had no pid for it and the rules forbid a pattern kill, so it was
  left to end with the session. It touches nothing.

## Follow-ups filed

- F240: Manage's Re-sign (n) / Update (n) (installed.js `runManageJobs`) still runs through `runAppQueue`: one at a
  time, stopping at the first failure. installed.js isn't one of this task's files.
- F241: My IPAs' Install through this run. The native side (`signing.prepare {library}`) and `prepareParams` are in
  place. The queue job (`appqueue.add` needs a url today) and the My IPAs page aren't.

## Not verified

- **The iPhone 7 check (a queue of 3 with one cancelled installs the other two) was not run on a phone.** The 7 runs
  the jailbreak .deb, which refuses `signing.*`, and the sideload IPA has the same bundle ID, so the two can't sit
  side by side. No other sideload device is here, and no certificate is set up on one (see the memory note on
  wildcard signing). The same scenario is covered with fake lanes in `screens/apprun.test.js` (3 apps, one stopped
  at iOS's prompt, the other two installed and cleared) and in `core/apprun.test.js`.
- **The new Swift paths have not run on iOS.** That covers `signing.prepare`, `signing.open`, `signing.discard`,
  `signing.cancel {tag}` and `signing.progress {wait, tag}`. The .deb and the IPA compile in the gate
  (native/build.sh), and the tagged SignJob has a Linux host test. The download, sign, keep, serve and watch path is
  only read, not run.
- **The page's look on a screen.** Its rows reuse F234's CSS, and F234 never saw its bars on the phone either. The
  "IPA queue" mockup (a claude.ai artifact link) was not opened: it needs a signed-in browser.
- **Re-sign All end to end** (Settings > Signing, then Confirm, then this page). The path is the existing
  `queueResignAll` into the app Confirm, and only the Confirm's run changed. Node tests cover a re-sign row
  (`{record}` params, "Re-signed, expires …").
