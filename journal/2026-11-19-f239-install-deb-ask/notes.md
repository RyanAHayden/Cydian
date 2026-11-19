# F239: the queue run asks about conffiles for shell-fetched .debs

## What changed

- `ifizbox-helper install-deb-ask <path.deb>`: install-deb as apply-ask is apply. The plan
  (`policy.c` local_deb_plan) drops `--force-confdef`/`--force-confold` and refuses without fd 3. `main.c` keeps the
  caller's stdin on a high fd for it (as for apply-ask), and `paid.c` runs apt-get on the root-owned copy through
  a callback (`helper_local_deb_ask`, with main.c's `ask_relay`) instead of its own fork and exec, so only `Y`/`N`
  reach dpkg and `C` cancels, exactly as apply-ask. The copy's directory goes afterwards either way.
- A new verb rather than a flag on install-deb: Apt.swift already picks the stdin pipe by the first word, and a
  word the helper doesn't know is refused (64) rather than silently run without asking.
  `HV_INSTALL_DEB_ASK` went at the end of the enum so the merge with other helper work stays clean.
- `Apt.swift` Helper.run: install-deb-ask gets the stdin pipe too (helper.answer / helper.cancel write into it).
- `share.debInstall {ask: true}` (ShareBridge.swift) -> `ShareRun.installDeb(ask:)` (Share.swift) runs
  install-deb-ask. These two files weren't in the brief's file list, but share.debInstall is the only road to
  install-deb (the staged file's path never reaches JS), so the flag had to go through them.
- `backend-native.js` queueInstall sends `ask: Boolean(onEvent)`: a run with an event handler (the queue run page)
  can answer; without one nobody can, so plain install-deb (dpkg keeps your copy) as before. The queue run page
  (screens/queuerun.js) already handled `pmconffile:` lines for any row, so no UI change was needed.
- No fallback for an older helper: the app and helper ship in one .deb.

## Tests

- `native/helper/test_helper.py` LocalDeb: `test_plan_ask` (argv, needs fd 3, one path, path checks) and
  `test_chain_ask` (the real helper on Linux with a fake apt-get that prints a pmconffile line and reads stdin:
  Z/D dropped, N and Y passed, end of file when the caller closes; CYDIA set; copy gone).
- `web/app/backend-native-queuerun.test.js`: share.debInstall gets `ask: true` with onEvent, `false` without.

## Device check (iPhone 7)

See below.

## Not verified

See below.
