# C8: remove what F183 left unreachable

F183 made iFizBox's own update a silent row in Changes, so the old F61/F86 install path had no callers left.

## Done
- `web/app/screens/queue.js`: removed `whenConfirmEnds`, its waiter list and `confirmEnded`. Both Confirm sheets'
  `close(how)` only passed `how` to the waiters, so `close` takes no argument now (6 call sites).
- `web/app/screens/essentialqueue.test.js`: deleted (it only tested that wait).
- `native/Sources/Bridge.swift`: removed `selfupdate.download`, and `app.quit` as well. The brief didn't name
  `app.quit`, but F61 added it for "Close iFizBox" after `runInstall`, and nothing in `web/` calls it now (grep). I
  kept `app.openURL` (F72, still used by incoming.js and essential-ui.js) and left the `SelfUpdate` enum name as it
  was, so the diff stays small. Its comment now says what is left.
- `native/helper/`: removed the `selfupdate` verb: `selfupdate_plan`, `helper_deb_path_ok` and `HELPER_DEB_PATH_MAX`
  (only selfupdate used them), `HV_SELFUPDATE`, its entry in `HELPER_VERBS`, the main.c usage line, the README rows
  and the "as selfupdate" mentions, and `test_selfupdate_plan`.

## Left as is
- `web/app/screens/resignqueue.test.js:136` has a comment that mentions essentialqueue.test.js ("as
  essentialqueue.test.js"). That file isn't on C8's file list, and a stale comment does no harm.

## Checks
- `cc -fsyntax-only` on policy.c: clean. `python3 -m unittest native.helper.test_helper`: 55 OK.
  `node --test web/app/screens/`: 234 pass. `tools/check.sh` is run by `done`.

## Not verified
- I didn't compile the Swift shell: this machine is Linux and has no Xcode or iOS SDK. The removal only deletes two
  `b.on` closures from inside one function body, so the risk is low.
- I didn't run anything on the iPhone 7: C8 doesn't touch a device.
