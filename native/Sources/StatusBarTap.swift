import UIKit
import WebKit

// F167: a tap on the status bar scrolls the page to the top, as native iOS apps do (user 2026-11-18). Every page
// scrolls in its own .page-body (a WKChildScrollView, which WebKit already leaves with scrollsToTop off), and the
// web view's own scroll view never moves, so the tap moved nothing.
//
// The web view's scroll view can't take the tap either: it sits at its top with nothing to scroll, and UIKit then
// drops the tap without asking its delegate (checked on the iPhone 7, iOS 15.8). So the tap goes to a probe of our
// own instead: a 1 pt tall, invisible UIScrollView across the top of the web view, always 1 pt "scrolled down", the
// one scroll view with scrollsToTop. Its delegate refuses the scroll (it stays put, ready for the next tap) and asks
// the page to scroll whatever is on top (web/app/nav/statusbar.js, ifizboxScrollToTop: a sheet's list, Search's
// results, else the top page's body). UIKit only picks scroll views that take touches, so the probe has user
// interaction on; it lies under the status bar, where no touch reaches the page anyway.
final class StatusBarTap: NSObject, UIScrollViewDelegate {
    private weak var web: WKWebView?
    private weak var probe: UIScrollView?
    private static var attached: [ObjectIdentifier: StatusBarTap] = [:] // scrollView.delegate is weak

    static func attach(to web: WKWebView) {
        let t = StatusBarTap()
        t.web = web
        web.scrollView.scrollsToTop = false // iOS ignores the tap when more than one scroll view has it
        let p = UIScrollView(frame: CGRect(x: 0, y: 0, width: web.bounds.width, height: 1))
        p.autoresizingMask = [.flexibleWidth]
        p.backgroundColor = .clear
        p.showsVerticalScrollIndicator = false
        p.showsHorizontalScrollIndicator = false
        p.contentInsetAdjustmentBehavior = .never
        p.contentSize = CGSize(width: 1, height: 3)
        p.contentOffset = CGPoint(x: 0, y: 1)
        p.scrollsToTop = true
        p.delegate = t
        web.addSubview(p)
        t.probe = p
        attached[ObjectIdentifier(web)] = t
    }

    func scrollViewShouldScrollToTop(_ scrollView: UIScrollView) -> Bool {
        guard let web, scrollView === probe else { return true }
        web.evaluateJavaScript("globalThis.ifizboxScrollToTop?.()", completionHandler: nil)
        return false
    }
}
