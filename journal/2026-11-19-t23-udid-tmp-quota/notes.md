# T23: test_udid.Udid robust under load

## What it raced

The failing id was the class (`test_udid.Udid`), not a method, so `setUpClass` failed, not a test. The only work
there is two `cc` builds (`test_helper.build`) into a `tempfile.mkdtemp()` dir. Both the output dir and gcc's own
temporaries (`$TMPDIR`, default `/tmp`) were on the shared `/tmp` tmpfs, which has a per-user quota that the other
slots' gates fill (the same failure as T14–T17 and T19 for swiftc, see `native/disktmp.py`). `build` captures cc's
output, so the gate showed only a CalledProcessError. T24 (`test_uninstall.UninstallApp`, same gate, also a class
id, also a cc build in setUpClass into /tmp) is very likely the same thing; I left that file alone for T24.

The B116 gate log itself wasn't kept anywhere I could find, so the cause comes from the pattern above, not from the
log line.

## What I did

`native/helper/test_udid.py` only:
- the scratch dir comes from `disktmp.build_dir("ifizbox-udidtest-")` (`~/.cache/ifizbox-tests`, on the disk);
- the two builds run with `TMPDIR` inside that dir (`disktmp.swift_env`, which only sets TMPDIR), set with
  `mock.patch.dict(os.environ, …)` so the rest of the discover run keeps its own environment;
- cleanup moved from `tearDownClass` to `addClassCleanup`, so a failed build no longer leaves the dir behind.

I didn't change `test_helper.build` (one place for all the helper tests) so as not to collide with T24, which will
likely touch the same thing. Worth a later tidy-up once both land.

Not changed: test_driver's 10 s `poll` timeout. `udid` exits at once off iOS, and the failure was in setUpClass, so
it wasn't the cause here.

## Checks

- `CC=<wrapper logging $TMPDIR> python3 -m unittest test_udid`: 5 OK; both cc runs saw
  `TMPDIR=~/.cache/ifizbox-tests/ifizbox-udidtest-*/swift-tmp`, and TMPDIR was unset again afterwards.
- `python3 -m unittest discover` in `native/helper`: 98 tests OK.
- `tools/check.sh` through `agent-runner done`.

## Not verified

- I didn't reproduce the original failure with a full /tmp quota: I can't fill or shrink the shared tmpfs without
  breaking the other slots' gates. `TMPDIR=/nonexistent` doesn't show it either (gcc and Python fall back to /tmp).
  The wrapper check above shows the builds no longer write to /tmp.
