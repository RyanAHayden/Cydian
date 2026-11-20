# T27: test_rollback_keeps_previous_versions on a non-tmpfs TMPDIR

## Finding

Already fixed on main: B142 (231e7b5b) made `auto_prune` break equal-mtime ties by dpkg version, so the
previous version kept no longer depends on readdir order. T26 (9fb742e8) added
`Runs.test_rollback_prune_ignores_dir_order`, which covers this same case. No code change was needed for T27.

## Checks

- On current main, the rollback tests (`-k rollback`, including test_rollback_keeps_previous_versions) pass
  5/5 runs with TMPDIR on /home (btrfs).
- Ran the current tests against the pre-B142 `auto.c`/`auto.h` in a scratchpad copy of native/daemon. With TMPDIR
  on btrfs, test_rollback_keeps_previous_versions failed 3/3 times, which is the failure in the task. So the
  failure is real and B142 is what fixed it.

## Not verified

- ext4/other filesystems: none at hand. After B142 the keep choice does not read listing order unless two
  versions are identical, so the filesystem should not matter.
