# B59: unsigned IPAs need application-identifier even with AppSync

installd refuses an app whose main binary has no `application-identifier` entitlement ("Application is missing the
application-identifier entitlement"), AppSync Unified or not (R21, F189's screenshot with opentennis v1.7.2's
`opentennis-ios.ipa`, which ships an unsigned `OpenTennis.app/opentennis`).

## Checked on the 7 first (by hand, as mobile)

- `ldid -e <unsigned binary>` exits 1: "ldid: -e, -q, and -h requre a signed binary". So "ldid -e failed" means "no
  entitlements at all".
- The phone's ldid (2.1.5-procursus7) has `-M`: merge with the existing entitlements. `ldid -M -Sent.xml bin` kept a
  key it already had (`get-task-allow`) and the new keys won over old ones with the same name. So there is no plist
  merging to write in C: write a small ent.xml with the two keys and let ldid merge.

## What I did

`native/helper/ipa.c`:

- `fakesign()`: reads `CFBundleExecutable` from the unpacked app's Info.plist (a plain name: no `/`, not `.`/`..`;
  the binary must be a regular file, lstat), runs `ldid -e <bin>` as the IPA's user with stdout captured
  (`run_as_capture`, a pipe, capped at 4 MiB). If it shows an `application-identifier`, nothing changes. Otherwise it
  writes `<work>/ent.xml` (root-owned work dir, 0644) with `application-identifier` `<TEAM>.<bundle id>` and
  `com.apple.developer.team-identifier` `<TEAM>`, and runs `ldid -M -S<ent.xml> <the .app>` as the user (the whole
  bundle, see "On the 7" below). TEAM is the
  binary's own team id when it has a usable one (10 of `[A-Z0-9]`), else `FAKESIGNED`.
- AppSync path: when ldid is there, `fakesign` first. If it signed, installd gets the unpacked .app (PackageType
  Developer), since the phone has no `zip` to pack the IPA back; otherwise the IPA as before. No ldid: as before.
- No-AppSync path: `ldid -s` on the .app as before, then `fakesign` (`-s` keeps entitlements but adds none).
- Only the main binary's entitlements decide whether to sign. ldid signs the nested code too when it signs the
  .app; `-M` should keep each nested binary's own entitlements but merge ours in (not checked: no IPA with an
  extension or framework was tried).
- New progress line: `pmstatus:<id>:45:Adding the application-identifier entitlement (ldid)`.
- `ipa.h`: `helper_ipa_team_ok`, `helper_ipa_exe_ok`.

`native/helper/test_helper.py`: the ldid stand-in now understands `-e` (prints `<bin>.ent` from the fixture or
fails like ldid on unsigned binaries) and `-M -S` (prints the entitlements it got, fails when `<bin>.nosign`
exists). New tests: AppSync + unsigned (fakesigned, .app installed, FAKESIGNED team), own team id reused, a bad
team id not reused, AppSync + already has application-identifier (IPA as is, no signing), AppSync with no ldid,
no-AppSync order (`-s` then `-M`), and refusals (`../Demo`, missing executable, no CFBundleExecutable, ldid failing).

## On the 7 (build 0.9.7-1435 from this branch)

1. First version signed only the main binary (`ldid -M -S<ent> <bin>`). opentennis v1.7.2's IPA **installed**
   (console: "Adding the application-identifier entitlement (ldid)", "Installed OpenTennis (io.github.fizl0.hst)",
   icon on the home screen), but **wouldn't launch** (the user saw it too: the icon dims, nothing opens). No process,
   no crash report. `oslog` (installed from Procursus for this; see below) showed SpringBoard:
   `signature state: Generic, reason: Error - -402620388: reason: No code signature found` → RequestDenied
   "Unable to launch … invalid code signature, inadequate entitlements or its profile has not been explicitly
   trusted". The binary itself ran fine from ssh.
2. Tried: adding `get-task-allow` to the installed binary in place: still denied.
3. Tried: signing the whole .app (`ldid -M -S<ent> OpenTennis.app` makes `_CodeSignature/CodeResources`), zipped on
   the desktop, installed through iFizBox: still denied, same log line.
4. Cause: AppSync Unified's FrontBoard hook (`AppSyncUnified-FrontBoard.dylib`, filter com.apple.FrontBoard) wasn't
   in SpringBoard: SpringBoard had run since 03:26, AppSync went in at 19:39 without a respring (R21 only noticed the
   installd half working). `sbreload` (respring, keeps the jailbreak), then the launch got past the signature check
   and OpenTennis **opened** ("Hot Shots Tennis needs your disc image" screen). docs/iphone7.md now says so.
5. I kept the whole-.app signing (the helper now passes the .app to `ldid -M -S`): it is what fakesigners do, it
   seals the bundle and `-M` keeps each binary's own entitlements. Whether binary-only would also launch with the
   hook loaded wasn't tested separately (see Not verified).
6. Also: `ldid -e` on an unsigned binary printed "ldid: -e, -q, and -h requre a signed binary" into the console;
   the probe's stderr now goes to /dev/null.

`native/fake/ifizbox-helper` (the shell fake for the UI tests) is unchanged: its exit codes and final lines are the
same; only a new 45% pmstatus line would differ, which no UI test looks at.

## Final check on the 7

The final code (whole-.app signing, quiet probe), rebuilt as 0.9.7-1435 and reinstalled (`--reinstall`; the
helper's sha256 matched the .deb's). opentennis v1.7.2's unsigned `opentennis-ios.ipa` through
`ifizbox://install?url=…`: console "Adding the application-identifier entitlement (ldid)", "Installing (AppSync
Unified)", "Installed OpenTennis (io.github.fizl0.hst)"; the installed bundle has `_CodeSignature/CodeResources`;
`uiopen --bundleid io.github.fizl0.hst` opened it (process running, the game's disc-image screen). The user also
saw it open.

Left on the phone: OpenTennis installed (the user was using it), the 0.9.7-1435 build of this branch. Removed:
`oslog`, my files in /var/mobile/Documents and /tmp. The tunnel and http server are stopped.

## Follow-ups

- B61 (filed): when iFizBox installs AppSync itself (F189, ensureAppSync), the IPA installed right after won't
  launch until a respring (the FrontBoard hook). End that run on Restart SpringBoard, or say so.
- B45 (noted): the user asked why the IPA console's button is Reload Data and not Return; installd shows the icon
  without uicache (checked: the icon was there after Done).
- Checked the open and running tasks for anything that could undo this (the user asked): none lists
  native/helper/** or native/fake/**; B45, B49 and B61 touch web/app/screens/ipa-install.js (the UI around the
  helper call), not the signing.

## Not verified

- An IPA with app extensions or frameworks: ldid signs nested code when it signs the .app; whether `-M` keeps each
  nested binary's entitlements and installd accepts the merged application-identifier there wasn't tried (no such
  test IPA at hand).
- The no-AppSync path (`ldid -s` then `-M -S`) on the phone: AppSync is installed on the 7 and must stay.
- Whether signing only the binary (the first version) would also have launched once the FrontBoard hook was
  loaded: not re-tested after the respring; the whole-.app signing was kept anyway.
- A signed binary that already has entitlements but no application-identifier (the "reuse its team id" path) was
  only checked in the Linux tests, not on the phone.
- iOS build of the helper compiles (the .deb built twice); `test_ios_build` runs in the gate when IOS_SDK is set.
