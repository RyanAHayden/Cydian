// B85: iOS's Install prompt for an itms-services link, one app at a time. iOS drops an itms-services open made while
// iFizBox isn't in front (another app's prompt still up, or just answered, or iFizBox in the background), and the
// install server can't tell a dismissed prompt from one still waiting. So, per bundle ID, on the main queue:
//
//   open(link, bundleID, name, done)   opens the link once iFizBox is in front and settled (`settle` after it came
//                                     back), tries again when iOS refuses it (`tries`), and once more when iOS showed no
//                                     prompt within `noPrompt` s; done(true) once iOS took it
//   reprompt(bundleID) -> Bool         the user's tap (the run's "Tap Install on the iOS prompt" row, or a "didn't
//                                     download it" row's Try Again): opens the link again (false: the IPA isn't served
//                                     any more, or iOS already asked for it)
//   rehost(bundleID, link)             B91: the IPA is served from another link too (the Signing Server's, after iOS
//                                     froze iFizBox): the next reprompt opens that one. Opens nothing by itself
//   heard(bundleID)                    the install server saw iOS ask for the IPA: Install was tapped
//   end(bundleID, link)                the IPA is no longer served (fetched, expired or cancelled)
//   dismissed(bundleID) -> Bool        the prompt was shown and closed, then nothing for `dismissQuiet` s with iFizBox in
//                                     front: Cancel, or iOS couldn't reach the IPA (signing.progress answers dismissed)
//   summary(bundleID) -> String        what was seen, for the watch's last log line
//
// The prompt is seen through iFizBox's own state: iOS's alert makes it inactive (shown), closing it makes it active
// again (answered). Every step goes to the install log (InstallLog), which signing.progress streams to the page.
// B91: iFizBox opens a prompt by itself only until one was shown (`everShown`): once the user saw one and it closed,
// iFizBox can't tell their Cancel from a frozen server, so only their tap (reprompt) opens another.
// SPDX-License-Identifier: GPL-3.0-or-later
import UIKit

enum InstallPrompt {
    private final class Entry {
        var link: URL          // what an open hands iOS (B91: the Signing Server's after rehost)
        var links: Set<URL>    // every link this IPA is served at (end() matches any)
        let name: String
        var opening: Date?     // an open went out (the prompt can show before its completion runs)
        var opens = 0          // opens iOS took
        var shownAt: Date?     // iFizBox went inactive after an open: iOS's prompt is up
        var everShown = false  // B91: a prompt was shown at some point: no more opens by iFizBox itself
        var answeredAt: Date?  // iFizBox active again after that: the prompt was answered
        var requested = false  // iOS asked the install server for the IPA: Install was tapped
        var ended = false      // the IPA is no longer served
        var reopened = false   // the one automatic open again when no prompt showed
        var gone = false       // dismissed() said so: it stays so
        var waitingSaid = false
        init(link: URL, name: String) { self.link = link; self.links = [link]; self.name = name }
    }

    private static var entries = [String: Entry]()
    private static var observing = false
    private static var lastActive = Date.distantPast

    static let settle: TimeInterval = 1
    static let noPrompt: TimeInterval = 8
    static let dismissQuiet: TimeInterval = 20
    static let tries = 3

    private static func say(_ bid: String, _ line: String) { InstallLog.say(bid, line) }

    private static func observe() {
        guard !observing else { return }
        observing = true
        let nc = NotificationCenter.default
        nc.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { _ in
            for (bid, e) in entries where !e.ended && !e.requested && e.opening != nil && e.shownAt == nil {
                e.shownAt = Date()
                e.everShown = true
                say(bid, "iOS showed its Install prompt for \(e.name)")
            }
        }
        nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
            lastActive = Date()
            for (bid, e) in entries where !e.ended && e.shownAt != nil && e.answeredAt == nil {
                e.answeredAt = Date()
                say(bid, e.requested ? "The Install prompt for \(e.name) closed; iOS is fetching the IPA"
                    : "The Install prompt for \(e.name) closed; waiting for iOS to ask for the IPA")
            }
        }
    }

    private static var ready: Bool {
        UIApplication.shared.applicationState == .active && Date().timeIntervalSince(lastActive) >= settle
    }

    static func open(_ link: URL, bundleID bid: String, name: String, done: @escaping (Bool) -> Void) {
        observe()
        let e = Entry(link: link, name: name)
        entries[bid] = e
        attempt(bid, e, n: 1, user: false, done: done)
    }

    // B91: whether iFizBox may open the prompt without the user's tap: only while no prompt was ever shown for it.
    static func mayOpenByItself(everShown: Bool) -> Bool { !everShown }

    // One open of the link, once iFizBox is in front and settled. `user`: the user's tap (reprompt) asked for it.
    private static func attempt(_ bid: String, _ e: Entry, n: Int, user: Bool, done: ((Bool) -> Void)?) {
        guard entries[bid] === e, !e.ended else { done?(false); return }
        guard user || mayOpenByItself(everShown: e.everShown) else {
            say(bid, "A prompt for \(e.name) was shown and closed: no new one until its row is tapped")
            done?(false)
            return
        }
        guard ready else {
            if UIApplication.shared.applicationState != .active, !e.waitingSaid {
                e.waitingSaid = true
                say(bid, "\(Brand.name) isn't in front (an Install prompt is up, or it is in the background): "
                    + "the prompt for \(e.name) opens once it is")
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { attempt(bid, e, n: n, user: user, done: done) }
            return
        }
        e.waitingSaid = false
        e.opening = Date()
        e.shownAt = nil
        e.answeredAt = nil
        UIApplication.shared.open(e.link, options: [:]) { ok in
            if ok {
                e.opens += 1
                say(bid, "iOS took the install link for \(e.name)" + (e.opens > 1 ? " (open \(e.opens))" : ""))
                done?(true)
                DispatchQueue.main.asyncAfter(deadline: .now() + noPrompt) { checkShown(bid, e) }
            } else if n < tries {
                e.opening = nil
                say(bid, "iOS didn't open the install link for \(e.name) (try \(n) of \(tries)); asking again")
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { attempt(bid, e, n: n + 1, user: user, done: done) }
            } else {
                e.opening = nil
                say(bid, "iOS didn't open the install link for \(e.name); tap its row to ask again")
                done?(false)
            }
        }
    }

    // iOS took the link but showed no prompt (iFizBox never went inactive): open it once more. B91: never once a
    // prompt was shown for it (the user may have answered it with Cancel).
    private static func checkShown(_ bid: String, _ e: Entry) {
        guard entries[bid] === e, !e.ended, !e.requested, e.shownAt == nil, !e.reopened,
              mayOpenByItself(everShown: e.everShown),
              UIApplication.shared.applicationState == .active else { return }
        e.reopened = true
        say(bid, "No Install prompt for \(e.name) after \(Int(noPrompt)) s; asking iOS again")
        attempt(bid, e, n: 1, user: false, done: nil)
    }

    static func reprompt(_ bid: String) -> Bool {
        guard let e = entries[bid], !e.ended, !e.requested else { return false }
        e.gone = false
        e.reopened = true
        e.shownAt = nil
        e.answeredAt = nil
        say(bid, "Asked iOS again to install \(e.name)" + (e.links.count > 1 ? " (from the Signing Server)" : ""))
        attempt(bid, e, n: 1, user: true, done: nil)
        return true
    }

    // B91: the IPA is also at `link` (the Signing Server's copy after a freeze). Only the next reprompt opens it.
    static func rehost(_ bid: String, link: URL) {
        DispatchQueue.main.async {
            guard let e = entries[bid], !e.ended, !e.requested else { return }
            e.link = link
            e.links.insert(link)
            say(bid, "The Signing Server holds \(e.name): tapping its row asks iOS to install it from there")
        }
    }

    static func heard(_ bid: String) {
        DispatchQueue.main.async { entries[bid]?.requested = true }
    }

    static func end(_ bid: String, link: URL) {
        DispatchQueue.main.async {
            guard let e = entries[bid], e.links.contains(link) else { return }
            e.ended = true
        }
    }

    static func dismissed(_ bid: String) -> Bool {
        guard let e = entries[bid], !e.requested else { return false }
        if e.gone { return true }
        guard let at = e.answeredAt, UIApplication.shared.applicationState == .active,
              Date().timeIntervalSince(at) >= dismissQuiet else { return false }
        e.gone = true
        say(bid, "iOS didn't ask for \(e.name) within \(Int(dismissQuiet)) s of its prompt closing "
            + "(Cancel, or iOS couldn't reach the IPA): tap its row to try again")
        return true
    }

    static func summary(_ bid: String) -> String {
        guard let e = entries[bid] else { return "no install link was opened here" }
        let yes = { (b: Bool) in b ? "yes" : "no" }
        return "link opened \(e.opens)x, prompt seen \(yes(e.shownAt != nil)), answered \(yes(e.answeredAt != nil)), "
            + "IPA asked for \(yes(e.requested))"
    }
}
