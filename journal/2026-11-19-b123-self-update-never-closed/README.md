# B123: iFizBox's own update ended on "Closing iFizBox" but iFizBox never closed

User report (2026-11-19, 0.11.0 to 0.12.0 through the IPA queue): the run page ended locked on "Closing iFizBox",
and iFizBox stayed open.

## Cause

- `screens/apprun.js` (the queue's run) ended the page locked on CLOSING_LABEL the moment iFizBox's own row was
  sent, and never followed `signing.selfUpdate` (only `signing-client.js installOnDevice` did, B83). So whenever
  native `CloseForUpdate` didn't exit (notStarted / stalled after 120 s / 600 s, an older server, or no follow at
  all) the page stayed locked with no status and no Try Again.
- Native `CloseForUpdate.afterPrompt` only started its wait on a resign-active followed by become-active. If iOS's
  prompt doesn't make iFizBox resign active, or the user taps Install then goes Home, the state stays `.prompt` for
  ever: no polling, no timeout, nothing closes iFizBox, and `signing.selfUpdate` never answers.
- This iPhone route: installd ends iFizBox while it installs over it, so if the reply came back at all iFizBox
  wasn't closed; both the queue and the single install then sat on a locked "Closing".

## What changed

- `screens/apprun.js`: `followSelf` for the self row. Hosted: locked "Waiting for iOS" (new `WAITING_LABEL`), a log
  line per `signing.selfUpdate` state (`SELF_UPDATE_LINES`), "Closing iFizBox" only at finished / guessed; still
  open `CLOSE_GRACE` (20 s) later, or a shell that can't be followed, ends on `CLOSE_BY_HAND` (close it from the app
  switcher) with Return. notStarted / stalled: `run.notTaken` turns the row Failed ("iOS didn't download it" /
  "iOS stopped downloading it"), the job goes back in the queue (quiet), the bar gets Close + Retry All, and the
  finish button is Try Again (signs and sends it again, followed again). This iPhone: `RESTART_BY_HAND` and Return.
  `phoneLanes` gets `selfUpdate` (signing-client's new `watchSelfUpdate`). No follow lane (jailbreak helper lanes):
  Closing, then the instruction after the grace.
- `core/apprun.js`: `run.notTaken(id, why)`.
- `signing-client.js`: `watchSelfUpdate`; `followSelfUpdate({ waiting, later })` turns a WAITING lock to Closing at
  finished/guessed and adds the grace and the by-hand end; the single install's hosted lock uses WAITING_LABEL; its
  This iPhone self route ends unlocked with `RESTART_BY_HAND` instead of a locked Closing.
- `nav/progress.js`: `WAITING_LABEL`, `CLOSE_GRACE`, `CLOSE_BY_HAND`, `RESTART_BY_HAND`; `lockSelfUpdate({ label })`.
- `native/Sources/Sideload.swift` `CloseForUpdate.afterPrompt`: the wait also begins on didEnterBackground, and
  after `promptGrace` (5 s) when iFizBox never resigned active, so it can't stay in `.prompt` for ever.

Tests: `web/app/screens/apprun-self.test.js` (followed states, label per state, unlock + Try Again on notStarted /
stalled, by-hand end, This iPhone, notTaken, watchSelfUpdate), `web/app/selfupdate-waiting.test.js` (single
install's Waiting -> Closing -> by hand, This iPhone self route unlocked).

## Tried and dropped

- A node test of the single install's hosted path end to end: `installOnDevice` shows a banner (nav/banner.js) that
  needs a DOM; the follow it hands to is tested directly instead.

## Not verified

- On a phone: no device update was run (needs a signed build of two versions and a phone to update; the task is
  web + native logic). Whether iOS's itms-services prompt resigns active on iOS 26/27 is still unknown; the 5 s
  grace covers both cases either way.
- The native change compiled in the gate's builds (iFizBox.deb and iFizBox.ipa built here), but it was not run on a
  device.
