# T28: test_mode.Mode robust under load

## What it raced

B132's merge gate log (`~/repos/iFizBox/.runner/merge-gate.log`) shows `setUpClass (test_mode.Mode)` failing with

    /var/tmp/tmp6ph4qwsf/driver.c:8:1: fatal error: error closing /tmp/ccYOK65H.s: Disk quota exceeded

The race was nothing to do with time: the shared `/tmp` (a tmpfs with a per-user quota, used by every slot's gate and
session) was full. Python's `tempfile` had already noticed and fallen back to `/var/tmp` for the test's own
directory, but gcc picks its scratch directory itself (`$TMPDIR`, else `/tmp`) and wrote its intermediate `.s`,
`.o` and `.res` files there.

## Fix

`native/test_mode.py` builds with `-pipe` (no `.s` file) and runs cc with `TMPDIR` set to the test's own `mkdtemp`
directory, which has just been shown to be writable. The directory is now removed with `addClassCleanup`, so a
failed build no longer leaks it either (tearDownClass doesn't run when setUpClass raises).

Checked with `cc -v`: without the fix gcc names `/tmp/cc*.s`, `/tmp/cc*.o`, `/tmp/cc*.res`; with `-pipe` and
`TMPDIR` it names only files in the given directory. `python3 -m unittest -v test_mode` passes 5 of 5.

## Follow-up

The helper and daemon C tests (`native/helper/test_helper.py`, `native/daemon/test_*.py`) compile the same way and
also broke on the quota in B132's gate runs. Not in this task's scope: filed as T29.

## Not verified

- A gate run with `/tmp` actually at its quota: I can't fill the shared tmpfs without breaking the other slots.
  The `cc -v` check above shows the compile no longer touches `/tmp` at all, which is what failed.
- If the filesystem holding the test's own directory is full too, the build still fails; that is a full disk, not a
  race, and no test can avoid it.
