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
import os
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

    // os_log, public: NSLog's lines never reached the syslog relay on iOS 27 (f15pair2), and os_log redacts a
    // dynamic string as <private> unless it is marked public.
    private static let pairLog = OSLog(subsystem: "ifizbox.idevice", category: "pair")
    static func log(_ s: String) { os_log("%{public}@", log: pairLog, type: .default, "\(Brand.name) pair: \(s)") }

    /// The 6-digit code for one pairing: made before anything listens, shown at once, and used by every try.
    static func newPairingCode() -> String { String(format: "%06d", Int.random(in: 0..<1_000_000)) }

    private final class PinBox { let show: (String) -> Void; init(_ f: @escaping (String) -> Void) { show = f } }

    private final class RegBox {
        let done = DispatchSemaphore(value: 0)
        var err: DNSServiceErrorType = 0
        var name = ""
        var signalled = false
    }

    /// Advertises the app as a pairable host and waits (blocking; call it on `queue`) until the phone pairs, the
    /// user cancels, or it fails. `code` (newPairingCode) is the 6-digit code pair-setup uses on every try, so the
    /// page shows it before the phone connects. `event` gets the steps and a failed try (the phone can try again).
    static func pairOnPhone(code: String, cancel: PairCancel, event: @escaping (PairEvent) -> Void) throws {
        // 1. The identity and what to publish
        var handle: OpaquePointer?
        var sid: UnsafeMutablePointer<CChar>?
        var txtPtr: UnsafeMutablePointer<UInt8>?
        var txtLen: UInt = 0
        try check(pairable_host_prepare(Brand.name, nil, false, &handle, &sid, &txtPtr, &txtLen, nil), "pair_failed")
        defer { pairable_host_free(handle) }
        // Our code, not one idevice draws after the phone connects (patches/0001: pairable_host_set_pin)
        try check(pairable_host_set_pin(handle, code), "pair_failed")
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
            IDevice.log("pair-setup started; the phone asks for the code")
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

    // ---- Logging and time limits for connecting and installing
    //
    // One os_log line per step (subsystem ifizbox.idevice, category install), public, so the syslog relay shows it
    // (NSLog never reached it on iOS 27). idevice's own log (Info: no keys, no payloads) goes to Caches/idevice.log;
    // its last lines are copied into os_log when a step fails or stops answering.
    //
    // No idevice call has a read timeout (its 5 s limit covers TCP connects only), so a phone that stops answering
    // left the install waiting for ever (f15pair4, 2026-11-19: the tunnel stayed up, 14.4 MB went over it, then only
    // empty TCP segments, and the page never got an error). Every step now runs under a Watch: the work runs on its
    // own thread, and when a step goes quiet past its limit the tunnel is closed (adapter_close on a clone), which
    // makes idevice's waiting read fail, and the install fails with what stopped.

    private static let installLog = OSLog(subsystem: "ifizbox.idevice", category: "install")
    static func ilog(_ s: String) { os_log("%{public}@", log: installLog, type: .default, "\(Brand.name) install: \(s)") }

    static let libraryLogURL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("idevice.log")
    private static let libraryLogStarted: Bool = {
        var path = Array(libraryLogURL.path.utf8CString)
        let r = path.withUnsafeMutableBufferPointer { idevice_init_logger(Disabled, Info, $0.baseAddress) }
        ilog("idevice log: \(libraryLogURL.path) (\(r))")
        return true
    }()

    /// The last lines of idevice's own log, into os_log (after a failure).
    static func relayLibraryLog(_ lines: Int = 30) {
        guard let fh = try? FileHandle(forReadingFrom: libraryLogURL) else { return }
        defer { try? fh.close() }
        let end = (try? fh.seekToEnd()) ?? 0
        try? fh.seek(toOffset: end > 8192 ? end - 8192 : 0)
        let text = String(decoding: (try? fh.readToEnd()) ?? Data(), as: UTF8.self)
        for line in text.split(separator: "\n").suffix(lines) { ilog("idevice: \(line)") }
    }

    /// Time limits, in seconds. A step fails when nothing moved for its limit; progress (an uploaded chunk, an
    /// installd percentage) starts the clock again.
    enum Limit {
        static let tunnel: TimeInterval = 30   // RPPairing verify, the tunnel, the RSD handshake (or lockdown)
        static let service: TimeInterval = 20  // connecting to AFC or installation_proxy through RSD
        static let afcStep: TimeInterval = 20  // one AFC request (mkdir, open, close, remove)
        static let upload: TimeInterval = 30   // one 1 MB chunk
        static let install: TimeInterval = 180 // installd's next percentage (a big app verifies for a while)
        static let grace: TimeInterval = 10    // after closing the tunnel, for the stuck call to come back
    }

    /// The step running now and when it last moved; the watchdog's view of the work thread.
    final class Watch {
        private let lock = NSLock()
        private var step = "starting", limit = Limit.tunnel, last = Date()
        private var closer: OpaquePointer? // an AdapterHandle clone, only for adapter_close; freed here
        private(set) var detail = ""

        func begin(_ s: String, _ l: TimeInterval) {
            lock.lock(); step = s; limit = l; last = Date(); lock.unlock()
            IDevice.ilog("step: \(s) (limit \(Int(l)) s)")
        }
        func alive(_ d: String? = nil) { lock.lock(); last = Date(); if let d = d { detail = d }; lock.unlock() }
        var now: (step: String, limit: TimeInterval, quiet: TimeInterval) {
            lock.lock(); defer { lock.unlock() }
            return (step, limit, Date().timeIntervalSince(last))
        }
        func setCloser(_ a: OpaquePointer?) { lock.lock(); closer = a; lock.unlock() }
        /// Shuts the tunnel's TCP stack down: every read waiting on it fails at once.
        func closeTunnel() -> Bool {
            lock.lock(); defer { lock.unlock() }
            guard let c = closer else { return false }
            adapter_close(c).map(idevice_error_free)
            return true
        }
        func releaseCloser() {
            lock.lock(); let c = closer; closer = nil; lock.unlock()
            if let c = c { adapter_free(c) }
        }
    }

    private final class Outcome<T> {
        let done = DispatchSemaphore(value: 0)
        var result: Result<T, Error>?
    }

    /// Runs `body` on its own thread under a Watch and waits for it, at most each step's limit of quiet. A step that
    /// overruns closes the tunnel and throws "timeout: <step> …"; if the call still doesn't come back, its thread is
    /// left with everything it holds (nothing is freed under it).
    static func watched<T>(_ what: String, _ body: @escaping (Watch) throws -> T) throws -> T {
        _ = libraryLogStarted
        let w = Watch(), out = Outcome<T>()
        let t0 = Date()
        let th = Thread {
            do { out.result = .success(try body(w)) } catch { out.result = .failure(error) }
            out.done.signal()
        }
        th.stackSize = 4 << 20 // idevice runs its futures on this thread (block_on)
        th.start()
        while out.done.wait(timeout: .now() + 0.5) == .timedOut {
            let n = w.now
            guard n.quiet > n.limit else { continue }
            let why = "\(n.step): no answer from iOS for \(Int(n.limit)) s" + (w.detail.isEmpty ? "" : " (\(w.detail))")
            ilog("TIMEOUT \(why); closing the tunnel")
            let closed = w.closeTunnel()
            if out.done.wait(timeout: .now() + Limit.grace) == .timedOut {
                ilog("the stuck call didn't come back (tunnel closed: \(closed)); leaving it")
            } else if case .failure(let e)? = out.result {
                ilog("the stuck call ended with: \(e.localizedDescription)")
            }
            relayLibraryLog()
            throw Failure(code: "timeout", text: "\(why). Check that LocalDevVPN is on, then try again")
        }
        switch out.result! {
        case .success(let v):
            ilog("\(what): done in \(String(format: "%.1f", Date().timeIntervalSince(t0))) s")
            return v
        case .failure(let e):
            ilog("\(what): FAILED at \(w.now.step) after \(String(format: "%.1f", Date().timeIntervalSince(t0))) s: \((e as? Failure)?.errorDescription ?? e.localizedDescription)")
            relayLibraryLog()
            throw e
        }
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

    /// One connection to the phone's services, over whichever route the stored pairing is for. Made and used on the
    /// one thread `watched` runs (idevice's handles aren't thread safe); only the Watch's adapter clone is touched
    /// from the watchdog.
    ///
    /// RemotePairing (the order idevice's own pair_rsd_ios tool and StikDebug use): tunnel_create_rppairing does the
    /// TCP connect to 49152, pair-verify, createListener, the TLS-PSK tunnel on the port the phone answers, and the
    /// RSD handshake to the RSD port the tunnel's handshake names, all through idevice's userspace TCP stack (jktcp)
    /// to the tunnel's server address (fd4f:…::1), not the OS network. The adapter's I/O task keeps running on
    /// idevice's multi-thread runtime after the call returns, for as long as `adapter` (or a clone) lives. The
    /// RPPairing control connection is dropped when the call returns ("host disconnected" in remotepairingdeviced's
    /// log): the tunnel stays up without it (its stats go on every 30 s), as for every idevice user.
    final class Session {
        private var provider: OpaquePointer? // lockdown: IdeviceProviderHandle
        private var adapter: OpaquePointer?  // RemotePairing: AdapterHandle (the tunnel)
        private var handshake: OpaquePointer? // and its RsdHandshakeHandle
        private var heartbeat: OpaquePointer?
        private var beating = false
        private let watch: Watch
        let kind: Kind

        init(watch: Watch) throws {
            self.watch = watch
            guard let (kind, data) = IDevice.pairing() else {
                throw Failure(code: "not_paired", text: "pair this iPhone first (Settings > Installation)")
            }
            self.kind = kind
            switch kind {
            case .remotePairing:
                watch.begin("connecting to iOS at \(address):\(remotePairingPort) (RemotePairing tunnel, RSD)", Limit.tunnel)
                ilog("addresses: \(interfaceAddresses())")
                var rp: OpaquePointer?
                try data.withUnsafeBytes { try check(rp_pairing_file_from_bytes($0.baseAddress?.assumingMemoryBound(to: UInt8.self), UInt(data.count), &rp), "bad_pairing") }
                defer { rp_pairing_file_free(rp) }
                var a = sockaddr4(remotePairingPort)
                let t0 = Date()
                let err = withUnsafePointer(to: &a) {
                    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                        tunnel_create_rppairing($0, socklen_t(MemoryLayout<sockaddr_in>.size), Brand.name, rp, nil, nil, &adapter, &handshake)
                    }
                }
                try check(err, "connect_failed")
                guard adapter != nil, handshake != nil else { throw Failure(code: "connect_failed", text: "idevice made no tunnel") }
                watch.setCloser(adapter_clone(adapter))
                ilog("tunnel and RSD up in \(String(format: "%.2f", Date().timeIntervalSince(t0))) s: \(rsdSummary())")
                // A pair-verify that fell back to pair-setup updates the file in place: keep what it is now.
                if let now = try? IDevice.bytes(rp), now != data { try? savePairing(now, kind: .remotePairing) }
            case .lockdown:
                watch.begin("connecting to iOS at \(address):\(lockdownPort) (lockdown)", Limit.tunnel)
                var pf: OpaquePointer?
                try data.withUnsafeBytes { try check(idevice_pairing_file_from_bytes($0.baseAddress?.assumingMemoryBound(to: UInt8.self), UInt(data.count), &pf), "bad_pairing") }
                var a = sockaddr4(lockdownPort)
                let err = withUnsafePointer(to: &a) {
                    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { idevice_tcp_provider_new($0, pf, Brand.name, &provider) }
                }
                if err != nil { idevice_pairing_file_free(pf) } // consumed only on success
                try check(err, "connect_failed")
                try check(heartbeat_connect(provider, &heartbeat), "connect_failed")
                ilog("lockdown connected, heartbeat on")
                startHeartbeat()
            }
        }

        /// "RSD <uuid>, 63 services; AFC on 52012, installation_proxy on 52040", for the log.
        private func rsdSummary() -> String {
            var parts: [String] = []
            var uuid: UnsafeMutablePointer<CChar>?
            if rsd_get_uuid(handshake, &uuid).map({ idevice_error_free($0) }) == nil, let u = uuid {
                parts.append("RSD \(String(cString: u))"); rsd_free_string(u)
            }
            var all: UnsafeMutablePointer<CRsdServiceArray>?
            if rsd_get_services(handshake, &all).map({ idevice_error_free($0) }) == nil, let s = all {
                parts.append("\(s.pointee.count) services"); rsd_free_services(s)
            }
            for (label, name) in [("AFC", "com.apple.afc.shim.remote"), ("installation_proxy", "com.apple.mobile.installation_proxy.shim.remote")] {
                var info: UnsafeMutablePointer<CRsdService>?
                if let e = rsd_get_service_info(handshake, name, &info) { idevice_error_free(e); parts.append("\(label) MISSING") }
                else if let i = info { parts.append("\(label) on \(i.pointee.port)"); rsd_free_service(i) }
            }
            return parts.joined(separator: ", ")
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
            watch.begin("connecting to AFC", Limit.service)
            var c: OpaquePointer?
            switch kind {
            case .remotePairing: try check(afc_client_connect_rsd(adapter, handshake, &c), "afc_failed")
            case .lockdown: try check(afc_client_connect(provider, &c), "afc_failed")
            }
            ilog("AFC connected")
            return c
        }

        func installationProxy() throws -> OpaquePointer? {
            watch.begin("connecting to installation_proxy", Limit.service)
            var c: OpaquePointer?
            switch kind {
            case .remotePairing: try check(installation_proxy_connect_rsd(adapter, handshake, &c), "install_failed")
            case .lockdown: try check(installation_proxy_connect(provider, &c), "install_failed")
            }
            ilog("installation_proxy connected")
            return c
        }

        deinit {
            beating = false
            watch.releaseCloser()
            if let h = heartbeat { heartbeat_client_free(h) }
            if let h = handshake { rsd_handshake_free(h) }
            if let a = adapter { adapter_free(a) }
            if let p = provider { idevice_provider_free(p) }
        }
    }

    /// Connects once with the stored pairing: "is the pairing still good and LocalDevVPN on". Blocking.
    static func verify() throws -> Kind { try watched("verify") { try Session(watch: $0).kind } }

    // ---- Installing

    enum Step { case connected, upload(Double), install(Double) }

    private final class ProgressBox { let f: (UInt64) -> Void; init(_ f: @escaping (UInt64) -> Void) { self.f = f } }

    /// Installs a signed IPA on this phone (blocking; call it on `queue`). Every step has a time limit (Limit), so
    /// it ends with an error rather than waiting for ever. Installing this app itself works too: installd ends the
    /// process, so the call never returns then. `note` gets a line per step for the progress page's console.
    static func install(_ ipa: URL, note: @escaping (String) -> Void = { _ in }, progress: @escaping (Step) -> Void) throws {
        let size = (try? ipa.resourceValues(forKeys: [.fileSizeKey]).fileSize).flatMap { $0 } ?? 0
        ilog("installing \(ipa.lastPathComponent) (\(mb(size)))")
        try watched("install") { (w: Watch) -> Void in
            let s = try Session(watch: w)
            note(s.kind == .remotePairing ? "Connected to iOS (RemotePairing tunnel)" : "Connected to iOS (lockdown)")
            progress(.connected)
            let remote = "\(stagingDir)/\(UUID().uuidString).ipa"
            try upload(ipa, size: size, to: remote, session: s, watch: w, note: note, progress: progress)
            let ip = try s.installationProxy()
            defer { installation_proxy_client_free(ip) }
            w.begin("iOS installing the app (installd)", Limit.install)
            note("iOS is installing it")
            var lastPct: UInt64 = .max
            let box = Unmanaged.passRetained(ProgressBox { pct in
                w.alive("\(pct)% installed")
                if pct != lastPct { lastPct = pct; ilog("installd: \(pct)%") }
                progress(.install(Double(min(pct, 100)) / 100))
            })
            defer { box.release() }
            let cb: @convention(c) (UInt64, UnsafeMutableRawPointer?) -> Void = { pct, ctx in
                guard let ctx = ctx else { return }
                Unmanaged<ProgressBox>.fromOpaque(ctx).takeUnretainedValue().f(pct)
            }
            let err = installation_proxy_install_with_callback(ip, remote, nil, cb, box.toOpaque())
            if err == nil { ilog("installd: Complete") }
            if let afc = try? s.afc() {
                w.begin("removing the staged IPA", Limit.afcStep)
                afc_remove_path(afc, remote).map(idevice_error_free); afc_client_free(afc)
            }
            try check(err, "install_failed")
            progress(.install(1))
        }
    }

    static let chunk = 1 << 20

    static func mb(_ n: Int) -> String { String(format: "%.1f MB", Double(n) / 1_048_576) }

    private static func upload(_ ipa: URL, size total: Int, to remote: String, session s: Session, watch w: Watch,
                               note: (String) -> Void, progress: (Step) -> Void) throws {
        let fh = try FileHandle(forReadingFrom: ipa)
        defer { try? fh.close() }
        let afc = try s.afc()
        defer { afc_client_free(afc) }
        w.begin("opening \(remote) on iOS (AFC)", Limit.afcStep)
        afc_make_directory(afc, stagingDir).map(idevice_error_free) // there already: an error, and fine
        var file: OpaquePointer?
        try check(afc_file_open(afc, remote, AfcWrOnly, &file), "upload_failed")
        w.begin("copying the IPA to iOS (AFC)", Limit.upload)
        note("Copying the IPA to iOS (\(mb(total)))")
        var sent = 0, logged = 0
        let t0 = Date()
        do {
            while let d = try fh.read(upToCount: chunk), !d.isEmpty {
                try d.withUnsafeBytes { try check(afc_file_write(file, $0.baseAddress?.assumingMemoryBound(to: UInt8.self), d.count), "upload_failed") }
                sent += d.count
                w.alive("\(mb(sent)) of \(mb(total)) copied")
                if sent - logged >= 8 * chunk || sent == total {
                    logged = sent
                    let secs = max(Date().timeIntervalSince(t0), 0.001)
                    ilog("AFC: \(mb(sent)) of \(mb(total)) (\(String(format: "%.1f", Double(sent) / 1_048_576 / secs)) MB/s)")
                }
                progress(.upload(total > 0 ? Double(sent) / Double(total) : 0))
            }
        } catch {
            afc_file_close(file).map(idevice_error_free)
            throw error
        }
        w.begin("closing \(remote) on iOS (AFC)", Limit.afcStep)
        try check(afc_file_close(file), "upload_failed")
        ilog("AFC: copied \(mb(sent)) in \(String(format: "%.1f", Date().timeIntervalSince(t0))) s")
        note("Copied \(mb(sent)) to iOS")
    }
}
