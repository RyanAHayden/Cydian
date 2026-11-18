# F91: signature status and re-signs through the queue

User 2026-11-18: Installed shows how many days an app's signature has left (green/amber/red). Apps inside the re-sign
window show in Changes as needing a re-sign. Re-signs go through the queue, not a reinstall.

## What I did

**Status (core/signing.js)**
- `resignWindow(get)` reads the `resignReminder` setting. Default 2; Off (0) means only expired apps count.
- `signatureState(expires, { now, window })` returns `{ state, text, long, days }`. `state` is ok (outside the
  window), soon (inside it; the edge counts as inside) or expired. `text` is "Expired" / "Today" / "3 days";
  `long` is the app page's wording ("5 days left", "Expires today", "Expired").
- `needsResign(installed, { now, window, skip })` gives Changes' rows, soonest first. The pill text goes in
  `version` and the app's own version in `installed`. Each row has `change: "resign"`.
- `signedIndex(installed)` maps bundle IDs to records, by installed and by original bundle ID.
- `signedAppRows` rows now also carry `name` and `version`, so Re-sign All can queue them.

**Installed tab (screens/installed.js)**
- Sideload app only: every row Cydian signed shows the pill in place of the version (`withSignatures`, matched by
  installed or original bundle ID). The version moves into the subtitle.
- Signed apps the list doesn't remember (My IPAs, Custom Install under another ID) are listed underneath with
  "Signed by Cydian". They have no Delete, because Settings > Signing > Signed Apps forgets those.
- A row with an Upgrade badge keeps the badge and gets no pill: both would be crowded, and the upgrade re-signs it.

**Pill CSS (packages.css, appended)**: the tab badge's gloss and shadow without the white ring. Green, amber, or
`.badge`'s exact red. It applies to `.sig-pill`, `.cell.sig-row-*` details (the app page) and Changes' resign rows
(`.pkg-row[data-change=resign][data-sig]`).

**Changes (screens/changes.js)**
- "Needs Re-sign" is the first group, above Available Upgrades (`itemsOf(..., { resign })`). The search field
  filters it too.
- `resignNow()` calls `signing.installed` (sideload app only; [] on failure or with no bridge). An app that has an
  available upgrade is left out (decision: the upgrade signs it anew, and queuing both would only replace one job
  with the other).
- The tab badge is `badgeCount` = upgrades + re-signs. The icon badge follows it through ctx.setBadge →
  upgradeNotices.badge. At launch the sideload app always computes the badge, because signed apps can need a
  re-sign even with nothing recorded.
- Upgrade (N) counts both and queues both (`queueAll`: re-signs first, then upgrades). The Home Screen icon's
  Upgrade All (`upgradeEverything`) does the same.
- A change to the Re-sign Reminder setting reloads the list or the badge.

**Queue (core/appqueue.js, screens/queue.js)**
- Job mode "resign": `q.add({ ..., mode: "resign" })` needs no url (`op: "resign"`, `url: null`).
  `resignJob(row|record)` builds one. `appPlan` has `resigns`.
- `APP_MODES` and `APP_MODE_LABEL` are the app Confirm's groups. They are core/queue.js's modes without Remove
  (the sideload app can't remove apps) and with Re-sign. `modifications()` in screens/queue.js takes the modes as
  a parameter, and the apt Confirm is unchanged.
- The run: `installApp` passes a resign job to `resignApp`, which calls `signing.resign { bundleId, manifestServer,
  host? }` with a HUD (resignLabel without "(1 of 1)"). Cydian's own re-sign passes `host: true`, as its install
  does. `runOrder` already puts Cydian last. A re-sign records no version (`recordApp` skips it).
- Modify sheet (screens/altstore.js `appPageAction`): `modifyActions({ signed })` appends "Re-sign" for an app
  Cydian signed (`signedRecordOf`). The sheet also appears for a signed app that was never recorded as installed
  ("Install", "Re-sign").
- App page Installed section: a "Signature" row ("5 days left", drawn as the pill), second in the group.
- Settings > Signing > Signed Apps: Re-sign All now queues every app (`queueResignAll`) and opens Confirm.
  The old `resignAll` (signing.resignAll at once) is still in the file and exported, but nothing calls it.

**Native (Sideload.swift, sign/CertCheck.swift)**
- `signing.resign {bundleId}` uses Re-sign All's loop (`resign(c, pick:)`) with only that app's record
  (`SignedRecords.only`: by installed bundle ID, else by original). Same stream and reply shape. If Cydian has no
  record of the app, it fails with `not_signed:`.
- `resign()` now sets `hostServer` from the call's `host` param, as `install` does. Before this change, Re-sign All
  reused whatever `hostServer` the last install had left. Now it is nil unless asked, so a Re-sign All that
  includes Cydian serves Cydian locally, as any app. Re-signing Cydian alone through the queue passes `host: true`.
- Swift test: `SignedRecords.only` in native/sign/tests/sideload/main.swift ("signed records").

## Tests
- web/app/core/resign.test.js: pill states and texts, window setting, needsResign, signedIndex, resign jobs in the
  plan and run order, resignJob, Modify's Re-sign.
- web/app/screens/resignqueue.test.js: Changes' group, badge, resignNow, Upgrade (N) queueing; Installed's
  withSignatures; the app page's Signature row and Modify Re-sign; resignApp's bridge calls (host for Cydian,
  failures); runAppQueue order; Signed Apps' Re-sign All queueing; Confirm's Re-sign group (fake DOM).

## Tried / found
- native/test_sideload.py's Swift part (and test_sign.py's) is skipped by the gate on every machine:
  `web/signer/testkit.py`, its fixture kit, was deleted with the server in 9905b05. To run my Swift change, I
  restored `web/signer/` from 9905b05^ into the scratchpad (with an empty `__init__.py`; the old one imported the
  deleted fetch.py) and ran it with `uv run --with cryptography` and PYTHONPATH. All 6 passed: test_swift ("all
  passed", which includes the new SignedRecords.only checks), test_signed_with_edits and test_ocsp_request.
  I filed a follow-up to bring the kit back under native/ so the gate runs these again.

## Not verified
- On the iPhone: the pill, the Needs Re-sign group, the badge, and a real `signing.resign` with iOS's install
  prompt. This run has no device. The user tries it with a short re-sign window (Settings > Signing > Re-sign
  Reminder: 7 Days Before), or with Change Installed Version.
- The pill's look in a 3x render against the badge. No browser screenshot was taken in this unattended run; the
  colours are the badge's red plus green and amber gradients built the same way, not sampled from the kit.
- A Changes resign row opens `package:<bundleId>`. For an app no source has (My IPAs), that page reads "Package not
  found". It was not changed.
