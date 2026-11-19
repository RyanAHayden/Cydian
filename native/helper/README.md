# native/helper/: ifizbox-helper, the root helper (N2)

How root works and why: docs/native.md, "3. Root". In short: no setuid bit. iFizBox (signed with
`com.apple.private.persona-mgmt`) spawns `/var/jb/usr/libexec/ifizbox/ifizbox-helper` as root with the persona spawn
attributes; the helper checks its words and `execve`s one apt command, or edits iFizBox's one apt source file.

    ifizbox-helper update | upgrade | configure | install <pkg>... | remove <pkg>...
    ifizbox-helper hold <pkg>... | unhold <pkg>... | showhold
    ifizbox-helper addsource <uri> <suite> [component...] | removesource <uri> <suite>
    ifizbox-helper simulate <item>... | apply <item>... | respring          (N4: the install queue)
    ifizbox-helper apply-ask <item>...                                      (F63: apply that asks about conffiles)
    ifizbox-helper install-ipa <path>                                      (F59: an IPA, through installd)
    ifizbox-helper rollbacks <pkg> | rollback <pkg> <version>              (F71: Roll Back to a kept .deb)
    ifizbox-helper install-paid <path.deb> <pkg> <version>                 (F57: a paid package's .deb)
    ifizbox-helper simulate-deb <path.deb> | install-deb <path.deb>         (N9: a .deb shared with iFizBox)
    ifizbox-helper notifications on|off                                     (F65: Upgrade Notifications)
    ifizbox-helper app-versions                                             (I4: installed apps' real versions)
    ifizbox-helper userspace-reboot                                         (N8: the Userspace Reboot intent)
    ifizbox-helper uicache                                                  (F151: the console's Reload Data)
    ifizbox-helper uninstall-app <bundle id>                                (B46: Installed's Delete)
    ifizbox-helper remove-malware <path>...                                 (F232: Malware Found's Delete)

| verb        | runs (from `/var/jb/usr/bin`)                                                               |
|-------------|---------------------------------------------------------------------------------------------|
| `update`    | `apt-get -o Acquire::AllowInsecureRepositories=true [-o APT::Status-Fd=3] update` (unsigned repos; below) |
| `install`   | `apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold --allow-unauthenticated [-o APT::Status-Fd=3] install <pkg>...` |
| `remove`    | same options, `remove <pkg>...`                                                             |
| `upgrade`   | same options, `upgrade`                                                                     |
| `configure` | `dpkg --force-confdef --force-confold [--status-fd 3] --configure -a`                       |
| `hold`      | `apt-mark hold <pkg>...` (F22: Settings > Ignored Upgrades in jailbreak mode)               |
| `unhold`    | `apt-mark unhold <pkg>...`                                                                  |
| `showhold`  | `apt-mark showhold`: the held packages on stdout, one per line                              |
| `addsource` | runs nothing: writes a deb822 stanza (`Types: deb`, `URIs:`, `Suites:`, `Components:`) into `/var/jb/etc/apt/sources.list.d/ifizbox.sources` (F33) |
| `removesource` | runs nothing: drops the stanza for that URI and suite from `ifizbox.sources`              |
| `simulate`  | `apt-get -s --reinstall --allow-downgrades --allow-unauthenticated install <items>`: the Confirm sheet's plan (N4)       |
| `apply`     | `apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold --reinstall --allow-downgrades --allow-unauthenticated [-o APT::Keep-Fds::=3 -o APT::Status-Fd=3] install <items>`, with `CYDIA=3 1` in its environment when fd 3 is open (N4) |
| `apply-ask` | `apt-get -y --reinstall --allow-downgrades --allow-unauthenticated -o APT::Keep-Fds::=3 -o APT::Status-Fd=3 install <items>` (no conffile options; refused without fd 3), `CYDIA=3 1`, as a child whose stdin is a pipe the helper feeds (F63; below) |
| `install-ipa` | runs no apt: installs one IPA through `LSApplicationWorkspace installApplication:withOptions:error:` as AppSync's `appinst` does (`ipa.c`, F59; below) |
| `rollbacks` | runs nothing: `<version> <file>` per line for each .deb of the package N7's daemon kept in `/var/jb/var/cache/ifizbox/rollback/<pkg>/` that `rollback` would take (F71; below) |
| `notifications` | runs nothing: `off` creates `/var/jb/var/lib/ifizbox/upgrades.off` (empty, 0644; the folder 0755 if missing), `on` deletes it (F65, Settings' Upgrade Notifications; N5's daemon reads it, `../daemon/quiet.h`). A symlink or anything but a regular file there is refused (exit 74), never followed. Prints `Upgrade notifications on\|off` |
| `app-versions` | runs nothing: `<id>\t<short>\t<build>\t<store>` per app installd put in `/var/containers/Bundle/Application` (`HELPER_APPS_DIR`): `<UUID>/<the one>.app/Info.plist`'s CFBundleIdentifier, CFBundleShortVersionString and CFBundleVersion, and `<UUID>/iTunesMetadata.plist`'s bundleShortVersionString (App Store apps). Real directories and regular files only (`lstat`, `O_NOFOLLOW`, at most 4 MiB), a bundle id `[A-Za-z0-9.-]`, a value with a control character or over 255 bytes printed empty, at most 4096 apps. A missing folder lists nothing (exit 0), an unreadable one is exit 74 (I4; `ipa.c`) |
| `rollback`  | `apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold --allow-downgrades [-o APT::Keep-Fds::=3 -o APT::Status-Fd=3] install /var/jb/var/cache/ifizbox/rollback/<pkg>/<pkg>_<ver>_<arch>.deb`, `CYDIA=3 1` as for `apply` (F71; below) |
| `install-paid` | `apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold [-o APT::Keep-Fds::=3 -o APT::Status-Fd=3] install /var/tmp/ifizbox-paid.XXXXXX/paid.deb`, `CYDIA=3 1` as for `apply`, after copying and checking the app's download (F57; below) |
| `respring`  | `sbreload`, or `killall -9 backboardd` when the jailbreak has no sbreload (N4: Restart SpringBoard) |
| `userspace-reboot` | `launchctl reboot userspace` (N8: the Userspace Reboot intent and control)              |
| `uicache`   | `uicache -a`: rebuilds the home screen's icon cache (F151: the console's Reload Data after an app was installed) |
| `uninstall-app` | runs nothing: takes a bundle id (`[A-Za-z0-9.-]`), finds the app among installd's containers as `app-versions` reads them (`HELPER_APPS_DIR`; real directories only), and has installd uninstall it (`LSApplicationWorkspace uninstallApplication:withOptions:`, the entitlements' `Uninstall` SPI). A system app or anything in the jailbreak's `/Applications` (iFizBox itself) isn't in the containers, so it is refused (exit 64). `pmstatus:<id>:<percent>:<text>` on fd 3, `Uninstalled <id>` on stdout; installd refusing is exit 1 (B46; `ipa.c`) |
| `remove-malware` | runs no apt: deletes 1 to 16 known-malware tweak dylibs and restarts SpringBoard (F232, Installed's Malware Found alert > Delete). Each path must be spelled exactly `[/var/jb]/Library/MobileSubstrate/DynamicLibraries/<name>` or `[/var/jb]/usr/lib/TweakInject/<name>`, `<name>` one of `main.c`'s `malware_files` (the copy of `web/app/core/known-malware.js` `MALWARE_FILES`; `test_remove_malware.py` keeps them the same). Refused (exit 64, nothing deleted) when any path isn't one of those, is given twice, is missing, isn't a regular file or a link, or when a file of that name in either tweak folder is listed in a `/var/jb/var/lib/dpkg/info/*.list` (that package's Remove takes it away); dpkg's lists unreadable is exit 74. Then `unlinkat` in the opened folder (a link is deleted itself, never followed), `Deleted <path>` on stdout for each, and the `respring` command is `execve`d (its exit status); none deleted is exit 74 |

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
`ifizbox_helper_spawn_in`), only the lines `Y` (accept the new copy) and `N` (keep the old one), `\r` allowed; any
other line is dropped with `ifizbox-helper: ignored an answer that isn't Y or N` on stderr, so dpkg's `D` (diff
through a pager) and `Z` (a root shell) can't be reached. When the app closes its end, apt's stdin is closed too
(a question after that fails as dpkg does at end of file, and `configure` finishes the package). The helper exits
with apt's status when apt-get ends, even while the app's end is still open. Maintainer scripts that read stdin
read this pipe too (as under Cydia, which runs apt the same way); with nothing written they wait, where `apply`'s
`/dev/null` gave them end of file. The app (`Apt.swift` `helper.answer {answer: keep|new}`) writes `N` or `Y`.

**Cancel (F64):** a `C` line on `apply-ask`'s stdin (`\r` allowed) is never passed to apt: the helper sends apt-get
`SIGINT`, as Ctrl-C would, and says `ifizbox-helper: cancelled: stopping apt-get` on stderr. While apt downloads that
ends it (nothing unpacked; partial files stay in `archives/partial` for next time) with exit 130. The app
(`Apt.swift` `helper.cancel`) sends it only before apt's first `pmstatus:` line on fd 3, so dpkg never starts; should
it race one, apt's own SIGINT handler lets the running dpkg call finish and stops after it.

**Roll Back (F71):** N7's daemon keeps the .debs automatic updates replace in `<prefix>/var/cache/ifizbox/rollback/<pkg>/`,
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

**Unsigned repos (N6):** most jailbreak repos have no signed Release (BigBoss, iFizBox's own GitHub repo, and repo.palera.in, whose key palera1n's keyring lacks), and `apt-get update` exits 100 on any one of them, so `update` passes `Acquire::AllowInsecureRepositories=true` and the verbs that install pass `--allow-unauthenticated`, as Sileo and Zebra do. `Acquire::AllowDowngradeToInsecureRepositories` stays false: a repo apt has seen signed can't drop its signature unnoticed. The daemon (`native/daemon/main.m`) passes the same to its update and automatic installs.

**Sources (F33):** sources added in the app go into `ifizbox.sources` and nowhere else, so `apt-get update` and
installs use them; the app never edits apt's other files. Checks: the URI is `http://` or `https://` (lower case), a
host of `[A-Za-z0-9.-]` with an optional `:port`, and a path that starts and ends with `/` of `[A-Za-z0-9._~%+/:=,-]`
with no `.` or `..` segment, at most 1024 bytes (no `user:password@`: the file is world-readable; no spaces, `#`,
newlines, quotes or brackets, so a value can't add a field such as `Trusted: yes`). The suite is `./`, a flat path
ending in `/`, or a name of `[A-Za-z0-9._+/-]` not starting with `-` or `/`, no `..`, at most 255 bytes. A flat suite
takes no components, any other needs 1-16 of `[A-Za-z0-9][A-Za-z0-9._+/-]*` (at most 64 bytes, no `..`). The edit:
an exclusive `flock` on `sources.list.d` (made if missing), read the file (`O_NOFOLLOW`, a regular file of at most
1 MiB, missing is empty), the first stanza naming exactly this URI and suite becomes the new one and any other goes
(a hand-written stanza with several URIs or suites is left alone), new ones go at the end; written to
`.ifizbox.sources.XXXXXX` beside it (apt skips dotfiles), mode 0644, fsync, `rename(2)`. No stanzas left: the file
is removed. Nothing changed: nothing is written. stdout says `Added|Removed <uri> <suite>: ifizbox.sources updated`
or `nothing to change`; exit 0, 64 refused, 74 couldn't write.

**IPAs (F59):** `install-ipa <path>` takes one file, `/var/mobile/Library/Caches/com.ryha.ifizbox/ipa/<name>.ipa`
(`HELPER_IPA_DIR`, where Apt.swift's `ipa.install` downloads; name `[A-Za-z0-9][A-Za-z0-9._-]*.ipa`, at most 255
bytes). `ipa.c` opens it with `O_NOFOLLOW` through the real directory (iOS's `/var` -> `/private/var` aside, no
link), and wants a plain file with one link, owned by the directory's owner and not root, at most 8 GiB. It copies it
into a root-owned `/var/tmp/ifizbox-ipa.XXXXXX/app.ipa` (`HELPER_IPA_WORK`), and `<prefix>/usr/bin/unzip` unpacks that
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
`/var/mobile/Library/Caches/com.ryha.ifizbox/paid/<name>.deb` (`HELPER_PAID_DIR`, where Paid.swift's `paid.install`
downloads the vendor's one-time `authorize_download` URL; name `[A-Za-z0-9][A-Za-z0-9._-]*.deb`, at most 255 bytes),
a package name and a version by the usual rules. `paid.c` opens it as `ipa.c` does (`O_NOFOLLOW` through the real
directory; a plain file, one link, the directory owner's and not root's, at most 1 GiB), copies it into a root-owned
`/var/tmp/ifizbox-paid.XXXXXX/paid.deb` (`HELPER_PAID_WORK`), and `dpkg-deb -f` reads the copy's control: `Package`
must be the name and `Version` the version asked (rollback's check), so a vendor's or a swapped file can't install
something else. Then apt-get installs the copy (dependencies from the sources), and the directory goes. Exit 64 for
a refused path, file or control, 74 couldn't copy, else apt's.

**Shared .debs (N9):** `simulate-deb <path>` and `install-deb <path>` take one file,
`/var/mobile/Library/Caches/com.ryha.ifizbox/deb/<name>.deb` (`HELPER_DEB_DIR`, where the shell stages a .deb another
app shared, `../share/App/ShareBridge.swift`; name as install-paid's). `paid.c` copies it as install-paid does into a
root-owned `/var/tmp/ifizbox-deb.XXXXXX/deb.deb`, with no control check (any .deb: the caller check is
the boundary), then runs `apt-get -s --reinstall --allow-downgrades install <copy>` (the Confirm sheet's plan) or
`apt-get -y` (conffile options) `--reinstall --allow-downgrades [-o APT::Keep-Fds::=3 -o APT::Status-Fd=3] install
<copy>` with `CYDIA=3 1` (the console), so apt pulls dependencies from the sources (`apt install ./file.deb`). Exit 64
for a refused path or file, 74 couldn't copy, else apt's.

- **Arguments:** only the verb and package names. A name matches `[a-z0-9][a-z0-9.+-]+` (so never an option), is
  at most 255 bytes, at most 256 of them, and must be known: for `install` a `Package:` line in dpkg's status or an
  apt `*_Packages` list, for `remove`, `hold` and `unhold` in dpkg's status. The last rule stops apt from reading
  an unknown name as a regex (`com.foo.bar` would match `com.foo.bar2`) or a modifier (`foo-` removes, `foo+`
  installs). Virtual packages (only in `Provides:`) are refused for that reason; install the real one.
- **Caller:** real and effective uid 0 (only the entitled app can arrange that), and the parent's executable
  (`proc_pidpath(getppid())`) is the same device + inode as `/var/jb/Applications/iFizBox.app/iFizBox`.
- **Process:** stdin `/dev/null` (apply-ask: the relay's pipe, above), cwd `/`, fds above 2 closed (3 kept when open, for status), signals default,
  umask 022, and its own environment (`PATH` with the prefix first, `HOME=/var/root`, `LANG=C`,
  `DEBIAN_FRONTEND=noninteractive`; nothing from the caller such as `APT_CONFIG`).
- **Exit:** 64 refused arguments (and install-ipa: not an IPA or not the app's file), 69 install-ipa can't
  install ad hoc, 77 refused caller, 74 `ifizbox.sources` (or install-ipa's copy) not written, 126 exec failed, anything
  else is apt's/dpkg's.
- **Output:** apt's stdout/stderr are the console; fd 3 carries `pmstatus:`/`dlstatus:` lines (apt) or dpkg's
  status lines for the progress bar.

Files:

- `policy.c/.h`: the checks (names, verbs → argv, known packages, caller, source URIs/suites/components) and the
  `ifizbox.sources` edit. Pure enough to test on Linux.
- `ipa.c/.h`: install-ipa (F59). Off iOS its installd step only prints what it would install, so the rest is tested
  on Linux (`test_helper.py` InstallIpa).
- `paid.c/.h`: install-paid (F57), tested on Linux (`test_helper.py` InstallPaid).
- `entitlements.plist`: the helper's (F59, appinst's); `../build.sh` signs with it.
- `main.c`: the helper. `IFIZBOX_PREFIX` (default `/var/jb`) and `IFIZBOX_ROOT_UID` (default 0) are compile-time
  only; the tests change them, the shipped build must not.
- `spawn.c/.h`: the app's side, `ifizbox_helper_spawn()`: pipes on the child's fds 1-3, `/dev/null` stdin (or a
  pipe, `ifizbox_helper_spawn_in()`, F63),
  `POSIX_SPAWN_CLOEXEC_DEFAULT` and the persona attributes (99, override, uid/gid 0) on Apple. For the Swift shell
  to call (N3); on Linux it spawns as the current user, for the tests.
- `test_driver.c`, `test_helper.py`: unit tests and the whole chain on Linux (stand-in iFizBox → helper → stand-in
  apt-get). `make host` / `make ios` build by hand; `../build.sh` builds both into the .deb (N3).
