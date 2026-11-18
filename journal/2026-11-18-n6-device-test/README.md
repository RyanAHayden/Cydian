# N6: hand test on the iPhone 7 (iOS 15.8.8, palera1n rootless), done

Third N6 run. Earlier today's run (`journal/2026-11-18-n6-hand-test/`) had no root; sudo is passwordless now, so
this run drove every step on the phone through `tools/ui-7.sh` and checked each result over ssh. Screenshots:
`ref/7/screens/n6-*.png` (gitignored, main checkout's `ref/`).

## What I did, and what each step showed
- **Upgrade of Cydian itself:** `native/build.sh deb` (0.3.8-765), `sudo apt-get install /tmp/Cydian.deb` over 741:
  fine, daemon loaded (`launchctl list` shows `com.ryha.cydian.upgrades`).
- **Add source:** Sources > Add, typed `ios.jjolano.me` on the keyboard (taps), Add Source. The stanza landed in
  `cydian.sources`, the source showed in the list with 23 packages, sections listed. Works.
- **Install:** Search > `tree` (Procursus) > Install > Confirm. Console ran to "Installed tree"; `dpkg -s tree`
  installed, `/var/jb/usr/bin/tree` present. First real run of the helper through the persona spawn (N3): works.
- **Upgrade:** rebuilt tree's .deb as 2.0.0 and `dpkg -i` it, relaunched Cydian: Changes lists tree 2.0.1, badge 1
  on the tab, Upgrade (1) > Confirm: "Unpacking tree (2.0.1) over (2.0.0)", `dpkg -s` says 2.0.1. The 14
  same-version "reinstalls" apt reports are not counted (Changes and the daemon both say 1).
- **Remove:** Installed > Recent > tree > Modify > Remove > Confirm: gone from dpkg and from disk.
- **Notification (N5 daemon):** with tree's upgrade pending, `sudo cydian-upgrades --force`: "1 upgrades, new since
  the last notification", exit 0, **but nothing showed up**. Bug 1 below. After the fix: "1 Upgrade / tree 2.0.1 is
  available." in Notification Centre ("now"), badge 1 on the Cydian icon; a second run says "1 upgrades" (not
  new) and posts nothing. Opening Changes cleared the badge.
- **Install from an unsigned repo:** Refresh failed (bug 2). After the fix, Refresh finishes with no error and
  AltList (BigBoss, unsigned) installs: "Authentication warning overridden ... Installed AltList".
- **Uninstall:** `sudo apt-get remove com.ryha.cydian`: app gone from `/var/jb/Applications`, `libexec/cydian` gone,
  daemon unloaded (`launchctl list` has no cydian). Reinstalled 0.3.8-765, launched once and allowed
  notifications, so the phone is left with a current Cydian, notifications on.
- Cleanup: removed tree and AltList, the jjolano stanza and its apt lists, and `/tmp/n6` on the phone.

## Bugs found and fixed
1. **The notification permission never stuck, so N5's notifications and badge were dropped.** iOS showed "Cydian
   Would Like to Send You Notifications" on every launch; Allow did nothing, and Cydian was missing from Settings >
   Notifications. Sileo's Info.plist has `SBAppUsesLocalNotifications = true` and Cydian's had not: an app in
   `/Applications` (a system app to iOS) gets no BulletinBoard section without it. Fix: the key in
   `native/Info.plist` (+ `test_local_notifications_key`). After a reinstall the prompt came once, Allow stuck
   (`VersionedSectionInfo.plist` has the section), and the daemon's notification and badge show.
2. **Refresh failed on every palera1n phone, and packages from unsigned repos couldn't be installed.**
   "apt-get update failed (100): E: The repository 'https://repo.palera.in ./ InRelease' is not signed." BigBoss,
   Cydian's own GitHub repo, jjolano and repo.palera.in (key missing) are all unsigned; apt refuses each one, so
   their packages were never in apt's lists, and an install from one stops at "There were unauthenticated
   packages and -y was used without --allow-unauthenticated". Fix, as Sileo and Zebra do it:
   `-o Acquire::AllowInsecureRepositories=true` on the helper's `update` and the daemon's update, and
   `--allow-unauthenticated` on the helper's install/remove/upgrade/simulate/apply/apply-ask and the daemon's
   automatic installs. `AllowDowngradeToInsecureRepositories` stays false, so a repo that was signed can't drop its
   signature unnoticed. Local .deb verbs (install-deb, install-paid, rollback) didn't need it. Tests:
   `test_helper.py` argv expectations; doc: `native/helper/README.md` "Unsigned repos (N6)".

## What failed / dead ends
- HookKit Framework (jjolano) still fails after fix 2: its `Filename:` is an absolute GitHub URL, which apt appends
  to the repo URL (404). Filed **F131** (Sileo supports these).
- A failed job stays in the queue (the "Q'd" badge) and runs again with the next install, as in Cydia. Confirm >
  Cancel clears it. Left as is.
- `cydian://sources` / `cydian://changes` on a cold launch open Home. Filed **B14** (low).
- The console repeats "Retrieving file 1 of N" five or six times. Filed **C6** (low).
- Tapping the notification in Notification Centre through `phonectl tap` did nothing, unlocked or locked; I
  couldn't tell whether that's phonectl's synthetic touch or the app. See Not verified.

## Not verified
- That tapping the "n Upgrades" notification opens Changes (the `#/changes` route): phonectl's tap on the
  Notification Centre cell does nothing. A person should tap it once.
- The daemon's launchd schedule (only started by hand with `--force`); the 23-hour rule was not waited out.
- Installing from a signed third-party repo that isn't Procursus (Chariz): not tried, Procursus covers signed.
- The sideload IPA build also carries `SBAppUsesLocalNotifications` (mkipa overlays Info-sideload.plist). It's
  ignored for user apps, but no sideload build was installed to check.
