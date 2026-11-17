// The app's mode, picked once at launch (task I2): jailbreak when the N2 helper exists at its rootless path,
// otherwise sideload. The check is native/Sources/mode.c (tested on Linux); the web UI gets the mode through
// globalThis.cydianApp.mode (set before any page script runs) and the bridge's app.info.

@_silgen_name("cydian_mode")
private func cydian_mode() -> Int32

enum AppMode: String {
    case jailbreak, sideload

    static let current: AppMode = cydian_mode() == 1 ? .jailbreak : .sideload
}
