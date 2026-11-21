# B234: Sideload.swift's last NSLog lines via DeviceLog.say

Sideload.swift had four NSLog lines left after B228, which iOS 27's device log never shows:

- B146's watch line ("not installed; progress seen …")
- `[sideload] plain http download (Install Anyway)`
- `[sideload] no https twin for …`
- HostUpload's `[sideload] <method> <path> failed (…), trying again`

All four now go through `DeviceLog.say` (os_log `%{public}@`, subsystem `ifizbox.sideload`). The text is the same;
format arguments became string interpolation, and B146's `%` → `%%` escape is gone because os_log takes the line as
one public argument, not as a format string. No NSLog is left in the file.

Nothing tried that failed.

**Not verified**

- That the lines show in `pymobiledevice3 syslog live` on an iOS 27 phone: no iOS 27 device is reachable from this
  unattended run. Same route as B228's lines, which were checked there.
- Compile: no swiftc on PATH in this shell; the gate's native build (SWIFT_TOOLCHAIN) compiles it.
