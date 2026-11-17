# native/helper/: cydian-helper, the root helper (N2)

How root works and why: docs/native.md, "3. Root". In short: no setuid bit. Cydian (signed with
`com.apple.private.persona-mgmt`) spawns `/var/jb/usr/libexec/cydian/cydian-helper` as root with the persona spawn
attributes; the helper checks its words and `execve`s one apt command, or edits Cydian's one apt source file.

    cydian-helper update | upgrade | configure | install <pkg>... | remove <pkg>...
    cydian-helper hold <pkg>... | unhold <pkg>... | showhold
    cydian-helper addsource <uri> <suite> [component...] | removesource <uri> <suite>

| verb        | runs (from `/var/jb/usr/bin`)                                                               |
|-------------|---------------------------------------------------------------------------------------------|
| `update`    | `apt-get [-o APT::Status-Fd=3] update`                                                      |
| `install`   | `apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold [-o APT::Status-Fd=3] install <pkg>...` |
| `remove`    | same options, `remove <pkg>...`                                                             |
| `upgrade`   | same options, `upgrade`                                                                     |
| `configure` | `dpkg --force-confdef --force-confold [--status-fd 3] --configure -a`                       |
| `hold`      | `apt-mark hold <pkg>...` (F22: Settings > Ignored Upgrades in jailbreak mode)               |
| `unhold`    | `apt-mark unhold <pkg>...`                                                                  |
| `showhold`  | `apt-mark showhold`: the held packages on stdout, one per line                              |
| `addsource` | runs nothing: writes a deb822 stanza (`Types: deb`, `URIs:`, `Suites:`, `Components:`) into `/var/jb/etc/apt/sources.list.d/cydian.sources` (F33) |
| `removesource` | runs nothing: drops the stanza for that URI and suite from `cydian.sources`              |

**Sources (F33):** sources added in the app go into `cydian.sources` and nowhere else, so `apt-get update` and
installs use them; the app never edits apt's other files. Checks: the URI is `http://` or `https://` (lower case), a
host of `[A-Za-z0-9.-]` with an optional `:port`, and a path that starts and ends with `/` of `[A-Za-z0-9._~%+/:=,-]`
with no `.` or `..` segment, at most 1024 bytes (no `user:password@`: the file is world-readable; no spaces, `#`,
newlines, quotes or brackets, so a value can't add a field such as `Trusted: yes`). The suite is `./`, a flat path
ending in `/`, or a name of `[A-Za-z0-9._+/-]` not starting with `-` or `/`, no `..`, at most 255 bytes. A flat suite
takes no components, any other needs 1-16 of `[A-Za-z0-9][A-Za-z0-9._+/-]*` (at most 64 bytes, no `..`). The edit:
an exclusive `flock` on `sources.list.d` (made if missing), read the file (`O_NOFOLLOW`, a regular file of at most
1 MiB, missing is empty), the first stanza naming exactly this URI and suite becomes the new one and any other goes
(a hand-written stanza with several URIs or suites is left alone), new ones go at the end; written to
`.cydian.sources.XXXXXX` beside it (apt skips dotfiles), mode 0644, fsync, `rename(2)`. No stanzas left: the file
is removed. Nothing changed: nothing is written. stdout says `Added|Removed <uri> <suite>: cydian.sources updated`
or `nothing to change`; exit 0, 64 refused, 74 couldn't write.

- **Arguments:** only the verb and package names. A name matches `[a-z0-9][a-z0-9.+-]+` (so never an option), is
  at most 255 bytes, at most 256 of them, and must be known: for `install` a `Package:` line in dpkg's status or an
  apt `*_Packages` list, for `remove`, `hold` and `unhold` in dpkg's status. The last rule stops apt from reading
  an unknown name as a regex (`com.foo.bar` would match `com.foo.bar2`) or a modifier (`foo-` removes, `foo+`
  installs). Virtual packages (only in `Provides:`) are refused for that reason; install the real one.
- **Caller:** real and effective uid 0 (only the entitled app can arrange that), and the parent's executable
  (`proc_pidpath(getppid())`) is the same device + inode as `/var/jb/Applications/Cydian.app/Cydian`.
- **Process:** stdin `/dev/null`, cwd `/`, fds above 2 closed (3 kept when open, for status), signals default,
  umask 022, and its own environment (`PATH` with the prefix first, `HOME=/var/root`, `LANG=C`,
  `DEBIAN_FRONTEND=noninteractive`; nothing from the caller such as `APT_CONFIG`).
- **Exit:** 64 refused arguments, 77 refused caller, 74 `cydian.sources` not written, 126 exec failed, anything
  else is apt's/dpkg's.
- **Output:** apt's stdout/stderr are the console; fd 3 carries `pmstatus:`/`dlstatus:` lines (apt) or dpkg's
  status lines for the progress bar.

Files:

- `policy.c/.h`: the checks (names, verbs → argv, known packages, caller, source URIs/suites/components) and the
  `cydian.sources` edit. Pure enough to test on Linux.
- `main.c`: the helper. `CYDIAN_PREFIX` (default `/var/jb`) and `CYDIAN_ROOT_UID` (default 0) are compile-time
  only; the tests change them, the shipped build must not.
- `spawn.c/.h`: the app's side, `cydian_helper_spawn()`: pipes on the child's fds 1-3, `/dev/null` stdin,
  `POSIX_SPAWN_CLOEXEC_DEFAULT` and the persona attributes (99, override, uid/gid 0) on Apple. For the Swift shell
  to call (N3); on Linux it spawns as the current user, for the tests.
- `test_driver.c`, `test_helper.py`: unit tests and the whole chain on Linux (stand-in Cydian → helper → stand-in
  apt-get). `make host` / `make ios` build by hand; `../build.sh` builds both into the .deb (N3).
