# T24: test_uninstall.UninstallApp robust under load

## What it raced

Not time. B116's merge gate log (`~/repos/iFizBox/.runner/merge-gate.log`) shows `setUpClass (test_uninstall.UninstallApp)`
failing in `build()`: `cc` exited 1. In the same run, `test_remove_malware` hit
`OSError: [Errno 122] Disk quota exceeded` copying the driver into `/tmp/...`. `/tmp` on this machine is a tmpfs mounted with
`usrquota`, and every agent slot, gate, native/wasm build and Claude scratchpad shares it (5 GB of scratchpads alone when I looked).
When something else filled it, `cc` couldn't write the test binary or its own temp files. Run alone later, `/tmp` had room, so it passed.

The shared resource is the `/tmp` quota. The other suspects are fine: the 10 s `poll` in test_driver and the 30 s subprocess
timeout never fired. 48 copies of the test run in parallel on 16 cores all passed.

## Fix

`native/helper/scratch.py` (new): `Scratch()` makes a folder under `native/helper/build/tests/` (gitignored, on the
checkout's disk, a realpath because the helper compares `/proc/<ppid>/exe` with its built-in prefix). It points `TMPDIR` there,
so cc's temp files go there too, until `close()`. `test_uninstall.py` uses it from setUpClass, with `addClassCleanup`
so `TMPDIR` comes back even when setUpClass fails.

## Checked

- `python3 -m unittest -v test_uninstall`: 4 tests OK, and `build/tests/` is empty afterwards.
- A full `/tmp`: in `unshare -rm`, I mounted an 8 KB tmpfs on `/tmp` and filled it. The new test passes. The old test
  (HEAD's copy) fails with the same `setUpClass` `CalledProcessError` as the merge gate.
- `tools/check.sh` through `agent-runner done`.

## Not verified

- The disk holding the checkout filling up would still break the test, as it would break anything. That isn't
  a race on a shared quota.
- T22 (`test_remove_malware`) and T23 (`test_udid`) failed in the same gate for the same reason. They are their own tasks,
  so I only noted on each that `scratch.py` is the fix.
