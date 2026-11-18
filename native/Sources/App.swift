// Cydian's jailbreak shell: one window, one WKWebView showing web/app/ from the bundle (docs/native.md, R3 (a)).
// Navigation, push/pop and the edge swipe back are web/app/'s own JS stack; the shell adds nothing on top.
import UIKit
import WebKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        true
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
        w.makeKeyAndVisible()
        window = w
    }
}

final class WebController: UIViewController, WKNavigationDelegate {
    private let bridge = Bridge()
    private lazy var web = Web.make(bridge: bridge)
    private var cover: UIView?

    override func loadView() { view = web }

    override func viewDidLoad() {
        super.viewDidLoad()
        web.navigationDelegate = self
        // N10: the launch screen's Home-as-it-loads, exact for this screen, over the web view until the page has
        // drawn its own (index.html's #boot looks the same), so the hand-over from the launch screen shows no jump.
        if let c = Launch.cover(frame: UIScreen.main.bounds) {
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
