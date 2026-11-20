# B144: auto_prune mtime ties broken by readdir order

## Finding

Already fixed on main. B142 (231e7b5b) changed `auto_prune` in native/daemon/auto.c so that equal-mtime
stashes are ordered by Debian version (`ver_cmp`, the higher counts as newer, so the older one is pruned
first); listing order only decides between two identical versions. T26 (9fb742e8) added
`test_rollback_prune_ignores_dir_order`, and T27 confirmed the failure was real before B142 and gone after.
No code change for B144.

## Checks

- `TMPDIR=/var/tmp python3 -m pytest test_auto.py -k rollback` (/var/tmp is btrfs here): 3 passed, 3/3 runs,
  including test_rollback_keeps_previous_versions.

## Not verified

- ext4: no ext4 filesystem on this machine. With the version tie-break the result no longer depends on
  readdir order, so the filesystem should not matter.
