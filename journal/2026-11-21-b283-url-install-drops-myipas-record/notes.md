# B283: a URL install drops the app's My IPAs record

## Decision (unattended)

When you Reinstall from My IPAs, it writes a device record (`key: library:<file>`, `sourceName: "My IPAs"`). An install
of the same app from a URL afterwards (an `ifizbox://install` link, or another sideloader's IPA link) wrote nothing, so
that record kept the app's page on "Source: My IPAs".

There were two choices: **drop the library: record**, or write a source-less one. I picked dropping it:

- The app then reads exactly as a fresh URL install does today: the signed-only row ("Signed by iFizBox", the signed
  record's days) and its page. Writing a source-less record would give every link install a new look that has no
  source line and no icon. That look change belongs in its own task.
- `keptIpa` (`keptIpaOf`) finds My IPAs' signed copy by bundle ID from `library.list`, not through the device
  record, so Save Signed IPA stays. Re-sign reads `r.signed`, which is the URL's signed record. Both are covered by a
  test.

## What I did

- `screens/installed.js`: added `libraryRecord(rec)` and `dropMyIpasRecord(answer, { store, signed })`. The record goes
  only when all of these hold:
  - the install answered with a bundle ID;
  - the shell's signed record for that ID exists and is not a My IPAs one (so the URL install really landed);
  - the device record is a My IPAs one (no source, key `library:`).
  A source's record stays, because Changes and Update read it. The jailbreak build and the website have no signed
  records from the shell (`signedApps` gives null), so nothing is dropped there.
- `incoming.js confirmInstall`: passes `onInstalled`, which starts the drop from the install's own answer. That way a
  run that waits for a connection (`rememberInstall`) drops it too when it later lands. The B281 reload waits for the
  drop. A drop that fails is ignored. `drop` can be injected through `handleIncoming` deps the same way `reload` is.
- Two existing tests compared the install argument with `deepEqual`. They now compare `url` and `name` only, because
  the argument now carries `onInstalled`.
- Tests: `web/app/screens/installed-myipas-drop.test.js`.
- Filed **B285** (low): in the jailbreak build, the helper install's `rememberIpa` keeps an existing My IPAs record,
  so the same "Source: My IPAs" stays there.

## Spec review

- If a run waits for a connection (`rememberInstall`), it lands only after `confirmInstall` has already reloaded.
  Its drop then fired only `onAppsChange`, so an open app page could stay on "Source: My IPAs". Fixed: a drop that
  starts after the link has returned now reloads Installed (`reloadSigned`) again. There is a test for this.
- On the signing-server route, `onInstalled` fires once iOS's install prompt shows, not once iOS has the app. The drop
  happens then, after the shell's signed record already names the URL. So if the person cancels iOS's prompt, the
  page reads as the URL install, matching the signed record. The comment now says this instead of "the install did
  land".

## Tried and failed

Nothing failed.

## Not verified

- I did not check on the iPhone 15 Pro. Repeating R56 run 8a needs three things: a My IPAs install, then an
  `ifizbox://install` link served over https through `tailscale serve`, and the phone lock. That is about half an hour
  of setup for a low-priority follow-up. The node tests cover the decision and the wiring. Not covered: whether the
  native `onInstalled` answer's `bundleId` matches the device record's `id` on the phone. Both come from the same
  `result.bundleId` that My IPAs records with, but that is read from the code, not seen on the phone.
- I didn't test the "Copy" (new bundle ID) choice: the answer then carries the new ID, the My IPAs record keeps the
  original ID, and that record stays, which is correct because it is a different app.
