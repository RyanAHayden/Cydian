# T52: sanitizers on the remaining daemon host tests

## What I did

- `native/daemon/test_daemon.py`: `test_driver` (test_driver.c + upgrades.c) is now built with `SAN_FLAGS`
  (`-fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer -g`) when the probe finds them
  working, and every run inherits `ASAN_OPTIONS=detect_leaks=0:abort_on_error=1`. A new
  `Rules.test_driver_is_sanitized` checks the binary carries `__asan_init`; it is skipped with the probe's reason
  (`SAN_SKIP`) where sanitizers don't work, and the other tests then run on a plain build as before.
- `native/daemon/test_quiet.py`: the quiet.h program gets the same flags and env, and `test_rule` checks
  `__asan_init` when sanitized.
- The probe, flags and env come from `test_auto.py` (`from test_auto import ...`) rather than a third copy. The gate
  discovers per directory, so `native/daemon/` is on `sys.path`; importing names only does not re-run test_auto's
  test classes.

## Result

All 18 tests in test_daemon + test_quiet pass under ASan/UBSan here (GCC 16.2.1); `test_driver_is_sanitized` ran
(not skipped), so the driver really was sanitized.

## Tried and failed

Nothing.

## Not verified

- The skip path (a compiler without working sanitizers): this machine's GCC has them; the skip logic is test_auto's,
  already used by T45.
- Clang as `CC`: not tried; only the default `cc` (GCC).
