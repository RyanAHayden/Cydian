// Cydian's jailbreak shell: one window, one WKWebView showing web/app/ from the bundle (docs/native.md, R3 (a)).
// Navigation, push/pop and the edge swipe back are web/app/'s own JS stack; the shell adds nothing on top.
import UIKit
import WebKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        Notifications.shared.start() // F65: permission for N5's daemon, and notification taps (Notifications.swift)
        SignBridge.importBundled() // F75: the certificate the Signing Server put inside Cydian's own IPA
        BackgroundCheck.register() // I3: before launch ends, as BGTaskScheduler requires (sideload build)
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let c = UISceneConfiguration(name: "Default", sessionRole: session.role)
        c.delegateClass = SceneDelegate.self
        return c
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let ws = scene as? UIWindowScene else { return }
        let w = UIWindow(windowScene: ws)
        // N10: the pinstripes, not black, behind everything: nothing dark shows between the launch screen and the page.
        w.backgroundColor = Launch.pinstripes
        w.rootViewController = WebController()
        // Light until the page says otherwise (Settings > Appearance, Light by default): Automatic then lets the window
        // follow iOS, dark included (Theme.apply). Info.plist has no UIUserInterfaceStyle, which would pin it to light.
        w.overrideUserInterfaceStyle = .light
        w.makeKeyAndVisible()
        window = w
        if let u = options.urlContexts.first?.url { Incoming.receive(u) } // F75: launched by a cydian:// link
    }

    // F75: a cydian:// link while Cydian runs (Import from Safari, Open in Cydian App on the website).
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for c in URLContexts { Incoming.receive(c.url) }
    }
}

// F75: cydian://import?d=… and cydian://signing-import#… for the page (web/app/incoming.js). The shell keeps the
// latest one and tells the page there is one ("cydian:url" on window); the page takes it with app.takeURL, also
// once at start, so a link that launched Cydian before the page loaded isn't lost. Only IncomingLink's hosts pass.
//   app.takeURL            -> {url} | null (and forgets it)
//   app.gunzip {data}      base64 gzip -> {text}: cydian://import's payload where WebKit has no DecompressionStream
enum Incoming {
    private static var pending: String?

    static func receive(_ url: URL) {
        if MyIPAs.receive(url) { return } // F77: an .ipa file goes into My IPAs, which then sends cydian://myipas
        guard IncomingLink.accepts(url) else { return }
        pending = url.absoluteString
        notify(tries: 50)
    }

    // The page's hash-style wake-up, as Notifications.open does: wait for the web view to finish loading.
    private static func notify(tries: Int) {
        let web = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.windows.first?.rootViewController?.view as? WKWebView }.first
        guard let web, !web.isLoading, web.url != nil else {
            if tries > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { notify(tries: tries - 1) } }
            return
        }
        web.callAsyncJavaScript("window.dispatchEvent(new Event('cydian:url'))", arguments: [:], in: nil, in: .page,
                                completionHandler: nil)
    }

    static func register(_ b: Bridge) {
        b.on("app.takeURL") { c in
            DispatchQueue.main.async {
                let u = pending
                pending = nil
                c.reply(u.map { ["url": $0] }, nil)
            }
        }
        b.on("app.gunzip") { c in
            guard let d = (c.params["data"] as? String).flatMap({ Data(base64Encoded: $0) }) else {
                return c.reply(nil, "bad_request: data")
            }
            do { c.reply(["text": String(decoding: try gunzip(d), as: UTF8.self)], nil) } catch {
                c.reply(nil, "bad_data: \(error)")
            }
        }
    }
}

final class WebController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let bridge = Bridge()
    private lazy var web = Web.make(bridge: bridge)
    private var cover: UIView?

    override func loadView() { view = web }

    override func viewDidLoad() {
        super.viewDidLoad()
        web.navigationDelegate = self
        web.uiDelegate = self // B8: window.open goes out of the app (LinkOut)
        // N10: the launch screen's Home-as-it-loads, exact for this screen, over the web view until the page has
        // drawn its own (index.html's #boot looks the same), so the hand-over from the launch screen shows no jump.
        if false, let c = Launch.cover(frame: UIScreen.main.bounds) { // off: per-screen images only fit known sizes
            web.addSubview(c)
            cover = c
        }
        web.load(URLRequest(url: AppScheme.url("index.html")))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { dropCover() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { dropCover() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        dropCover()
    }

    // B8 (docs/native.md, "Links out of the app"): Cydian's own pages (cydian:, about:, blob:, data:) load in the
    // web view, and so does anything inside a subframe. Any other main-frame navigation (location.href to https,
    // itms-services, feather://, altstore://, cydia://, sileo://, a target=_blank link) goes to iOS and is cancelled,
    // so Cydian's UI stays where it was. Going straight to iOS also means an itms-services install link shows only
    // iOS's "Install …?" prompt, not WebKit's "Open in iTunes?" first.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        let mainFrame = navigationAction.targetFrame?.isMainFrame ?? true // nil: a new window (target=_blank)
        if !mainFrame || LinkOut.staysInside(url) { return decisionHandler(.allow) }
        decisionHandler(.cancel)
        if let url { LinkOut.open(url) }
    }

    // B8: window.open(url) has no second web view to open into: hand the URL to iOS and return nil (window.open
    // then returns null, as before, but the link opens).
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, !LinkOut.staysInside(url) { LinkOut.open(url) }
        return nil
    }

    // The load event has fired; give WebKit a moment to put #boot on screen, then fade out (opacity only).
    private func dropCover() {
        guard let c = cover else { return }
        cover = nil
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            UIView.animate(withDuration: 0.2, animations: { c.alpha = 0 }, completion: { _ in c.removeFromSuperview() })
        }
    }

    // The nav bar under the status bar is iOS 6 blue, so light text.
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
}

enum Web {
    static func make(bridge: Bridge) -> WKWebView {
        let c = WKWebViewConfiguration()
        c.setURLSchemeHandler(AppScheme(), forURLScheme: AppScheme.scheme)
        c.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "cydian")
        Apt.installScript(c.userContentController) // cydianNative, before any page script (native/bridge.js)
        // WebKit holds requestAnimationFrame near 60 Hz by default on iOS; the JS edge swipe needs 120 (R3).
        WebKitFeature.set({ $0 == "PreferPageRenderingUpdatesNear60FPSEnabled" }, false, c.preferences)
        let w = WKWebView(frame: .zero, configuration: c)
        // Back is web/app/'s JS swipe; WebKit's history gesture would fight it.
        w.allowsBackForwardNavigationGestures = false
        w.allowsLinkPreview = false
        // N10: transparent until the page paints, over the window's pinstripes; the same behind the page's edges.
        w.isOpaque = false
        w.backgroundColor = Launch.pinstripes
        w.scrollView.backgroundColor = Launch.pinstripes
        if #available(iOS 15.0, *) { w.underPageBackgroundColor = Launch.pinLight }
        // The page lays itself out with env(safe-area-inset-*) (viewport-fit=cover) and scrolls inside its own boxes.
        w.scrollView.contentInsetAdjustmentBehavior = .never
        w.scrollView.bounces = false
        if #available(iOS 16.4, *) { w.isInspectable = true }
        return w
    }
}

// B8: links out of the app. What loads inside the web view, and how the rest is handed to iOS.
enum LinkOut {
    // Schemes the web view keeps: the bundle (AppScheme) and the page's own documents and objects.
    static let inside: Set<String> = [AppScheme.scheme, "about", "blob", "data"]
    // Schemes never handed to iOS (app.openURL too): they would mean nothing outside, or reach the file system.
    static let never: Set<String> = inside.union(["javascript", "file"])

    static func staysInside(_ url: URL?) -> Bool {
        guard let s = url?.scheme?.lowercased() else { return true } // no URL, no scheme: nothing to open
        return inside.contains(s)
    }

    static func canOpen(_ url: URL) -> Bool {
        guard let s = url.scheme?.lowercased(), !s.isEmpty else { return false }
        return !never.contains(s)
    }

    // UIApplication.open: Safari or the app that claims an https link, the app for its scheme, iOS's install
    // prompt for itms-services. An unclaimed scheme just reports false.
    static func open(_ url: URL, done: ((Bool) -> Void)? = nil) {
        guard canOpen(url) else { done?(false); return }
        DispatchQueue.main.async { UIApplication.shared.open(url, options: [:]) { done?($0) } }
    }
}

// N10: the launch screen's look, for the native side (docs/native.md, "Launch screen").
enum Launch {
    // web/app/ios6.css --pin-dark / --pin-light: 2.5 pt dark, 5.5 pt light, an 8 pt period.
    static let pinDark = UIColor(red: 0xcb / 255.0, green: 0xd0 / 255.0, blue: 0xda / 255.0, alpha: 1)
    static let pinLight = UIColor(red: 0xce / 255.0, green: 0xd3 / 255.0, blue: 0xdc / 255.0, alpha: 1)
    static let pinstripes: UIColor = {
        let tile = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 1)).image { ctx in
            pinLight.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 8, height: 1))
            pinDark.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 2.5, height: 1))
        }
        return UIColor(patternImage: tile)
    }()

    // The website's launch image for this screen (web/icons/launch/launch-<W>x<H>.png, in device pixels, made by
    // tools/launch_images.py): nav bar titled Cydian, the pinstripes with Loading, the tab bar with Home selected.
    // nil on a screen it has no image for; the window's pinstripes show there instead.
    static func cover(frame: CGRect) -> UIView? {
        let px = UIScreen.main.nativeBounds.size // portrait pixels
        let name = "launch-\(Int(min(px.width, px.height)))x\(Int(max(px.width, px.height)))"
        guard let path = Bundle.main.path(forResource: name, ofType: "png", inDirectory: "web/icons/launch"),
              let image = UIImage(contentsOfFile: path) else { return nil }
        let v = UIImageView(image: image)
        v.frame = frame
        v.contentMode = .scaleToFill
        v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        return v
    }
}
