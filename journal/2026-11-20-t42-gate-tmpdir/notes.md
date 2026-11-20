# T42: one TMPDIR for the whole gate

## What changed

- `tools/check.sh` makes a folder of its own per run, `gate-XXXXXX` under `$IFIZBOX_TEST_TMP`, else
  `${XDG_CACHE_HOME:-~/.cache}/ifizbox-tests` (the base `native/disktmp.py` already uses), exports it as `TMPDIR`
  (and `IFIZBOX_GATE_TMPDIR`) before anything else runs, and removes it on exit. Per run, not the shared base, so
  parallel slots don't see each other's files and nothing piles up. If the base can't be made it says so and keeps
  the default temp dir.
- Everything the gate starts follows it: mktemp (check.sh's own, `tools/build-zsign-wasm.sh`'s `WORK`), Python's
  `tempfile`, node's `os.tmpdir()`, swiftc/cc. `native/disktmp.py` and `native/helper/scratch.py` stay as they are
  (they still help when a test is run by hand outside the gate).
- `tools/test_gate_tmpdir.py`: checks that check.sh exports TMPDIR before its first mktemp, size guard, native
  build, unittest run and node tests; inside the gate it checks that tempfile, `mktemp` and node all land in the
  gate's folder and that it isn't under /tmp. Outside the gate that second case skips.

## Tried

- First test version located commands with `str.index` and matched the header comment ("node --test"); now it
  looks at code lines only.
- Gate under a 64 KB tmpfs /tmp via `unshare -rm` (root in a user namespace): failed only in
  `web/app/startup.test.js` ("Chromium's DevTools didn't come up"), because Chromium won't start as root without
  `--no-sandbox`, an artefact of the namespace, not of /tmp. Rerun with a nested
  `unshare --map-user=1000 --map-group=1000` so the gate runs as uid 1000 again:
  `unshare -rm sh -c 'mount -t tmpfs -o size=64k tmpfs /tmp && exec unshare --map-user=1000 --map-group=1000 tools/check.sh'`.
  Result below.

## Result

The whole gate passed (exit 0) with /tmp a 64 KB tmpfs: the native .deb/IPA build, the zsign wasm build, every
Python suite (test_gate_tmpdir's in-gate case ran, not skipped), `node --test web/app` and the Worker test. Only skip:
tools/setup's PowerShell test (no pwsh here). No `gate-*` folder was left under ~/.cache/ifizbox-tests afterwards.

## Not verified

- The fallback path (base folder not writable → default TMPDIR) was not run end to end; it is a two-line branch.
- Disk use of ~/.cache during the gate was not measured (only that it gets cleaned up).
