# F221: Re-sign for apps marked as installed

User 2026-11-18: "even apps marked as installed should have a resign option, they dont as of now".

## What I did

- `core/appqueue.js`
  - `modifyActions({ ..., onSource })`: a marked app (installed record, no signature of iFizBox's) whose installed
    version is still on its source gets "Re-sign" in the sideload and site builds. Jailbreak build unchanged; a
    signed app still gets one Re-sign button.
  - `markedVersionOnSource(pkg, installed)`: that version's entry (a downloadable IPA, not an itms-services link), or null.
  - `markedResignJob(pkg, installed, { source })`: appJob for that version with `mode: "resign"`.
  - `createAppQueue().add` keeps a resign job's `url` (and size) when it has one; F91's record re-signs still have none.
- `screens/altstore.js`
  - Sideload `appPageAction`: `onSource` computed only when there is no signed record; Re-sign on a marked app
    queues `markedResignJob` (Confirm lists it under Re-sign).
  - Website `siteModify`: Re-sign signs the installed version in the browser via `siteInstall` (the same path
    as Downgrade).
- `screens/queue.js` `resignApp` (not on the task's file list, but it is the only place the run is routed;
  a 5-line addition at the top of the function): a job with a `url` is installed as an Install would be
  (`installOnDevice`, or `signAndInstall` for iFizBox's own IPA). Native `signing.install` saves a SignedRecord
  (native/Sources/Sideload.swift:258), so the app is a signed one with a normal days-left pill afterwards.
  `recordApp` still skips resign jobs: the installed version doesn't change.
- `screens/installed.js`: `withSignatures(..., { marked: true })` (the sideload list only) gives a row with no
  signature record `sig: MARKED_SIG` (grey "?", state "unknown") and `marked: true`; not for iFizBox's own row, a
  row iOS no longer has (`actual === null`), or with Show Expiry Dates off. The subtitle is
  `markedSubtitle`: "Version x · Marked as installed".
- `packages.css`: `.sig-pill[data-sig="unknown"]`, a grey version of the pills' gloss.
- Tests: new `screens/markedresign.test.js` (modifyActions per build, the job, the sideload and site sheets, the
  run going to signing.install with the source IPA against a fake native backend, the Installed pill). Updated
  `marknotinstalled.test.js` and `resignqueue.test.js`, whose marked apps' versions are on the source, so their
  sheets now have Re-sign.

## Decisions

- The '?' pill is only in the sideload app's Installed list: on the website there are no signature records, so
  every row would carry a '?', which says nothing. The brief's pill wording reads as the sideload list.
- A marked app with an unknown version ("") gets no Re-sign: there is no version to look up on the source.

## Not verified

- On a phone: the sideload IPA build doing a marked app's Re-sign end to end (download, sign, iOS install over the
  app with data kept, then the green pill). No sideload test phone in this task; covered by unit tests with a fake
  native bridge only.
- The grey pill's look at 3x: not rendered in a browser; the gradient copies the existing pills' stops in greys.
- Website Re-sign when website installs are still gated: it goes through `siteInstallVersion` like Downgrade,
  which falls back to its first install row; not clicked through in a browser.
