// The bridge calls for the "no server" install route (IDevice.swift), sideload build only:
//   idevice.status        {paired: "rp"|"lockdown"|null, ios, pairOnPhone, localDevVPN, otherVPN, tunnels, tailscale}
//   idevice.vpn           {localDevVPN, otherVPN, tunnels} (VPNCheck)
//   idevice.import        {data: base64 pairing file} -> status; a lockdown pairing record or a RemotePairing one
//   idevice.pair          makes the 6-digit code first and emits [{pin}] at once (also posted as a notification, for
//                         the Settings app), then [{step, text}] as it goes (listening, advertised, connected) and
//                         [{step: "failed", error}] when a try fails (it keeps listening: Pair can be tapped again);
//                         replies status when paired (iOS 27+). No timeout: it waits until paired or canceled.
//   idevice.pairState     {active, pin, step, text, error}: the pairing now, for a page that was in the background
//   idevice.pairCancel    ends a waiting idevice.pair (it replies "canceled: ...")
//   idevice.verify        connects once: {ok: true, kind} or "not_paired:/connect_failed:/bad_pairing: ..."
//   idevice.forget        deletes the pairing -> status
//   idevice.openLocalDevVPN  opens the LocalDevVPN app ({opened: false} when it isn't installed)
//   idevice.vpnApps       {localdevvpn: bool, tailscale: bool}: which VPN apps are installed (canOpenURL on their
//                         schemes, listed in Info-sideload.plist LSApplicationQueriesSchemes); the page picks the
//                         way to connect from it (web/app/core/installroute.js vpnRoute)
// Installing through this route is IDevice.install(_:progress:), called by the install run.
import Foundation
import UIKit
import UserNotifications

enum IDeviceBridge {
    private static var pairing: IDevice.PairCancel? // on IDevice.queue's callers; guarded by lock
    private static let lock = NSLock()
    static let localDevVPNScheme = "localdevvpn://" // LocalDevVPN's URL scheme, to open it
    // The Tailscale app's URL scheme: Tailscale's own deep links use it (tailscale/tailscale tka/deeplink.go,
    // DeeplinkTailscaleURLScheme = "tailscale").
    static let tailscaleScheme = "tailscale://"
    static let codeNoteID = "ifizbox-pairing-code"
    private static var now: [String: Any] = ["active": false] // idevice.pairState; guarded by lock

    private static func setNow(_ cancel: IDevice.PairCancel, _ f: (inout [String: Any]) -> Void) {
        lock.lock(); if pairing === cancel { f(&now) }; lock.unlock()
    }

    static func register(_ b: Bridge) {
        // Not on IDevice.queue: idevice.pair holds it while it waits, and the page asks for these meanwhile.
        b.on("idevice.status") { c in quick(c) { status() } }
        b.on("idevice.vpn") { c in quick(c) { VPNCheck.status() } }
        b.on("idevice.pairState") { c in quick(c) { lock.lock(); defer { lock.unlock() }; return now } }
        b.on("idevice.import") { c in
            run(c) {
                guard let s = c.params["data"] as? String, let d = Data(base64Encoded: s) else {
                    throw IDevice.Failure(code: "bad_pairing", text: "no pairing file")
                }
                _ = try IDevice.importPairing(d)
                return status()
            }
        }
        b.on("idevice.pair") { c in
            guard AppMode.current != .jailbreak else { return run(c) { nil } } // run() refuses the jailbreak build
            let cancel = IDevice.PairCancel()
            let code = IDevice.newPairingCode()
            lock.lock()
            pairing?.signal()
            pairing = cancel
            now = ["active": true, "pin": code, "step": "starting", "text": "", "error": ""]
            lock.unlock()
            // The code first, before anything listens: the page shows it, and a notification carries it into the
            // Settings app, where it is typed. iFizBox is in the background meanwhile: KeepAlive's silent audio
            // keeps the listener and Bonjour going for as long as the page is in pairing mode.
            c.emit([["pin": code]])
            KeepAlive.shared.begin()
            postCode(code)
            run(c) {
                defer {
                    lock.lock()
                    if pairing === cancel { pairing = nil; now = ["active": false] }
                    lock.unlock()
                    KeepAlive.shared.end()
                    removeCode()
                }
                try IDevice.pairOnPhone(code: code, cancel: cancel) { ev in
                    let e: [String: Any]
                    switch ev {
                    case .pin(let pin): e = ["pin": pin]
                    case .step(let step, let text): e = ["step": step, "text": text]
                    case .failed(let step, let error): e = ["step": "failed", "failedAt": step, "error": error]
                    }
                    setNow(cancel) { n in
                        if let p = e["pin"] { n["pin"] = p }
                        if let st = e["step"] { n["step"] = st }
                        if let t = e["text"] { n["text"] = t; n["error"] = "" }
                        if let err = e["error"] { n["error"] = err }
                    }
                    DispatchQueue.main.async { c.emit([e]) }
                }
                return status()
            }
        }
        b.on("idevice.pairCancel") { c in
            lock.lock(); pairing?.signal(); lock.unlock()
            Apt.reply(c, ["ok": true], nil)
        }
        b.on("idevice.verify") { c in run(c) { ["ok": true, "kind": try IDevice.verify().rawValue] } }
        b.on("idevice.forget") { c in
            run(c) {
                IDevice.deletePairing(.remotePairing)
                IDevice.deletePairing(.lockdown)
                return status()
            }
        }
        b.on("idevice.openLocalDevVPN") { c in
            DispatchQueue.main.async {
                guard AppMode.current != .jailbreak, let u = URL(string: localDevVPNScheme) else { return c.reply(["opened": false], nil) }
                UIApplication.shared.open(u, options: [:]) { ok in c.reply(["opened": ok], nil) }
            }
        }
        b.on("idevice.vpnApps") { c in
            DispatchQueue.main.async { // canOpenURL is main-thread UIKit
                guard AppMode.current != .jailbreak else { return Apt.reply(c, nil, "jailbreak: the jailbreak app installs IPAs through its helper") }
                let has = { (s: String) in URL(string: s).map { UIApplication.shared.canOpenURL($0) } ?? false }
                c.reply(["localdevvpn": has(localDevVPNScheme), "tailscale": has(tailscaleScheme)], nil)
            }
        }
    }

    /// Sideload build only (the jailbreak app installs through its helper), on IDevice.queue, which keeps one
    /// connection to the phone at a time. idevice.pair waits there too, so the other calls wait for it.
    static func run(_ c: Bridge.Call, _ f: @escaping () throws -> Any?) {
        guard AppMode.current != .jailbreak else { return Apt.reply(c, nil, "jailbreak: the jailbreak app installs IPAs through its helper") }
        IDevice.queue.async {
            do { Apt.reply(c, try f(), nil) } catch let e as IDevice.Failure { Apt.reply(c, nil, e.errorDescription) } catch {
                Apt.reply(c, nil, "internal: \(error.localizedDescription)")
            }
        }
    }

    /// The quick calls, off IDevice.queue (sideload build only, like run).
    static func quick(_ c: Bridge.Call, _ f: @escaping () -> Any?) {
        guard AppMode.current != .jailbreak else { return Apt.reply(c, nil, "jailbreak: the jailbreak app installs IPAs through its helper") }
        DispatchQueue.global(qos: .userInitiated).async { Apt.reply(c, f(), nil) }
    }

    // "iFizBox Pairing Code" / "123 456 — type it in Settings", while pairing waits. Asks for permission the first
    // time; without it there is no notification, and the code is on the page.
    static func postCode(_ code: String) {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return IDevice.log("no notification permission; the code is on the page only") }
            let n = UNMutableNotificationContent()
            n.title = "\(Brand.name) Pairing Code"
            n.body = "\(code.prefix(3)) \(code.suffix(3)) — type it in Settings"
            n.sound = .default
            center.add(UNNotificationRequest(identifier: codeNoteID, content: n, trigger: nil)) { err in
                if let err = err { IDevice.log("notification: \(err.localizedDescription)") }
            }
        }
    }

    static func removeCode() {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [codeNoteID])
        center.removeDeliveredNotifications(withIdentifiers: [codeNoteID])
    }

    static func status() -> [String: Any] {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        var s = VPNCheck.status()
        s["paired"] = IDevice.pairing().map { $0.kind.rawValue as Any } ?? NSNull()
        s["ios"] = "\(v.majorVersion).\(v.minorVersion)"
        s["pairOnPhone"] = v.majorVersion >= 27 // iOS 27 pairs with the app on the phone; older imports a file
        s["tailscale"] = Tailscale.status() // native/sideload/tailscale: Connect With and the node
        return s
    }
}
