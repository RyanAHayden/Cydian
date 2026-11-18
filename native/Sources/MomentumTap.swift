import UIKit
import WebKit

// F153: a quick tap on a list that is still coasting opens the row (user 2026-11-18), not only stops the scroll.
// UIKit spends such a touch on stopping the deceleration and WebKit never sees it: no touchstart, no pointerdown,
// no click (checked on the iPhone 7 with an on-screen event trace). So the app watches for it here: a tap
// recognizer on the web view that only takes touches landing on a scroll view that is decelerating, and when one
// ends as a tap (short, under 10 pt of movement: UITapGestureRecognizer's own rule, plus MAX_TAP), it asks the page
// to click what is under the finger (web/app/nav/momentum-tap.js, ifizboxMomentumTap). A drag fails the
// recognizer, so it only scrolls. Every other touch never reaches this recognizer, so ordinary taps are untouched.
final class MomentumTap: NSObject, UIGestureRecognizerDelegate {
    static let maxTap: TimeInterval = 0.3 // as momentum-tap.js TAP_MS: longer is a hold, not a tap

    private weak var web: WKWebView?
    private var began: TimeInterval = 0
    private static var attached: [ObjectIdentifier: MomentumTap] = [:] // the recognizer's delegate is weak

    static func attach(to web: WKWebView) {
        let m = MomentumTap()
        m.web = web
        let g = UITapGestureRecognizer(target: m, action: #selector(tapped(_:)))
        g.cancelsTouchesInView = false
        g.delaysTouchesBegan = false
        g.delaysTouchesEnded = false
        g.delegate = m
        web.addGestureRecognizer(g)
        attached[ObjectIdentifier(web)] = m
    }

    // Asked as the touch comes down, before the scroll view stops: take it only if a scroll view under it coasts.
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        var v: UIView? = touch.view
        while let view = v, view !== web {
            if let s = view as? UIScrollView, s.isDecelerating {
                began = touch.timestamp
                return true
            }
            v = view.superview
        }
        return false
    }

    // Alongside WebKit's and the scroll view's own recognizers, never instead of them.
    func gestureRecognizer(_ g: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

    @objc private func tapped(_ g: UITapGestureRecognizer) {
        guard g.state == .ended, let web, ProcessInfo.processInfo.systemUptime - began <= MomentumTap.maxTap + 0.05
        else { return }
        // The page is laid out 1:1 in points from the web view's top left (no zoom, the outer scroll view never moves).
        let p = g.location(in: web)
        web.callAsyncJavaScript("globalThis.ifizboxMomentumTap?.(x, y)", arguments: ["x": Double(p.x), "y": Double(p.y)],
                                in: nil, in: .page, completionHandler: nil)
    }
}
