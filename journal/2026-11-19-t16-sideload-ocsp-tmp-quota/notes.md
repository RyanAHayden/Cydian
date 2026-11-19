# T16: test_sideload.Sideload.test_ocsp_request failing under load

## What it raced

R35's failed merge gate (`.runner/gates/f7f93a99…-923d2412d932.failed` in the main checkout) shows that the test
itself was not at fault. `Sideload.setUpClass` could not build the Swift test binary:

    <unknown>:0: error: error closing '/tmp/TemporaryDirectory.I1kv22/Library-1.o' for output: Disk quota exceeded
    error: autolink-extract command failed with exit code 1

So `build_error` was set, and all three Sideload tests failed on `assertIsNone(self.build_error)`:
`test_ocsp_request`, `test_signed_with_edits` (T17) and `test_swift` (T15). The OCSP code (CertCheck.swift
`OCSP.request`) and the test's comparison are deterministic. The thing being raced was the per-user quota on the
`/tmp` tmpfs, which every session and gate on this machine shares. swiftc -O writes its objects to `$TMPDIR` (`/tmp`),
and the test's own `mkdtemp` is under `/tmp` too.

## Why there's no code change here

T14 (test_sign.OnDeviceSigner.test_swift, failed in F261's gate) has the same root cause. Its branch
(`origin/wip/T14`, commit 2a33216, still being finished in slot s3) already moves `native/test_sideload.py` off
`/tmp`: `disk_tmpdir()` puts the scratch dir under `native/build/tmp/`, and `swift_env()` sets swiftc's and the binary's
`TMPDIR` inside it. That is exactly the fix this task needs. If I made the same edit here, the two branches would
conflict in test_sideload.py and test_sign.py for nothing, so I blocked T16 `--after T14`. Once T14 merges, re-check
that test_sideload.py uses `disk_tmpdir`/`swift_env`, then tick. T15 and T17 are the same failure and the same fix.

## Not verified

- I did not run test_sideload with T14's change from this worktree. T14's own journal reports the three modules
  passing with `TMPDIR=/nonexistent-t14`.
- I did not reproduce the quota failure. Filling the shared `/tmp` would break the other sessions on this machine.
