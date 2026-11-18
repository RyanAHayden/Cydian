# T5: mkdeb.py/mkipa.py check N5's daemon

## Done
- `native/mkdeb.py check` now requires, besides what it checked already:
  - `/var/jb/usr/libexec/cydian/cydian-upgrades`: mode 0755 (no setuid), a signed arm64 iOS MH_EXECUTE, with
    `com.apple.private.usernotifications.bundle-identifiers` listing `com.ryha.cydian` (read from the code
    signature with mkipa's `macho_entitlements`, imported inside the function since mkipa imports mkdeb).
  - `/var/jb/Library/LaunchDaemons/com.ryha.cydian.upgrades.plist`: mode 0644, Label
    `com.ryha.cydian.upgrades`, ProgramArguments[0] the daemon's path.
  - postinst runs `launchctl load <job>`; prerm is executable and runs `launchctl unload <job>` (one step past
    the brief: an unload-less prerm leaves a dead job after removal).
- `native/mkipa.py check` refuses `cydian-upgrades`, `com.ryha.cydian.upgrades.plist` and anything under a
  `LaunchDaemons/` dir. The notification entitlement on the app was already refused (it starts with
  `com.apple.private.`); a test now pins that.
- Tests: test_native.py (daemon missing/unentitled/wrong entitlement/wrong arch/setuid, job missing/writable/wrong
  label/wrong program, postinst/prerm without launchctl, daemon entitlements file), test_ipa.py (daemon files,
  notification entitlement).

## Tried and changed
- Mode tests first wrote files with 0o4755/0o666: `mkdeb.build` normalises every mode to 0755/0644, so the check
  never saw them. The tests now patch `mkdeb._walk`'s output to put the odd mode into the tar.

## Not verified
- On a device: no jailbroken test phone (user, N5). The checks hold the package shape only.
- If a build machine has neither ldid nor rcodesign, the daemon now fails `mkdeb.py check` (no entitlements)
  where before stage.sh only warned. Intended: such a daemon can't post notifications.
