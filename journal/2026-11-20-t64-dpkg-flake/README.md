# T64: the test `dpkg:` robust under load

## What `dpkg:` is

There is no test named `dpkg:`. B213's merge gate failed on one node test,
`F64 cancelApply while apt downloads stops the run before dpkg: nothing changes`
(`web/app/backend-native-queue.test.js`, 20 018 ms, assertion "Cancel ends the wait"). The repair session ended with
`FLAKE: F64 cancelApply while apt downloads stops the run before dpkg: nothing changes`, and the runner split that line
on spaces (`.runner/run.log`, 19:48:45: "found a flaky test … F64, cancelApply, while, apt, …, dpkg:, …"), so each word
became a "make the test robust" task: T62 (`F64`), T63 (`cancelApply`), T64 (`dpkg:`) are the same test.

## What I did

- Read the test, `native/fake/fake-native.mjs` (helper.run resolves on the child's `close`; helper.cancel sends SIGTERM
  to the helper's process group) and the fake helper's `FAKE_DLWAIT` sleep. The run took the full 20 s with exit 130,
  so the shell was killed but something holding its pipes (the `sleep`) lived on.
- Tried to reproduce it: a node script running the cancel path 150 at a time for 10 rounds (load average ~16), and a
  Python loop sending the group SIGTERM at random 0–4 ms after the line, 400 runs. 0 slow runs in both.
- Found T63 (slot s2) already on the same test with the same diagnosis, and a fix committed on task/T63: the
  `FAKE_DLWAIT` sleep holds none of the helper's pipes, and the test forces a sleep that survives Cancel every run.
  Doing it again here would only clash with that merge, so T64 makes no code change and waits for T63 to land.

## Reopened after T63 landed

- Main (f43fdb6c) has T63's merge: the helper's `FAKE_DLWAIT` sleep runs with `</dev/null >/dev/null 2>&1 3>&-`, and
  the test puts a SIGTERM-ignoring `sleep` on the helper's PATH so the escaped-sleep case is exercised every run.
- Ran the test on this branch (main + nothing): alone 38 ms; then 10 rounds of 24 concurrent `node --test` runs of it:
  240 runs, 0 failures. No further code change needed; T64 ticks with the journal only.

## Not verified

- The full merge gate under other slots' load: only the single test under my own load was run; `done` runs the gate.
- How the real `sleep` escaped the group signal: not reproduced here either (see above). T63's fix doesn't depend on it.
