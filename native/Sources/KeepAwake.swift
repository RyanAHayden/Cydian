// F287: app.keepAwake {on}: the screen doesn't auto-lock while work runs (a download, signing, the IPA queue, an apt
// run). The page counts its jobs (web/app/core/keepawake.js) and sends on: true with the first, on: false after the
// last one ends, fails or is cancelled; here that becomes UIApplication.isIdleTimerDisabled. Both builds.
//
// Never stuck on: going to the background turns the idle timer back on (coming back to the front restores what the
// page last asked for), and a page that loads again (a reload, WebKit's content process restarting) starts with
// nothing held, so KeepAwake.reset() from the web view's didCommit clears it.
// SPDX-License-Identifier: GPL-3.0-or-later
import UIKit

enum KeepAwake {
    private static var wanted = false   // what the page last asked for
    private static var watching = false

    static func register(_ b: Bridge) {
        b.on("app.keepAwake") { c in
            let on = c.params["on"] as? Bool ?? false
            DispatchQueue.main.async {
                set(on)
                c.reply(["on": wanted], nil)
            }
        }
    }

    // Main thread only.
    static func set(_ on: Bool) {
        watch()
        wanted = on
        apply()
    }

    static func reset() { if wanted { set(false) } }

    private static func apply() {
        let front = UIApplication.shared.applicationState != .background
        UIApplication.shared.isIdleTimerDisabled = wanted && front
    }

    private static func watch() {
        guard !watching else { return }
        watching = true
        let nc = NotificationCenter.default
        nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in
            UIApplication.shared.isIdleTimerDisabled = false
        }
        nc.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { _ in
            UIApplication.shared.isIdleTimerDisabled = wanted
        }
    }
}
