# C13: one scratch-dir helper for the swiftc tests

There were two helpers doing the same job (keep swiftc's build and temporaries off the shared /tmp tmpfs):
`test_sign.disk_tmpdir()`/`swift_env()` (under `native/build/tmp/`) and `native/disktmp.py`
`build_dir()`/`swift_env()` (under `$IFIZBOX_TEST_TMP`, else `~/.cache/ifizbox-tests`, else tempfile's default).

What I did: switched the callers to `disktmp` and removed test_sign's copies (and its now-unused `tempfile` import).

- `native/test_sign.py`, `native/test_updates.py`, `native/test_sideload.py` now use
  `disktmp.build_dir(prefix)` and `disktmp.swift_env(dict(os.environ), tmp)`. The `dict(os.environ)` copy keeps
  the old behaviour of test_sign's `swift_env(tmp)`, which returned a fresh copy of the environment each call.
- `native/disktmp.py` unchanged.
- Behaviour change: those three tests now build under `~/.cache/ifizbox-tests` (or `$IFIZBOX_TEST_TMP`) instead of
  `native/build/tmp/`. Both are on the disk. The `swift-tmp` subfolder name replaces `tmpdir`, which nothing else
  reads.

Why switch the callers rather than make test_sign's functions thin wrappers: wrappers would leave two names for one
thing, which is what the task was meant to remove. `test_updates`/`test_sideload` still import other things from
test_sign (toolchain, fixtures), so that link stays.

## Checks

- `TMPDIR=/nonexistent-c13 python3 -m unittest test_sign test_updates test_sideload` from `native/`: 18 tests OK, none skipped, 43 s. With TMPDIR pointing nowhere, a pass shows the builds and the
  signer runs stay inside the disktmp folder. `~/.cache/ifizbox-tests` was empty afterwards (tearDownClass cleans up).
- `tools/check.sh` through `agent-runner done`.

## Not verified

none
