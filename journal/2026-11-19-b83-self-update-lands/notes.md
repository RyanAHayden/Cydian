# B83: the sideload self-update closes iFizBox only once iOS has the IPA

User report (2026-11-19, 0.9.8 to 0.9.9): the first two Upgrades showed the progress page and the "iFizBox Updated"
notification, but iFizBox opened still on the old version; the third worked; another app was installing at the
same time. Read from the code: `CloseForUpdate` posted the notification on a fixed 8 s timer and exited as soon as
iOS's prompt was answered, without knowing whether iOS had downloaded the IPA from `/sign/host`. With iOS's queue
busy, the user tapped the notification first and opened the old app, which iOS won't install over.

## What changed

- **Worker** (`worker/src/index.js`, `hosted()`): `/sign/host/<t>/manifest.plist` and `app.ipa` retry the KV read
  for `HOST_WAIT` (6 s, `waitFor`, scaled by `WAIT_SCALE` in tests) before the 404, covering KV's eventual
  consistency right after the POST's put. iOS's requests leave F190's marks (`manifest`, `started`, `finished`) under
  `<t>.ios` (`markIos`/`iosStatus` now take the key; `/sign/up`'s calls are unchanged). `app.ipa` streams 1 MB a
  pull, so `finished` is written when the last chunk is pulled (iOS has read all but the last MB or so), not when
  the response object is made. New `GET /sign/host/<t>/status` -> `{manifest, started, finished}`.
- **Native** (`Sideload.swift`, `CloseForUpdate`): after the prompt is answered, KeepAlive (silent audio) and a
  poll of the status URL every 2 s (derived from the POST's `manifest` URL). `finished` -> notification "Finishing
  the iFizBox Update / iOS has the new version and is installing it. Tap to open it." 3 s later, then exit.
  Not `started` within 120 s -> `notStarted`; started but not finished within 600 s (link TTL) -> `stalled`; both
  keep iFizBox open, release KeepAlive, and (from the background) post "didn't start/finish". Three 404s from the
  status route (a Signing Server without B83, e.g. a self-hosted older Worker, or ifizbox.com before this deploys)
  fall back to the old 8 s close (`guessed`). New bridge call `signing.selfUpdate` streams `{state}`.
- **Web**: `signing-client.js followSelfUpdate` follows `signing.selfUpdate` on the locked "Closing iFizBox" page
  (a line a step); `notStarted`/`stalled` -> `nav/progress.js unlockSelfUpdate`: the error, title "Not Updated",
  Try Again (re-runs the same install). The pre-prompt banner now says to keep iFizBox open until it closes itself.
- **Launch banner**: `core/selfupdate.js recordSelfUpdate` keeps the version handed to iOS (both the Upgrade path
  and the IPA queue run's `openPrepared` host path); `essential-ui.js unfinishedOnce` (first `lookForUpdates` of a
  page load, sideload only) shows "iFizBox X didn't finish installing." with Try Again (`bannerUpgrade`) when
  app.info is still older; it replaces the "X is out." banner for that check. Records older than a day are dropped.
- Docs: `docs/signing.md` and `worker/README.md` (outside the task's file list, a paragraph and a table row).

## Tests

`worker/test.mjs` "worker host status": marks written once each (3 writes), HEAD and a short Range don't finish,
`finished` false after the first MB and true after the last byte, KV lag on manifest and app.ipa waited out, 404
after the wait. `web/app/signing-client-selfupdate.test.js`: follow lines, Try Again on notStarted/stalled, older
shell, pending record, launch banner. Native builds (`make -C native package`) pass.

## Not verified

- **On a phone**: the brief asks for a sideload upgrade while another app installs, confirming iFizBox opens on
  the new version the first time. Not done: the only test phone here is the iPhone 7 running the jailbreak app (not
  for this, docs/iphone7.md), and this unattended run couldn't ask the user for a phone with the Lite build.
  So these are unchecked on iOS: that the poll keeps running in the background under KeepAlive, the notification
  wording/timing, that iOS installs once iFizBox exits after `finished`, and the Try Again flow.
- **On Cloudflare**: the KV retry and marks ran only against the in-memory KV in `worker/test.mjs`. Unchecked:
  whether the edge caches the status key's first "not found" read (KV caches reads ~60 s), which could delay
  `started`/`finished` by up to a minute; the 120 s/600 s limits leave room for that. The Worker deploys from main
  (Workers Builds), so until this merges the app falls back to the 8 s close (three 404s).
- `followInstall`'s own-app branch (`signing-sheet.js`, not on the file list) and the IPA queue run page
  (`screens/apprun.js`) don't follow `signing.selfUpdate`; the native side still waits for `finished` before exiting
  and the launch banner still catches a miss there.
