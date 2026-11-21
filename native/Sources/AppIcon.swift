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
        OwnIcons.register(b) // F329
        b.on("app.icon") { c in
            let word = { (k: String) -> String? in
                guard let s = c.params[k] as? String, s.range(of: "^[a-z0-9]{1,24}$", options: .regularExpression) != nil
                else { return nil }
                return s
            }
            guard let light = word("light"), let dark = word("dark"), let shown = word("onScreen") else {
                return c.reply(nil, "bad_params: light, dark and onScreen are icon names")
            }
            // F329: with your own icon in either mode, the icon of the tone on screen (loose sets have no dark look)
            if [light, dark, shown].contains(where: OwnIcons.isOwn) { return OwnIcons.applyShown(shown, c) }
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

// F329: your own icons (web/app/screens/appicon.js). The page crops a picture to 1024 px; it's kept here, in the app's
// container (Application Support/<bundle id>/AppIcons/<name>.png, the list in index.json), and served to the page as
// appicon/<name>.png (Bridge.swift AppScheme).
//   app.icon.list                -> {icons: [{name, label}]}
//   app.icon.add {data, crop: {x, y, size, width, height}, label} -> {name, icons}   the picture (base64) and the
//                                square the page showed, drawn at 1024 px
//   app.icon.remove {name}       -> {icons}
//   app.icon.decode {data}       -> {jpeg}           a picture the web view can't draw (HEIC on iOS 15), as JPEG
// Applying one (app.icon with an own name): the jailbreak build draws it at 120 and 180 px into AppIcons/Apply/, the
// helper copies them over one of Info.plist's two own sets (helper/ownicon.h, icon/alternates.py OWN_SLOTS), the
// one not on screen, and the shell switches to it quietly. The sideload build can't (its signed bundle can't gain
// icons): the page doesn't offer Add there, and app.icon answers lite_unsupported.
enum OwnIcons {
    static func isOwn(_ s: String) -> Bool { s.range(of: "^own[a-z0-9]{1,16}$", options: .regularExpression) != nil }

    static let dir: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent(Bundle.main.bundleIdentifier ?? "app").appendingPathComponent("AppIcons")
            .standardizedFileURL
    }()
    static func file(_ name: String) -> URL { dir.appendingPathComponent(name + ".png") }
    private static var index: URL { dir.appendingPathComponent("index.json") }
    private static let lock = NSLock()

    static func list() -> [[String: String]] {
        guard let d = try? Data(contentsOf: index), let a = try? JSONSerialization.jsonObject(with: d) as? [[String: String]]
        else { return [] }
        return a.filter { isOwn($0["name"] ?? "") && FileManager.default.fileExists(atPath: file($0["name"]!).path) }
    }

    private static func save(_ a: [[String: String]]) throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: a).write(to: index, options: .atomic)
    }

    // A square PNG of `image` at px x px, opaque (iOS draws an icon's transparent parts black, so it's drawn on black).
    static func png(_ image: UIImage, px: Int) -> Data? {
        let f = UIGraphicsImageRendererFormat()
        f.scale = 1
        f.opaque = true
        let size = CGSize(width: px, height: px)
        return UIGraphicsImageRenderer(size: size, format: f).pngData { ctx in
            UIColor.black.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    // The square `crop` (x, y, size in the picture's px as the page showed it: EXIF orientation applied, which
    // UIImage's draw applies too) drawn at px x px. nil when the picture can't be read or the square isn't inside it.
    static func cropped(_ data: Data, crop: [String: Double], px: Int) -> Data? {
        guard let image = UIImage(data: data), image.size.width > 0, image.size.height > 0,
              let x = crop["x"], let y = crop["y"], let size = crop["size"], size > 0 else { return nil }
        let w = image.size.width * image.scale, h = image.size.height * image.scale
        // The page measured the picture it drew; a decoded copy of another size is scaled to it
        let k0 = (crop["width"]).map { $0 > 0 ? w / $0 : 1 } ?? 1
        let (sx, sy, side) = (x * k0, y * k0, size * k0)
        guard sx >= -1, sy >= -1, sx + side <= w + 1, sy + side <= h + 1 else { return nil }
        let k = CGFloat(px) / side
        let f = UIGraphicsImageRendererFormat()
        f.scale = 1
        f.opaque = true
        let out = CGSize(width: px, height: px)
        return UIGraphicsImageRenderer(size: out, format: f).pngData { ctx in
            UIColor.black.setFill()
            ctx.fill(CGRect(origin: .zero, size: out))
            image.draw(in: CGRect(x: -sx * k, y: -sy * k, width: w * k, height: h * k))
        }
    }

    static func add(_ data: Data, crop: [String: Double], label: String) throws -> String {
        guard let out = cropped(data, crop: crop, px: 1024) else {
            throw BridgeError("bad_image", "The picture couldn't be read.")
        }
        lock.lock(); defer { lock.unlock() }
        var a = list()
        var name = "own" + String(Int(Date().timeIntervalSince1970 * 1000), radix: 36)
        while a.contains(where: { $0["name"] == name }) { name += "x" }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try out.write(to: file(name), options: .atomic)
        let clean = String(label.filter { !$0.isNewline }.prefix(24))
        a.append(["name": name, "label": clean.isEmpty ? "Icon" : clean])
        try save(a)
        return name
    }

    static func remove(_ name: String) throws {
        lock.lock(); defer { lock.unlock() }
        try save(list().filter { $0["name"] != name })
        try? FileManager.default.removeItem(at: file(name))
    }

    // A picture the web view can't draw, as JPEG (at most 4096 px on its long side).
    static func decode(_ data: Data) -> Data? {
        guard let image = UIImage(data: data), image.size.width > 0, image.size.height > 0 else { return nil }
        let k = min(1, 4096 / max(image.size.width * image.scale, image.size.height * image.scale))
        let size = CGSize(width: (image.size.width * image.scale * k).rounded(), height: (image.size.height * image.scale * k).rounded())
        let f = UIGraphicsImageRendererFormat()
        f.scale = 1
        return UIGraphicsImageRenderer(size: size, format: f).jpegData(withCompressionQuality: 0.9) { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    static func register(_ b: Bridge) {
        b.on("app.icon.list") { c in Apt.work(c) { ["icons": list()] } }
        b.on("app.icon.add") { c in
            Apt.work(c) {
                guard let s = c.params["data"] as? String, s.count < 64 << 20, let d = Data(base64Encoded: s),
                      let raw = c.params["crop"] as? [String: Any] else {
                    throw BridgeError("bad_params", "data is a base64 picture, crop its square")
                }
                let crop = raw.compactMapValues { ($0 as? NSNumber)?.doubleValue }
                let name = try add(d, crop: crop, label: c.params["label"] as? String ?? "")
                return ["name": name, "icons": list()]
            }
        }
        b.on("app.icon.remove") { c in
            Apt.work(c) {
                guard let n = c.params["name"] as? String, isOwn(n) else { throw BridgeError("bad_params", "name is an own icon") }
                try remove(n)
                return ["icons": list()]
            }
        }
        b.on("app.icon.decode") { c in
            Apt.work(c) {
                guard let s = c.params["data"] as? String, s.count < 64 << 20, let d = Data(base64Encoded: s) else {
                    throw BridgeError("bad_params", "data is a base64 picture")
                }
                guard let j = decode(d) else { throw BridgeError("bad_image", "The picture couldn't be read.") }
                return ["jpeg": j.base64EncodedString()]
            }
        }
    }

    // ---- Applying (jailbreak build)

    static func setName(_ slot: String) -> String { "Icon-own\(slot)" }
    static func stem(_ slot: String) -> String { "IconOwn\(slot.uppercased())60x60" }

    // The slot to show the picture in, given the set on screen: the one on screen if its files are the picture
    // already, else the other one (so the switch is a change of name and SpringBoard draws the new picture).
    // `write`: its files need the picture first. `holds(slot)`: that slot's files in the bundle are the picture (a
    // byte compare, so a .deb upgrade, which puts the placeholders back, is noticed).
    static func pick(current: String?, holds: (String) -> Bool) -> (slot: String, write: Bool) {
        let shown = current == setName("a") ? "a" : current == setName("b") ? "b" : nil
        if let s = shown, holds(s) { return (s, false) }
        let target = shown == "a" ? "b" : "a"
        return (target, !holds(target))
    }

    // The picture at 120 and 180 px in AppIcons/Apply/ (what the helper copies), as [@2x, @3x].
    static func render(_ name: String) throws -> [Data] {
        guard let d = try? Data(contentsOf: file(name)), let image = UIImage(data: d) else {
            throw BridgeError("missing", "That icon isn't kept any more.")
        }
        let apply = dir.appendingPathComponent("Apply")
        try FileManager.default.createDirectory(at: apply, withIntermediateDirectories: true)
        return try [(120, "@2x"), (180, "@3x")].map { px, s in
            guard let p = png(image, px: px) else { throw BridgeError("bad_image", "The picture couldn't be drawn.") }
            try p.write(to: apply.appendingPathComponent("IconOwn60x60\(s).png"), options: .atomic)
            return p
        }
    }

    static func holds(_ slot: String, _ pngs: [Data]) -> Bool {
        zip(["@2x", "@3x"], pngs).allSatisfy { s, p in
            FileManager.default.contents(atPath: Bundle.main.bundlePath + "/" + stem(slot) + s + ".png") == p
        }
    }

    // A slot's files in the bundle are the app's to switch to: Info.plist lists the set (a build since F329) and
    // both PNGs are there.
    static func ready(_ slot: String) -> Bool {
        AppIcon.sets.contains(setName(slot)) && ["@2x", "@3x"].allSatisfy {
            FileManager.default.fileExists(atPath: Bundle.main.bundlePath + "/" + stem(slot) + $0 + ".png")
        }
    }

    // SpringBoard keeps the picture it last drew for a set: a slot written again shows its old picture until the app
    // is registered again (uicache, checked on the iPhone 7). That closes the running app, so it waits until the app
    // goes to the background (the Home Screen is then where the picture is looked at): the helper's
    // own-icon-refresh starts uicache -p detached, and iOS closes the app in the background.
    private static var refreshObserver: NSObjectProtocol?
    static func refreshLater() {
        DispatchQueue.main.async {
            guard refreshObserver == nil else { return }
            refreshObserver = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification,
                                                                     object: nil, queue: .main) { _ in
                if let o = refreshObserver { NotificationCenter.default.removeObserver(o) }
                refreshObserver = nil
                var task = UIBackgroundTaskIdentifier.invalid
                task = UIApplication.shared.beginBackgroundTask { UIApplication.shared.endBackgroundTask(task) }
                DispatchQueue.global(qos: .userInitiated).async {
                    let out = try? Helper.run(["own-icon-refresh"], emit: nil)
                    if out?["code"] as? Int != 0 { NSLog("\(Brand.name): own-icon-refresh: \(out?["stderr"] ?? "not run")") }
                    DispatchQueue.main.async { UIApplication.shared.endBackgroundTask(task) }
                }
            }
        }
    }

    // Copies AppIcons/Apply/ (render) into `slot` through the helper. Off the main queue.
    static func write(slot: String) throws {
        let out = try Helper.run(["own-icon", slot, dir.appendingPathComponent("Apply").path], emit: nil)
        guard out["code"] as? Int == 0 else {
            throw BridgeError("helper", (out["stderr"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }

    // app.icon with an own icon in a mode: show `shown` (own, or a theme's icon in its one-icon set).
    static func applyShown(_ shown: String, _ c: Bridge.Call) {
        let finish = { (name: String?) in
            DispatchQueue.main.async {
                AppIcon.whenActive {
                    AppIcon.apply(name) { changed, quiet, err in
                        if let err = err { return c.reply(nil, "failed: \(err)") }
                        c.reply(["name": name ?? "AppIcon", "changed": changed, "quiet": quiet], nil)
                    }
                }
            }
        }
        guard isOwn(shown) else {
            return finish(AppIcon.setName(light: shown, dark: shown, onScreen: shown, variants: AppIcon.variants, sets: AppIcon.sets))
        }
        guard AppMode.current == .jailbreak else {
            return c.reply(nil, "lite_unsupported: the sideload build can't add icons to itself yet")
        }
        guard FileManager.default.fileExists(atPath: file(shown).path) else { return c.reply(nil, "missing: that icon isn't kept any more") }
        DispatchQueue.main.async {
            let current = UIApplication.shared.alternateIconName
            DispatchQueue.global(qos: .userInitiated).async {
                lock.lock(); defer { lock.unlock() }
                do {
                    let pngs = try render(shown)
                    let p = pick(current: current) { holds($0, pngs) }
                    guard ready(p.slot) else { return Apt.reply(c, nil, "old_build: this build has no own icon sets") }
                    if p.write { try write(slot: p.slot); refreshLater() }
                    finish(setName(p.slot))
                } catch let e as BridgeError {
                    Apt.reply(c, nil, e.text)
                } catch {
                    Apt.reply(c, nil, "failed: \(error.localizedDescription)")
                }
            }
        }
    }
}
