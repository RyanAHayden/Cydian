# T17: test_sideload.Sideload.test_signed_with_edits failing under load

## What it raced

The test's own checks don't depend on timing. It reads `edited.ipa`, which the Swift test binary wrote, and verifies
it with openssl against the test CA, whose certificate validity starts days in the past. It shares no ports, and every
file it uses is in its own `mkdtemp`. R35's failed merge gate
(`~/repos/iFizBox/.runner/gates/5230306f…-923d2412d932.failed`, read only) shows the real cause.
`Sideload.setUpClass` could not build the Swift binary:

    <unknown>:0: error: error closing '/tmp/TemporaryDirectory.VC3aRq/IPASigner-1.o' for output: Disk quota exceeded
    error: autolink-extract command failed with exit code 1

So `build_error` was set, and `test_signed_with_edits`, `test_swift` (T15) and `test_ocsp_request` (T16) all failed
on `assertIsNone(self.build_error)`. What it raced was the per-user quota on the `/tmp` tmpfs. Every slot's gate
shares that quota, and `swiftc -O` writes its objects to `$TMPDIR` (`/tmp`).

## Why there's no code change here

Two open branches already move `native/test_sideload.py` off `/tmp`, and that is the fix this test needs:
- `origin/task/T14` adds `disk_tmpdir` and `swift_env` in `test_sign.py`, so the scratch dir sits on the disk and
  swiftc's and the binary's `TMPDIR` point into it.
- `origin/task/T15` adds `native/disktmp.py` with `build_dir` and `swift_env`, the same idea.

A third copy of those lines here would conflict with both branches for no gain. T16 made the same call. I blocked T17
`--after T14`. Once it reopens, check that `native/test_sideload.py` on main builds outside `/tmp` (with either
branch's helper), run `python3 -m unittest native.test_sideload` or the gate, and tick it.

T14 and T15 edit the same lines of test_sideload.py in two different ways, so whichever merges second will conflict.
Its session has to take the version that is already on main.

## Not verified

- I did not reproduce the quota failure. Filling the shared `/tmp` would break the other sessions on this machine.
- I did not run test_sideload with T14's or T15's change from this worktree. Their journals report it passing.

## Reopened after T14 landed

`native/test_sideload.py` on main now imports `disk_tmpdir` and `swift_env` from `test_sign.py`. Its scratch dir is
under `native/build/tmp` on the checkout's disk. Both swiftc and the test binary run with `env=swift_env(cls.tmp)`, so
their `TMPDIR` is inside that dir too. Nothing in the module uses `/tmp` any more (I checked with a grep for `mkdtemp`,
`gettempdir` and `subprocess.` calls). No code change was needed.
`python3 -m unittest -v test_sideload` in `native/`: 9 tests OK in 19.6 s, `test_signed_with_edits` included, while
other slots were running.

## Not verified (reopened session)

- I still did not reproduce the original quota failure on purpose, for the same reason as before: filling the
  shared `/tmp` would hurt the other sessions. The fix takes the build off `/tmp`, so that quota no longer applies.
