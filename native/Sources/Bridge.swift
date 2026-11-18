// The JS-to-Swift bridge (docs/native.md, R3 "Bridge"), the cydian://app scheme serving the bundled web/app/, and
// the switch for WebKit's private 60 fps rendering preference. Taken from native/spike/Sources/Bridge.swift.
import UIKit
import WebKit

final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
    // One request from JS: {id, method, params[, stream]}. reply() settles the JS promise; emit() pushes stream events.
    struct Call {
        let id: Int
        let params: [String: Any]
        weak var web: WKWebView?
        let reply: (Any?, String?) -> Void

        func emit(_ events: [[String: Any]]) {
            web?.callAsyncJavaScript("cydianNative.emit(id, events)", arguments: ["id": id, "events": events],
                                     in: nil, in: .page, completionHandler: nil)
        }
    }

    typealias Handler = (Call) -> Void
    private var methods: [String: Handler] = [:]

    override init() {
        super.init()
        on("ping") { $0.reply(["pong": $0.params["i"] ?? 0], nil) }
        on("app.info") { c in
            let info = Bundle.main.infoDictionary ?? [:]
            c.reply(["version": info["CFBundleShortVersionString"] ?? "", "build": info["CFBundleVersion"] ?? "",
                     "ios": UIDevice.current.systemVersion, "jailbreak": Jailbreak.type, "mode": AppMode.current.rawValue,
                     // the model identifier (iPhone17,3), as Cydia's Home footer shows it
                     "machine": { var u = utsname(); uname(&u); return withUnsafeBytes(of: &u.machine) { String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self) } }(),
                     // F49: Telesphoreo's suite is ios/<this %.2f> (core/altstore.js coreFoundationDist)
                     "cf": kCFCoreFoundationVersionNumber,
                     // F56: which jailbreak's marker files exist (core/recommended.js jailbreakFromMarkers)
                     "markers": Jailbreak.markers], nil)
        }
        // The Appearance setting (F23, from screens/settings.js applyTheme): {style: auto|light|dark, theme}.
        on("app.theme") { c in
            DispatchQueue.main.async {
                if let w = c.web?.window { Theme.apply(style: c.params["style"] as? String ?? "auto",
                                                       theme: c.params["theme"] as? String ?? "light", to: w) }
                c.reply(nil, nil)
            }
        }
        SelfUpdate.register(self) // F61: selfupdate.download, app.quit (below)
        Apt.register(self) // N3: apt's files, the network, cydian-helper, haptic.tap (Apt.swift)
        Paid.register(self) // F57: vendors' calls, UDID, Keychain, sign-in sheet, paid installs (Paid.swift)
        SignBridge.register(self) // I6: sign and install IPAs on the phone, sideload build (SignBridge.swift)
        Notifications.register(self) // F65: app.badge, the icon badge (Notifications.swift)
        Prefs.register(self) // F70: prefs.set, N7's settings for the daemon (below)
        Incoming.register(self) // F75: cydian:// links for the page, app.takeURL and app.gunzip (App.swift)
        BackgroundCheck.register(self) // I3: updates.watch, the sideload build's background update check
    }

    func on(_ method: String, _ h: @escaping Handler) { methods[method] = h }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let method = body["method"] as? String else {
            return replyHandler(nil, "bad message")
        }
        guard let h = methods[method] else { return replyHandler(nil, "unknown method \(method)") }
        h(Call(id: (body["id"] as? NSNumber)?.intValue ?? 0, params: body["params"] as? [String: Any] ?? [:],
               web: message.webView, reply: replyHandler))
    }
}

// The jailbreak type for app.info (F38; web/app/device.js turns it into Settings' device type): "roothide" when
// libroothide's jbroot is loaded (Apt.swift's Jailbreak.prefix then comes from it), "rootless" under /var/jb,
// "rootful" when dpkg lives at / and "none" when there is no dpkg at all (the sideload build on a stock iPhone).
extension Jailbreak {
    static let type: String = {
        if dlsym(UnsafeMutableRawPointer(bitPattern: -2), "jbroot") != nil { return "roothide" } // RTLD_DEFAULT
        if prefix == "/var/jb" { return "rootless" }
        return FileManager.default.fileExists(atPath: "/var/lib/dpkg/status") ? "rootful" : "none"
    }()
}

// F56: the marker files jailbreaks leave under the jbroot, for app.info `markers` (core/recommended.js
// jailbreakFromMarkers decides). Each name read in the jailbreak's own source on 2026-11-17:
//   .installed_dopamine   Dopamine (DOBootstrapper.m); nathanlr and NekoJB write it too
//   .installed_nathanlr   nathanlr (usprebooter/main.m, beside its .installed_dopamine)
//   .installed_palera1n   palera1n's loader (LREnvironment.swift); .palecursus_strapped is its bootstrap's
//   etc/apt/sources.list.d/palera1n.sources   palera1n's loader (LRBootstrapper.swift)
//   .installed_nekojb, .xia0o0o0o_jb_installed   jailbreaks Dopamine itself tells apart from its own
// Paths relative to the jbroot, so roothide's random jbroot works as /var/jb does. Empty on a stock iPhone.
extension Jailbreak {
    static let markerFiles = [".installed_dopamine", ".installed_nathanlr", ".installed_palera1n", ".palecursus_strapped",
                              "etc/apt/sources.list.d/palera1n.sources", ".installed_nekojb", ".xia0o0o0o_jb_installed"]
    static var markers: [String] {
        guard !prefix.isEmpty else { return [] }
        return markerFiles.filter { FileManager.default.fileExists(atPath: path("/" + $0)) }
    }
}

// Serves Bundle/web/* as cydian://app/*. A real origin (unlike file://), so ES modules, module workers and
// IndexedDB behave as on the site, and nothing ever comes from the network.
final class AppScheme: NSObject, WKURLSchemeHandler {
    static let scheme = "cydian"
    static func url(_ page: String) -> URL { URL(string: "\(scheme)://app/\(page)")! }
    private let root = Bundle.main.resourceURL!.appendingPathComponent("web").standardizedFileURL

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return task.didFailWithError(URLError(.badURL)) }
        let path = url.path.isEmpty || url.path == "/" ? "index.html" : String(url.path.dropFirst())
        let file = root.appendingPathComponent(path).standardizedFileURL
        let inside = file.path.hasPrefix(root.path + "/")
        let data = inside ? try? Data(contentsOf: file) : nil
        let headers = ["Content-Type": AppScheme.mime(file.pathExtension), "Content-Length": "\(data?.count ?? 0)",
                       "Cache-Control": "no-cache"]
        let resp = HTTPURLResponse(url: url, statusCode: data == nil ? 404 : 200, httpVersion: "HTTP/1.1",
                                   headerFields: headers)!
        task.didReceive(resp)
        task.didReceive(data ?? Data())
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    static func mime(_ ext: String) -> String {
        switch ext {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }
}

// WKPreferences' private feature list (+_features, -_setEnabled:forFeature:). A jailbreak app may use it.
// Missing selectors or keys (an older or newer WebKit) leave WebKit's default in place.
enum WebKitFeature {
    static func all() -> [NSObject] {
        let sel = NSSelectorFromString("_features")
        guard let m = class_getClassMethod(WKPreferences.self, sel) else { return [] }
        typealias F = @convention(c) (AnyClass, Selector) -> Unmanaged<NSArray>?
        let f = unsafeBitCast(method_getImplementation(m), to: F.self)
        return (f(WKPreferences.self, sel)?.takeUnretainedValue() as? [NSObject]) ?? []
    }

    static func key(_ f: NSObject) -> String { (f.value(forKey: "key") as? String) ?? "" }

    @discardableResult
    static func set(_ match: (String) -> Bool, _ on: Bool, _ prefs: WKPreferences) -> [String] {
        let sel = NSSelectorFromString("_setEnabled:forFeature:")
        guard let m = class_getInstanceMethod(WKPreferences.self, sel) else { return [] }
        typealias F = @convention(c) (WKPreferences, Selector, Bool, NSObject) -> Void
        let f = unsafeBitCast(method_getImplementation(m), to: F.self)
        return all().filter { match(key($0)) }.map { f(prefs, sel, on, $0); return key($0) }
    }
}

// What the shell draws itself follows the page's theme: the keyboard, <select> pickers, alerts and menus through the
// window's interface style. Automatic leaves the style to the system, so the
// page's prefers-color-scheme (which follows the window's traits) keeps tracking it. The status bar stays light
// text in both themes: it sits on the blue nav bar in light and on the gunmetal "Status Bar (Black)" in dark.
// The bars themselves are web/app/'s (R3 (a)): the shell draws no UINavigationBar or UITabBar.
enum Theme {
    static func apply(style: String, theme: String, to window: UIWindow) {
        window.overrideUserInterfaceStyle = style == "dark" ? .dark : style == "light" ? .light : .unspecified
        window.rootViewController?.setNeedsStatusBarAppearanceUpdate()
    }
}

// F61: Cydian updates itself (web/app/core/selfupdate.js). The jailbreak build downloads its release's .deb here and
// installs it with `cydian-helper selfupdate <path>` (dpkg -i, native/helper/README.md); the sideload build signs
// its Cydian.ipa through signing.install and needs nothing from here.
//   selfupdate.download {url} -> {path, bytes}   the .deb (an ar archive) in this app's temp folder
//   app.quit                                      to the Home Screen, then exit, so the next launch runs the new build
enum SelfUpdate {
    static func register(_ b: Bridge) {
        b.on("selfupdate.download") { c in
            guard let url = Apt.httpURL(c.params["url"]), url.scheme?.lowercased() == "https" else {
                return Apt.reply(c, nil, "bad_url: not an https URL")
            }
            Apt.get(url) { res in
                switch res {
                case .failure(let e): Apt.reply(c, nil, e.text)
                case .success(let (status, _, data)):
                    guard status < 400 else { return Apt.reply(c, nil, "upstream: HTTP \(status)") }
                    guard data.starts(with: Array("!<arch>\n".utf8)) else { return Apt.reply(c, nil, "upstream: not a .deb") }
                    // The helper takes only [A-Za-z0-9._/-] paths: the temp folder's path is a container UUID or /tmp.
                    let file = FileManager.default.temporaryDirectory.appendingPathComponent("Cydian-update.deb")
                    do {
                        try? FileManager.default.removeItem(at: file)
                        try data.write(to: file, options: .atomic)
                        Apt.reply(c, ["path": file.standardizedFileURL.path, "bytes": data.count], nil)
                    } catch {
                        Apt.reply(c, nil, "network: couldn't save the .deb: \(error.localizedDescription)")
                    }
                }
            }
        }
        // F72: open a link outside the web view (Cydian's own update: the Signing Server's itms-services link, or
        // cydian.dev in Safari). B8: any scheme iOS can hand to an app (feather://, altstore://, sileo://…), not
        // the bundle's own, javascript:, file: or data: (LinkOut.canOpen).
        b.on("app.openURL") { c in
            guard let s = c.params["url"] as? String, let url = URL(string: s), LinkOut.canOpen(url) else {
                return Apt.reply(c, nil, "bad_url: not a URL another app can open")
            }
            LinkOut.open(url) { ok in c.reply(["opened": ok], nil) }
        }
        b.on("app.quit") { c in
            DispatchQueue.main.async {
                c.reply(nil, nil)
                // Cydia's "Close Cydia" (finish:reopen): suspend to the Home Screen, then end the process.
                UIApplication.shared.perform(#selector(NSXPCConnection.suspend))
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { exit(0) }
            }
        }
    }
}

// F70: N7's daemon (native/daemon/main.m e_settings) reads the automatic-install settings from Cydian's preferences,
// com.ryha.cydian for user mobile through cfprefsd, not from the web view's localStorage. web/app/settings.js
// createPrefsMirror sends them here at launch and on every change:
//   prefs.set {values: {"cydian.<key>": string | bool | number | [string] | null}} -> nil   null removes the key
// Only the daemon's keys (core/settings.js DAEMON_KEYS, DAEMON_LISTS) are taken; anything else is refused.
enum Prefs {
    static let domain = "com.ryha.cydian" as CFString
    static let scalars: Set<String> = ["cydian.checkUpdates", "cydian.cellular", "cydian.autoInstall",
                                       "cydian.autoInstallIdle", "cydian.respring", "cydian.keepVersions"]
    static let lists: Set<String> = ["cydian.holds", "cydian.autoMarked"]

    // The value to store, or nil to remove the key; .none when the value isn't one this key takes.
    static func value(_ key: String, _ v: Any) -> CFPropertyList?? {
        if v is NSNull { return .some(nil) }
        if lists.contains(key) {
            guard let a = v as? [Any], a.allSatisfy({ $0 is String }) else { return .none }
            return .some((a as NSArray) as CFArray)
        }
        guard scalars.contains(key) else { return .none }
        if let n = v as? NSNumber { return .some(n) } // JS booleans arrive as NSNumber (CFBoolean) and stay booleans
        if let s = v as? String { return .some(s as CFString) }
        return .none
    }

    static func register(_ b: Bridge) {
        b.on("prefs.set") { c in
            guard let values = c.params["values"] as? [String: Any] else { return c.reply(nil, "bad_params: no values") }
            var bad: [String] = []
            for (k, v) in values {
                guard let stored = value(k, v) else { bad.append(k); continue }
                CFPreferencesSetAppValue(k as CFString, stored, domain)
            }
            CFPreferencesAppSynchronize(domain)
            c.reply(nil, bad.isEmpty ? nil : "bad_params: \(bad.sorted().joined(separator: ", "))")
        }
    }
}
