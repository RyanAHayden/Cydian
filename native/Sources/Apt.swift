// The bridge calls behind web/app/backend-native.js (N3): apt's sources and lists, dpkg's status, network fetches
// (the page's origin is cydian://app, so repos without CORS headers are fetched here), cydian-helper and the haptic
// tick. Every reply is plain JSON types; errors are "<code>: <message>" strings that native/bridge.js turns into
// errors with a `code` (the proxy's codes: bad_url, network, timeout, too_large, not_found, helper).
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import UIKit
import WebKit

enum Jailbreak {
    // Where the jailbreak's files are (docs/native.md, "The /var/jb prefix"): roothide's jbroot("/") when
    // libroothide is loaded, else /var/jb (Dopamine, palera1n rootless), else "" (rootful: paths from /).
    static let prefix: String = {
        typealias JBRoot = @convention(c) (UnsafePointer<CChar>) -> UnsafePointer<CChar>?
        if let sym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "jbroot") { // RTLD_DEFAULT
            let f = unsafeBitCast(sym, to: JBRoot.self)
            if let p = f("/") { return String(cString: p).replacingOccurrences(of: "/+$", with: "", options: .regularExpression) }
        }
        return FileManager.default.fileExists(atPath: "/var/jb") ? "/var/jb" : ""
    }()

    static func path(_ p: String) -> String { prefix + p }
    // F40: what native/bridge.js tells the page as cydianNative.jailbreak. A prefix (/var/jb, or roothide's
    // jbroot) is rootless; none is rootful.
    static var kind: String { prefix.isEmpty ? "rootful" : "rootless" }
    static var helper: String { path("/usr/libexec/cydian/cydian-helper") }
}

enum Apt {
    static let maxBody = 64 << 20 // the proxy's cap is smaller; BigBoss' plain Packages is ~20 MB

    // native/bridge.js, before any page script runs: it defines cydianNative, which modules read as they load.
    // Its @JAILBREAK@ becomes the detected jailbreak type (F40).
    static func installScript(_ ucc: WKUserContentController) {
        guard let url = Bundle.main.url(forResource: "bridge", withExtension: "js"),
              let raw = try? String(contentsOf: url, encoding: .utf8) else { return }
        let src = raw.replacingOccurrences(of: "@JAILBREAK@", with: Jailbreak.kind)
        ucc.addUserScript(WKUserScript(source: src, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
    }

    static func register(_ b: Bridge) {
        b.on("apt.sources") { c in work(c) { () throws -> Any? in sourceFiles() } }
        b.on("apt.list") { c in
            work(c) { () throws -> Any? in
                guard let name = c.params["name"] as? String, !name.isEmpty, !name.contains("/"), !name.hasPrefix(".")
                else { throw BridgeError("bad_url", "bad list name") }
                return readText(Jailbreak.path("/var/lib/apt/lists/" + name))
            }
        }
        b.on("apt.dpkgStatus") { c in work(c) { () throws -> Any? in readText(Jailbreak.path("/var/lib/dpkg/status")) } }
        b.on("net.fetch") { c in
            guard let url = httpURL(c.params["url"]) else { return reply(c, nil, "bad_url: not an http(s) URL") }
            get(url) { res in
                switch res {
                case .failure(let e): reply(c, nil, e.text)
                case .success(let (status, headers, data)):
                    reply(c, ["status": status, "headers": headers, "body": data.base64EncodedString()], nil)
                }
            }
        }
        b.on("net.packages") { c in
            guard let dir = c.params["dir"] as? String, dir.hasSuffix("/"), httpURL(dir) != nil else {
                return reply(c, nil, "bad_url: not an http(s) directory URL")
            }
            packages(dir, ["Packages.xz", "Packages.gz", "Packages"]) { reply(c, $0, $1) }
        }
        b.on("helper.run") { c in
            guard let words = c.params["words"] as? [String], !words.isEmpty else {
                return reply(c, nil, "helper: no words")
            }
            let stream = (c.params["stream"] as? Bool) ?? false
            DispatchQueue.global(qos: .userInitiated).async {
                do { reply(c, try Helper.run(words, emit: stream ? { c.emitOnMain($0) } : nil), nil) }
                catch let e as BridgeError { reply(c, nil, e.text) }
                catch { reply(c, nil, "helper: \(error.localizedDescription)") }
            }
        }
        b.on("haptic.tap") { c in
            DispatchQueue.main.async {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                c.reply(nil, nil)
            }
        }
    }

    // ---- files

    static func readText(_ path: String) -> String? {
        guard let d = FileManager.default.contents(atPath: path) else { return nil }
        return String(decoding: d, as: UTF8.self)
    }

    static func sourceFiles() -> [[String: String]] {
        let etc = Jailbreak.path("/etc/apt")
        var out: [[String: String]] = []
        if let t = readText(etc + "/sources.list") { out.append(["path": etc + "/sources.list", "text": t]) }
        let d = etc + "/sources.list.d"
        let names = ((try? FileManager.default.contentsOfDirectory(atPath: d)) ?? []).sorted()
        for n in names where n.hasSuffix(".list") || n.hasSuffix(".sources") {
            if let t = readText(d + "/" + n) { out.append(["path": d + "/" + n, "text": t]) }
        }
        return out
    }

    // ---- network

    static func httpURL(_ v: Any?) -> URL? {
        guard let s = v as? String, let u = URL(string: s), let scheme = u.scheme?.lowercased(),
              scheme == "http" || scheme == "https", u.host != nil else { return nil }
        return u
    }

    static let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 30
        cfg.timeoutIntervalForResource = 120
        cfg.httpAdditionalHeaders = ["User-Agent": "Cydian/\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] ?? "")"]
        return URLSession(configuration: cfg)
    }()

    static func get(_ url: URL, done: @escaping (Result<(Int, [String: String], Data), BridgeError>) -> Void) {
        session.dataTask(with: url) { data, resp, err in
            if let e = err as? URLError {
                return done(.failure(BridgeError(e.code == .timedOut ? "timeout" : "network", e.localizedDescription)))
            }
            if let e = err { return done(.failure(BridgeError("network", e.localizedDescription))) }
            guard let http = resp as? HTTPURLResponse else { return done(.failure(BridgeError("network", "no HTTP answer"))) }
            let body = data ?? Data()
            if body.count > maxBody { return done(.failure(BridgeError("too_large", "more than \(maxBody >> 20) MB"))) }
            var headers: [String: String] = [:]
            for (k, v) in http.allHeaderFields { headers["\(k)".lowercased()] = "\(v)" }
            done(.success((http.statusCode, headers, body)))
        }.resume()
    }

    // The first of names in dir that the repo serves, decompressed. Missing ones (HTTP >= 400, or a body that
    // doesn't decompress) move on to the next; a network failure ends it.
    static func packages(_ dir: String, _ names: [String], _ done: @escaping (Any?, String?) -> Void) {
        guard let name = names.first else { return done(nil, "not_found: no Packages index in \(dir)") }
        get(URL(string: dir + name)!) { res in
            switch res {
            case .failure(let e): done(nil, e.text)
            case .success(let (status, _, data)):
                if status < 400, let plain = decompress(data, name) {
                    return done(["text": String(decoding: plain, as: UTF8.self), "source": dir + name], nil)
                }
                packages(dir, Array(names.dropFirst()), done)
            }
        }
    }

    static func decompress(_ data: Data, _ name: String) -> Data? {
        if name.hasSuffix(".xz") {
            guard data.starts(with: [0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00]) else { return nil }
            return try? (data as NSData).decompressed(using: .lzma) as Data
        }
        if name.hasSuffix(".gz") { return gunzip(data) }
        // A plain index, not an HTML page some hosts send for every path.
        return data.first == UInt8(ascii: "<") ? nil : data
    }

    // gzip (RFC 1952) = header + raw deflate + crc32/size; NSData's .zlib is raw deflate.
    static func gunzip(_ d: Data) -> Data? {
        let b = [UInt8](d)
        guard b.count > 18, b[0] == 0x1F, b[1] == 0x8B, b[2] == 8 else { return nil }
        let flags = b[3]
        var i = 10
        if flags & 4 != 0 { guard i + 2 <= b.count else { return nil }; i += 2 + Int(b[i]) + Int(b[i + 1]) << 8 }
        if flags & 8 != 0 { while i < b.count && b[i] != 0 { i += 1 }; i += 1 }
        if flags & 16 != 0 { while i < b.count && b[i] != 0 { i += 1 }; i += 1 }
        if flags & 2 != 0 { i += 2 }
        guard i < b.count - 8 else { return nil }
        return try? (Data(b[i..<(b.count - 8)]) as NSData).decompressed(using: .zlib) as Data
    }

    // ---- replies (WebKit wants them on the main thread)

    static func reply(_ c: Bridge.Call, _ value: Any?, _ error: String?) {
        DispatchQueue.main.async { c.reply(value, error) }
    }

    static func work(_ c: Bridge.Call, _ f: @escaping () throws -> Any?) {
        DispatchQueue.global(qos: .userInitiated).async {
            do { reply(c, try f(), nil) }
            catch let e as BridgeError { reply(c, nil, e.text) }
            catch { reply(c, nil, "network: \(error.localizedDescription)") }
        }
    }
}

struct BridgeError: Error {
    let code: String, message: String
    init(_ code: String, _ message: String) { self.code = code; self.message = message }
    var text: String { "\(code): \(message)" }
}

extension Bridge.Call {
    func emitOnMain(_ events: [[String: Any]]) {
        DispatchQueue.main.async { self.emit(events) }
    }
}

// cydian-helper as root through native/helper/spawn.c (the persona spawn attributes, allowed by the
// com.apple.private.persona-mgmt entitlement). Its fds 1, 2 and 3 (apt's status lines) are read to the end on
// three threads; with `emit`, every finished line goes to the page as { fd: "out" | "err" | "status", line }.
enum Helper {
    static func run(_ words: [String], emit: (([[String: Any]]) -> Void)?) throws -> [String: Any] {
        let path = Jailbreak.helper
        guard FileManager.default.isExecutableFile(atPath: path) else {
            throw BridgeError("helper", "cydian-helper is not installed at \(path)")
        }
        var cargs: [UnsafeMutablePointer<CChar>?] = words.map { strdup($0) }
        cargs.append(nil)
        defer { for p in cargs { free(p) } }
        var pid: pid_t = 0
        var fds: (Int32, Int32, Int32) = (-1, -1, -1)
        let rc = cargs.withUnsafeBufferPointer { buf -> Int32 in
            buf.baseAddress!.withMemoryRebound(to: UnsafePointer<CChar>?.self, capacity: buf.count) { args in
                cydian_helper_spawn(path, args, &pid, &fds.0, &fds.1, &fds.2)
            }
        }
        if rc != 0 { throw BridgeError("helper", "can't start cydian-helper: \(String(cString: strerror(rc)))") }

        let names = ["out", "err", "status"]
        var collected = [Data(), Data(), Data()]
        let lock = NSLock()
        let group = DispatchGroup()
        for (i, fd) in [fds.0, fds.1, fds.2].enumerated() {
            group.enter()
            Thread.detachNewThread {
                var all = Data(), pending = Data()
                var buf = [UInt8](repeating: 0, count: 16384)
                while true {
                    let n = read(fd, &buf, buf.count)
                    if n < 0 && errno == EINTR { continue }
                    if n <= 0 { break }
                    all.append(contentsOf: buf[0..<n])
                    guard let emit = emit else { continue }
                    pending.append(contentsOf: buf[0..<n])
                    var lines: [[String: Any]] = []
                    while let nl = pending.firstIndex(of: 0x0A) {
                        lines.append(["fd": names[i], "line": String(decoding: pending[pending.startIndex..<nl], as: UTF8.self)])
                        pending = Data(pending[(nl + 1)...])
                    }
                    if !lines.isEmpty { emit(lines) }
                }
                if let emit = emit, !pending.isEmpty { emit([["fd": names[i], "line": String(decoding: pending, as: UTF8.self)]]) }
                close(fd)
                lock.lock(); collected[i] = all; lock.unlock()
                group.leave()
            }
        }
        group.wait()
        var status: Int32 = 0
        while waitpid(pid, &status, 0) < 0 && errno == EINTR {}
        // WIFEXITED / WEXITSTATUS / WTERMSIG are macros Swift doesn't import.
        let code: Int32 = (status & 0x7F) == 0 ? (status >> 8) & 0xFF : 128 + (status & 0x7F)
        return ["code": Int(code), "stdout": String(decoding: collected[0], as: UTF8.self),
                "stderr": String(decoding: collected[1], as: UTF8.self)]
    }
}
