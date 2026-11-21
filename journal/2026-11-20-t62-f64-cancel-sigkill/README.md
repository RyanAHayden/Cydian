# T62: F64's cancel test, robust under load

## What failed

B213's merge gate (and an earlier gate, `20dee1a…`) failed
`F64 cancelApply while apt downloads stops the run before dpkg` in `web/app/backend-native-queue.test.js` after
20018 ms, on the `< 15000` assertion. `r.code` was already 130, so Cancel had run and the fake helper's shell had
died of the signal. Node's child `close` waits for every process holding the helper's pipes, though, and something
in the group lived through the whole `sleep $FAKE_DLWAIT` (20 s). The SIGTERM that `helper.cancel` in
`native/fake/fake-native.mjs` sent to the process group did not reach that `sleep`, or the `sleep` didn't act on it.

## What I tried

- 60 serial runs beside 48 busy loops, then 480 and 320 runs 16 at a time under the same load: no failure.
- A bare race (detached `sh`, group SIGTERM when its first fd-3 line arrives, 2000 runs, loaded and not): no
  survivor. Then a shell forking `sleep 3 &` in a tight loop, group SIGTERM at a random moment, 200 runs: no
  survivor either. My guess was bash blocking SIGTERM around `fork` (`/bin/sh` is bash 5.3 here). But the kernel
  queues a group signal to a fork in progress, and none of these runs showed a survivor, so that guess is unproven.
  strace isn't installed, so I couldn't watch it happen.

## The fix

The cancel no longer depends on any process acting on SIGTERM:

- `helper.cancel` sends **SIGKILL** to the helper's process group, through a new `killGroup` helper. SIGKILL can't
  be blocked, caught or ignored. SIGINT wasn't an option: a test runner started in the background leaves it
  ignored.
- When a cancelled helper exits, its group gets SIGKILL **again**. This is triggered by the `exit` event, not a
  timer, so a process that slipped past the first kill can't hold the pipes open after that.
- The fake helper takes a new `FAKE_DLWAIT_STUBBORN=1`: its download wait runs in a subshell that ignores TERM and
  INT. A new test, `F64 cancelApply ends the run even when the download wait ignores SIGTERM`, turns the gate's
  failure into a check that fails every time on the old code: in a scratch worktree of HEAD with only the test and
  the fake helper copied in, it failed after 20018 ms, the same as the gate. With the fix it passes in about 7 ms.

No timeout was widened. The exit code is still 130 for a cancelled run.

## Not verified

- I never reproduced the original gate failure on this machine (about 860 loaded runs), so the exact way the
  `sleep` outlived the SIGTERM is unknown. The fix covers every way a process can survive SIGTERM (blocked, caught,
  ignored, pending), and the new test covers the ignored case for sure. If a gate still fails this test, the
  holder of the pipes is outside the helper's process group, and the next step is to log which processes are
  still alive when the test fails.
