# T19: the remaining swiftc tests build off the shared /tmp tmpfs

## What I did
- `native/share/test_share.py` and `native/intents/test_intents.py`: `cls.tmp` now comes from
  `disktmp.build_dir()` (disk, under `$IFIZBOX_TEST_TMP` or `~/.cache/ifizbox-tests`) and the swiftc env from
  `disktmp.swift_env()`, so swiftc's `TemporaryDirectory.*` object files land there too. The test binaries' own
  run already used `TMPDIR=cls.tmp`, which now follows onto the disk. Dropped test_share's now-unused
  `import tempfile` (test_intents still uses it for a small non-swiftc fixture dir).
- `native/test_sign.py` and `native/test_updates.py`: left as they are. T14 (ba10e61) already moved both off /tmp,
  with its own helpers `test_sign.disk_tmpdir()` / `test_sign.swift_env()` (native/build/tmp), which
  `test_sideload.py` also imports. Switching them to `disktmp` would only churn files other slots touch, for
  no change in behaviour. Two helpers doing the same thing is a tidy-up, filed as a low-priority C task.

## Tried and failed
none

## Not verified
- That a full /tmp quota no longer fails these two tests: I did not fill the shared tmpfs on purpose (it would
  break the other slots' gates). The check was that the builds pass and that the scratch dirs are made under
  `~/.cache/ifizbox-tests`.
