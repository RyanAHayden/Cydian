// F323: the Home Screen icon follows the theme (Settings > Theme > App Icon). The page works out which icon each
// mode shows (web/app/appicon.js: Match Theme gives the themes' icons, else the Light and Dark picks) and sends
//   app.icon {light, dark, onScreen} -> {name, changed, quiet}
// light/dark: the icon iOS should draw on a light and on a dark Home Screen; onScreen: the icon of the tone the app
// shows now. The shell picks the set (icon/alternates.py lists them, Info.plist's CFBundleAlternateIcons names them)
// and switches with setAlternateIconName; `name` is the set ("AppIcon" for the primary), `changed` whether it
// switched, `quiet` whether it went without iOS's "You have changed the icon" alert.
//
// iOS 18+ draws a set's dark appearance on a dark Home Screen, so a (light, dark) pair set does both modes. Pairs
// exist for every light theme or Clear with every dark theme or Clear; anything else (a dark theme's icon picked for
// Light), and iOS 15-17, which only draw the light one, get the one-icon set of the theme on screen. The primary,
// AppIcon, is the default pair (Classic, Gunmetal).
//
// The jailbreak build switches through UIApplication's private _setAlternateIconName:completionHandler:, which
// skips the alert; the sideload build uses the public call and iOS shows its alert (Theme's footer says so).
// iOS only switches while the app is active: a call that comes earlier waits for didBecomeActive.
// SPDX-License-Identifier: GPL-3.0-or-later
import UIKit

enum AppIcon {
    static let primary = (light: "classic", dark: "gunmetal")

    // Info.plist's alternate set names.
    static let sets: Set<String> = {
        let icons = Bundle.main.infoDictionary?["CFBundleIcons"] as? [String: Any]
        return Set((icons?["CFBundleAlternateIcons"] as? [String: Any]).map { Array($0.keys) } ?? [])
    }()

    // The set for these icons; nil is the primary. `variants`: iOS draws appearance variants (18+).
    static func setName(light: String, dark: String, onScreen: String, variants: Bool, sets: Set<String>) -> String? {
        if variants {
            if light == primary.light && dark == primary.dark { return nil }
            let pair = light == dark ? "Icon-\(light)" : "Icon-\(light)-\(dark)"
            if sets.contains(pair) { return pair }
        } else if onScreen == primary.light {
            return nil
        }
        let one = "Icon-\(onScreen)"
        return sets.contains(one) ? one : nil
    }

    static var variants: Bool { if #available(iOS 18.0, *) { return true } else { return false } }

    static func register(_ b: Bridge) {
        b.on("app.icon") { c in
            let word = { (k: String) -> String? in
                guard let s = c.params[k] as? String, s.range(of: "^[a-z0-9]{1,24}$", options: .regularExpression) != nil
                else { return nil }
                return s
            }
            guard let light = word("light"), let dark = word("dark"), let shown = word("onScreen") else {
                return c.reply(nil, "bad_params: light, dark and onScreen are icon names")
            }
            let name = setName(light: light, dark: dark, onScreen: shown, variants: variants, sets: sets)
            DispatchQueue.main.async {
                whenActive {
                    apply(name) { changed, quiet, err in
                        if let err = err { return c.reply(nil, "failed: \(err)") }
                        c.reply(["name": name ?? "AppIcon", "changed": changed, "quiet": quiet], nil)
                    }
                }
            }
        }
    }

    // Runs `f` now if the app is active, else once it becomes active (the latest call wins). On the main queue.
    private static var waiting: (() -> Void)?
    private static var observer: NSObjectProtocol?
    static func whenActive(_ f: @escaping () -> Void) {
        if UIApplication.shared.applicationState == .active { waiting = nil; return f() }
        waiting = f
        guard observer == nil else { return }
        observer = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification,
                                                          object: nil, queue: .main) { _ in
            let f = waiting
            waiting = nil
            f?()
        }
    }

    // On the main queue; `done(changed, quiet, error)` too.
    static func apply(_ name: String?, done: @escaping (Bool, Bool, String?) -> Void) {
        let app = UIApplication.shared
        guard app.supportsAlternateIcons else { return done(false, false, "this iPhone doesn't switch app icons") }
        if app.alternateIconName == name { return done(false, false, nil) }
        let quietly = AppMode.current == .jailbreak && quiet(name) { e in
            DispatchQueue.main.async { done(e == nil, true, e?.localizedDescription) }
        }
        if quietly { return }
        app.setAlternateIconName(name) { e in DispatchQueue.main.async { done(e == nil, false, e?.localizedDescription) } }
    }

    // -[UIApplication _setAlternateIconName:completionHandler:]: the public call without its alert. false when this
    // iOS has no such method (the public one is used then).
    typealias Done = @convention(block) (NSError?) -> Void
    static func quiet(_ name: String?, _ done: @escaping (NSError?) -> Void) -> Bool {
        let app = UIApplication.shared
        let sel = NSSelectorFromString("_setAlternateIconName:completionHandler:")
        guard app.responds(to: sel), let m = class_getInstanceMethod(type(of: app), sel) else { return false }
        typealias F = @convention(c) (AnyObject, Selector, NSString?, Done) -> Void
        let f = unsafeBitCast(method_getImplementation(m), to: F.self)
        let block: Done = { e in done(e) }
        f(app, sel, name as NSString?, block)
        return true
    }
}
