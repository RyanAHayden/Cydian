# T41: gate builds native before the tests

## What I did
- `tools/check.sh`: moved the native build block (`native/build.sh --probe` then `make -s -C native package`) from the
  end of the gate to just above the unittest loop, with a comment on why: `test_intents.Built` and `test_share.Built`
  check `native/build` and skip when it is older than their sources, so building last made them skip on a cold run
  and test the previous build on a warm one. Header comment updated to say the native builds come first.

## Checked
- `native/build.sh --probe` passes on this machine (toolchain present).
- After `make -s -C native package` in this worktree, `unittest -v` on `native/intents` and `native/share` shows
  `Built.test_jailbreak_app`, `Built.test_ipa_carries_the_both_modes_intents`, `Built.test_deb_app`, `Built.test_ipa`
  and `Built.test_ipa_handoff` all `ok` (not skipped).
- Full gate via `run done`.

## Left alone
- `native/share/test_share.py`'s skip message still says "tools/check.sh builds it after the tests"; that file is
  not on this task's line, so the stale wording stays (harmless: the skip only shows without a toolchain now).

## Not verified
- A truly cold worktree (no `native/build` at all) through the whole gate: this worktree already had a build
  from an earlier run, so the cold case was only reasoned about (the build now precedes the tests, so it produces
  fresh outputs before `built()` is evaluated).
