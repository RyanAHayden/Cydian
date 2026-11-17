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
                     "ios": UIDevice.current.systemVersion, "mode": AppMode.current.rawValue], nil)
        }
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
