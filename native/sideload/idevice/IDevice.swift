// The "no server" install route (docs/sideload.md, "idevice"): the app talks to this phone's own installd through
// idevice (MIT, built from source by build.sh beside this file) as if it were a computer on USB. The phone is
// reached at LocalDevVPN's loopback address, 10.7.0.1:
//   - iOS 17.4+ (and iOS 27, where lockdown's 62078 is refused over loopback): the RemotePairing service on 49152,
//     an RPPairing tunnel (tunnel_create_rppairing) and RSD, with a RemotePairing pairing made on the phone
//     (pairable host: Settings > Developer > Pair with <app> on this iPhone, a 6-digit code).
//   - older iOS: plain TCP lockdown on 62078 with a pairing file made on a computer (idevice_pair, jitterbugpair)
//     and imported, plus a heartbeat while it is connected.
// Install: AFC writes the signed IPA to PublicStaging, then installation_proxy installs it with progress. No
// itms-services manifest, so nothing goes to the Signing Server, and the app can update itself (installd closes it).
// The pairing is a full credential for the phone: it lives in the Keychain, this device only.
import Darwin
import Foundation
import IDeviceFFI
import Security

enum IDevice {
    static let address = "10.7.0.1" // LocalDevVPN's loopback; the phone itself
    static let lockdownPort: UInt16 = 62078
    // The RemotePairing service. iOS advertises it over mDNS (_remotepairing._tcp); 49152 is the port it had on the
    // iPhone 15 (iOS 27.0.1) for every probe (journal/2026-11-19-f15-idevice-install/notes.md).
    static let remotePairingPort: UInt16 = 49152
    static let stagingDir = "/PublicStaging"
    static let queue = DispatchQueue(label: "ifizbox.idevice", qos: .userInitiated)

    struct Failure: LocalizedError {
        let code: String, text: String
        var errorDescription: String? { "\(code): \(text)" }
    }

    /// Throws idevice's error (and frees it). `code` is the bridge-facing prefix for this step.
    static func check(_ err: UnsafeMutablePointer<IdeviceFfiError>?, _ code: String) throws {
        guard let err = err else { return }
        let msg = err.pointee.message.map { String(cString: $0) } ?? "error \(err.pointee.code)"
        let n = err.pointee.code
        idevice_error_free(err)
        throw Failure(code: code, text: "\(msg) (\(n))")
    }

    // ---- The pairing, in the Keychain

    enum Kind: String { case remotePairing = "rp", lockdown }

    private static let service = "ifizbox.idevice.pairing"

    static func savePairing(_ data: Data, kind: Kind) throws {
        for k in [Kind.remotePairing, .lockdown] { deletePairing(k) } // one pairing at a time
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: kind.rawValue, kSecValueData as String: data,
                                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let st = SecItemAdd(q as CFDictionary, nil)
        guard st == errSecSuccess else { throw Failure(code: "keychain", text: "could not keep the pairing (\(st))") }
    }

    static func pairing() -> (kind: Kind, data: Data)? {
        for k in [Kind.remotePairing, .lockdown] {
            let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                    kSecAttrAccount as String: k.rawValue, kSecReturnData as String: true]
            var out: CFTypeRef?
            if SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data { return (k, d) }
        }
        return nil
    }

    static func deletePairing(_ kind: Kind) {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                       kSecAttrAccount as String: kind.rawValue] as CFDictionary)
    }

    /// Which kind of pairing a file is: a lockdown pairing record (idevice_pair, jitterbugpair: a plist with
    /// HostCertificate/HostPrivateKey) or a RemotePairing one (idevice's rp_pairing_file). Checked by idevice itself.
    static func importPairing(_ data: Data) throws -> Kind {
        let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
        if plist?["HostCertificate"] != nil {
            var pf: OpaquePointer?
            try data.withUnsafeBytes { try check(idevice_pairing_file_from_bytes($0.baseAddress?.assumingMemoryBound(to: UInt8.self), UInt(data.count), &pf), "bad_pairing") }
            idevice_pairing_file_free(pf)
            try savePairing(data, kind: .lockdown)
            return .lockdown
        }
        var rp: OpaquePointer?
        try data.withUnsafeBytes { try check(rp_pairing_file_from_bytes($0.baseAddress?.assumingMemoryBound(to: UInt8.self), UInt(data.count), &rp), "bad_pairing") }
        rp_pairing_file_free(rp)
        try savePairing(data, kind: .remotePairing)
        return .remotePairing
    }

    // ---- Pairing on the phone (iOS 27): this app is the "computer" the phone pairs with

    final class PairCancel {
        fileprivate let token = pairable_host_cancel_new()
        func signal() { if let t = token { pairable_host_cancel_signal(t) } }
        deinit { if let t = token { pairable_host_cancel_free(t) } }
    }

    private final class PinBox { let show: (String) -> Void; init(_ f: @escaping (String) -> Void) { show = f } }

    /// Advertises the app as a pairable host and waits (blocking; call it on `queue`) until the phone pairs, the
    /// user cancels, or it fails. `pin` gets the 6-digit code to type on the phone.
    static func pairOnPhone(cancel: PairCancel, pin: @escaping (String) -> Void) throws {
        let box = Unmanaged.passRetained(PinBox(pin))
        defer { box.release() }
        var out: OpaquePointer?
        let cb: @convention(c) (UnsafePointer<CChar>?, UnsafeMutableRawPointer?) -> Void = { p, ctx in
            guard let p = p, let ctx = ctx else { return }
            Unmanaged<PinBox>.fromOpaque(ctx).takeUnretainedValue().show(String(cString: p))
        }
        try check(pairable_host_accept(Brand.name, nil, 0, cb, box.toOpaque(), cancel.token, nil, nil, &out), "pair_failed")
        defer { rp_pairing_file_free(out) }
        try savePairing(try bytes(out), kind: .remotePairing)
    }

    private static func bytes(_ rp: OpaquePointer?) throws -> Data {
        var p: UnsafeMutablePointer<UInt8>?
        var n: UInt = 0
        try check(rp_pairing_file_to_bytes(rp, &p, &n), "pair_failed")
        defer { idevice_data_free(p, n) }
        return p.map { Data(bytes: $0, count: Int(n)) } ?? Data()
    }

    // ---- Connecting

    static func sockaddr4(_ port: UInt16) -> sockaddr_in {
        var a = sockaddr_in()
        a.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        a.sin_family = sa_family_t(AF_INET)
        a.sin_port = port.bigEndian
        inet_pton(AF_INET, address, &a.sin_addr)
        return a
    }

    /// One connection to the phone's services, over whichever route the stored pairing is for.
    final class Session {
        private var provider: OpaquePointer? // lockdown: IdeviceProviderHandle
        private var adapter: OpaquePointer?  // RemotePairing: AdapterHandle (the tunnel)
        private var handshake: OpaquePointer? // and its RsdHandshakeHandle
        private var heartbeat: OpaquePointer?
        private var beating = false
        let kind: Kind

        init() throws {
            guard let (kind, data) = IDevice.pairing() else {
                throw Failure(code: "not_paired", text: "pair this iPhone first (Settings > Installation)")
            }
            self.kind = kind
            switch kind {
            case .remotePairing:
                var rp: OpaquePointer?
                try data.withUnsafeBytes { try check(rp_pairing_file_from_bytes($0.baseAddress?.assumingMemoryBound(to: UInt8.self), UInt(data.count), &rp), "bad_pairing") }
                defer { rp_pairing_file_free(rp) }
                var a = sockaddr4(remotePairingPort)
                let err = withUnsafePointer(to: &a) {
                    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                        tunnel_create_rppairing($0, socklen_t(MemoryLayout<sockaddr_in>.size), Brand.name, rp, nil, nil, &adapter, &handshake)
                    }
                }
                try check(err, "connect_failed")
                // A pair-verify that fell back to pair-setup updates the file in place: keep what it is now.
                if let now = try? IDevice.bytes(rp), now != data { try? savePairing(now, kind: .remotePairing) }
            case .lockdown:
                var pf: OpaquePointer?
                try data.withUnsafeBytes { try check(idevice_pairing_file_from_bytes($0.baseAddress?.assumingMemoryBound(to: UInt8.self), UInt(data.count), &pf), "bad_pairing") }
                var a = sockaddr4(lockdownPort)
                let err = withUnsafePointer(to: &a) {
                    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { idevice_tcp_provider_new($0, pf, Brand.name, &provider) }
                }
                if err != nil { idevice_pairing_file_free(pf) } // consumed only on success
                try check(err, "connect_failed")
                try check(heartbeat_connect(provider, &heartbeat), "connect_failed")
                startHeartbeat()
            }
        }

        /// lockdown drops a client that stops answering its heartbeat: answer marco with polo while connected.
        private func startHeartbeat() {
            beating = true
            Thread.detachNewThread { [weak self] in
                var interval: UInt64 = 15
                while let s = self, s.beating, let hb = s.heartbeat {
                    var next: UInt64 = 0
                    if heartbeat_get_marco(hb, interval, &next) != nil || heartbeat_send_polo(hb) != nil { break }
                    if next > 0 { interval = next }
                }
            }
        }

        func afc() throws -> OpaquePointer? {
            var c: OpaquePointer?
            switch kind {
            case .remotePairing: try check(afc_client_connect_rsd(adapter, handshake, &c), "afc_failed")
            case .lockdown: try check(afc_client_connect(provider, &c), "afc_failed")
            }
            return c
        }

        func installationProxy() throws -> OpaquePointer? {
            var c: OpaquePointer?
            switch kind {
            case .remotePairing: try check(installation_proxy_connect_rsd(adapter, handshake, &c), "install_failed")
            case .lockdown: try check(installation_proxy_connect(provider, &c), "install_failed")
            }
            return c
        }

        deinit {
            beating = false
            if let h = heartbeat { heartbeat_client_free(h) }
            if let h = handshake { rsd_handshake_free(h) }
            if let a = adapter { adapter_free(a) }
            if let p = provider { idevice_provider_free(p) }
        }
    }

    /// Connects once with the stored pairing: "is the pairing still good and LocalDevVPN on". Blocking.
    static func verify() throws -> Kind { try Session().kind }

    // ---- Installing

    enum Step { case upload(Double), install(Double) }

    private final class ProgressBox { let f: (Step) -> Void; init(_ f: @escaping (Step) -> Void) { self.f = f } }

    /// Installs a signed IPA on this phone (blocking; call it on `queue`). Installing this app itself works too:
    /// installd ends the process, so the call never returns then.
    static func install(_ ipa: URL, progress: @escaping (Step) -> Void) throws {
        let s = try Session()
        let remote = "\(stagingDir)/\(UUID().uuidString).ipa"
        try upload(ipa, to: remote, session: s, progress: progress)
        let ip = try s.installationProxy()
        defer { installation_proxy_client_free(ip) }
        let box = Unmanaged.passRetained(ProgressBox(progress))
        defer { box.release() }
        let cb: @convention(c) (UInt64, UnsafeMutableRawPointer?) -> Void = { pct, ctx in
            guard let ctx = ctx else { return }
            Unmanaged<ProgressBox>.fromOpaque(ctx).takeUnretainedValue().f(.install(Double(min(pct, 100)) / 100))
        }
        let err = installation_proxy_install_with_callback(ip, remote, nil, cb, box.toOpaque())
        if let afc = try? s.afc() { afc_remove_path(afc, remote).map(idevice_error_free); afc_client_free(afc) }
        try check(err, "install_failed")
        progress(.install(1))
    }

    static let chunk = 1 << 20

    private static func upload(_ ipa: URL, to remote: String, session s: Session, progress: (Step) -> Void) throws {
        let fh = try FileHandle(forReadingFrom: ipa)
        defer { try? fh.close() }
        let total = (try? ipa.resourceValues(forKeys: [.fileSizeKey]).fileSize).flatMap { $0 } ?? 0
        let afc = try s.afc()
        defer { afc_client_free(afc) }
        afc_make_directory(afc, stagingDir).map(idevice_error_free) // there already: an error, and fine
        var file: OpaquePointer?
        try check(afc_file_open(afc, remote, AfcWrOnly, &file), "upload_failed")
        var sent = 0
        do {
            while let d = try fh.read(upToCount: chunk), !d.isEmpty {
                try d.withUnsafeBytes { try check(afc_file_write(file, $0.baseAddress?.assumingMemoryBound(to: UInt8.self), d.count), "upload_failed") }
                sent += d.count
                progress(.upload(total > 0 ? Double(sent) / Double(total) : 0))
            }
        } catch {
            afc_file_close(file).map(idevice_error_free)
            throw error
        }
        try check(afc_file_close(file), "upload_failed")
    }
}
