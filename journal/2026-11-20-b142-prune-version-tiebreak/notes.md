# B142: rollback prune breaks mtime ties by Debian version

## What I did

- `native/daemon/auto.c` `auto_prune`: each listed .deb now carries its decoded version; when two of the
  "others" share an mtime (both stashed in one run, so `auto_stash` gave them the same `now`), the one with the
  higher dpkg version counts as newer. Listing order is only the last tie-break (identical versions). The
  comparison is a new `ver_cmp` (epoch, then upstream, then revision) built on F282's existing
  `ver_split`/`ver_part_cmp`, forward-declared above `auto_prune`.
- `native/daemon/auto.h`: the `auto_prune` comment says equal mtimes go by version.
- `native/daemon/test_auto.py` `test_prune`: a tied-mtime listing in both orders (3.2 vs 3.10, so it checks the
  numeric compare, not string order) must drop 3.2 either way.

## Checks

- With TMPDIR on btrfs (`/home`): `test_auto.py` 43 passed with the fix. The same tests against HEAD's auto.c in a
  scratch worktree: `test_rollback_keeps_previous_versions` and the new `test_prune` case fail — the bug reproduced
  and is gone.

## Not verified

- ext4 specifically: no ext4 filesystem at hand; btrfs showed the same readdir-order failure.
- On a phone: the change is pure C logic covered by the host-built driver; no device run.
