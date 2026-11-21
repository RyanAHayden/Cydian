# T63: cancelApply test robust under load

## What failed

`F64 cancelApply while apt downloads stops the run before dpkg` failed twice in merge gates (B213's on 2026-11-20,
and one on 2026-11-18), the same way both times: 20 016–20 018 ms, on the "Cancel ends the wait" assertion. The
assertion before it (exit code 130) passed, so the helper's shell *was* killed by the cancel. What kept the run open
for the full `FAKE_DLWAIT=20` was the fake helper's `sleep 20`: it survived the process-group SIGTERM, and it held
the helper's stdout, stderr and fd 3 open. fake-native resolves `helper.run` on the child's `close`, which waits for
every pipe to close.

## Fix

- `native/fake/ifizbox-helper`: the `FAKE_DLWAIT` sleep runs with stdin, stdout, stderr redirected and fd 3 closed,
  so even a sleep that outlives the cancel holds none of the helper's pipes. The run ends when the shell dies.
- `web/app/backend-native-queue.test.js`: the test now forces that case every run instead of leaving it to load.
  A `sleep` put first on the helper's PATH ignores SIGTERM and writes its pid. The test cancels once that pid file
  exists, so the cancel lands while the sleep runs. `t.after` kills the sleep and removes its directory.
  `untilFile` waits up to 10 s for the file, so a helper that never gets there fails the test instead of hanging it.

Checked: with the old helper line and the new test, the test fails exactly as in the gate (20 015 ms, same assertion).
With the fix it passes: 8 runs alone, then 16 copies of the whole file running at once, 0 failures.

## Tried that didn't reproduce it

- A node script that sends a group SIGTERM to `sh -c 'printf | while …; sleep 3'` on its fd-3 line (as
  helper.cancel does): 0 survivors in 300 runs idle, then 0 in 3 600 runs across 24 copies running at once.
- `/bin/sh` (bash) doesn't catch SIGTERM (`SigCgt` in /proc), so bash deferring the signal past its fork isn't the
  cause either.
- With a plain SIGTERM-ignoring sleep and the old cancel timing (on the dlstatus line), the test still passed: the
  cancel nearly always lands before bash starts `sleep`. That's why the test now waits for the sleep's pid file.

## Not verified

- How exactly the real `sleep` escaped the group signal under load. I couldn't reproduce it (see above). The fix
  doesn't depend on that: whatever lets a sleep survive, it no longer holds the pipes.
- The full gate under the other slots' load: `run done` runs `tools/check.sh` once.
