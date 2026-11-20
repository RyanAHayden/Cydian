// B180 check, iOS Simulator only (never shipped): holds the system launch screen (LaunchScreen.storyboardc) up for
// 6 s, then shows the page's first frame: web/app/index.html (copied without app.js, so #boot stays) in a WKWebView
// set up like native/Sources/App.swift's (data-shell="app" at document start, transparent, no insets). Launched with
// the argument "cover", it also puts the storyboard's view on the window over the page, as App.swift's
// Launch.cover does until the page has loaded. run.sh screenshots each.
import UIKit
import WebKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ app: UIApplication, didFinishLaunchingWithOptions o: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        Thread.sleep(forTimeInterval: 6) // the launch screen stays until this returns
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.backgroundColor = UIColor(red: 0xce / 255.0, green: 0xd3 / 255.0, blue: 0xdc / 255.0, alpha: 1)
        w.rootViewController = Page()
        w.makeKeyAndVisible()
        window = w
        if CommandLine.arguments.contains("cover"),
           let v = UIStoryboard(name: "LaunchScreen", bundle: nil).instantiateInitialViewController()?.view {
            v.frame = w.bounds
            v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            w.addSubview(v)
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                print("cover safe", v.safeAreaInsets, "frame", v.frame)
                for s in v.subviews { print(type(of: s), s.frame) }
            }
        }
        return true
    }
}

final class Page: UIViewController {
    override func loadView() {
        let c = WKWebViewConfiguration()
        c.userContentController.addUserScript(WKUserScript(
            source: "document.documentElement.setAttribute('data-shell', 'app')",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let w = WKWebView(frame: .zero, configuration: c)
        w.isOpaque = false
        w.scrollView.contentInsetAdjustmentBehavior = .never
        let dir = Bundle.main.bundleURL.appendingPathComponent("web")
        w.loadFileURL(dir.appendingPathComponent("index.html"), allowingReadAccessTo: dir)
        view = w
    }
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
}
