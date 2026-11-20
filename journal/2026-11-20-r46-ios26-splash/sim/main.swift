// R46 check, iOS Simulator only (never shipped). B180's harness app (journal/2026-11-20-b180-launch-strips/sim)
// with B203's pieces:
//   - holds the system launch screen 10 s, then shows web/index.html (no app.js) in a WKWebView like App.swift's;
//   - "cover <key>": puts LaunchThemes/<key>/LaunchScreen.storyboardc on the window, loaded with Bundle(path:) as
//     Splash.cover does;
//   - "snap": before anything else, prints this app's Library/SplashBoard tree, then (from inside the app process)
//     copies every file under Documents/swap/ over the same relative path under Library/SplashBoard/Snapshots/, and
//     prints each result. "wipe" removes Library/SplashBoard instead. Both act on the next launch's splash.
import ImageIO
import UIKit
import WebKit

func tree(_ root: String) {
    let fm = FileManager.default
    print("tree", root)
    for p in (fm.enumerator(atPath: root)?.allObjects as? [String] ?? []).sorted() {
        let a = try? fm.attributesOfItem(atPath: root + "/" + p)
        print("  ", p, a?[.size] ?? "-", a?[.modificationDate] ?? "-")
    }
}

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ app: UIApplication, didFinishLaunchingWithOptions o: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        let args = CommandLine.arguments
        let sb = NSHomeDirectory() + "/Library/SplashBoard"
        let fm = FileManager.default
        if args.contains("snap") || args.contains("wipe") {
            tree(sb)
        }
        if args.contains("snap") {
            let swap = NSHomeDirectory() + "/Documents/swap"
            for p in (fm.enumerator(atPath: swap)?.allObjects as? [String] ?? []) {
                var dir: ObjCBool = false
                guard fm.fileExists(atPath: swap + "/" + p, isDirectory: &dir), !dir.boolValue else { continue }
                let dst = sb + "/Snapshots/" + p
                do {
                    let data = try Data(contentsOf: URL(fileURLWithPath: swap + "/" + p))
                    try data.write(to: URL(fileURLWithPath: dst)) // in place: keeps the file's xattrs
                    print("swapped", p, data.count)
                } catch {
                    print("swap failed", p, error)
                }
            }
            tree(sb)
        }
        if args.contains("wipe") {
            do { try fm.removeItem(atPath: sb); print("wiped") } catch { print("wipe failed", error) }
        }
        Thread.sleep(forTimeInterval: 10) // the launch screen stays until this returns (long: the Mac is often loaded)
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.backgroundColor = .systemBackground
        w.rootViewController = Page()
        w.makeKeyAndVisible()
        window = w
        if let i = args.firstIndex(of: "cover"), i + 1 < args.count,
           let b = Bundle(path: Bundle.main.bundlePath + "/LaunchThemes/" + args[i + 1]),
           let v = UIStoryboard(name: "LaunchScreen", bundle: b).instantiateInitialViewController()?.view {
            v.frame = w.bounds
            v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            w.addSubview(v)
            if args.contains("atx") { // render that cover and write it over this app's own SplashBoard snapshots
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { writeSnapshots(of: v) }
            }
        }
        return true
    }
}

// "cover <key> atx": the in-app way to give the next launch the theme's frame. The snapshots SplashBoard keeps are
// Apple's ATX texture files ("AAPL\r\n\u{1a}\n", named *.ktx), full-screen at the screen's scale, no status bar.
func writeSnapshots(of v: UIView) {
    let types = (CGImageDestinationCopyTypeIdentifiers() as? [String]) ?? []
    print("ImageIO writes atx:", types.contains("com.apple.atx"), types.filter { $0.contains("ktx") || $0.contains("atx") })
    let f = UIGraphicsImageRendererFormat()
    f.scale = UIScreen.main.scale
    f.opaque = true
    let img = UIGraphicsImageRenderer(bounds: v.bounds, format: f).image { _ in
        v.drawHierarchy(in: v.bounds, afterScreenUpdates: true)
    }
    guard let cg = img.cgImage else { print("no image"); return }
    print("rendered", cg.width, cg.height)
    let root = NSHomeDirectory() + "/Library/SplashBoard/Snapshots"
    let fm = FileManager.default
    for p in (fm.enumerator(atPath: root)?.allObjects as? [String] ?? []) where p.hasSuffix(".ktx") {
        let url = URL(fileURLWithPath: root + "/" + p)
        guard let d = CGImageDestinationCreateWithURL(url as CFURL, "com.apple.atx" as CFString, 1, nil) else {
            print("no atx destination", p); continue
        }
        CGImageDestinationAddImage(d, cg, nil)
        print("wrote", p, CGImageDestinationFinalize(d), (try? fm.attributesOfItem(atPath: url.path)[.size]) ?? "-")
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
