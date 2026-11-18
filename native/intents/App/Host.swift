// N8: the phone's IntentHost, for the app's intents (Intents.swift) and the widget extension's controls
// (native/widget/). Foundation and the C spawn only (no UIKit, AppIntents or Apt.swift), so the widget builds it too.
//   PhoneHost.shared   jailbroken: the N2 helper is where this jailbreak keeps it (Sources/mode.c, as AppMode);
//                      helper: ifizbox-helper as root through helper/spawn.c, its fds 1, 2 and 3 read to the end;
//                      sideloadUpdates: I3's remembered apps (BackgroundCheck's list) against their sources, now.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

final class PhoneHost: IntentHost {
    static let shared = PhoneHost()

    // As Jailbreak.prefix (Sources/Apt.swift), which the widget doesn't build: roothide's jbroot("/") when
    // libroothide is loaded, else /var/jb, else "" (rootful).
    let prefix: String = {
        typealias JBRoot = @convention(c) (UnsafePointer<CChar>) -> UnsafePointer<CChar>?
        if let sym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "jbroot") { // RTLD_DEFAULT
            let f = unsafeBitCast(sym, to: JBRoot.self)
            if let p = f("/") { return String(cString: p).replacingOccurrences(of: "/+$", with: "", options: .regularExpression) }
        }
        return FileManager.default.fileExists(atPath: "/var/jb") ? "/var/jb" : ""
    }()

    var helperPath: String { prefix + "/usr/libexec/ifizbox/ifizbox-helper" }
    lazy var jailbroken: Bool = ifizbox_mode_at(helperPath) == 1

    func read(_ path: String) -> String? {
        guard let d = FileManager.default.contents(atPath: prefix + path) else { return nil }
        return String(decoding: d, as: UTF8.self)
    }

    func list(_ dir: String) -> [String] { (try? FileManager.default.contentsOfDirectory(atPath: prefix + dir)) ?? [] }

    func helper(_ words: [String]) throws -> HelperResult {
        let path = helperPath
        guard FileManager.default.isExecutableFile(atPath: path) else { throw IntentFailure("ifizbox-helper is not installed at \(path).") }
        var cargs: [UnsafeMutablePointer<CChar>?] = words.map { strdup($0) }
        cargs.append(nil)
        defer { for p in cargs { free(p) } }
        var pid: pid_t = 0
        var fds: (Int32, Int32, Int32) = (-1, -1, -1)
        let rc = cargs.withUnsafeBufferPointer { buf -> Int32 in
            buf.baseAddress!.withMemoryRebound(to: UnsafePointer<CChar>?.self, capacity: buf.count) { args in
                ifizbox_helper_spawn(path, args, &pid, &fds.0, &fds.1, &fds.2)
            }
        }
        if rc != 0 { throw IntentFailure("Can't start ifizbox-helper: \(String(cString: strerror(rc))).") }
        var collected = [Data(), Data(), Data()]
        let lock = NSLock()
        let group = DispatchGroup()
        for (i, fd) in [fds.0, fds.1, fds.2].enumerated() {
            group.enter()
            Thread.detachNewThread {
                var all = Data()
                var buf = [UInt8](repeating: 0, count: 16384)
                while true {
                    let n = Darwin.read(fd, &buf, buf.count)
                    if n < 0 && errno == EINTR { continue }
                    if n <= 0 { break }
                    all.append(contentsOf: buf[0..<n])
                }
                close(fd)
                lock.lock(); collected[i] = all; lock.unlock()
                group.leave()
            }
        }
        group.wait()
        var status: Int32 = 0
        while waitpid(pid, &status, 0) < 0 && errno == EINTR {}
        let code: Int32 = (status & 0x7F) == 0 ? (status >> 8) & 0xFF : 128 + (status & 0x7F)
        return HelperResult(code: Int(code), out: String(decoding: collected[0], as: UTF8.self),
                            err: String(decoding: collected[1], as: UTF8.self), status: String(decoding: collected[2], as: UTF8.self))
    }

    // I3's list (BackgroundCheck.watchKey) against each source, fetched now; a source that fails is skipped, as the
    // background check does.
    func sideloadUpdates() throws -> [UpdateCheck.Found] {
        guard let d = UserDefaults.standard.data(forKey: "ifizbox.updates.watch"),
              let watch = try? JSONDecoder().decode([UpdateCheck.Watched].self, from: d), !watch.isEmpty else { return [] }
        let v = ProcessInfo.processInfo.operatingSystemVersion
        let ios = "\(v.majorVersion).\(v.minorVersion).\(v.patchVersion)"
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 20
        cfg.timeoutIntervalForResource = 25
        let session = URLSession(configuration: cfg)
        defer { session.finishTasksAndInvalidate() }
        let group = DispatchGroup()
        let lock = NSLock()
        var offers = [String: [String: UpdateCheck.Offer]]()
        for s in Set(watch.map(\.source)) {
            guard let url = URL(string: s) else { continue }
            group.enter()
            session.dataTask(with: url) { data, response, _ in
                defer { group.leave() }
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                guard let data, (200..<300).contains(status), data.count <= 8 << 20 else { return }
                let read = UpdateCheck.offers(data, ios: ios)
                lock.lock(); offers[s] = read; lock.unlock()
            }.resume()
        }
        _ = group.wait(timeout: .now() + 30)
        lock.lock(); defer { lock.unlock() }
        return UpdateCheck.updates(watch, offers: offers)
    }
}
