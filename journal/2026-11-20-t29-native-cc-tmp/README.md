# T29 — native helper/daemon tests: cc scratch files out of the shared /tmp

The C-compiling tests let cc write its scratch files (`/tmp/cc*.s`, `.o`) in the shared /tmp, which other gates on
this machine can fill (EDQUOT broke the helper tests in B132's gate runs). Same fix as T28's `native/test_mode.py`.

## What changed

- `native/helper/test_helper.py`: `build()` compiles with `-pipe` and `env=cc_env(dirname(out))`, a new helper that
  sets `TMPDIR` to the directory the output goes in. Every `build()` output lies in a test's own `mkdtemp` dir (the
  class's `cls.tmp` or a `mkdtemp(dir=self.tmp)` under it), so that directory exists and is writable. The skipped
  iOS build (`test_ios_build`) got the same `-pipe` and `TMPDIR`. The five classes' `tearDownClass` rmtree became
  `addClassCleanup(shutil.rmtree, cls.tmp, True)` right after the mkdtemp, so the dir also goes when the build in
  `setUpClass` fails (tearDownClass doesn't run then).
- `native/daemon/test_daemon.py`, `test_auto.py`: `-pipe`, `TMPDIR=cls.tmp`, addClassCleanup instead of tearDownClass.
- `native/daemon/test_quiet.py`: `-pipe`, `TMPDIR=` its `TemporaryDirectory` (already cleaned by the `with`).

## Tried and failed

nothing

## Not verified

- That nothing lands in /tmp any more under a real EDQUOT: I can't fill the shared /tmp without breaking the other
  slots' gates. The four suites pass with the change, and the mechanism is the one T28 proved.
- `test_ios_build`'s new flags: it skips here (no `IOS_SDK`).
