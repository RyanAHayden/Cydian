# T26: test_auto.py independent of readdir order

## Finding

The fault T26 describes (libfoo 3.1 kept where 3.2 is expected, but only when TMPDIR is not tmpfs) was in
`auto.c` `auto_prune`. `auto_stash` gives every .deb stashed in one run the same mtime (`now`), so the two
"others" tied, and the tie was broken by listing position, which is readdir order. tmpfs lists newest-created
first and btrfs/ext4 list in their own order, so the result depended on the filesystem. B142 (231e7b5b, merged
earlier today) already fixed `auto_prune`: equal mtimes go by dpkg version, and listing order only matters when
two versions are identical. On current main the whole `test_auto.py` passes with TMPDIR on tmpfs and on btrfs
(`/home`), so `auto.c` needed no change.

## What I did

- `native/daemon/test_auto.py`: added `Runs.test_rollback_prune_ignores_dir_order`. It is a whole hourly run, so
  it covers `auto_prune_dir`'s real readdir and not just the listing unit test B142 added. It puts libfoo 3.1 and
  3.2 in `rollback/libfoo` with the same mtime, creating them in both orders (which flips readdir order on tmpfs
  and btrfs alike), installs 3.3 with keepVersions=1, and expects 3.2 and 3.3 to be kept.

## Checks

- New test and the full `test_auto.py` (44 tests): pass with TMPDIR=/tmp (tmpfs) and with TMPDIR on /home (btrfs).
- The same test against the pre-B142 `auto.c` (231e7b5b^, in a scratch worktree, since removed) fails on
  both filesystems, each time with the opposite creation order (tmpfs: 3.2 then 3.1; btrfs: 3.1 then 3.2). So the
  test catches the bug whatever filesystem TMPDIR is on.

## Not verified

- ext4: none at hand. ext4 lists by hash order, but one of the two creation orders still sets up the tie, and
  after B142 order no longer matters.
- `auto_stash`, when the cache holds the same version for more than one arch, copies whichever comes first in
  readdir. I left it alone: the files are the same version and nothing tests it.
