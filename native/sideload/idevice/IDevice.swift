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
import dnssd
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
    //
    // idevice generates the host identity and TXT records (pairable_host_prepare) and runs the pairing on a socket
    // the phone has connected to (pairable_host_accept_fd); the networking is Apple's. A dual-stack listener on every
    // interface, published with DNSServiceRegister, so mDNSResponder advertises its own host name and the addresses
    // the phone's remotepairingdeviced can reach (loopback included). idevice's all-in-one pairable_host_accept
    // binds IPv4 only and answers mDNS itself (mdns-sd, an "idevice-XXXX.local." host): on the iPhone 15 Pro (iOS
    // 27.0.1) the phone resolved it but its connection stalled and never reached the listener (SYN in: 0).

    static let pairableHostService = "_remotepairing-pairable-host._tcp" // idevice's PAIRABLE_HOST_SERVICE_TYPE

    /// Ends a waiting pairOnPhone from any thread: stops accepting and shuts down a pairing in progress.
    final class PairCancel {
        private let lock = NSLock()
        private var canceled = false
        private var conn: Int32 = -1
        var isCanceled: Bool { lock.lock(); defer { lock.unlock() }; return canceled }
        func signal() {
            lock.lock(); canceled = true; let fd = conn; lock.unlock()
            if fd >= 0 { shutdown(fd, SHUT_RDWR) } // wakes idevice's read on its dup of this socket
        }
        fileprivate func track(_ fd: Int32) -> Bool {
            lock.lock(); defer { lock.unlock() }
            conn = fd
            return !canceled
        }
    }

    /// What pairOnPhone tells the page while it waits.
    enum PairEvent { case step(String, String), failed(String, String), pin(String) }

    static func log(_ s: String) { NSLog("%@", "\(Brand.name) pair: \(s)") }

    private final class PinBox { let show: (String) -> Void; init(_ f: @escaping (String) -> Void) { show = f } }

    private final class RegBox {
        let done = DispatchSemaphore(value: 0)
        var err: DNSServiceErrorType = 0
        var name = ""
        var signalled = false
    }

    /// Advertises the app as a pairable host and waits (blocking; call it on `queue`) until the phone pairs, the
    /// user cancels, or it fails. `event` gets the steps, a failed try (the phone can try again) and the 6-digit
    /// code to type on the phone.
    static func pairOnPhone(cancel: PairCancel, event: @escaping (PairEvent) -> Void) throws {
        // 1. The identity and what to publish
        var handle: OpaquePointer?
        var sid: UnsafeMutablePointer<CChar>?
        var txtPtr: UnsafeMutablePointer<UInt8>?
        var txtLen: UInt = 0
        try check(pairable_host_prepare(Brand.name, nil, false, &handle, &sid, &txtPtr, &txtLen, nil), "pair_failed")
        defer { pairable_host_free(handle) }
        let serviceID = sid.map { String(cString: $0) } ?? ""
        if let sid = sid { idevice_string_free(sid) }
        let txtPlist = txtPtr.map { Data(bytes: $0, count: Int(txtLen)) } ?? Data()
        if let t = txtPtr { idevice_data_free(t, txtLen) }
        guard let txt = (try? PropertyListSerialization.propertyList(from: txtPlist, format: nil)) as? [String: String] else {
            throw Failure(code: "pair_failed", text: "idevice gave no TXT records")
        }
        var record = Data() // DNS TXT: length-prefixed key=value strings
        for (k, v) in txt.sorted(by: { $0.key < $1.key }) {
            let kv = Data("\(k)=\(v)".utf8).prefix(255)
            record.append(UInt8(kv.count)); record.append(kv)
        }
        log("identity \(serviceID), TXT keys \(txt.keys.sorted().joined(separator: ","))")

        // 2. The listener: IPv6 socket that takes IPv4 too, every interface, a free port
        let lfd = socket(AF_INET6, SOCK_STREAM, IPPROTO_TCP)
        guard lfd >= 0 else { throw Failure(code: "pair_failed", text: "socket: \(String(cString: strerror(errno)))") }
        defer { close(lfd) }
        var off: Int32 = 0, on: Int32 = 1
        setsockopt(lfd, IPPROTO_IPV6, IPV6_V6ONLY, &off, socklen_t(MemoryLayout<Int32>.size))
        setsockopt(lfd, SOL_SOCKET, SO_REUSEADDR, &on, socklen_t(MemoryLayout<Int32>.size))
        var any = sockaddr_in6()
        any.sin6_len = UInt8(MemoryLayout<sockaddr_in6>.size)
        any.sin6_family = sa_family_t(AF_INET6)
        any.sin6_addr = in6addr_any
        let bound = withUnsafePointer(to: &any) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(lfd, $0, socklen_t(MemoryLayout<sockaddr_in6>.size)) } }
        guard bound == 0, listen(lfd, 4) == 0 else { throw Failure(code: "pair_failed", text: "listen: \(String(cString: strerror(errno)))") }
        var got = sockaddr_in6(); var gl = socklen_t(MemoryLayout<sockaddr_in6>.size)
        _ = withUnsafeMutablePointer(to: &got) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(lfd, $0, &gl) } }
        let port = UInt16(bigEndian: got.sin6_port)
        log("listening on [::]:\(port) (IPv4 and IPv6, every interface); addresses: \(interfaceAddresses())")
        event(.step("listening", "Listening on port \(port)."))

        // 3. Bonjour, by mDNSResponder
        let reg = RegBox()
        let regCtx = Unmanaged.passRetained(reg)
        defer { regCtx.release() }
        var sdRef: DNSServiceRef?
        let cb: DNSServiceRegisterReply = { _, _, err, name, _, _, ctx in
            guard let ctx = ctx else { return }
            let r = Unmanaged<RegBox>.fromOpaque(ctx).takeUnretainedValue()
            r.err = err
            r.name = name.map { String(cString: $0) } ?? ""
            if !r.signalled { r.signalled = true; r.done.signal() }
        }
        let st = record.withUnsafeBytes { buf in
            DNSServiceRegister(&sdRef, 0, 0, serviceID, pairableHostService, nil, nil, port.bigEndian,
                               UInt16(buf.count), buf.baseAddress, cb, regCtx.toOpaque())
        }
        guard st == kDNSServiceErr_NoError, let sd = sdRef else {
            log("DNSServiceRegister failed: \(st)")
            throw Failure(code: "pair_failed", text: bonjourError(st))
        }
        let bq = DispatchQueue(label: "ifizbox.idevice.bonjour")
        defer { bq.sync { DNSServiceRefDeallocate(sd) } } // on its queue: no callback runs after this
        DNSServiceSetDispatchQueue(sd, bq)
        if reg.done.wait(timeout: .now() + 10) == .timedOut {
            log("Bonjour: no answer from mDNSResponder in 10 s; still waiting for the iPhone")
        } else {
            let err = bq.sync { reg.err }
            guard err == kDNSServiceErr_NoError else {
                log("Bonjour registration failed: \(err)")
                throw Failure(code: "pair_failed", text: bonjourError(err))
            }
            log("Bonjour: registered \(bq.sync { reg.name }).\(pairableHostService) port \(port), every interface")
        }
        event(.step("advertised", "Waiting for the iPhone to connect (port \(port))."))

        // 4. Accept: one try at a time; a failed try keeps listening, so Pair can be tapped again on the phone
        let box = Unmanaged.passRetained(PinBox { event(.pin($0)) })
        defer { box.release() }
        let pinCb: @convention(c) (UnsafePointer<CChar>?, UnsafeMutableRawPointer?) -> Void = { p, ctx in
            guard let p = p, let ctx = ctx else { return }
            IDevice.log("idevice asked for the code to be shown")
            Unmanaged<PinBox>.fromOpaque(ctx).takeUnretainedValue().show(String(cString: p))
        }
        while !cancel.isCanceled {
            var pfd = pollfd(fd: lfd, events: Int16(POLLIN), revents: 0)
            let n = poll(&pfd, 1, 250)
            if n < 0 && errno != EINTR { throw Failure(code: "pair_failed", text: "poll: \(String(cString: strerror(errno)))") }
            guard n > 0 else { continue }
            var peer = sockaddr_storage(); var pl = socklen_t(MemoryLayout<sockaddr_storage>.size)
            let cfd = withUnsafeMutablePointer(to: &peer) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { accept(lfd, $0, &pl) } }
            guard cfd >= 0 else { log("accept failed: \(String(cString: strerror(errno)))"); continue }
            let from = numericHost(&peer, pl)
            log("connection from \(from)")
            event(.step("connected", "The iPhone connected. Pairing…"))
            guard cancel.track(cfd) else { close(cfd); break }
            var out: OpaquePointer?
            let err = pairable_host_accept_fd(handle, cfd, pinCb, box.toOpaque(), nil, &out)
            _ = cancel.track(-1)
            close(cfd)
            do {
                try check(err, "pair_failed")
                defer { rp_pairing_file_free(out) }
                try savePairing(try bytes(out), kind: .remotePairing)
                log("paired; the pairing is saved")
                return
            } catch let e as Failure {
                if cancel.isCanceled { break }
                log("pairing with \(from) failed: \(e.text)")
                event(.failed("pairing", e.text))
            }
        }
        log("canceled")
        throw Failure(code: "canceled", text: "pairing stopped")
    }

    private static func bonjourError(_ e: DNSServiceErrorType) -> String {
        if e == kDNSServiceErr_NoAuth || e == kDNSServiceErr_PolicyDenied {
            return "Local Network access is off for this app: turn it on in Settings > Privacy & Security > Local Network (Bonjour error \(e))"
        }
        return "could not advertise on the local network (Bonjour error \(e))"
    }

    private static func numericHost(_ ss: UnsafeMutablePointer<sockaddr_storage>, _ len: socklen_t) -> String {
        var host = [CChar](repeating: 0, count: Int(NI_MAXHOST)), serv = [CChar](repeating: 0, count: Int(NI_MAXSERV))
        let r = ss.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            getnameinfo($0, len, &host, socklen_t(host.count), &serv, socklen_t(serv.count), NI_NUMERICHOST | NI_NUMERICSERV)
        }
        return r == 0 ? "\(String(cString: host)) port \(String(cString: serv))" : "?"
    }

    /// This phone's interfaces and addresses, for the log ("lo0 127.0.0.1, en0 fe80::…, utun4 10.7.0.0").
    static func interfaceAddresses() -> String {
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return "?" }
        defer { freeifaddrs(list) }
        var out: [String] = []
        for p in sequence(first: first, next: { $0.pointee.ifa_next }) {
            guard let a = p.pointee.ifa_addr, (p.pointee.ifa_flags & UInt32(IFF_UP)) != 0 else { continue }
            let fam = Int32(a.pointee.sa_family)
            guard fam == AF_INET || fam == AF_INET6 else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            let len = socklen_t(fam == AF_INET ? MemoryLayout<sockaddr_in>.size : MemoryLayout<sockaddr_in6>.size)
            if getnameinfo(a, len, &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
                out.append("\(String(cString: p.pointee.ifa_name)) \(String(cString: host))")
            }
        }
        return out.joined(separator: ", ")
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
