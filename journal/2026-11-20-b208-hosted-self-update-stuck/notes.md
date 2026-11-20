# B208: hosted self-update stuck on "Finishing the update / Waiting for iOS"

User report: updating iFizBox (Lite) through the Signing Server (iOS's prompt) stays on "Finishing the update" with
the button locked on "Waiting for iOS", and iFizBox never closes, so iOS can't install over it.

## Cause (found in the code, not seen on the phone)

- The Worker's hosted `app.ipa` (`worker/src/index.js` `hosted`) writes the `finished` mark in the stream's last
  pull, *after* enqueueing the IPA's last bytes. On Cloudflare the body goes through a FixedLengthStream; iOS hangs up
  once it has Content-Length bytes and the runtime cancels the request, with that KV put still pending. F190 saw
  exactly this on `/sign/up` ("canceled" in wrangler tail) and fixed it there with `ctx.waitUntil`; `/sign/host`
  never got the fix (it wasn't even passed `ctx`). So `GET /sign/host/<t>/status` said `started` but never
  `finished`, native `CloseForUpdate` sat in `.downloading` until `finishLimit` (600 s) and only then gave up
  (stalled), and the page stayed locked on "Waiting for iOS" for those 10 minutes with nothing to do. The Node
  tests never showed it: Node finishes the pending put even after the reader is done.
- Answers to the brief's questions:
  - Does it see iOS's install start? Yes, `started` is written before the first byte goes out, so the page reads
    "iOS is downloading". What it never saw was `finished`.
  - Is the poll alive while the prompt is up? The poll only starts after the prompt (resign then become active, or
    background, or 5 s with no resign). One hole: resigned, then neither active again nor background left it in
    `.prompt` for ever. Now `promptLimit` (30 s) begins the wait anyway.
  - Does CLOSE_GRACE's "close by hand" ever show? Only after finished/guessed (or a shell that can't be followed),
    so in this stuck path never: nothing reached finished for 10 minutes.

## What changed

- `worker/src/index.js`: `hosted` gets `ctx`; the finished mark's promise goes to `ctx.waitUntil` (and is still
  awaited). Test: `worker/test.mjs` "worker host finished mark kept" (a short Range hands nothing over, the full
  download hands one promise to waitUntil, and status says finished after it).
- `native/Sources/Sideload.swift` `CloseForUpdate`:
  - `promptLimit` (30 s): the wait begins whatever iFizBox heard (begin only acts from `.prompt`).
  - `downloadGuess` (60 s): once the server says iOS started the download, iFizBox closes (guessed) if `finished`
    hasn't come within a minute. Closing can't hurt the download (iOS fetches from the server); B83's worry was
    closing before iOS *started*, which this doesn't do. The old `stalled` give-up (600 s) is now unreachable in
    practice; left in place rather than reworking the state machine.
  - Test: `native/test_selfupdate_hosted.py` (text checks, as the other native tests do).
- Page: `web/app/signing/selfupdate.js` `DOWNLOAD_HINT` (15 s) / `DOWNLOAD_BY_HAND`. In the queue's run
  (`screens/apprun.js` followSelf) and the single install (`followSelfUpdate`), 15 s after "downloading" with no
  close the page adds the line "If the new iFizBox is installing on the Home Screen…, close this one from the app
  switcher" and unlocks (Return); it keeps following, so a later finished/guessed locks on "Closing iFizBox" again.
  Tests: three new ones in `screens/apprun-self.test.js` (stuck path: hint + Return then Closing at guessed; finished
  before the hint: no hint; the single install's follow). `selfupdate-waiting.test.js` now finds the grace timer
  by its delay (there are two timers now).
- `docs/signing.md`: the self-update paragraph.

## Decisions

- The user's phone runs an older build: its native code and bundled page don't have the app-side changes, so the
  re-try that matters is fixed by the Worker change alone, once the Worker is deployed with this merge. The app-side
  backstops cover the next updates if the mark is ever late again (KV caching, see below).
- Worker files weren't in the brief's file list; the cause lives there, so they are changed (small, local edits).

## Tried and failed

- Nothing failed. One of my own comments first quoted "Finishing the update", which `native/test_updates.py`
  forbids inside CloseForUpdate (B178's no-notification check); reworded.

## Not verified

- On the phone (the brief's "user re-tries an update on the 15 Pro"): this unattended run can't drive the user's
  phone and the Worker isn't deployed from a task branch. The user needs to re-try after this merge is deployed.
- That Cloudflare's cancel was really what dropped the mark on `/sign/host`: inferred from F190's identical
  observation on `/sign/up` and the code; no `wrangler tail` of a real self-update was taken here.
- KV edge caching: the status poll reads the `.ios` key every 2 s, and a cached read can show `finished` up to
  about 60 s late. Not measured; the 60 s native guess and the 15 s page hint bound the wait either way.
- The Swift changes are checked only by the gate's native builds and the text tests, not run on a device.
