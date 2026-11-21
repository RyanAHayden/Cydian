# B228: Lite install lines through os_log public

## What

R31 (journal/2026-11-19-r31-lite-ios27-eviction) found that on iOS 27 nothing logged with NSLog reaches the device
log; only `IDevice.ilog` (os_log `%{public}@`) does. In `native/Sources/Sideload.swift`:

- New `DeviceLog.say(_:)`: `os_log("%{public}@", log: OSLog(subsystem: "ifizbox.sideload", category: "install"),
  type: .default, s)`, the same form as `IDevice.ilog`. `import os` added.
- The lines the task names now go through it: `InstallLog.say` (all install-server lines, B89's frozen / listens
  again / uploading-to-the-Signing-Server notes and B29's request lines, since InstallServer and InstallPrompt
  only reach the log through `InstallLog.say`), KeepAlive's interruption line (its only log line) and the install
  watch's summary.
- First pass also converted B146's "not installed" line and the three `[sideload]` lines (plain-http download,
  missing https twin, HostUpload's retry). The spec review flagged them as not asked, so they are reverted here
  and filed as a follow-up. Other files' NSLogs (Apt.swift, Launch.swift, …) are left as they are too.
- Subsystem `ifizbox.sideload` (IDevice uses `ifizbox.idevice`): idevicesyslog / syslog live show every
  subsystem, so the name only matters for `log stream --predicate` filtering. The summary line stays well under
  os_log's ~1 KB dynamic-string limit.
- The `%` → `%%` escaping is gone: the text is now an argument, not the format string.

Line text is unchanged, so a syslog grep for `iFizBox install <bundle id>:` finds them.

## Checks

- `DeviceLog` and an interpolation like the retry line typecheck with `xcrun swiftc -typecheck` on the MBA
  (macOS SDK; the MBA has no iphoneos SDK, but `os_log`/`OSLog` are the same API).
- `tools/check.sh` via `run done`.

## Not verified

- The full app build: no Swift toolchain on this Linux box and no iOS SDK on the MBA, so the edited file was not
  compiled in context (only the helper alone).
- That the lines now show in `idevicesyslog` / `pymobiledevice3 syslog live` on an iOS 27 phone: needs a Lite build
  installed on the iOS 27 test phone and an install run; not done in this unattended session. The same os_log form
  already shows there for `IDevice.ilog` (R31), which is the basis for expecting it to work.
