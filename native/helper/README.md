# native/helper/: cydian-helper, the root helper (N2)

How root works and why: docs/native.md, "3. Root". In short: no setuid bit. Cydian (signed with
`com.apple.private.persona-mgmt`) spawns `/var/jb/usr/libexec/cydian/cydian-helper` as root with the persona spawn
attributes; the helper checks its words and `execve`s one apt command, or edits Cydian's one apt source file.

    cydian-helper update | upgrade | configure | install <pkg>... | remove <pkg>...
    cydian-helper hold <pkg>... | unhold <pkg>... | showhold
    cydian-helper addsource <uri> <suite> [component...] | removesource <uri> <suite>
    cydian-helper simulate <item>... | apply <item>... | respring          (N4: the install queue)
    cydian-helper apply-ask <item>...                                      (F63: apply that asks about conffiles)
    cydian-helper install-ipa <path>                                      (F59: an IPA, through installd)
    cydian-helper selfupdate <path.deb>                                    (F61: Cydian updates itself)
    cydian-helper rollbacks <pkg> | rollback <pkg> <version>              (F71: Roll Back to a kept .deb)
    cydian-helper install-paid <path.deb> <pkg> <version>                 (F57: a paid package's .deb)
    cydian-helper notifications on|off                                     (F65: Upgrade Notifications)

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
| `simulate`  | `apt-get -s --reinstall --allow-downgrades install <items>`: the Confirm sheet's plan (N4)       |
| `apply`     | `apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold --reinstall --allow-downgrades [-o APT::Keep-Fds::=3 -o APT::Status-Fd=3] install <items>`, with `CYDIA=3 1` in its environment when fd 3 is open (N4) |
| `apply-ask` | `apt-get -y --reinstall --allow-downgrades -o APT::Keep-Fds::=3 -o APT::Status-Fd=3 install <items>` (no conffile options; refused without fd 3), `CYDIA=3 1`, as a child whose stdin is a pipe the helper feeds (F63; below) |
| `install-ipa` | runs no apt: installs one IPA through `LSApplicationWorkspace installApplication:withOptions:error:` as AppSync's `appinst` does (`ipa.c`, F59; below) |
| `selfupdate` | `dpkg --force-confdef --force-confold [--status-fd 3] -i <path>`: Cydian's own update (F61). The path is absolute, `[A-Za-z0-9._/-]`, no `.`/`..` segment, ends in `.deb`, at most 1024 bytes, and a regular file (not a symlink). Any .deb is accepted: the caller check is the boundary, and Cydian can already install anything through `addsource` + `install` |
| `rollbacks` | runs nothing: `<version> <file>` per line for each .deb of the package N7's daemon kept in `/var/jb/var/cache/cydian/rollback/<pkg>/` that `rollback` would take (F71; below) |
| `notifications` | runs nothing: `off` creates `/var/jb/var/lib/cydian/upgrades.off` (empty, 0644; the folder 0755 if missing), `on` deletes it (F65, Settings' Upgrade Notifications; N5's daemon reads it, `../daemon/quiet.h`). A symlink or anything but a regular file there is refused (exit 74), never followed. Prints `Upgrade notifications on\|off` |
| `rollback`  | `apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold --allow-downgrades [-o APT::Keep-Fds::=3 -o APT::Status-Fd=3] install /var/jb/var/cache/cydian/rollback/<pkg>/<pkg>_<ver>_<arch>.deb`, `CYDIA=3 1` as for `apply` (F71; below) |
| `install-paid` | `apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold [-o APT::Keep-Fds::=3 -o APT::Status-Fd=3] install /var/tmp/cydian-paid.XXXXXX/paid.deb`, `CYDIA=3 1` as for `apply`, after copying and checking the app's download (F57; below) |
| `respring`  | `sbreload`, or `killall -9 backboardd` when the jailbreak has no sbreload (N4: Restart SpringBoard) |

**The queue (N4):** `simulate` and `apply` take items: `name` installs the newest, `name=version` that exact
version (Reinstall, Downgrade and the Version History pick one), `-name` removes. apt gets `name`, `name=version`
and `name-` in one `apt-get install`, so one run does the whole queue, as Cydia's does. A name follows the rules
below (an install's must not end in `-` or `+`, which apt would read as a modifier); a version is a digit, then
`[A-Za-z0-9.+~:-]`, at most 255 bytes; no package twice. Install items must be known to dpkg's status or apt's lists,
removals to dpkg's status. `--reinstall` makes an item naming the installed version do something; `--allow-downgrades`
is what lets `-y` take an older version on purpose. Cydia's finish protocol: maintainer scripts write `finish:restart`
(and so on) to the fd named in `$CYDIA`; `APT::Keep-Fds` keeps fd 3 open through apt and dpkg, so those lines arrive
beside apt's status lines and raise the console's finish button.

**Configuration Upgrade (F63):** `apply-ask` is `apply` without `--force-confdef`/`--force-confold`, so when a
conffile was changed by both the user and the package, dpkg asks (apt reports it on fd 3 as
`pmconffile:<file>:<percent>:'<old>' '<new>' 1 1`) and reads the answer from its stdin. The helper does not `execve`
apt here: it forks it with a pipe on its stdin and copies over, from its own stdin (the app's pipe,
`cydian_helper_spawn_in`), only the lines `Y` (accept the new copy) and `N` (keep the old one), `\r` allowed; any
other line is dropped with `cydian-helper: ignored an answer that isn't Y or N` on stderr, so dpkg's `D` (diff
through a pager) and `Z` (a root shell) can't be reached. When the app closes its end, apt's stdin is closed too
(a question after that fails as dpkg does at end of file, and `configure` finishes the package). The helper exits
with apt's status when apt-get ends, even while the app's end is still open. Maintainer scripts that read stdin
read this pipe too (as under Cydia, which runs apt the same way); with nothing written they wait, where `apply`'s
`/dev/null` gave them end of file. The app (`Apt.swift` `helper.answer {answer: keep|new}`) writes `N` or `Y`.

**Roll Back (F71):** N7's daemon keeps the .debs automatic updates replace in `<prefix>/var/cache/cydian/rollback/<pkg>/`,
named as apt's archive cache names them, `<pkg>_<version>_<arch>.deb` with the epoch's `:` as `%3a`. `rollbacks <pkg>`
lists them; `rollback <pkg> <version>` installs one. Checks: the name and version rules of the queue; the `rollback`
folder and `<pkg>/` are real directories (`lstat`, no links) owned by root and not group/other writable; the file's
name parses as `<pkg>_<version>_<arch>.deb` (arch `[a-z0-9-]`, exactly two `_`) with that version; it is a regular
root-owned file, not group/other writable, with one link. Then, just before the exec, `<prefix>/usr/bin/dpkg-deb -f
<file> Package Version` (stdin and stderr `/dev/null`, `PATH` and `LANG=C` only) must print exactly `Package: <pkg>`
and `Version: <version>`, so a file whose name lies is refused. apt-get (not `dpkg -i`) takes the file by its
absolute path, so dependencies the old version needs come from the sources, and `--allow-downgrades` lets `-y` take
an older version. Since everything on the path is root's and only root can write it, mobile can't swap the file
between the checks and apt. A missing folder lists nothing (exit 0); anything refused is exit 64 with the reason.

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

**IPAs (F59):** `install-ipa <path>` takes one file, `/var/mobile/Library/Caches/com.ryha.cydian/ipa/<name>.ipa`
(`HELPER_IPA_DIR`, where Apt.swift's `ipa.install` downloads; name `[A-Za-z0-9][A-Za-z0-9._-]*.ipa`, at most 255
bytes). `ipa.c` opens it with `O_NOFOLLOW` through the real directory (iOS's `/var` -> `/private/var` aside, no
link), and wants a plain file with one link, owned by the directory's owner and not root, at most 8 GiB. It copies it
into a root-owned `/var/tmp/cydian-ipa.XXXXXX/app.ipa` (`HELPER_IPA_WORK`), and `<prefix>/usr/bin/unzip` unpacks that
**as the file's owner** (mobile, never root) into `pkg/`, so a hostile zip's links or `../` can only write where mobile
can. The bundle id comes from `Payload/<the one>.app/Info.plist` (`O_NOFOLLOW`, CFPropertyList, `[A-Za-z0-9.-]`). With
AppSync Unified (its installd dylib in `Library/MobileSubstrate/DynamicLibraries` or `usr/lib/TweakInject`), installd
gets the root-owned copy with `{CFBundleIdentifier}`, as appinst. Without it, `<prefix>/usr/bin/ldid -s` signs the
`.app` ad hoc (as TrollStore Lite; also as mobile) and installd gets the unpacked `.app` with `PackageType: Developer`;
that tree is mobile's, the same trust as mobile running appinst. No ldid, or installd refuses the ad hoc app: exit
**69** with a line saying to install AppSync Unified (or ldid), or to sign the IPA for this iPhone. Progress on fd 3
as `pmstatus:<id>:<percent>:<text>`, `Installed <id>` on stdout. The helper is signed with `entitlements.plist` here
(appinst's: `allowedSPI` Install and InstallForLaunchServices, installd's mach-lookup, `platform-application`).

**Paid packages (F57):** `install-paid <path> <pkg> <version>` takes one file,
`/var/mobile/Library/Caches/com.ryha.cydian/paid/<name>.deb` (`HELPER_PAID_DIR`, where Paid.swift's `paid.install`
downloads the vendor's one-time `authorize_download` URL; name `[A-Za-z0-9][A-Za-z0-9._-]*.deb`, at most 255 bytes),
a package name and a version by the usual rules. `paid.c` opens it as `ipa.c` does (`O_NOFOLLOW` through the real
directory; a plain file, one link, the directory owner's and not root's, at most 1 GiB), copies it into a root-owned
`/var/tmp/cydian-paid.XXXXXX/paid.deb` (`HELPER_PAID_WORK`), and `dpkg-deb -f` reads the copy's control: `Package`
must be the name and `Version` the version asked (rollback's check), so a vendor's or a swapped file can't install
something else. Then apt-get installs the copy (dependencies from the sources), and the directory goes. Exit 64 for
a refused path, file or control, 74 couldn't copy, else apt's.

- **Arguments:** only the verb and package names. A name matches `[a-z0-9][a-z0-9.+-]+` (so never an option), is
  at most 255 bytes, at most 256 of them, and must be known: for `install` a `Package:` line in dpkg's status or an
  apt `*_Packages` list, for `remove`, `hold` and `unhold` in dpkg's status. The last rule stops apt from reading
  an unknown name as a regex (`com.foo.bar` would match `com.foo.bar2`) or a modifier (`foo-` removes, `foo+`
  installs). Virtual packages (only in `Provides:`) are refused for that reason; install the real one.
- **Caller:** real and effective uid 0 (only the entitled app can arrange that), and the parent's executable
  (`proc_pidpath(getppid())`) is the same device + inode as `/var/jb/Applications/Cydian.app/Cydian`.
- **Process:** stdin `/dev/null` (apply-ask: the relay's pipe, above), cwd `/`, fds above 2 closed (3 kept when open, for status), signals default,
  umask 022, and its own environment (`PATH` with the prefix first, `HOME=/var/root`, `LANG=C`,
  `DEBIAN_FRONTEND=noninteractive`; nothing from the caller such as `APT_CONFIG`).
- **Exit:** 64 refused arguments (and install-ipa: not an IPA or not the app's file), 69 install-ipa can't
  install ad hoc, 77 refused caller, 74 `cydian.sources` (or install-ipa's copy) not written, 126 exec failed, anything
  else is apt's/dpkg's.
- **Output:** apt's stdout/stderr are the console; fd 3 carries `pmstatus:`/`dlstatus:` lines (apt) or dpkg's
  status lines for the progress bar.

Files:

- `policy.c/.h`: the checks (names, verbs → argv, known packages, caller, source URIs/suites/components) and the
  `cydian.sources` edit. Pure enough to test on Linux.
- `ipa.c/.h`: install-ipa (F59). Off iOS its installd step only prints what it would install, so the rest is tested
  on Linux (`test_helper.py` InstallIpa).
- `paid.c/.h`: install-paid (F57), tested on Linux (`test_helper.py` InstallPaid).
- `entitlements.plist`: the helper's (F59, appinst's); `../build.sh` signs with it.
- `main.c`: the helper. `CYDIAN_PREFIX` (default `/var/jb`) and `CYDIAN_ROOT_UID` (default 0) are compile-time
  only; the tests change them, the shipped build must not.
- `spawn.c/.h`: the app's side, `cydian_helper_spawn()`: pipes on the child's fds 1-3, `/dev/null` stdin (or a
  pipe, `cydian_helper_spawn_in()`, F63),
  `POSIX_SPAWN_CLOEXEC_DEFAULT` and the persona attributes (99, override, uid/gid 0) on Apple. For the Swift shell
  to call (N3); on Linux it spawns as the current user, for the tests.
- `test_driver.c`, `test_helper.py`: unit tests and the whole chain on Linux (stand-in Cydian → helper → stand-in
  apt-get). `make host` / `make ios` build by hand; `../build.sh` builds both into the .deb (N3).
