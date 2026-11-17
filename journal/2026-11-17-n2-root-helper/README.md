# N2: root helper (2026-11-17)

## What I did

- `native/helper/`: `cydian-helper` in C (no setuid; docs/native.md "3. Root"), its checks in `policy.c`, the app's
  persona spawn in `spawn.c`, and `test_helper.py` (run by the gate, needs only `cc`). README.md there has the
  exact commands it runs.
- Allowlist: verbs `update|install|remove|upgrade|configure` (configure = `dpkg --configure -a`), names
  `[a-z0-9][a-z0-9.+-]+` (first char alnum so nothing reads as an option, 2-255 bytes, at most 256), no options
  from the caller. All options apt gets are fixed in the helper (`-y`, confdef/confold since stdin is /dev/null,
  status-fd 3 when fd 3 is open).
- Added beyond the brief, because the name grammar alone isn't enough: every name must be known (`Package:` line in
  dpkg status, or for install also in an apt `*_Packages` list). apt-get treats a name it can't find exactly as a
  regex when it has `.`/`+` in it (iOS bundle-style names always do), and as an install/remove modifier when it
  ends in `+`/`-`. With the check apt always finds the exact name first. Cost: virtual packages are refused.
- Caller check as R3 decided: uid and euid 0, and `proc_pidpath(getppid())` same dev+inode as
  `/var/jb/Applications/Cydian.app/Cydian`. The real gate is the kernel's persona-mgmt entitlement check.
- Clean exec: own environment (caller's `APT_CONFIG`, `DYLD_*` dropped), fds > 3 closed, stdin /dev/null, cwd /.
- Tests (11, Linux): name grammar, exact argv per verb, refusals, known-package check against fixture status and
  lists, caller check (dev+inode, symlink, wrong uid), and the whole chain: a copy of the test driver placed at the
  fake prefix's `Cydian.app/Cydian` spawns the helper (built with a test prefix and the test user's uid as "root"),
  which execs a stand-in apt-get; the test reads stdout/stderr/fd 3 separately, checks apt's exit code comes back,
  the environment is clean, only fds 0-3 reach apt, and refusals exit 64/77 without running apt.

## Decisions

- Wiring into the app (build the helper in `native/build.sh`, install it at `/var/jb/usr/libexec/cydian/`, add
  `com.apple.private.persona-mgmt` to `native/entitlements.plist`, call `cydian_helper_spawn` from Swift) is left
  to N3, which owns `native/**` and is the first task that uses it. N2's files were `native/helper/**`; I put a
  note on N3. The entitlement alone without a caller would do nothing.
- N4's Confirm sheet wants `apt-get -s`; that is not in the allowlist (simulation needs no root; run it as mobile).
  Noted on N3/N4's path via the N3 note.

## Tried and failed

- First build failed: a `*/` inside a comment (`LD_*/DYLD_*`) ended it early. Reworded.

## Not verified

- **No run on a device**: the user has no jailbroken test phone (2026-11-17). Untested on a device: the persona
  spawn (`posix_spawnattr_set_persona_*`), whether Dopamine/palera1n honour persona-mgmt for Cydian, `proc_pidpath`
  for the caller check, the real apt-get/dpkg runs and their status-fd output.
- **iOS compile**: no `IOS_SDK` on this machine (T3's default path `~/.local/share/cydian/iPhoneOS.sdk` is absent),
  so `main.c`/`spawn.c` were never compiled for iOS. `test_ios_build` compiles them when `IOS_SDK` is set and skips
  otherwise; `make ios` links and ad hoc signs. The Apple-only branches (libproc, persona declarations,
  `POSIX_SPAWN_CLOEXEC_DEFAULT`) are unchecked by any compiler.
- apt's regex fallback and modifier behaviour is from memory of apt-get's behaviour, not checked against
  Procursus' apt 2.x here (no apt on this Arch machine). The known-package check makes it moot either way.
