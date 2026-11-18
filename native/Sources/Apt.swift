// The bridge calls behind web/app/backend-native.js (N3): apt's sources and lists, dpkg's status, network fetches
// (the page's origin is ifizbox://app, so repos without CORS headers are fetched here), ifizbox-helper and the haptic
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
    // F40: what native/bridge.js tells the page as ifizboxNative.jailbreak. A prefix (/var/jb, or roothide's
    // jbroot) is rootless; none is rootful.
    static var kind: String { prefix.isEmpty ? "rootful" : "rootless" }
    static var helper: String { path("/usr/libexec/ifizbox/ifizbox-helper") }
}

enum Apt {
    static let maxBody = 64 << 20 // the proxy's cap is smaller; BigBoss' plain Packages is ~20 MB

    // native/bridge.js, before any page script runs: it defines ifizboxNative, which modules read as they load.
    // Its @JAILBREAK@ becomes the detected jailbreak type (F40), @MODE@ the build's mode (I2, Mode.swift).
    static func installScript(_ ucc: WKUserContentController) {
        guard let url = Bundle.main.url(forResource: "bridge", withExtension: "js"),
              let raw = try? String(contentsOf: url, encoding: .utf8) else { return }
        let src = raw.replacingOccurrences(of: "@JAILBREAK@", with: Jailbreak.kind)
            .replacingOccurrences(of: "@MODE@", with: AppMode.current.rawValue)
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
        // F104: when each package was installed or last upgraded, as Installed's Recent sort needs it.
        b.on("apt.installDates") { c in work(c) { () throws -> Any? in installDates() } }
        // F130: the packages apt marked as installed only to satisfy another's dependency, for Installed's User mode.
        b.on("apt.autoInstalled") { c in work(c) { () throws -> Any? in autoInstalled() } }
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
        // F63: helper.answer {answer: "keep" | "new"} answers the running apply-ask's Configuration Upgrade question.
        b.on("helper.answer") { c in
            work(c) { () throws -> Any? in try Helper.answer(c.params["answer"] as? String ?? ""); return true }
        }
        // F64: helper.cancel stops the running apply-ask while apt still downloads (Cydia's Cancel on the progress
        // page); an error once dpkg has started (apt's first pmstatus: line), or when nothing runs.
        b.on("helper.cancel") { c in
            work(c) { () throws -> Any? in try Helper.cancel(); return true }
        }
        // F59: ipa.install {url} (stream: helper lines as helper.run's, after a "dlstatus:ipa:0:Downloading" one).
        b.on("ipa.install") { c in
            guard AppMode.current == .jailbreak else {
                return reply(c, nil, "sideload: the sideload build installs IPAs through signing.install")
            }
            guard let url = httpURL(c.params["url"]) else { return reply(c, nil, "bad_url: not an http(s) URL") }
            let stream = (c.params["stream"] as? Bool) ?? false
            IPAInstall.run(url, emit: stream ? { c.emitOnMain($0) } : nil) { reply(c, $0, $1) }
        }
        b.on("haptic.tap") { c in
            DispatchQueue.main.async {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                c.reply(nil, nil)
            }
        }
    }

    // ---- files

    // F104: { package: seconds since 1970 } from the mtime of dpkg's info/<pkg>.list (info/<pkg>:<arch>.list on
    // multiarch), which dpkg rewrites on every install or upgrade of the package.
    static func installDates() -> [String: Double] {
        let dir = Jailbreak.path("/var/lib/dpkg/info")
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: dir) else { return [:] }
        var out: [String: Double] = [:]
        for name in names where name.hasSuffix(".list") {
            var pkg = String(name.dropLast(5))
            if let colon = pkg.firstIndex(of: ":") { pkg = String(pkg[..<colon]) }
            guard !pkg.isEmpty,
                  let date = (try? fm.attributesOfItem(atPath: dir + "/" + name))?[.modificationDate] as? Date else { continue }
            out[pkg] = max(out[pkg] ?? 0, date.timeIntervalSince1970.rounded())
        }
        return out
    }

    // F130: the names /var/lib/apt/extended_states marks `Auto-Installed: 1` (apt-mark auto), sorted; nil when the
    // file can't be read (apt never marked anything), so the page keeps its dependency guess.
    static func autoInstalled() -> [String]? {
        guard let text = readText(Jailbreak.path("/var/lib/apt/extended_states")) else { return nil }
        var out = Set<String>()
        for stanza in text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n\n") {
            var pkg = "", auto = false
            for line in stanza.split(separator: "\n") {
                guard let colon = line.firstIndex(of: ":") else { continue }
                let key = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
                let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
                if key == "package" { pkg = value } else if key == "auto-installed" { auto = value == "1" }
            }
            if auto && !pkg.isEmpty { out.insert(pkg) }
        }
        return out.sorted()
    }

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
        cfg.httpAdditionalHeaders = ["User-Agent": "\(Brand.name)/\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] ?? "")"]
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

// ifizbox-helper as root through native/helper/spawn.c (the persona spawn attributes, allowed by the
// com.apple.private.persona-mgmt entitlement). Its fds 1, 2 and 3 (apt's status lines) are read to the end on
// three threads; with `emit`, every finished line goes to the page as { fd: "out" | "err" | "status", line }.
// stdin is /dev/null, except for apply-ask (F63): a pipe that helper.answer writes into until the helper ends.
// F64: helper.cancel writes "C" into the same pipe. The helper runs as root, so the app (mobile) can't signal it or
// apt-get itself (kill is EPERM across users); the helper turns the line into SIGINT for apt-get.
enum Helper {
    // F63: the stdin of the running apply-ask (one console runs at a time), or -1.
    static var answerFd: Int32 = -1
    static let answerLock = NSLock()
    // F64: the running apply-ask has had a pmstatus:/pmconffile:/pmerror: line on fd 3: dpkg is at work, so Cancel
    // is refused (Cydia's Cancel goes away there too). Guarded by answerLock.
    static var dpkgStarted = false

    // F64: Cancel while apt is still downloading (only dlstatus: lines so far).
    static func cancel() throws {
        answerLock.lock(); defer { answerLock.unlock() }
        guard answerFd >= 0 else { throw BridgeError("helper", "no install is running") }
        guard !dpkgStarted else { throw BridgeError("helper", "dpkg is already installing; it can't be stopped halfway") }
        let n = "C\n".withCString { write(answerFd, $0, 2) }
        if n != 2 { throw BridgeError("helper", "the install isn't listening: \(String(cString: strerror(errno)))") }
    }

    // F63: the console's answer to dpkg's conffile question (apt's pmconffile: line): keep -> "N" (Keep My Old
    // Copy), new -> "Y" (Accept The New Copy). ifizbox-helper passes on only those two lines.
    static func answer(_ word: String) throws {
        guard let line = ["keep": "N\n", "new": "Y\n"][word] else { throw BridgeError("helper", "answer is keep or new") }
        answerLock.lock(); defer { answerLock.unlock() }
        guard answerFd >= 0 else { throw BridgeError("helper", "no install is waiting for an answer") }
        let n = line.withCString { write(answerFd, $0, 2) }
        if n != 2 { throw BridgeError("helper", "the install isn't listening: \(String(cString: strerror(errno)))") }
    }

    static func run(_ words: [String], emit: (([[String: Any]]) -> Void)?) throws -> [String: Any] {
        let path = Jailbreak.helper
        guard FileManager.default.isExecutableFile(atPath: path) else {
            throw BridgeError("helper", "ifizbox-helper is not installed at \(path)")
        }
        var cargs: [UnsafeMutablePointer<CChar>?] = words.map { strdup($0) }
        cargs.append(nil)
        defer { for p in cargs { free(p) } }
        var pid: pid_t = 0
        var fds: (Int32, Int32, Int32) = (-1, -1, -1)
        // F63: apply-ask gets a pipe on its stdin, which helper.answer writes the console's answers into.
        let ask = words.first == "apply-ask"
        var input: Int32 = -1
        let rc = cargs.withUnsafeBufferPointer { buf -> Int32 in
            buf.baseAddress!.withMemoryRebound(to: UnsafePointer<CChar>?.self, capacity: buf.count) { args in
                ask ? ifizbox_helper_spawn_in(path, args, &pid, &input, &fds.0, &fds.1, &fds.2)
                    : ifizbox_helper_spawn(path, args, &pid, &fds.0, &fds.1, &fds.2)
            }
        }
        if rc != 0 { throw BridgeError("helper", "can't start ifizbox-helper: \(String(cString: strerror(rc)))") }
        if ask {
            _ = fcntl(input, F_SETNOSIGPIPE, 1) // an answer after the helper is gone is EPIPE, not a dead app
            answerLock.lock(); answerFd = input; dpkgStarted = false; answerLock.unlock()
        }
        defer {
            if ask {
                answerLock.lock(); if answerFd == input { answerFd = -1 }; answerLock.unlock()
                close(input)
            }
        }

        let names = ["out", "err", "status"]
        var collected = [Data(), Data(), Data()]
        let lock = NSLock()
        let group = DispatchGroup()
        for (i, fd) in [fds.0, fds.1, fds.2].enumerated() {
            group.enter()
            // F64: apply-ask's status lines are split even without emit, to see when dpkg starts.
            let watch = ask && i == 2
            Thread.detachNewThread {
                var all = Data(), pending = Data()
                var buf = [UInt8](repeating: 0, count: 16384)
                while true {
                    let n = read(fd, &buf, buf.count)
                    if n < 0 && errno == EINTR { continue }
                    if n <= 0 { break }
                    all.append(contentsOf: buf[0..<n])
                    guard emit != nil || watch else { continue }
                    pending.append(contentsOf: buf[0..<n])
                    var lines: [[String: Any]] = []
                    while let nl = pending.firstIndex(of: 0x0A) {
                        let text = String(decoding: pending[pending.startIndex..<nl], as: UTF8.self)
                        if watch && (text.hasPrefix("pmstatus:") || text.hasPrefix("pmconffile:") || text.hasPrefix("pmerror:")) {
                            answerLock.lock(); if answerFd == input { dpkgStarted = true }; answerLock.unlock()
                        }
                        lines.append(["fd": names[i], "line": text])
                        pending = Data(pending[(nl + 1)...])
                    }
                    if let emit = emit, !lines.isEmpty { emit(lines) }
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

// F59: ipa.install, the jailbreak build's IPA install (the sideload build signs and installs with signing.install,
// SignBridge.swift). Downloads the IPA into the one directory ifizbox-helper takes IPAs from (native/helper/policy.h
// HELPER_IPA_DIR: this no-container app's own Caches) as <UUID>.ipa, runs `ifizbox-helper install-ipa <path>` (as
// AppSync's appinst does; ad hoc signed with ldid first when AppSync Unified isn't there, native/helper/ipa.c) and
// removes the download. Replies {code: 0, stdout, stderr, bundleId}, or an error:
//   bad_url, network, timeout, not_found (HTTP >= 400)          the download
//   bad_ipa   (helper exit 64) not an IPA, or not the app's own file
//   no_adhoc  (exit 69) the jailbreak can't install ad hoc apps: no AppSync Unified and no ldid, or installd
//             refused the ad hoc signed app. The message says what to install.
//   install   (exit 1 or 74) installd refused it, or the helper couldn't copy or unpack it
//   helper    no helper, or it refused the caller (exit 77)
// The message is the helper's own last "ifizbox-helper: " line.
enum IPAInstall {
    static let dir = "/var/mobile/Library/Caches/com.ryha.ifizbox/ipa" // = HELPER_IPA_DIR

    static let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 60
        cfg.timeoutIntervalForResource = 60 * 60 // an IPA can be a few GB
        cfg.httpAdditionalHeaders = Apt.session.configuration.httpAdditionalHeaders
        return URLSession(configuration: cfg)
    }()

    static func run(_ url: URL, emit: (([[String: Any]]) -> Void)?, done: @escaping (Any?, String?) -> Void) {
        let fm = FileManager.default
        do {
            try fm.createDirectory(atPath: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        } catch { return done(nil, "install: can't make \(dir): \(error.localizedDescription)") }
        emit?([["fd": "status", "line": "dlstatus:ipa:0:Downloading"]])
        session.downloadTask(with: url) { tmp, resp, err in
            if let e = err as? URLError { return done(nil, "\(e.code == .timedOut ? "timeout" : "network"): \(e.localizedDescription)") }
            if let e = err { return done(nil, "network: \(e.localizedDescription)") }
            guard let tmp = tmp, let http = resp as? HTTPURLResponse else { return done(nil, "network: no HTTP answer") }
            if http.statusCode >= 400 { return done(nil, "not_found: HTTP \(http.statusCode) for \(url.absoluteString)") }
            let path = dir + "/" + UUID().uuidString + ".ipa"
            do { try FileManager.default.moveItem(atPath: tmp.path, toPath: path) }
            catch { return done(nil, "install: can't keep the download: \(error.localizedDescription)") }
            DispatchQueue.global(qos: .userInitiated).async {
                defer { try? FileManager.default.removeItem(atPath: path) }
                do {
                    let r = try Helper.run(["install-ipa", path], emit: emit)
                    let code = r["code"] as? Int ?? 1
                    let out = r["stdout"] as? String ?? "", errText = r["stderr"] as? String ?? ""
                    if code == 0 {
                        let id = out.split(separator: "\n").last { $0.hasPrefix("Installed ") }.map { String($0.dropFirst(10)) }
                        return done(["code": 0, "stdout": out, "stderr": errText, "bundleId": id ?? ""], nil)
                    }
                    let why = errText.split(separator: "\n").last { $0.hasPrefix("ifizbox-helper: ") }
                        .map { String($0.dropFirst(16)) } ?? "ifizbox-helper exited with \(code)"
                    let kind = code == 64 ? "bad_ipa" : code == 69 ? "no_adhoc" : code == 77 ? "helper" : "install"
                    done(nil, "\(kind): \(why)")
                } catch let e as BridgeError { done(nil, e.text) }
                catch { done(nil, "helper: \(error.localizedDescription)") }
            }
        }.resume()
    }
}
