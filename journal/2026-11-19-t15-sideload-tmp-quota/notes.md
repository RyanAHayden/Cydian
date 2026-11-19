# T15: test_sideload.Sideload.test_swift under load

## What it raced

Not time, ports or another process: **disk space in /tmp**. R35's failed merge gate
(`~/repos/iFizBox/.runner/gates/f7f93a99…-923d2412d932.failed`) shows all three Sideload tests failing on
`build_error`, and swiftc's own words:

    error: error closing '/tmp/TemporaryDirectory.I1kv22/Library-1.o' for output: Disk quota exceeded

On this machine `/tmp` is a 16 GB tmpfs mounted with `usrquota` (12 GB in use while I looked), shared by every
slot's gate. swiftc writes its object files to `$TMPDIR` (default `/tmp`), and the test's own folder
(`tempfile.mkdtemp`) was there too. Whenever the other slots had filled the quota, the build failed. Run alone, it passes.

## Fix

- `native/disktmp.py` (new, stdlib only): `build_dir(prefix)` makes the test's folder under `$IFIZBOX_TEST_TMP`,
  else `${XDG_CACHE_HOME:-~/.cache}/ifizbox-tests`, falling back to the default temp dir if neither can be made;
  `swift_env(env, tmp)` sets swiftc's `TMPDIR` inside that folder.
- `native/test_sideload.py` uses both. tearDownClass already removes the folder.

## Checks

- Alone: `python3 -m unittest test_sideload` passes (19 s).
- 16 copies at once (`Sideload` class): all passed. They also passed before the fix, because /tmp had room then:
  load alone doesn't cause the failure; a full /tmp does.
- Full `native/` discover (as the gate runs it): 92 tests OK.
- Stand-in for a full /tmp: `TMPDIR` pointed at a read-only folder. The old test fails (`build_error: error:
  permissionDenied` from swiftc), and the new one passes. `~/.cache/ifizbox-tests` was empty afterwards.

## Tried and dropped

- Looked for wall-clock dependence (OCSP this/next update ±1 h, profile and cert dates relative to now, Reminder
  tests use fixed dates) and for thread or Process races in the Swift test's openssl calls. Nothing there could
  fail under load, and the gate log settled it.

## Follow-up

- T19: the same move for test_sign, test_updates, share/test_share and intents/test_intents. They build with swiftc
  the same way and can fail the same way.

## Not verified

- A real full-quota /tmp: I didn't fill the shared tmpfs because it would break the other slots' gates. The
  read-only TMPDIR test stands in for it: it shows nothing in the build needs `$TMPDIR` any more.
- A run killed mid-test leaves its folder in `~/.cache/ifizbox-tests` instead of /tmp, so a reboot won't clear
  it. It holds only fixtures and build output, a few tens of MB.
