# N6: hand test on the iPhone 7 (iOS 15.8.8, palera1n rootless), partly done, blocked on root

## What I did
- `ssh 7` works as mobile. `sudo -n` asks for a password and `root@` over ssh refuses the key. This run is
  unattended, so I couldn't get the password: nothing that needs root (dpkg -i, apt install/remove, launchctl load,
  the daemon writing its state) could run. Those steps are left for a person (below).
- Built a fresh `native/build.sh deb` (com.ryha.cydian 0.3.7-654), copied it to `/var/mobile/n6` and checked what
  mobile can check:
  - `dpkg-deb -I/-c` on the phone: the control, postinst/prerm and file list are as expected.
  - `apt-get -s install ./Cydian.deb`: it resolves (firmware 15.8.8, uikittools 2.1.7, unzip, ldid all installed),
    1 new package and nothing removed.
  - Entitlements (`ldid -e`) of the app, helper and daemon.
  - Started each binary by hand from the extracted tree: the app stays up (killed by `timeout`, so it gets as far
    as UIApplicationMain), the daemon prints its usage for a bad flag (exit 64), but **cydian-helper was SIGKILLed
    at once (exit 137) with no output**.
- **Bug found and fixed: the helper never ran on a rootless jailbreak.** Bisected on the phone: a plain
  hello-world built by our toolchain is killed too, signed by lld, by `ldid -S` or `ldid -S` with only
  `platform-application`. It runs (exit 3) once signed with `com.apple.private.security.no-container` or
  `com.apple.private.security.no-sandbox`. Procursus's tools (apt-get, unzip) all carry no-container, the daemon
  and the app already had them, but `native/helper/entitlements.plist` (F59, AppSync's appinst set) did not.
  So every root action from the app (install, remove, upgrade, add source through the helper) would have died.
  - Fix: no-container and no-sandbox in `native/helper/entitlements.plist`. The rebuilt helper now runs on the phone
    and refuses mobile as designed: `cydian-helper: not root: Cydian must spawn the helper with the root persona`,
    exit 77.
  - Gate: `mkdeb.check` now flags a helper or daemon with neither entitlement (`UNSANDBOXED`, `_unsandboxed`);
    `test_native.py` gets `test_unsandboxed_flagged` and `test_helper_entitlements`, and its fake helper/daemon
    carry the entitlement.
- Small fix in `native/daemon/main.m`: when the lock file can't be opened (a run by hand without root, or the
  folder missing), it said "another check is running" and exited 0. It now says
  `can't open /var/jb/var/lib/cydian/upgrades.lock: <error>` and exits 1. Checked on the phone.
- Deleted `/var/mobile/n6` on the phone afterwards.

## What failed / dead ends
- `cydian-upgrades --force --no-update --dry-run` as mobile can't count anything: it needs to create
  `/var/jb/var/lib/cydian` (root). Running the helper as mobile only reaches its caller check (by design).
- The share extension also exits 137 when started by hand; that's expected (pkd launches extensions, sandboxed),
  not a bug.

## Still to do, with root (person with the sudo password)
1. `scp native/build/Cydian.deb 7:` then `sudo dpkg -i Cydian.deb` (or open it in Sileo). Icon on the home screen;
   `sudo launchctl list | grep com.ryha.cydian.upgrades`.
2. Add source: Sources > Edit > Add (e.g. a public rootless repo), refreshes with no error, sections listed.
3. Install a small package through the app: progress finishes, `dpkg -s <pkg>` shows it. This is the first real run
   of the helper through the persona spawn (N3), so it's the most important check.
4. Upgrade: `apt-get -s dist-upgrade` on the phone today lists 14 `Inst x [v] (v …)` lines with the same version
   on both sides (reinstalls). The daemon must count 0 for those. For a real upgrade, install an older .deb first.
5. Remove: Remove > Confirm, gone in `dpkg -s` and in the app.
6. Notification: with an upgrade pending, `sudo /var/jb/usr/libexec/cydian/cydian-upgrades --force --dry-run`, then
   without `--dry-run`: "n Upgrades" and a badge. Run again: no second notification.
7. `sudo apt remove com.ryha.cydian`: icon gone, daemon unloaded.

## Not verified
- Install, upgrade, remove, add source from the app, the persona spawn of the helper as root, the daemon's count
  and notification on the device, postinst/prerm: all need root, and the sudo password needs the user.
- That the helper's new entitlements still let `install-ipa` reach installd (F59) when it runs as root: needs root
  and an IPA install.
