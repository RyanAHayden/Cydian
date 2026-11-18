// The JS-to-Swift bridge as R3 proposes it (docs/native.md, "Bridge"), the app:// scheme that serves the bundled
// web files, and the switch for WebKit's private 60 fps rendering preference.
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
            web?.callAsyncJavaScript("ifizboxNative.emit(id, events)", arguments: ["id": id, "events": events],
                                     in: nil, in: .page, completionHandler: nil)
        }
    }

    typealias Handler = (Call) -> Void
    private var methods: [String: Handler] = [:]

    override init() {
        super.init()
        on("ping") { $0.reply(["pong": $0.params["i"] ?? 0], nil) }
        on("page.ready") { $0.reply(nil, nil) }
        on("meter.phase") { c in
            Meter.shared.setPhase(c.params["phase"] as? String ?? "idle")
            c.reply(nil, nil)
        }
        on("meter.samples") { c in
            let ms = (c.params["ms"] as? [NSNumber] ?? []).map(\.doubleValue)
            Meter.shared.addJS(phase: c.params["phase"] as? String ?? "?", ms: ms)
            c.reply(nil, nil)
        }
        on("probe.result") { c in
            Meter.shared.probe = c.params
            c.reply(nil, nil)
        }
        on("demo.install", Bridge.demoInstall)
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

    // Fake apt run: output lines in batches of at most one per 16 ms, an exit event, then the reply.
    private static func demoInstall(_ c: Call) {
        let total = (c.params["lines"] as? NSNumber)?.intValue ?? 1000
        var sent = 0
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now(), repeating: .milliseconds(16))
        timer.setEventHandler {
            let n = min(40, total - sent)
            var events: [[String: Any]] = (0..<n).map {
                ["type": "output", "fd": 1, "text": "Unpacking package-\(sent + $0) (1.0-\($0)) ..."]
            }
            sent += n
            if sent >= total { events.append(["type": "exit", "code": 0]) }
            c.emit(events)
            if sent >= total {
                timer.cancel()
                timer.setEventHandler(handler: nil)
                c.reply(["exitCode": 0], nil)
            }
        }
        timer.resume()
    }
}

// Serves Bundle/web/* as ifizbox://app/*. A real origin (unlike file://), so ES modules, module workers and
// IndexedDB behave as on the site, and nothing ever comes from the network.
final class AppScheme: NSObject, WKURLSchemeHandler {
    static let scheme = "ifizbox"
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
        default: return "application/octet-stream"
        }
    }
}

enum Web {
    static func make(bridge: Bridge) -> WKWebView {
        let c = WKWebViewConfiguration()
        c.setURLSchemeHandler(AppScheme(), forURLScheme: AppScheme.scheme)
        c.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "ifizbox")
        WebKitFeature.set({ $0.contains("60FPS") }, Settings.prefer60, c.preferences)
        let w = WKWebView(frame: .zero, configuration: c)
        w.allowsBackForwardNavigationGestures = false
        w.backgroundColor = .white
        if #available(iOS 16.4, *) { w.isInspectable = true }
        return w
    }
}

// WKPreferences' private feature list (+_features, -_setEnabled:forFeature:, -_isEnabledForFeature:).
// A jailbreak app may use it; the key we want is PreferPageRenderingUpdatesNear60FPSEnabled.
enum WebKitFeature {
    static func all() -> [NSObject] {
        let sel = NSSelectorFromString("_features")
        guard let m = class_getClassMethod(WKPreferences.self, sel) else { return [] }
        typealias F = @convention(c) (AnyClass, Selector) -> Unmanaged<NSArray>?
        let f = unsafeBitCast(method_getImplementation(m), to: F.self)
        return (f(WKPreferences.self, sel)?.takeUnretainedValue() as? [NSObject]) ?? []
    }

    static func key(_ f: NSObject) -> String { (f.value(forKey: "key") as? String) ?? "" }

    static func isOn(_ f: NSObject, _ prefs: WKPreferences) -> Bool {
        let sel = NSSelectorFromString("_isEnabledForFeature:")
        guard let m = class_getInstanceMethod(WKPreferences.self, sel) else { return false }
        typealias F = @convention(c) (WKPreferences, Selector, NSObject) -> Bool
        return unsafeBitCast(method_getImplementation(m), to: F.self)(prefs, sel, f)
    }

    @discardableResult
    static func set(_ match: (String) -> Bool, _ on: Bool, _ prefs: WKPreferences) -> [String] {
        let sel = NSSelectorFromString("_setEnabled:forFeature:")
        guard let m = class_getInstanceMethod(WKPreferences.self, sel) else { return [] }
        typealias F = @convention(c) (WKPreferences, Selector, Bool, NSObject) -> Void
        let f = unsafeBitCast(method_getImplementation(m), to: F.self)
        return all().filter { match(key($0)) }.map { f(prefs, sel, on, $0); return key($0) }
    }

    static func frameRateFeatures() -> [(key: String, on: Bool)] {
        let prefs = WKPreferences()
        return all().filter { k in ["FPS", "FrameRate", "Refresh"].contains { key(k).contains($0) } }
            .map { (key($0), isOn($0, prefs)) }
    }
}
