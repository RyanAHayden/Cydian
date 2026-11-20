// I3: the sideload build's background update check. The page hands over the apps iFizBox remembers (each with the
// version Install recorded and the AltStore source it came from) and the updates it already shows; a
// BGAppRefreshTask then fetches those sources now and then while iFizBox isn't open, and when one offers an app a
// newer version than remembered, beyond the ones already counted or notified, posts "n Updates" (a tap opens
// Changes) and sets the icon badge (B47: Changes' last count plus updates it didn't count, UpdateCheck.badge). The rules are native/sign/Updates.swift (tested on Linux, native/test_updates.py).
//
//   updates.watch {apps: [{id, name, version, source}], known: ["<id> <version>"]} -> {scheduled: Bool}
//
// iOS decides when the task runs (how often the app is used, battery, Low Power Mode): earliestBeginDate is only
// "not before". It never runs in the jailbreak build (N5's daemon checks apt there), and only registers where the
// Info.plist permits its identifier: register(forTaskWithIdentifier:) traps on one that isn't listed.
// Notification permission is asked once the page follows anything, iFizBox itself included (B34: before, only an app
// other than iFizBox asked, so a phone with nothing else recorded could never be told about iFizBox's own update in
// the background), or by app.badge's first count (Notifications.swift); in the background iOS can't ask, so until
// then the check only updates what it knows and sets nothing.
// SPDX-License-Identifier: GPL-3.0-or-later
import BackgroundTasks
import Foundation
import UIKit
import UserNotifications

enum BackgroundCheck {
    static let taskID = "com.ryha.ifizbox.updates"
    static let watchKey = "ifizbox.updates.watch" // UserDefaults: [UpdateCheck.Watched] as JSON
    static let knownKey = "ifizbox.updates.known" // UserDefaults: ["<id> <version>"]
    // B47: what Changes counted when last open: its "<id> <version>" keys (updates.watch's `known`, as sent) and the
    // icon count it set (app.badge, Notifications.swift). A background run's badge starts from these.
    static let pageKeysKey = "ifizbox.updates.pageKeys"
    static let pageCountKey = "ifizbox.updates.pageCount"
    // B124: the "<id> <version>" keys the last background run found (its badge's other part); app.badge drops them,
    // since the page's count then stands for everything.
    static let foundKey = "ifizbox.updates.foundKeys"
    static let interval: TimeInterval = 4 * 3600
    static let maxBytes = 8 << 20 // AltStore's own source is about 1 MB; the biggest seen (F9) under 8 MB
    private static let queue = DispatchQueue(label: "com.ryha.ifizbox.updates")
    private static var registered = false

    static var permitted: Bool {
        (Bundle.main.object(forInfoDictionaryKey: "BGTaskSchedulerPermittedIdentifiers") as? [String])?.contains(taskID) ?? false
    }

    // From application(_:didFinishLaunchingWithOptions:), before it returns.
    static func register() {
        guard AppMode.current == .sideload, permitted, !registered else { return }
        registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: taskID, using: nil) { task in
            guard let refresh = task as? BGAppRefreshTask else { return task.setTaskCompleted(success: false) }
            run(refresh)
        }
        schedule()
    }

    static func register(_ b: Bridge) {
        b.on("updates.watch") { c in
            guard AppMode.current == .sideload else { return Apt.reply(c, ["scheduled": false], nil) }
            let apps = UpdateCheck.watched(c.params["apps"])
            let page = Set((c.params["known"] as? [Any] ?? []).compactMap { $0 as? String })
            queue.async {
                let known = UpdateCheck.mergeKnown(old: loadKnown(), oldWatch: loadWatch(), page: page, newWatch: apps)
                save(apps, known: known)
                UserDefaults.standard.set(page.sorted(), forKey: pageKeysKey)
                // B34: iFizBox itself counts too, or a phone following only iFizBox never gets asked and its own
                // update can neither badge the icon nor notify from here.
                if !apps.isEmpty { askOnce() }
                Apt.reply(c, ["scheduled": schedule()], nil)
            }
        }
    }

    @discardableResult
    static func schedule() -> Bool {
        guard registered, !UserDefaults.standard.bool(forKey: offKey) else { return false }
        let r = BGAppRefreshTaskRequest(identifier: taskID)
        r.earliestBeginDate = Date(timeIntervalSinceNow: interval)
        do { try BGTaskScheduler.shared.submit(r); return true } catch { return false }
    }

    // ---- the stored lists

    private static func loadWatch() -> [UpdateCheck.Watched] {
        guard let d = UserDefaults.standard.data(forKey: watchKey) else { return [] }
        return (try? JSONDecoder().decode([UpdateCheck.Watched].self, from: d)) ?? []
    }

    private static func loadKnown() -> Set<String> { Set(UserDefaults.standard.stringArray(forKey: knownKey) ?? []) }

    private static func save(_ apps: [UpdateCheck.Watched], known: Set<String>) {
        if let d = try? JSONEncoder().encode(apps) { UserDefaults.standard.set(d, forKey: watchKey) }
        UserDefaults.standard.set(known.sorted(), forKey: knownKey)
    }

    // B124: iFizBox has handed iOS its own update (`version`, under any of `ids`; this copy's bundle ID always counts):
    // the icon badge drops that update now, rather than at the new version's first launch (app.js lastVersion), which
    // never comes when the install doesn't land. Other updates stay counted. The watch list moves iFizBox to that
    // version so a background run meanwhile doesn't badge it again (the new version's page sends its own list).
    // Returns the new count, for the closing notification's content.badge. Sideload build only; any queue but this
    // one's own.
    @discardableResult
    static func selfHandedOff(ids: Set<String>, version: String) -> Int {
        guard AppMode.current == .sideload else { return 0 }
        var mine = ids
        if let b = Bundle.main.bundleIdentifier { mine.insert(b) }
        let d = UserDefaults.standard
        let n: Int = queue.sync {
            let before = UpdateCheck.Counts(pageCount: d.integer(forKey: pageCountKey),
                                            pageKeys: Set(d.stringArray(forKey: pageKeysKey) ?? []),
                                            found: d.stringArray(forKey: foundKey) ?? [])
            let after = UpdateCheck.without(mine, before)
            d.set(after.pageCount, forKey: pageCountKey)
            d.set(after.pageKeys.sorted(), forKey: pageKeysKey)
            d.set(after.found, forKey: foundKey)
            save(UpdateCheck.handedOff(loadWatch(), ids: mine, version: version), known: loadKnown())
            return after.badge
        }
        WidgetStore.save(count: n, names: []) // N8: the widget shows the same count
        let center = UNUserNotificationCenter.current()
        if n == 0 { center.removeDeliveredNotifications(withIdentifiers: [Notifications.upgradesID]) }
        Notifications.setIcon(n) // B158: in order with the page's app.badge
        return n
    }

    private static func askOnce() {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { s in
            guard s.authorizationStatus == .notDetermined else { return }
            center.requestAuthorization(options: [.alert, .badge, .sound]) { _, _ in }
        }
    }

    // ---- the task

    static let lastRunKey = "ifizbox.backgroundCheck.lastRun"
    static let offKey = "ifizbox.backgroundCheck.off" // Settings > Update Alerts > Check in the Background, off
    private static func run(_ task: BGAppRefreshTask) {
        schedule() // the next one first, so a check cut short still has a successor
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: lastRunKey) // Settings shows it
        let check = Check()
        task.expirationHandler = { check.cancel() }
        check.start { ok in task.setTaskCompleted(success: ok) }
    }

    // One background run: every watched source at once, then the comparison, then at most one notification.
    private final class Check {
        private let lock = NSLock()
        private var tasks = [URLSessionDataTask]()
        private var finished = false
        private var done: ((Bool) -> Void)?
        private lazy var session: URLSession = {
            let cfg = URLSessionConfiguration.ephemeral
            cfg.timeoutIntervalForRequest = 20
            cfg.timeoutIntervalForResource = 25 // iOS gives a refresh task about 30 s
            cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
            return URLSession(configuration: cfg)
        }()

        func start(_ done: @escaping (Bool) -> Void) {
            self.done = done
            BackgroundCheck.queue.async { [self] in
                let watch = BackgroundCheck.loadWatch()
                let sources = Array(Set(watch.map(\.source))).sorted()
                guard !sources.isEmpty else { return finish(true) }
                let v = ProcessInfo.processInfo.operatingSystemVersion // not UIDevice: this is off the main thread
                let ios = "\(v.majorVersion).\(v.minorVersion).\(v.patchVersion)"
                let group = DispatchGroup()
                var offers = [String: [String: UpdateCheck.Offer]]()
                let gather = NSLock()
                for s in sources {
                    guard let url = URL(string: s) else { continue }
                    group.enter()
                    let t = session.dataTask(with: url) { data, response, _ in
                        defer { group.leave() }
                        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                        guard let data, (200..<300).contains(status), data.count <= BackgroundCheck.maxBytes else { return }
                        let read = UpdateCheck.offers(data, ios: ios)
                        gather.lock(); offers[s] = read; gather.unlock()
                    }
                    lock.lock(); tasks.append(t); lock.unlock()
                    t.resume()
                }
                group.notify(queue: BackgroundCheck.queue) { [self] in
                    if isFinished { return }
                    let found = UpdateCheck.updates(watch, offers: offers)
                    // B47: the icon badge is Changes' count: what it counted when last open, plus updates for apps it
                    // didn't count (before, found.count alone, which disagreed with Changes' rows).
                    let pageKeys = Set(UserDefaults.standard.stringArray(forKey: BackgroundCheck.pageKeysKey) ?? [])
                    let badge = UpdateCheck.badge(found, pageCount: UserDefaults.standard.integer(forKey: BackgroundCheck.pageCountKey),
                                                  pageKeys: pageKeys)
                    UserDefaults.standard.set(found.map(\.key), forKey: BackgroundCheck.foundKey) // B124
                    UNUserNotificationCenter.current().getNotificationSettings { st in
                        guard st.badgeSetting == .enabled else { return }
                        Notifications.setIcon(badge) // B158: one setter, in order
                    }
                    let known = BackgroundCheck.loadKnown()
                    guard !UpdateCheck.fresh(found, known: known).isEmpty else { return finish(true) }
                    post(found, badge: badge) { posted in
                        BackgroundCheck.queue.async { [self] in
                            // Only what reached the user counts as told: without permission, the next run tries again.
                            if posted { UserDefaults.standard.set(known.union(found.map(\.key)).sorted(), forKey: BackgroundCheck.knownKey) }
                            finish(true)
                        }
                    }
                }
            }
        }

        private var isFinished: Bool { lock.lock(); defer { lock.unlock() }; return finished }

        func cancel() {
            lock.lock()
            let ts = tasks
            lock.unlock()
            ts.forEach { $0.cancel() }
            finish(false)
        }

        private func finish(_ ok: Bool) {
            lock.lock()
            let first = !finished
            finished = true
            let f = done
            done = nil
            lock.unlock()
            if first { session.finishTasksAndInvalidate(); f?(ok) }
        }

        // "n Updates" with every update found (not only the new ones), under N5's identifier so app.badge's 0 takes
        // it away and Notifications.swift opens its route.
        private func post(_ found: [UpdateCheck.Found], badge: Int, _ done: @escaping (Bool) -> Void) {
            let center = UNUserNotificationCenter.current()
            center.getNotificationSettings { s in
                let ok: Set<UNAuthorizationStatus> = [.authorized, .provisional, .ephemeral]
                guard ok.contains(s.authorizationStatus) else { return done(false) }
                let content = UNMutableNotificationContent()
                content.title = UpdateCheck.title(found.count)
                content.body = UpdateCheck.body(found)
                content.sound = .default
                content.badge = NSNumber(value: badge) // B47: the same count as the icon badge above
                content.userInfo = ["url": "#/changes"]
                let req = UNNotificationRequest(identifier: Notifications.upgradesID, content: content, trigger: nil)
                center.add(req) { e in done(e == nil) }
            }
        }
    }
}
