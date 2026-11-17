// Spike A (and the probe): one full-screen WKWebView; the page owns navigation.
// Spike B: UITabBarController > UINavigationController > WebScreen, each screen borrowing a WKWebView from a pool.
import UIKit
import WebKit

final class WebSpikeController: UIViewController {
    private let page: String
    private let spike: String
    private let bridge = Bridge()
    private var web: WKWebView!

    init(page: String, spike: String) {
        self.page = page
        self.spike = spike
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        bridge.on("app.exit") { [weak self] c in
            c.reply(nil, nil)
            self?.close()
        }
        bridge.on("app.autoDone") { $0.reply(nil, nil) }
        web = Web.make(bridge: bridge)
        web.frame = view.bounds
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        if spike == "A" {
            web.scrollView.contentInsetAdjustmentBehavior = .never // the page pads with env(safe-area-inset-*)
            web.scrollView.isScrollEnabled = false // only the screens' own overflow areas scroll
            web.scrollView.bounces = false
        }
        view.addSubview(web)
        Meter.shared.begin(spike: spike)
        web.load(URLRequest(url: AppScheme.url(page)))
    }

    private func close() {
        Meter.shared.end()
        web.configuration.userContentController.removeAllScriptMessageHandlers()
        dismiss(animated: true)
    }
}

final class WebPool {
    let bridge: Bridge
    private var idle: [WKWebView] = []
    private(set) var created = 0
    private(set) var reused = 0
    private let maxIdle = 3

    init(bridge: Bridge) { self.bridge = bridge }

    func prewarm(_ n: Int) {
        while idle.count < n { idle.append(make()) }
    }

    func take() -> WKWebView {
        if let w = idle.popLast() {
            reused += 1
            return w
        }
        return make()
    }

    func give(_ w: WKWebView) {
        w.removeFromSuperview()
        if idle.count < maxIdle { idle.append(w) }
    }

    func drain() {
        idle.forEach { $0.configuration.userContentController.removeAllScriptMessageHandlers() }
        idle = []
    }

    private func make() -> WKWebView {
        created += 1
        let w = Web.make(bridge: bridge)
        w.load(URLRequest(url: AppScheme.url("b.html")))
        return w
    }
}

final class WebScreen: UIViewController {
    let seed: Int
    let depth: Int
    private unowned let pool: WebPool
    private(set) var web: WKWebView?
    private var savedOffset: CGPoint?

    init(title: String, seed: Int, depth: Int, pool: WebPool) {
        self.seed = seed
        self.depth = depth
        self.pool = pool
        super.init(nibName: nil, bundle: nil)
        self.title = title
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        attach()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isMovingFromParent { detach() }
    }

    func attach() {
        guard web == nil else { return }
        let w = pool.take()
        w.frame = view.bounds
        w.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(w)
        web = w
        let spec = "{seed:\(seed),depth:\(depth)}"
        let offset = savedOffset
        w.evaluateJavaScript("window.spike ? spike.show(\(spec)) : (window.__pending = \(spec)); 0") { _, _ in
            if let o = offset { w.scrollView.setContentOffset(o, animated: false) }
        }
    }

    // Screens more than one below the top give their view back; they get one again (and their scroll offset)
    // when they come back into view.
    func detach() {
        guard let w = web else { return }
        savedOffset = w.scrollView.contentOffset
        pool.give(w)
        web = nil
    }
}

final class SpikeB: UITabBarController, UINavigationControllerDelegate {
    private let bridge = Bridge()
    private lazy var pool = WebPool(bridge: bridge)

    override func viewDidLoad() {
        super.viewDidLoad()
        bridge.on("nav.push") { [weak self] c in
            c.reply(nil, nil)
            guard let self, let nav = self.selectedViewController as? UINavigationController,
                  let top = nav.topViewController as? WebScreen, top.web === c.web else { return }
            let seed = (c.params["seed"] as? NSNumber)?.intValue ?? 1
            nav.pushViewController(WebScreen(title: c.params["title"] as? String ?? "?", seed: seed,
                                             depth: top.depth + 1, pool: self.pool), animated: true)
        }
        viewControllers = ["Sources", "Changes", "Search"].enumerated().map { i, name in
            let root = WebScreen(title: name, seed: i + 1, depth: 0, pool: pool)
            root.navigationItem.leftBarButtonItem = UIBarButtonItem(title: "Exit", primaryAction: UIAction { [weak self] _ in
                self?.close()
            })
            root.navigationItem.rightBarButtonItem = UIBarButtonItem(title: "Auto", primaryAction: UIAction { [weak self] _ in
                self?.auto(step: 0)
            })
            let nav = UINavigationController(rootViewController: root)
            nav.delegate = self
            nav.tabBarItem = UITabBarItem(title: name, image: nil, tag: i)
            return nav
        }
        Meter.shared.begin(spike: "B")
        pool.prewarm(3)
    }

    private func close() {
        Meter.shared.pool = ["created": pool.created, "reused": pool.reused]
        Meter.shared.end()
        for case let nav as UINavigationController in viewControllers ?? [] {
            for case let s as WebScreen in nav.viewControllers { s.detach() }
        }
        pool.drain()
        dismiss(animated: true)
    }

    // Scripted run, same as spike A: 10 pushes, 10 pops, 3 s of JS fast scroll on the root list.
    private func auto(step: Int) {
        guard let nav = selectedViewController as? UINavigationController else { return }
        let next = { DispatchQueue.main.asyncAfter(deadline: .now() + 0.75) { self.auto(step: step + 1) } }
        if step < 10, let top = nav.topViewController as? WebScreen {
            nav.pushViewController(WebScreen(title: "Auto \(step + 1)", seed: 1000 + step, depth: top.depth + 1,
                                             pool: pool), animated: true)
            next()
        } else if step < 20 {
            nav.popViewController(animated: true)
            next()
        } else if let root = nav.viewControllers.first as? WebScreen {
            root.web?.callAsyncJavaScript("await spike.autoscroll()", arguments: [:], in: nil, in: .page) { _ in }
        }
    }

    func navigationController(_ nav: UINavigationController, willShow vc: UIViewController, animated: Bool) {
        guard animated, let tc = nav.transitionCoordinator else { return }
        let popping = tc.viewController(forKey: .from).map { !nav.viewControllers.contains($0) } ?? false
        Meter.shared.setPhase(tc.isInteractive ? "swipe" : popping ? "pop" : "push")
        tc.animate(alongsideTransition: nil) { _ in Meter.shared.setPhase("idle") }
    }

    func navigationController(_ nav: UINavigationController, didShow vc: UIViewController, animated: Bool) {
        for case let s as WebScreen in nav.viewControllers.dropLast(2) { s.detach() }
    }
}

final class ResultsController: UIViewController {
    private let text = UITextView()

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Results"
        view.backgroundColor = .systemBackground
        text.isEditable = false
        text.font = .monospacedSystemFont(ofSize: 10, weight: .regular)
        text.frame = view.bounds
        text.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(text)
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "Close", primaryAction: UIAction { [weak self] _ in
            self?.dismiss(animated: true)
        })
        navigationItem.rightBarButtonItems = [
            UIBarButtonItem(title: "Share", primaryAction: UIAction { [weak self] _ in self?.share() }),
            UIBarButtonItem(title: "Reset", primaryAction: UIAction { [weak self] _ in
                Meter.shared.reset()
                self?.refresh()
            }),
        ]
        refresh()
    }

    private func refresh() {
        let json = (try? JSONSerialization.data(withJSONObject: Meter.shared.report(), options: [.prettyPrinted, .sortedKeys]))
            .map { String(decoding: $0, as: UTF8.self) } ?? "{}"
        text.text = Meter.shared.table() + "\n\n" + json
    }

    private func share() {
        guard let url = Meter.shared.save() else { return }
        let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        vc.popoverPresentationController?.barButtonItem = navigationItem.rightBarButtonItems?.first
        present(vc, animated: true)
    }
}
