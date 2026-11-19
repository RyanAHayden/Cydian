# T14: test_sign.OnDeviceSigner.test_swift failing under load

## What it raced

F261's merge-gate log (`.runner/merge-gate.log` in the main checkout) shows the failure was not a timeout. swiftc
failed to build the test binary:

    error closing '/tmp/TemporaryDirectory.VC3aRq/IPASigner-1.o' for output: Disk quota exceeded

On this machine `/tmp` is a 16 GB tmpfs mounted with `usrquota`, and every agent session's scratchpad sits on it
(`/tmp/claude-1000` held 11.7 GB of the 12 GB used when I looked). The test put its whole build in `/tmp`
(`tempfile.mkdtemp`), and swiftc -O wrote its objects to `$TMPDIR`, which is also `/tmp`. When the other slots' gates
and sessions were writing at the same time, the per-user quota ran out halfway through the build. So the shared
thing being raced was `/tmp` space, not time.

## Fix

- `native/test_sign.py`: new `disk_tmpdir(prefix)` makes the scratch dir under `native/build/tmp/` (gitignored, on
  the checkout's own disk, one per worktree). New `swift_env(tmp)` sets `TMPDIR` inside that dir, so swiftc's
  `TemporaryDirectory.*` and the signer binary's own temp files (openssl, unzip) stay off `/tmp` too.
  `OnDeviceSigner` uses both.
- `native/test_sideload.py` and `native/test_updates.py` build the same Swift sources the same way, so they would
  hit the same quota next. I made the same change there (one line each plus the import). The root cause is the same,
  so I kept it in this task rather than filing two more flaky-test tasks.
- No timeout was changed.

## Check

The three test modules, run with `TMPDIR=/nonexistent-t14`: anything still writing to the default temp dir would fail
there, so a pass shows the build and run stay off `/tmp`. Result: 18 tests, OK, none skipped, 50 s. `native/build/tmp/`
was empty afterwards (tearDownClass removes each dir). Then the full gate through `agent-runner done`.

## Not verified

- I could not reproduce the quota failure on purpose. Filling the shared `/tmp` tmpfs would break the other sessions
  on this machine. The fix removes the dependency on `/tmp` instead, and the `TMPDIR=/nonexistent` run checks that.
- Other gate steps still use `/tmp` (`mktemp -d` in tools/check.sh for zsign, the `make package` build in
  native/build.sh, other tests' `mkdtemp`). They were not part of this failure, and they write much less than a
  swiftc -O build. I left them alone.
