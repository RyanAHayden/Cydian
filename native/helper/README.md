# native/helper/: cydian-helper, the root helper (N2)

How root works and why: docs/native.md, "3. Root". In short: no setuid bit. Cydian (signed with
`com.apple.private.persona-mgmt`) spawns `/var/jb/usr/libexec/cydian/cydian-helper` as root with the persona spawn
attributes; the helper checks its words and `execve`s one apt command.

    cydian-helper update | upgrade | configure | install <pkg>... | remove <pkg>...

| verb        | runs (from `/var/jb/usr/bin`)                                                               |
|-------------|---------------------------------------------------------------------------------------------|
| `update`    | `apt-get [-o APT::Status-Fd=3] update`                                                      |
| `install`   | `apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold [-o APT::Status-Fd=3] install <pkg>...` |
| `remove`    | same options, `remove <pkg>...`                                                             |
| `upgrade`   | same options, `upgrade`                                                                     |
| `configure` | `dpkg --force-confdef --force-confold [--status-fd 3] --configure -a`                       |

- **Arguments:** only the verb and package names. A name matches `[a-z0-9][a-z0-9.+-]+` (so never an option), is
  at most 255 bytes, at most 256 of them, and must be known: for `install` a `Package:` line in dpkg's status or an
  apt `*_Packages` list, for `remove` in dpkg's status. The last rule stops apt from reading an unknown name as a
  regex (`com.foo.bar` would match `com.foo.bar2`) or a modifier (`foo-` removes, `foo+` installs). Virtual
  packages (only in `Provides:`) are refused for that reason; install the real one.
- **Caller:** real and effective uid 0 (only the entitled app can arrange that), and the parent's executable
  (`proc_pidpath(getppid())`) is the same device + inode as `/var/jb/Applications/Cydian.app/Cydian`.
- **Process:** stdin `/dev/null`, cwd `/`, fds above 2 closed (3 kept when open, for status), signals default,
  umask 022, and its own environment (`PATH` with the prefix first, `HOME=/var/root`, `LANG=C`,
  `DEBIAN_FRONTEND=noninteractive`; nothing from the caller such as `APT_CONFIG`).
- **Exit:** 64 refused arguments, 77 refused caller, 126 exec failed, anything else is apt's/dpkg's.
- **Output:** apt's stdout/stderr are the console; fd 3 carries `pmstatus:`/`dlstatus:` lines (apt) or dpkg's
  status lines for the progress bar.

Files:

- `policy.c/.h`: the checks (names, verbs → argv, known packages, caller). Pure enough to test on Linux.
- `main.c`: the helper. `CYDIAN_PREFIX` (default `/var/jb`) and `CYDIAN_ROOT_UID` (default 0) are compile-time
  only; the tests change them, the shipped build must not.
- `spawn.c/.h`: the app's side, `cydian_helper_spawn()`: pipes on the child's fds 1-3, `/dev/null` stdin,
  `POSIX_SPAWN_CLOEXEC_DEFAULT` and the persona attributes (99, override, uid/gid 0) on Apple. For the Swift shell
  to call (N3); on Linux it spawns as the current user, for the tests.
- `test_driver.c`, `test_helper.py`: unit tests and the whole chain on Linux (stand-in Cydian → helper → stand-in
  apt-get). `make host` / `make ios` build by hand; packaging into the .deb is N3's.
