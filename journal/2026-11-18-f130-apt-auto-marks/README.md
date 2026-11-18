# F130: Installed's User mode from apt's Auto-Installed marks

## What I did
- `native/Sources/Apt.swift`: bridge call `apt.autoInstalled` -> the sorted names `/var/lib/apt/extended_states`
  marks `Auto-Installed: 1`, or nil when the file can't be read. Mirrored in `native/fake/fake-native.mjs`.
- `web/app/core/installed.js`: `packageTier` now gives a dependency-only package tier **2** (still Expert, so
  without marks nothing changes) instead of 3. New `markedRows(rows, auto)`: with a marks Set, tier 2 rows apt
  didn't mark go back to User (1), User rows apt marked go to 2. Essential and role tiers (3, 6, 7) are untouched.
  Encoding this in `tier` meant `core/catalog.js` (not on this task's file list) needed no change: it already
  passes `tier` through.
- `web/app/screens/installed.js`: `autoInstalled()` reads the marks (null on the site, the sideload build, an
  older shell, or no extended_states), loaded beside the install dates; `dpkgItems` takes `auto`.
- Tests in `core/installed.test.js` and `screens/installed.test.js` (including the fake shell parsing CRLF and
  `Auto-Installed: 0`).

## Decisions
- A missing extended_states means "can't read the marks", so the guess stays (apt creates the file on its first
  auto mark). An existing file with no `Auto-Installed: 1` entries counts as read: nothing is hidden as a
  dependency then. Risk: packages laid down by a bootstrap with dpkg (not apt) carry no marks, so on such a device
  libraries that aren't Essential/required would show in User. Not checked on a device (below).

## Not verified
- The Swift side wasn't compiled: no Swift toolchain on this Linux machine (check.sh skips the native builds here).
- Not run on the iPhone 7 or read off the 4S: the task didn't say to touch either device, so how a real
  palera1n/Procursus extended_states looks (and how many bootstrap packages lack marks) is unchecked.
