# N6: hand test on a modern jailbroken phone (blocked)

## What I did
- Looked for a device this run can reach. `~/.ssh/config` has only `Host 4s`, and the 4S (iOS 6) never runs Cydian
  (rootless, iOS 15+). The N5 note records it: "User 2026-11-17: no jailbroken test phone."
- Without a device, an agent can't do this task. Wrote the checklist below so a person with a phone can run it, then
  blocked the task with `--blocked`.

## Checklist for the person with the phone (rootless jailbreak, iOS 15+)
1. Build on the Mac/Linux box: `native/build.sh deb` gives `native/build/Cydian.deb`. Copy it to the phone and run
   `dpkg -i Cydian.deb` (or install it through Sileo/Zebra). Check that the icon shows up on the home screen and the
   daemon is loaded: `launchctl list | grep com.ryha.cydian.upgrades`.
2. **Add source:** Sources > Edit > Add, enter a repo (e.g. a known public rootless repo), and check that it
   refreshes with no error and that its sections and packages are listed.
3. **Install:** pick a small package, Install > Confirm, then check that the progress screen finishes and
   `dpkg -s <pkg>` shows it installed.
4. **Upgrade:** pick a package that has a newer version in a source (or install an older .deb by hand first). It
   should show up in Changes, and after Upgrade, `dpkg -s` should show the new version.
5. **Remove:** Remove > Confirm, then check that the package is gone in `dpkg -s` and in the app.
6. **Notification (N5 daemon):** with an upgrade pending, delete the daemon's last-run stamp (or wait out the
   23-hour rule) and start it by hand: `launchctl kickstart -k system/com.ryha.cydian.upgrades` (or whatever
   `native/daemon/README.md` says). Expect a "n Upgrades" notification and a badge on the Cydian icon. Run it again:
   with no new upgrades, it must not notify a second time.
7. Uninstall Cydian (`apt remove com.ryha.cydian`) and check that prerm unloads the daemon.

## Not verified
- All of it: add source, install, upgrade, remove, notification, the daemon on a device. There's no modern
  jailbroken phone this run can reach, and the 4S can't run Cydian.
