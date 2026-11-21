# B236: Lite on iOS 27 records an install iOS fetched in full

## Problem

A queue install on iOS 27 (app page Install / Downgrade, Change Installed Version, Version History) ended
"1 installed" but Installed's record kept the old version. `recordWhen` (core/apprun.js) records a "Sent to iOS" row
only when `apps.isInstalled` says true, and on iOS 27 that call answers nil for every app (B229's
`Workspace.seesInstalls`), so the record never came.

## What changed

- `web/app/core/apprun.js`: rows carry `fetched` (false in `appRows` and on a retry). A row ends with
  `fetched: true` when the install call answered `handedOff: true`, which `signing/queue.js openPrepared` returns only
  on the shell's `{served: true}` (iOS has every byte of the IPA, B200). `.away()` (iFizBox in the background) is not
  a fetch and doesn't set it.
- `recordWhen(row, null)` is "now" for a fetched row with a bundle ID: iOS can't answer, and the fetch is the proof.
  - B170's cancelled install (the user's Cancel on iOS's prompt) fetches nothing, so it still waits.
  - A false (an iOS that answers and says it doesn't have the app) still waits, so older iOS keeps B156's
    ask-again behaviour, and a later false still undoes the record (B170's unrecord).
- `web/app/screens/apprun.js`: comment only. `followHandoff` already passes the null answer to `answered`, which
  calls `recordIf`; nothing else needed changing.
- Tests: `core/apprun.test.js` (fetched set from handedOff, reset on retry, recordWhen cases) and the new
  `screens/apprun-b236.test.js` (a 1.8.4 -> 1.8.3 downgrade gets recorded when isInstalled answers null; an
  unfetched row next to it doesn't; a fetched row iOS says false to waits until true).

## Choice made

The task offered "record on a fetched-in-full install" or "confirm through signing.installed / installd". I took the
first: it needs no native change, the shell already tells the page about the fetch, and installd isn't reachable
from Lite without LocalDevVPN (the This iPhone route already reports `installed` directly).

## Not verified

- On the iPhone 15 Pro (iOS 27): not run. It needs a Lite IPA built from this branch and a full install through
  iOS's prompt; the unit tests cover the path from the shell's answers (`handedOff: true`, isInstalled null) to the
  record. The native side (served event, nil isInstalled) is unchanged and was seen working in B232's run.
- An install iOS fetched in full and then refused (e.g. a bad signature found after download) is now recorded on iOS
  27; iOS gives no way to tell that apart there.
