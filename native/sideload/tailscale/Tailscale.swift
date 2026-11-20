// Tailscale as the "This iPhone" route's connection (README.md beside this file), sideload build only. iOS runs one
// VPN at a time; a Tailscale user keeps Tailscale on instead of switching to LocalDevVPN. The app runs its own tsnet
// node (tsnet.go) only while signing in, testing or installing, and idevice reaches this phone's own RemotePairing
// service through it: a 127.0.0.1 relay per port (the RPPairing port, then the tunnel's port, through
// idevice's tunnel_set_port_map), each connection dialed over the tailnet to the phone's own Tailscale address.
//
// Bridge calls (TailscaleBridge below):
//   tailscale.status      {address, signedIn, name, keyExpiry, connect, use}: quick, doesn't start the node
//   tailscale.setConnect  {value: "auto"|"localdevvpn"|"tailscale"} -> status (Settings > Installation's Connect With)
//   tailscale.signIn      starts the node; emits [{step: "login"}] and opens the login page when it needs one,
//                         [{step: "approval"}] when the tailnet wants it approved; replies status once it's in
//   tailscale.signInCancel ends a running tailscale.signIn (it replies "canceled: ..."); the page asks it when it's left
//                         while the sign-in starts or waits for approval
//   tailscale.test        RemotePairing's handshake to this phone through the tailnet: {ok, code, detail, peer, ms}
//   tailscale.signOut     logs the node out and deletes its state -> status
import Darwin
import Foundation
import IDeviceFFI
import os
import SafariServices
import TailscaleFFI
import UIKit

enum Tailscale {
    static let connectKey = "ifizbox.installConnect" // auto | localdevvpn | tailscale
    static let nodeKey = "ifizbox.tailscale.node"   // {name, keyExpiry} once signed in
    static var deviceName = "iPhone"                 // UIDevice.current.name, read on the main thread at launch

    private static let osLog = OSLog(subsystem: "ifizbox.tailscale", category: "app")
    static func log(_ s: String) { os_log("%{public}@", log: osLog, type: .default, "\(Brand.name) tailscale: \(s)") }

    /// The node's state (its keys among it): Application Support, not backed up, unreadable until first unlock.
    static var stateDir: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        var dir = base.appendingPathComponent("tailscale", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true,
                                                 attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var v = URLResourceValues(); v.isExcludedFromBackup = true
        try? dir.setResourceValues(v)
        return dir
    }

    static var hostname: String { "\(Brand.name) on \(deviceName)" }
    static var connect: String { UserDefaults.standard.string(forKey: connectKey) ?? "auto" }
    static var node: [String: Any]? { UserDefaults.standard.dictionary(forKey: nodeKey) }

    /// This phone's own Tailscale address: an IPv4 in 100.64.0.0/10 on a utun interface that's up (the Tailscale app's
    /// VPN is on). nil when it's off.
    static func ownAddress() -> String? {
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0 else { return nil }
        defer { freeifaddrs(head) }
        var p = head
        while let i = p {
            defer { p = i.pointee.ifa_next }
            let name = String(cString: i.pointee.ifa_name)
            guard name.hasPrefix("utun"), Int32(i.pointee.ifa_flags) & IFF_UP != 0,
                  let a = i.pointee.ifa_addr, a.pointee.sa_family == sa_family_t(AF_INET) else { continue }
            let addr = a.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { UInt32(bigEndian: $0.pointee.sin_addr.s_addr) }
            if addr & 0xFFC0_0000 == 0x6440_0000 { // 100.64.0.0/10
                return "\(addr >> 24).\((addr >> 16) & 255).\((addr >> 8) & 255).\(addr & 255)"
            }
        }
        return nil
    }

    /// Installs go through Tailscale: Connect With is Tailscale, or Automatic with the Tailscale VPN on, and the app's
    /// node is signed in.
    static func useForInstall() -> Bool {
        guard connect != "localdevvpn", node != nil, ownAddress() != nil else { return false }
        return true
    }

    static func status() -> [String: Any] {
        let n = node
        return ["address": ownAddress() ?? NSNull(), "signedIn": n != nil, "name": n?["name"] ?? NSNull(),
                "keyExpiry": n?["keyExpiry"] ?? NSNull(), "connect": connect, "use": useForInstall()]
    }

    static func json(_ p: UnsafeMutablePointer<CChar>?) -> [String: Any] {
        guard let p = p else { return [:] }
        defer { TSFree(p) }
        let d = Data(bytes: p, count: strlen(p))
        return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] ?? [:]
    }

    /// Starts the node (or reads it, if it runs): {running, state, authURL, name, ips, keyExpiry, expired, error}.
    static func start() -> [String: Any] {
        let dir = strdup(stateDir.path), host = strdup(hostname)
        defer { free(dir); free(host) }
        let t0 = Date()
        let st = json(TSStart(dir, host))
        log("node started in \(String(format: "%.1f", Date().timeIntervalSince(t0))) s: state \(st["state"] ?? "?"), \(st["error"] ?? "")")
        return st
    }

    static func current() -> [String: Any] { json(TSStatus()) }
    static func stop() { TSStop() }

    static func remember(_ st: [String: Any]) {
        var n: [String: Any] = ["name": st["name"] as? String ?? hostname]
        if let k = st["keyExpiry"] as? String, !k.isEmpty { n["keyExpiry"] = k }
        UserDefaults.standard.set(n, forKey: nodeKey)
    }

    static func forget() {
        UserDefaults.standard.removeObject(forKey: nodeKey)
        try? FileManager.default.removeItem(at: stateDir)
    }

    // ---- Installing (IDevice.Session, on IDevice.queue's thread)

    private static let lock = NSLock()
    private static var relayHost: String? // the phone's own Tailscale address while an install runs

    /// Starts the node for an install and returns the 127.0.0.1 port that reaches `port` on this phone. Blocking.
    static func beginInstall(port: UInt16) throws -> UInt16 {
        guard let own = ownAddress() else {
            throw IDevice.Failure(code: "connect_failed", text: "Tailscale is off: turn it on in the Tailscale app")
        }
        let st = start()
        if let e = st["error"] as? String, !e.isEmpty { stop(); throw IDevice.Failure(code: "connect_failed", text: "Tailscale: \(e)") }
        switch st["state"] as? String ?? "" {
        case "Running": remember(st)
        case "NeedsMachineAuth":
            stop(); throw IDevice.Failure(code: "connect_failed", text: "Tailscale: approve this device in the tailnet's admin console")
        case "NeedsLogin":
            stop(); throw IDevice.Failure(code: "connect_failed", text: "Tailscale: sign in again in Settings > Installation (the device key expired)")
        case let s:
            stop(); throw IDevice.Failure(code: "connect_failed", text: "Tailscale didn't connect (\(s.isEmpty ? "no answer" : s)); check the internet connection")
        }
        lock.lock(); relayHost = own; lock.unlock()
        let local = mapPort(port)
        guard local != port else { endInstall(); throw IDevice.Failure(code: "connect_failed", text: "Tailscale: couldn't open the local relay") }
        tunnel_set_port_map { Tailscale.mapPort($0) }
        log("install through \(own):\(port) via 127.0.0.1:\(local) (node \(st["name"] ?? "?"))")
        return local
    }

    /// The local relay port for `port` on this phone (idevice asks for the tunnel's port this way); `port` itself when
    /// no install runs.
    static func mapPort(_ port: UInt16) -> UInt16 {
        lock.lock(); let host = relayHost; lock.unlock()
        guard let h = host else { return port }
        let c = strdup(h); defer { free(c) }
        let p = TSRelay(c, Int32(port))
        log("relay for port \(port): 127.0.0.1:\(p)")
        return p > 0 ? UInt16(p) : port
    }

    static func endInstall() {
        tunnel_set_port_map(nil)
        lock.lock(); relayHost = nil; lock.unlock()
        stop()
        log("install connection closed; node stopped")
    }
}

enum TailscaleBridge {
    static func register(_ b: Bridge) {
        Tailscale.deviceName = UIDevice.current.name
        b.on("tailscale.status") { c in IDeviceBridge.quick(c) { Tailscale.status() } }
        b.on("tailscale.setConnect") { c in
            IDeviceBridge.quick(c) {
                let v = c.params["value"] as? String ?? "auto"
                UserDefaults.standard.set(["auto", "localdevvpn", "tailscale"].contains(v) ? v : "auto", forKey: Tailscale.connectKey)
                return Tailscale.status()
            }
        }
        b.on("tailscale.signIn") { c in
            setCanceled(false) // here, not on the queue: a cancel sent while it waits there still counts
            IDeviceBridge.run(c) { try signIn(c) }
        }
        b.on("tailscale.signInCancel") { c in
            setCanceled(true)
            Apt.reply(c, ["ok": true], nil)
        }
        b.on("tailscale.test") { c in IDeviceBridge.run(c) { try test() } }
        b.on("tailscale.signOut") { c in
            IDeviceBridge.run(c) {
                if Tailscale.node != nil {
                    _ = Tailscale.start()
                    let r = Tailscale.json(TSLogout())
                    Tailscale.log("signed out: \(r)")
                }
                Tailscale.stop()
                Tailscale.forget()
                return Tailscale.status()
            }
        }
    }

    private static let cancelLock = NSLock()
    private static var signInCanceled = false
    private static func setCanceled(_ v: Bool) { cancelLock.lock(); signInCanceled = v; cancelLock.unlock() }
    private static var canceled: Bool { cancelLock.lock(); defer { cancelLock.unlock() }; return signInCanceled }

    private final class Sheet: NSObject, SFSafariViewControllerDelegate {
        var vc: SFSafariViewController?
        var closed = false // the user closed the login page
        func safariViewControllerDidFinish(_ controller: SFSafariViewController) { closed = true }
    }

    private static func topController() -> UIViewController? {
        let win = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.windows.first { $0.isKeyWindow } ?? ($0 as? UIWindowScene)?.windows.first }.first
        var top = win?.rootViewController
        while let p = top?.presentedViewController { top = p }
        return top
    }

    /// Starts the node; while it needs a login, shows Tailscale's login page in the app and waits (up to 10 min) until
    /// the node runs. Stops the node after.
    static func signIn(_ c: Bridge.Call) throws -> Any? {
        let sheet = Sheet()
        defer {
            Tailscale.stop()
            DispatchQueue.main.async { sheet.vc?.dismiss(animated: true) }
        }
        let stopped = IDevice.Failure(code: "canceled", text: "sign-in canceled: the page was left")
        if canceled { throw stopped }
        var st = Tailscale.start()
        if let e = st["error"] as? String, !e.isEmpty { throw IDevice.Failure(code: "tailscale", text: e) }
        var shownURL = "", lastState = ""
        let deadline = Date().addingTimeInterval(600)
        while Date() < deadline {
            let state = st["state"] as? String ?? ""
            if state != lastState { Tailscale.log("sign in: state \(state)"); lastState = state }
            if state == "Running", !((st["ips"] as? [Any]) ?? []).isEmpty {
                Tailscale.remember(st)
                Tailscale.log("signed in as \(st["name"] ?? "?")")
                return Tailscale.status()
            }
            if canceled { Tailscale.log("sign in: canceled by the page"); throw stopped }
            if state == "NeedsMachineAuth" { DispatchQueue.main.async { c.emit([["step": "approval"]]) } }
            if state == "NeedsLogin", let u = st["authURL"] as? String, !u.isEmpty, u != shownURL, let url = URL(string: u) {
                shownURL = u
                Tailscale.log("sign in: opening the login page")
                DispatchQueue.main.async {
                    c.emit([["step": "login"]])
                    sheet.vc?.dismiss(animated: false)
                    let vc = SFSafariViewController(url: url)
                    vc.delegate = sheet
                    sheet.vc = vc
                    sheet.closed = false
                    topController()?.present(vc, animated: true)
                }
            }
            if sheet.closed && state != "Running" {
                Thread.sleep(forTimeInterval: 2) // a login that just finished closes the page itself
                st = Tailscale.current()
                if st["state"] as? String == "Running" { continue }
                throw IDevice.Failure(code: "canceled", text: "sign-in canceled")
            }
            Thread.sleep(forTimeInterval: 1)
            st = Tailscale.current()
        }
        throw IDevice.Failure(code: "timeout", text: "the sign-in didn't finish in 10 minutes")
    }

    /// RemotePairing's handshake to this phone's own Tailscale address, through the tailnet.
    static func test() throws -> Any? {
        guard Tailscale.node != nil else { throw IDevice.Failure(code: "not_signed_in", text: "sign in to Tailscale first") }
        guard let own = Tailscale.ownAddress() else { return ["ok": false, "code": "no_interface"] }
        defer { Tailscale.stop() }
        let st = Tailscale.start()
        if let e = st["error"] as? String, !e.isEmpty { return ["ok": false, "code": "not_running", "detail": e] }
        if st["state"] as? String == "Running" { Tailscale.remember(st) }
        let h = strdup(own); defer { free(h) }
        var r = Tailscale.json(TSTest(h, Int32(IDevice.remotePairingPort)))
        r["address"] = own
        r["name"] = st["name"] ?? NSNull()
        Tailscale.log("test \(own):\(IDevice.remotePairingPort): \(r)")
        return r
    }
}
