# B65: the black page's log floods during IPA installs and re-signs; Re-sign stuck at 50%

## The flood: two causes

1. `core/progress.js hudLine` only took a percent off the **end** of a label. Re-sign's labels
   (`core/signing.js resignLabel`) put it in the middle: `Signing 45% Partyboard (2 of 3)`. So the text changed on
   every percent and `nav/progress.js progressHUD`'s `set()` wrote a new step line each time.
   Fix: `hudLine` now pulls a percent standing anywhere (a whitespace-separated `NN%` or `(NN%)` token), so the
   text stays the same for the whole phase. Every caller of `hudLine` benefits (progressHUD, bulkHud). I kept
   `resignLabel`'s wording as it is (its test and the status line still show the percent where it reads well).
2. `screens/installed.js bulkHud` (Manage's runs, My IPAs' bulk sign: the "Downloading 12%" lines the user saw
   for every app) wrote **every** `set()` to the log as a raw line, percent included. It now logs the phase text
   (percent taken out) once each time it changes.

Other `h.set` callers checked: `signing-client.js` (installOnDevice / installFromLibrary use `phaseLabel`: trailing
percent; signAndInstall's `pct()` and the worker's "Signing": trailing or none; `watchInstall`'s steps: no percent),
`signing-sheet.js` (phaseLabel, "Done"), `signed-apps.js resignAll` (resignLabel, now fixed by hudLine). None
had the same problem once hudLine handles a middle percent.

## Stuck at 50%

Partyboard has two bundles (the app and one extension). The signer (`native/sign/IPASigner.swift`) sent
"signing" progress only once per bundle, so 50% = the extension done, the main bundle being signed. Nothing more
comes until it ends (then "installing", which shows as "Installing Partyboard"). So the stop was inside signing the
main bundle: its loose Mach-Os (Frameworks), its CodeResources or its executable. Which of these, and whether it was
slow or truly hung, I couldn't find without the phone (see Not verified). What changed:

- The signer now also sends progress per loose Mach-O of a bundle and before its executable, so a big main bundle
  moves the bar instead of sitting at 50%; it also checks Cancel before each loose Mach-O.
- `Sideload.resign` (signing.resign / resignAll) now has a `SignJob` per app, so `signing.cancel` stops it (the
  download, the signer at its next step, the serving), and a cancelled app ends the whole run with
  `cancelled: Cancelled`. Before, re-sign had no job at all: Cancel did nothing to it.
- It also streams the shell's console lines (`{log}`: Downloading/Downloaded, certificate, profile, "Signed X",
  serving, manifest), as signing.install does; `queue.js resignApp` puts them on the page as raw lines. The next
  time a re-sign stops, the log shows the last step that finished.
- `core/signing.js callWithStall`: the re-sign bridge call fails with code `stalled` and
  "Partyboard stopped at Signing 50%: nothing moved for 3 minutes, so it was cancelled." when a phase before
  "installing" sends no progress for `STALL_LIMIT` (3 min), and calls `signing.cancel`. "installing" (iOS's own
  install) is not timed: the shell already ends it after 15 min (serveChecked). Used by `queue.js resignApp`
  (Manage / queue Re-sign) and `signed-apps.js resignAll`.

Decision (unattended): 3 minutes. The signer sends progress at least per Mach-O now; one Mach-O taking 3 minutes on
an iPhone 7 would itself be a bug worth seeing as a failure.

## Tests

`web/app/resign-progress.test.js`: resign events for 3 apps (every percent, as Throttle sends them) through
progressHUD give one step line per phase per app and still move the bar; the queue's 1-of-1 path; an IPA install's
phaseLabel events; bulkHud logs each phase once; callWithStall's stall (message, signing.cancel, later events
dropped), installing not timed, answer and failure passing through. `installed-manage.test.js`'s bulkHud test now
expects the phase without its percent.

## Not verified

- **On the iPhone 7: Re-sign All over 3 apps.** Not done: the 7 runs the jailbreak .deb, where `signing.*` is
  refused (only the sideload build signs); testing needs the sideload IPA installed on it with a signing identity,
  which this unattended run can't set up. So the real cause of the 50% stop (slow vs. hung, and in which part of
  the main bundle) is not found; the new log lines and the finer progress are there to show it next time.
- If the signer is truly hung inside one call (e.g. `MachO.sign` of the main executable never returns),
  `signing.cancel` can't interrupt it: the page fails with the stall message, but SignBridge's queue stays busy
  until that call returns, so the next signing job waits behind it.
- signing.install / library.sign (IPA installs) have no stall limit; only re-sign does (the reported hang).
