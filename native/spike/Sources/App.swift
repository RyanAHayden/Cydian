// R3 navigation spike: one app, both approaches, a frame meter and a results screen. Not product code.
import UIKit
import WebKit

enum Settings {
    // WebKit's default caps requestAnimationFrame near 60 fps; off = the private feature switched off (rAF at 120).
    static var prefer60 = true
    // CADisplayLink in the app process at 120 Hz while a spike is open (it also keeps the display at 120 Hz).
    static var nativeMeter = true
}

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
        w.rootViewController = MenuController()
        w.makeKeyAndVisible()
        window = w
    }
}

final class MenuController: UIViewController {
    private let info = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemGroupedBackground
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 20),
        ])
        let title = UILabel()
        title.text = "Cydian navigation spike (R3)"
        title.font = .boldSystemFont(ofSize: 22)
        stack.addArrangedSubview(title)
        stack.addArrangedSubview(toggle("Prefer 60 fps page rendering (WebKit default)", Settings.prefer60) { Settings.prefer60 = $0 })
        stack.addArrangedSubview(toggle("Native frame meter (CADisplayLink)", Settings.nativeMeter) { Settings.nativeMeter = $0 })
        stack.addArrangedSubview(button("Spike A: one WKWebView, JS stack + JS swipe") { [unowned self] in
            self.open(WebSpikeController(page: "a.html", spike: "A"))
        })
        stack.addArrangedSubview(button("Spike B: UINavigationController + pooled WKWebViews") { [unowned self] in
            self.open(SpikeB())
        })
        stack.addArrangedSubview(button("Probe: offline bundle, worker, bridge") { [unowned self] in
            self.open(WebSpikeController(page: "probe.html", spike: "probe"))
        })
        stack.addArrangedSubview(button("Results") { [unowned self] in
            self.present(UINavigationController(rootViewController: ResultsController()), animated: true)
        })
        info.numberOfLines = 0
        info.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        stack.addArrangedSubview(info)
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        let feats = WebKitFeature.frameRateFeatures().map { "\($0.key)=\($0.on)" }.joined(separator: "\n")
        info.text = """
        maximumFramesPerSecond: \(UIScreen.main.maximumFramesPerSecond)
        \(Meter.deviceModel()) iOS \(UIDevice.current.systemVersion)
        WebKit frame-rate features (defaults):
        \(feats.isEmpty ? "none found" : feats)

        Protocol: per spike, tap Auto once, then 10 edge-swipes back
        (push a row first), then 10 hard flings on the 30k list.
        Run each spike with the 60 fps switch on and off.
        """
    }

    private func open(_ vc: UIViewController) {
        vc.modalPresentationStyle = .fullScreen
        present(vc, animated: true)
    }

    private func button(_ title: String, _ action: @escaping () -> Void) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(title, for: .normal)
        b.contentHorizontalAlignment = .leading
        b.titleLabel?.font = .systemFont(ofSize: 17)
        b.addAction(UIAction { _ in action() }, for: .touchUpInside)
        return b
    }

    private func toggle(_ title: String, _ on: Bool, _ set: @escaping (Bool) -> Void) -> UIView {
        let l = UILabel()
        l.text = title
        l.numberOfLines = 0
        l.font = .systemFont(ofSize: 15)
        let s = UISwitch()
        s.isOn = on
        s.addAction(UIAction { a in set((a.sender as? UISwitch)?.isOn ?? on) }, for: .valueChanged)
        let row = UIStackView(arrangedSubviews: [l, s])
        row.spacing = 8
        return row
    }
}
