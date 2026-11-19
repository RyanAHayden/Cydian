// F65: the app side of N5's upgrade daemon (native/daemon/). The daemon posts "3 Upgrades" and sets the icon badge
// under iFizBox's bundle id, and iOS drops both until iFizBox itself has notification permission: so the jailbreak
// build asks once (alert, badge and sound) at its first launch. A tap on a notification whose userInfo has a
// "url" route ("#/changes", main.m's post) opens that route in the web view, and the page clears the badge
// through app.badge once the Changes tab shows no upgrades (web/app/settings.js).
//
//   app.badge {count}   the icon badge to count (0 clears it and takes N5's delivered notification away)
//
// The delegate is also what lets a notification show while iFizBox is open (the sideload build's re-sign reminder,
// Sideload.swift, too); its taps carry no route and do nothing here.
import UIKit
import BackgroundTasks
import UserNotifications
import WebKit

final class Notifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifications()
    static let upgradesID = "ifizbox-upgrades" // native/daemon/main.m NOTE_ID

    // From application(_:didFinishLaunchingWithOptions:), before it returns, so a tap that launched the app arrives.
    func start() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        guard AppMode.current == .jailbreak else { return } // the sideload build asks when a reminder is set
        center.getNotificationSettings { s in
            // Once: iOS shows its alert only while undecided, and a "no" stays the user's (Settings > Notifications).
            guard s.authorizationStatus == .notDetermined else { return }
            center.requestAuthorization(options: [.alert, .badge, .sound]) { _, _ in }
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound, .badge])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        if response.actionIdentifier == UNNotificationDefaultActionIdentifier,
           let route = Notifications.route(response.notification.request.content.userInfo["url"]) {
            DispatchQueue.main.async { Notifications.open(route, tries: 50) }
        }
        completionHandler()
    }

    // Only one of web/app/router.js's routes: "#/" then [A-Za-z0-9/%._~-], at most 200 characters.
    static func route(_ value: Any?) -> String? {
        guard let s = value as? String, s.hasPrefix("#/"), s.count <= 200 else { return nil }
        let ok = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/%._~-")
        return s.dropFirst(2).unicodeScalars.allSatisfy { ok.contains($0) } ? s : nil
    }

    // Set the page's hash (the router follows hashchange). A tap that launched the app comes before the page has
    // loaded: try again every 0.2 s, for up to `tries` times, until the web view has finished loading.
    static func open(_ route: String, tries: Int) {
        let web = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.windows.first?.rootViewController?.view as? WKWebView }.first
        guard let web, !web.isLoading, web.url != nil else {
            if tries > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { open(route, tries: tries - 1) } }
            return
        }
        web.callAsyncJavaScript("location.hash = route", arguments: ["route": route], in: nil, in: .page,
                                completionHandler: nil)
    }

    static func register(_ b: Bridge) {
        // What iOS allows iFizBox (Settings > Notifications > iFizBox, Background App Refresh) and when the background
        // check last ran: Settings shows it, so a badge that never comes has a reason on screen.
        b.on("app.notifyStatus") { c in
            UNUserNotificationCenter.current().getNotificationSettings { st in
                DispatchQueue.main.async {
                    let name: [UNAuthorizationStatus: String] = [.notDetermined: "notDetermined", .denied: "denied",
                                                                 .authorized: "authorized", .provisional: "provisional"]
                    let last = UserDefaults.standard.double(forKey: BackgroundCheck.lastRunKey)
                    c.reply(["status": name[st.authorizationStatus] ?? "other", "badges": st.badgeSetting == .enabled,
                             "alerts": st.alertSetting == .enabled,
                             "backgroundRefresh": UIApplication.shared.backgroundRefreshStatus == .available,
                             "backgroundOn": !UserDefaults.standard.bool(forKey: BackgroundCheck.offKey),
                             "lastCheck": last > 0 ? ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: last)) as Any : NSNull()], nil)
                }
            }
        }
        // The Home Screen icon's long-press menu: "Upgrade All (N)" while N upgrades wait (none: no item).
        b.on("app.shortcuts") { c in
            let n = max(0, (c.params["upgrades"] as? NSNumber)?.intValue ?? 0)
            DispatchQueue.main.async {
                UIApplication.shared.shortcutItems = n > 0 ? [UIApplicationShortcutItem(type: Shortcut.upgrade,
                    localizedTitle: "Upgrade All", localizedSubtitle: n == 1 ? "1 upgrade" : "\(n) upgrades",
                    icon: UIApplicationShortcutIcon(systemImageName: "arrow.down.circle"), userInfo: nil)] : []
                c.reply(nil, nil)
            }
        }
        // Settings > Update Alerts > Check in the Background (on unless turned off): off cancels the scheduled check.
        b.on("updates.background") { c in
            let on = c.params["on"] as? Bool ?? true
            UserDefaults.standard.set(!on, forKey: BackgroundCheck.offKey)
            if on { BackgroundCheck.schedule() } else { BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: BackgroundCheck.taskID) }
            c.reply(["on": on], nil)
        }
        // iFizBox's page in iOS Settings (notifications, badges, Background App Refresh live there).
        b.on("app.openSettings") { c in
            DispatchQueue.main.async {
                var s = UIApplication.openSettingsURLString
                if #available(iOS 16.0, *) { s = UIApplication.openNotificationSettingsURLString }
                let url = URL(string: s)!
                UIApplication.shared.open(url)
                c.reply(nil, nil)
            }
        }
        b.on("app.badge") { c in
            let n = max(0, (c.params["count"] as? NSNumber)?.intValue ?? 0)
            WidgetStore.save(count: n, names: []) // N8: the Home Screen widget shows the same count
            UserDefaults.standard.set(n, forKey: BackgroundCheck.pageCountKey) // B47: the background check's badge starts here
            DispatchQueue.main.async {
                let center = UNUserNotificationCenter.current()
                if n == 0 { center.removeDeliveredNotifications(withIdentifiers: [upgradesID]) }
                let set = {
                    if #available(iOS 16.0, *) {
                        center.setBadgeCount(n) { e in c.reply(nil, e.map { "badge: \($0.localizedDescription)" }) }
                    } else {
                        UIApplication.shared.applicationIconBadgeNumber = n
                        c.reply(nil, nil)
                    }
                }
                // iOS shows an icon badge only with permission for badges: ask once, the first time there's a count.
                center.getNotificationSettings { st in
                    if n > 0 && st.authorizationStatus == .notDetermined {
                        center.requestAuthorization(options: [.badge, .alert, .sound]) { _, _ in DispatchQueue.main.async(execute: set) }
                    } else {
                        DispatchQueue.main.async(execute: set)
                    }
                }
            }
        }
    }
}

// The Home Screen icon's quick action (app.shortcuts sets it): the page queues every upgrade and opens Confirm
// (app.js ifizboxShortcut). A tap that launched iFizBox waits for the page as a notification tap does.
enum Shortcut {
    static let upgrade = "com.ryha.ifizbox.upgrade"
    static func perform(_ type: String, tries: Int = 50) {
        let web = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.windows.first?.rootViewController?.view as? WKWebView }.first
        guard let web, !web.isLoading, web.url != nil else {
            if tries > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { perform(type, tries: tries - 1) } }
            return
        }
        // the page's own scripts may still be starting: it calls this once it can (app.js)
        web.callAsyncJavaScript("globalThis.ifizboxShortcut ? globalThis.ifizboxShortcut(t) : (globalThis.ifizboxPendingShortcut = t)",
                                arguments: ["t": type == upgrade ? "upgrade" : type], in: nil, in: .page, completionHandler: nil)
    }
}
