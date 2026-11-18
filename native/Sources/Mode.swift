// The app's mode, picked once at launch (task I2): jailbreak when the N2 helper exists where this jailbreak keeps
// it (Jailbreak.helper: /var/jb/... rootless, roothide's jbroot, or / rootful), otherwise sideload. The check is
// native/Sources/mode.c (tested on Linux); the web UI reads it as ifizboxNative.mode (native/bridge.js, filled in by
// Apt.installScript before any page script runs) and from the bridge's app.info.

enum AppMode: String {
    case jailbreak, sideload

    static let current: AppMode = ifizbox_mode_at(Jailbreak.helper) == 1 ? .jailbreak : .sideload
}
