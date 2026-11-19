# B45: normal runs end on "Close"; "Close iFizBox" only when iFizBox upgrades itself

## What changed
- `core/queue.js` FINISH_LABEL.return is now `"Close"` (B35 had made it `Close ${NAME}`). reopen keeps `Close ${NAME}`.
- `nav/progress.js`: `finish()` and `progressHUD()` default to `"Close"` (the unused NAME import went).
- Nothing produced the reopen level: grep `reopen` in `native/` and `backend-native.js` finds only Cydia's
  `finish:reopen` protocol parsing (intents/Core.swift, the daemon), no frontend producer. Wired it up in the
  frontend: `core/progress.js selfLevels(jobs)` returns `["reopen"]` when a run installs iFizBox's own package
  (PACKAGE / BUNDLE_ID, not a removal, not `.share`-style suffixes), else `[]`.
  - `screens/queue.js runConsole`: `chooseFinish({ levels: [...levels, ...selfLevels(jobs)] })`, so a queue run
    holding iFizBox's own .deb ends on Close iFizBox (a tweak in the same run still wins with Restart SpringBoard).
  - `screens/ipa-install.js ipaFinish` takes `bundleId` (runIpaConsole passes `r.bundleId`): iFizBox's own IPA
    ends on reopen; any other IPA on return ("Close", no action). B61's Restart SpringBoard after a fresh AppSync
    is kept (uicache first, as B61 verified on the 7); a backend that can't respring now gets Close plus the note.
  - IPA installs no longer end on Reload Data (per the user's B59 note: installd puts the icon on the home screen
    itself). Reload Data stays for .deb apps (packageKind "app" in queue runs).
  - Sideload: `signing-sheet.js followInstall` ends on `FINISH_LABEL.reopen` when the bundle id is iFizBox's own,
    else progressHUD's plain Close. (signing-sheet.js wasn't on the task's file list; a 3-line change, needed for
    "both the jailbreak and sideload apps".)
- The reopen button has no action of its own: the native shell's `Replaced` watcher (App.swift) already closes
  the app within ~3 s once its Info.plist on disk changes, and Sideload.swift exits after iOS's install prompt.
  So the button mostly won't be seen; if it is, it closes the sheet and the watcher closes the app.
- Comments fixed in screens/queue.js, screens/ipa-install.js, core/queue.js.

## Tests
- core/progress.test.js: selfLevels: a normal apt run -> Close, a .deb app -> Reload Data, iFizBox's own
  package -> Close iFizBox, removal / other IDs / failed run -> not reopen.
- screens/ipa-respring.test.js: normal IPA (no/other bundle id) -> Close, no action, no uicache; iFizBox's own IPA
  -> Close iFizBox; B61 respring cases updated (Close instead of Reload Data where they fell back).
- nav/progress.test.js, signing-sheet.test.js: Close by default; sideload own-bundle -> Close iFizBox.
- `node --test web/app/`: 1397 pass, 0 fail.

## Tried / failed
- The first own-bundle case in signing-sheet.test.js got null: progressHUD carries a new job onto a page still up.
  Closed the first fake page before the second job.
- Process slip: one edit of nav/progress.js was made with a python heredoc instead of the edit tool (the change
  itself is the three lines listed above; checked by grep afterwards).

## Not verified
- On a phone: no device run (the task didn't call for one, and the iPhone 7 is shared). Not seen: a real
  self-upgrade of the .deb or IPA showing Close iFizBox before the Replaced watcher exits the app, and a real
  IPA install ending on Close.
- Whether apt upgrading iFizBox as a *dependency* of something else (not a queued job) ends on reopen: selfLevels
  only looks at the queued jobs, so it wouldn't; the native watcher still closes the app.
