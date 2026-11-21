# B286: Keychain restore lines through os_log

R61 found that the "restored from the keychain" lines show only as `<private>` in iOS 27's syslog, because they
used NSLog.

## What changed
- `native/Sources/PhoneID.swift`: "phone UDID restored from the keychain" now goes through a private `say()` that
  calls `os_log("%{public}@", …)` (subsystem `ifizbox.phone`, category `keychain`). This works the same way as
  `Tailscale.log` and `IDevice.ilog`.
- `native/Sources/SignStore.swift`: "signing certificate restored from the keychain", "signing profile restored
  from the keychain" and the "signing profile not restored: …" failure from the same restore step now use the same
  `say()` (subsystem `ifizbox.signing`, category `keychain`).
- The wording is unchanged and still starts with `Brand.name`, so a device check can grep for the same text.

Left as NSLog on purpose, because the task names only the restore lines: "keychain refused the phone UDID / the
signing …" (the keep/write side) and "ifizbox-helper udid didn't answer" (jailbreak build).

## Checks
- `tools/check.sh` (via `run done`) builds the deb and IPA with the iOS SDK (`native/build.sh --probe` passed), so
  both files compile with `import os`.

## Not verified
- I didn't check on a phone that the lines now show readable in iOS 27's syslog. The test means deleting and
  reinstalling the Lite app on the iPhone 15 Pro, which R61 has just restored and which other slots use. The same
  `%{public}@` pattern already shows readable there for `Tailscale.log` and `IDevice.ilog`.
