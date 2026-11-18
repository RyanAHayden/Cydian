# T7: test_chain_apply_ask's "fds: 0 1 2 3 4 5 6 255" under load

## Finding

Nothing leaks into the spawn-ask chain. The extra fds were the stand-in apt-get's **own shell's** pipeline pipes.
The stand-in listed its fds with `ls /proc/$$/fd | sort -n | tr … | sed …`. To run that pipeline, sh (bash here,
`/bin/sh -> bash`) makes the pipes in the parent and keeps their ends open while it forks the later stages. If
`ls` reads `/proc/<shell>/fd` before the parent has closed them, it lists them. Fd 3 is the status fd, so the pipes
land on 4, 5, 6. That's exactly the failing line. 255 is bash's script fd, already allowed.

Reproduced outside the test (one CPU, a busy loop beside it):
`taskset -c 0 sh -c 'ls /proc/$$/fd | sort -n | tr "\n" " "'` ×200 → 168 runs show extra fds (`0 1 2 3 4`,
`0 1 2 3 4 5`). The new form `printf "fds: " >&2; ls -m /proc/$$/fd >&2` ×200 → all `0, 1, 2`.

Reading the code also rules out a real leak:
- main.c closes every fd from 3 up (4 up when fd 3 is the status fd) before anything else. `answers` is
  `F_DUPFD_CLOEXEC`.
- In `ask_relay`, `in[1]` and `answers` get `FD_CLOEXEC` before the fork, and the child closes `in[0]` after
  `dup2`. The helper has no threads, so nothing can open an fd during the fork.
- So the test process's parallel `subprocess.run` pipes and test_driver's pipes can't get past the helper's
  close loop on Linux.

## Change

`native/helper/test_helper.py`: the stand-in prints its fd list with one plain command (no pipe, no `$(...)`), so
the shell holds only its usual fds while `ls` reads them. A new `stand_in_fds()` parses the `ls -m` line ("0, 1, 2,
255, 3") for test_chain and test_chain_apply_ask. It also asserts 0-2 are there, so a parse that comes back empty
can't pass the check by accident. The check itself is unchanged: no fd above 3 but 255. No retry, no timeout.

## Tried

- Running the old test_chain/test_chain_apply_ask pinned to one CPU with 1 and then 3 busy loops (4 + 6 runs) didn't
  reproduce the failure end to end. Python, test_driver and the helper add enough scheduling slack. The fixed tests
  passed 6/6 in the same setup.

## Not verified

- The original end-to-end failure never showed up here (see Tried). So the fix rests on the standalone shell repro
  plus matching the fd numbers, not on watching that test turn from red to green.
- Not checked on macOS/iOS (no device run needed: this is the Linux stand-in, `/proc` only).
