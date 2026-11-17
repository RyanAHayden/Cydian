# F22: apt-mark hold/unhold/showhold in cydian-helper; Ignored Upgrades as dpkg holds

## What I did

- `native/helper/policy.c/.h`: three new verbs. `hold <pkg>...` / `unhold <pkg>...` run
  `<prefix>/usr/bin/apt-mark hold|unhold <pkg>...`. `showhold` runs `apt-mark showhold` and takes no arguments.
  apt-mark gets no status fd because it has no progress to report. The names follow the same rules as before
  (`[a-z0-9][a-z0-9.+-]+`, at most 256), and they must appear in dpkg's status (`helper_first_unknown`, the same
  rule as `remove`). So apt-mark never sees a name it would treat as a pattern, and you can't hold a package that
  is only in a repo list. Holding a package that isn't installed does nothing for Ignore Upgrades, and a held
  package stays in dpkg's status anyway, so unhold always works. The verb list in the error messages is now
  `HELPER_VERBS`.
- `main.c` header comment and `README.md` table updated.
- `test_helper.py`: plan argv for the three verbs, new refusals (`showhold ab`, options as names, `a*`), known-package
  checks (in the dpkg status passes, a name only in a repo list or a prefix of a name is refused), and the whole
  chain to a stand-in `apt-mark` and back.
- `web/app/core/settings.js`: `createSettings({ helper })`, used only in jailbreak mode.
  `holds.set(pkg, on)` updates the list right away, as before. It then calls `helper(["hold"|"unhold", pkg])` and
  resolves to true, or to false when the helper fails. After a failure it calls `holds.sync()` to put dpkg's list
  back, and if showhold fails too it restores the old list. `holds.sync()` makes showhold's stdout the list, and
  tells listeners only when the list changed. Site and sideload modes, or jailbreak with no helper, keep the
  local list, and `sync()` returns it unchanged.
- `web/app/screens/settings.js`: passes `globalThis.cydianNative?.helper`, and calls `holds.sync()` each time a
  Settings page opens, because something outside the app can change holds (another package manager, apt-mark
  run by hand).
- "holds" is **not** in FEATURES yet. The brief says to add it once the upgrades list exists. That list is F7's,
  which is still open, so the row stays hidden. I added a note to F7 asking it to add "holds" when it lands. I also
  added a note to N3 describing what the bridge must provide: `cydianNative.helper(words) -> Promise<{code, stdout,
  stderr}>`.

## Tried and failed

Nothing.

## Not verified

- Real `apt-mark` on a device. There's no jailbroken iOS 15+ phone. The 4S runs iOS 6, and the task doesn't say
  to touch it. The tests use a stand-in `apt-mark` script. I'm assuming two things about real apt-mark: showhold
  prints one package per line, and hold/unhold exit 0 on success.
- The iOS build of the changed helper. `test_ios_build` skips when IOS_SDK isn't set, and it was not set here.
- The real path from `cydianNative.helper` to the Swift bridge. The bridge doesn't exist yet (N3), so I tested
  holds.set/sync against a fake helper in `settings.test.js`.
- The Ignored Upgrades page in a browser: the row stays hidden until "holds" is in FEATURES (F7).
