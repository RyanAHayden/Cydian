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
        w.backgroundColor = .black
        w.rootViewController = WebController()
        w.makeKeyAndVisible()
        window = w
    }
}

final class WebController: UIViewController {
    private let bridge = Bridge()
    private lazy var web = Web.make(bridge: bridge)

    override func loadView() { view = web }

    override func viewDidLoad() {
        super.viewDidLoad()
        web.load(URLRequest(url: AppScheme.url("index.html")))
    }

    // The nav bar under the status bar is iOS 6 blue, so light text.
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
}

enum Web {
    static func make(bridge: Bridge) -> WKWebView {
        let c = WKWebViewConfiguration()
        c.setURLSchemeHandler(AppScheme(), forURLScheme: AppScheme.scheme)
        c.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "cydian")
        // WebKit holds requestAnimationFrame near 60 Hz by default on iOS; the JS edge swipe needs 120 (R3).
        WebKitFeature.set({ $0 == "PreferPageRenderingUpdatesNear60FPSEnabled" }, false, c.preferences)
        let w = WKWebView(frame: .zero, configuration: c)
        // Back is web/app/'s JS swipe; WebKit's history gesture would fight it.
        w.allowsBackForwardNavigationGestures = false
        w.allowsLinkPreview = false
        w.isOpaque = false
        w.backgroundColor = .black
        // The page lays itself out with env(safe-area-inset-*) (viewport-fit=cover) and scrolls inside its own boxes.
        w.scrollView.contentInsetAdjustmentBehavior = .never
        w.scrollView.bounces = false
        if #available(iOS 16.4, *) { w.isInspectable = true }
        return w
    }
}
