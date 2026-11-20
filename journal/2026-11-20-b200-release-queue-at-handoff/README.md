# B200: the IPA queue moves on once iOS has the whole IPA

## What was wrong
On the prompt route (sign.<DOMAIN> manifest, local install server), the run's install lane is
`openPrepared` (web/app/signing/queue.js). After `signing.open` it awaited `signing.progress {bundleId, wait: 600}`,
which only answers when the shell's watch ends (Sideload.swift `watch`: iOS's install progress gone, 45 s / 30 s
quiet rules, or 15 minutes). Meanwhile the row showed "Installing 62/70/80%" from iOS's own progress object, and
core/apprun.js installs one app at a time, so the next app waited for all of it.

## What changed
- native/Sources/Sideload.swift: `watch` takes `onServed`, called once when `Handoff.wasServed(bid)` turns true
  (the install server's onServed, or the B89 hosted copy fully fetched). `signing.progress` emits `{served: true}`
  on it and keeps watching.
- web/app/signing/queue.js `openPrepared`: races the watch against `{served: true}`. On served it answers
  `{installed: null, handedOff: true, later}` at once; later events are dropped; `later` is the watch's own answer
  (true or null).
- web/app/core/apprun.js `startInstall`: the row ends "Sent to iOS" (unsure) and `pump()` starts the next app;
  when `later` gives true the row turns Installed (the same patch and log line as `confirm`), which the page's
  onChange records (B136's recordIf).
- docs/signing.md: the event and the queue's new wait.
- Test: web/app/install-served-release.test.js: two queued installs; the second's `signing.open` happens right after
  the first's `{served: true}`, with the first's watch still open; its later `installed: true` makes it Installed.

The brief's file list (screens/installed.js, screens/signing.js, core/signing.js, screens/progress.js) named
guesses; the wait lives in signing/queue.js and core/apprun.js, and the event had to come from the shell, so those
are the files changed.

## Tried and failed
Nothing failed. Considered keying off the install log line "iOS has the whole IPA" (already reaching the page as
`{log}`), but a structured event doesn't depend on wording.

## Not verified
- On a phone: no sideload-build phone test (the task is unattended and the iPhone 7 runs the jailbreak build; the
  sideload route needs the 18 Pro / iPhone 15, which are read-only or the user's). The Swift change is checked only
  by the gate's native build.
- Whether iOS still installing app A while app B's prompt shows causes any iOS-side trouble: iOS queues installs
  itself, but not seen here.
