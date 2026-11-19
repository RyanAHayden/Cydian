// The bridge calls for the "no server" install route (IDevice.swift), sideload build only:
//   idevice.status        {paired: "rp"|"lockdown"|null, ios, pairOnPhone, localDevVPN, otherVPN, tunnels}
//   idevice.vpn           {localDevVPN, otherVPN, tunnels} (VPNCheck)
//   idevice.import        {data: base64 pairing file} -> status; a lockdown pairing record or a RemotePairing one
//   idevice.pair          emits [{pin}] once the phone asks for the code, replies status when paired (iOS 27+)
//   idevice.pairCancel    ends a waiting idevice.pair (it replies "canceled: ...")
//   idevice.verify        connects once: {ok: true, kind} or "not_paired:/connect_failed:/bad_pairing: ..."
//   idevice.forget        deletes the pairing -> status
//   idevice.openLocalDevVPN  opens the LocalDevVPN app ({opened: false} when it isn't installed)
// Installing through this route is IDevice.install(_:progress:), called by the install run.
import Foundation
import UIKit

enum IDeviceBridge {
    private static var pairing: IDevice.PairCancel? // on IDevice.queue's callers; guarded by lock
    private static let lock = NSLock()
    static let localDevVPNScheme = "localdevvpn://" // LocalDevVPN's URL scheme, to open it

    static func register(_ b: Bridge) {
        b.on("idevice.status") { c in run(c) { status() } }
        b.on("idevice.vpn") { c in run(c) { VPNCheck.status() } }
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
            let cancel = IDevice.PairCancel()
            lock.lock(); pairing?.signal(); pairing = cancel; lock.unlock()
            // The code is typed in the Settings app, so iFizBox is in the background meanwhile: KeepAlive's silent
            // audio keeps the pairable host listening.
            if AppMode.current != .jailbreak { KeepAlive.shared.begin() } // run() refuses the jailbreak build before the defer
            run(c) {
                defer { lock.lock(); if pairing === cancel { pairing = nil }; lock.unlock(); KeepAlive.shared.end() }
                try IDevice.pairOnPhone(cancel: cancel) { pin in
                    DispatchQueue.main.async { c.emit([["pin": pin]]) }
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

    static func status() -> [String: Any] {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        var s = VPNCheck.status()
        s["paired"] = IDevice.pairing().map { $0.kind.rawValue as Any } ?? NSNull()
        s["ios"] = "\(v.majorVersion).\(v.minorVersion)"
        s["pairOnPhone"] = v.majorVersion >= 27 // iOS 27 pairs with the app on the phone; older imports a file
        return s
    }
}
