// The bridge calls for signing and installing IPAs on the phone (I6), sideload build only. In jailbreak mode they
// answer code "jailbreak": there the N2 helper installs IPAs itself and none of this is needed.
//
//   signing.status              {mode, identity: {name, team, expires, profile: {...}} | null, trust: {ca, trusted, name}}
//   signing.import {p12, password, profile}   (both files base64) -> status; the .p12 goes into the Keychain
//   signing.remove              forgets the identity and the profile -> status
//   signing.trust               makes the local CA if needed and opens its profile in Safari -> {url}
//   signing.resetTrust          throws the local CA away (the user removes the old profile in Settings) -> status
//   signing.install {url} (stream: {phase: "downloading"|"reading"|"signing"|"installing", progress})
//                               downloads, signs and opens the itms-services link -> {bundleId, originalBundleId,
//                               name, version, removed}
//
// Error codes: jailbreak, no_identity, untrusted, wrong_password, bad_p12, bad_profile, profile_expired,
// cert_expired, cert_not_in_profile, bad_ipa, encrypted, bad_url, network, too_large, keychain, server.
// docs/signing.md, "On the phone (I6)".
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import UIKit

enum SignBridge {
    static let maxIPA: Int64 = 4 << 30
    static let work: URL = {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent("cydian-sign", isDirectory: true)
        try? FileManager.default.removeItem(at: d) // leftovers of an earlier run
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    static let queue = DispatchQueue(label: "cydian.sign", qos: .userInitiated)

    static func register(_ b: Bridge) {
        b.on("signing.status") { c in run(c) { status() } }
        b.on("signing.import") { c in
            run(c) {
                guard let p12 = (c.params["p12"] as? String).flatMap({ Data(base64Encoded: $0) }),
                      let prof = (c.params["profile"] as? String).flatMap({ Data(base64Encoded: $0) }) else {
                    throw SignError("bad_p12", "A .p12 and a .mobileprovision are needed.")
                }
                _ = try SignStore.importIdentity(p12: p12, password: c.params["password"] as? String ?? "", profile: prof)
                return status()
            }
        }
        b.on("signing.remove") { c in run(c) { SignStore.removeIdentity(); return status() } }
        b.on("signing.resetTrust") { c in run(c) { InstallServer.secure.stop(); LocalTrust.reset(); return status() } }
        b.on("signing.trust") { c in
            guard AppMode.current != .jailbreak else { return Apt.reply(c, nil, "jailbreak: the jailbreak app installs IPAs through its helper") }
            queue.async {
                do {
                    let ca = try LocalTrust.ensureCA()
                    _ = try LocalTrust.tlsIdentity()
                    let profile = try LocalCA.mobileconfig(ca: ca, label: LocalTrust.label() ?? "iPhone")
                    let path = "/\(token())/Cydian-Local-Install.mobileconfig"
                    InstallServer.plain.serve(path, .init(type: "application/x-apple-aspen-config", body: .data(profile), onServed: nil),
                                              ttl: 5 * 60)
                    InstallServer.plain.start { res in
                        switch res {
                        case .failure(let e): Apt.reply(c, nil, "server: \(e.localizedDescription)")
                        case .success:
                            let url = InstallServer.plain.base + path
                            DispatchQueue.main.async {
                                UIApplication.shared.open(URL(string: url)!)
                                c.reply(["url": url], nil)
                            }
                        }
                    }
                } catch { Apt.reply(c, nil, text(error)) }
            }
        }
        b.on("signing.install") { c in install(c) }
    }

    static func status() -> [String: Any] {
        var out: [String: Any] = ["mode": AppMode.current.rawValue]
        let iso = ISO8601DateFormatter()
        if let id = SignStore.identity(), let der = SignStore.certificateDER(id), let cert = try? Certificate(der: der) {
            var ident: [String: Any] = ["name": cert.commonName ?? "", "team": cert.team ?? ""]
            if let x = cert.notAfter { ident["expires"] = iso.string(from: x) }
            if let p = SignStore.profile() {
                var prof: [String: Any] = ["name": p.name, "team": p.team, "appId": p.appID, "devices": p.devices,
                                           "wildcard": p.isWildcard]
                if let x = p.expires { prof["expires"] = iso.string(from: x) }
                if let problem = p.problem(with: der) { prof["problem"] = problem.message }
                ident["profile"] = prof
            }
            out["identity"] = ident
        } else {
            out["identity"] = NSNull()
        }
        out["trust"] = ["ca": LocalTrust.ca() != nil, "trusted": LocalTrust.ca() != nil && LocalTrust.trusted(),
                        "name": LocalTrust.label() ?? ""] as [String: Any]
        return out
    }

    static func install(_ c: Bridge.Call) {
        guard AppMode.current != .jailbreak else { return Apt.reply(c, nil, "jailbreak: the jailbreak app installs IPAs through its helper") }
        guard let url = Apt.httpURL(c.params["url"]) else { return Apt.reply(c, nil, "bad_url: not an http(s) URL") }
        guard let id = SignStore.identity(), let profile = SignStore.profile() else {
            return Apt.reply(c, nil, "no_identity: import a certificate in Settings > Signing first")
        }
        guard LocalTrust.trusted() else {
            return Apt.reply(c, nil, "untrusted: set up Local Install in Settings > Signing first (install and trust Cydian's certificate)")
        }
        let throttle = Throttle()
        let emit = { (phase: String, p: Double) in
            if throttle.pass(phase, p) { c.emitOnMain([["phase": phase, "progress": p]]) }
        }
        let tok = token()
        let input = work.appendingPathComponent("\(tok)-in.ipa")
        let output = work.appendingPathComponent("\(tok).ipa")
        Download.start(url, to: input, max: maxIPA, progress: { emit("downloading", $0) }) { err in
            if let e = err { return Apt.reply(c, nil, e) }
            queue.async {
                defer { try? FileManager.default.removeItem(at: input) }
                do {
                    let identity = try KeychainIdentity(id)
                    if let p = profile.problem(with: identity.certificate) { throw p }
                    let app = try IPASigner(profile: profile, identity: identity).sign(input, to: output) { emit($0, $1) }
                    emit("installing", 0)
                    let manifestPath = "/\(tok)/manifest.plist", ipaPath = "/\(tok)/app.ipa"
                    let server = InstallServer.secure
                    server.start { res in
                        switch res {
                        case .failure(let e):
                            try? FileManager.default.removeItem(at: output)
                            Apt.reply(c, nil, "server: \(e.localizedDescription)")
                        case .success:
                            do {
                                let manifest = try LocalCA.manifest(ipaURL: server.base + ipaPath, bundleID: app.bundleID,
                                                                    version: app.version, title: app.name)
                                server.serve(manifestPath, .init(type: "text/xml", body: .data(manifest), onServed: nil))
                                server.serve(ipaPath, .init(type: "application/octet-stream", body: .file(output)) {
                                    // iOS has the whole IPA: the link is spent.
                                    server.remove(manifestPath); server.remove(ipaPath)
                                    queue.asyncAfter(deadline: .now() + 60) { try? FileManager.default.removeItem(at: output) }
                                })
                                queue.asyncAfter(deadline: .now() + 15 * 60) {
                                    server.remove(manifestPath); server.remove(ipaPath)
                                    try? FileManager.default.removeItem(at: output)
                                }
                                let link = LocalCA.itmsURL(manifest: server.base + manifestPath)
                                DispatchQueue.main.async {
                                    UIApplication.shared.open(URL(string: link)!)
                                    c.reply(["bundleId": app.bundleID, "originalBundleId": app.originalBundleID,
                                             "name": app.name, "version": app.version, "removed": app.removed], nil)
                                }
                            } catch { Apt.reply(c, nil, text(error)) }
                        }
                    }
                } catch {
                    try? FileManager.default.removeItem(at: output)
                    Apt.reply(c, nil, text(error))
                }
            }
        }
    }

    // ---- helpers

    static func run(_ c: Bridge.Call, _ f: @escaping () throws -> Any?) {
        guard AppMode.current != .jailbreak else { return Apt.reply(c, nil, "jailbreak: the jailbreak app installs IPAs through its helper") }
        queue.async {
            do { Apt.reply(c, try f(), nil) } catch { Apt.reply(c, nil, text(error)) }
        }
    }

    static func text(_ e: Error) -> String {
        if let s = e as? SignError { return "\(s.code): \(s.message)" }
        if let z = e as? ZipError { return "bad_ipa: \(z.description)" }
        return "internal: \(e.localizedDescription)"
    }

    static func token() -> String {
        (0..<16).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    }
}

// Progress events at most once per phase change or whole percent, so a big IPA doesn't flood the web view.
final class Throttle {
    private var phase = "", last = -1
    private let lock = NSLock()
    func pass(_ p: String, _ v: Double) -> Bool {
        lock.lock(); defer { lock.unlock() }
        let pct = Int(v * 100)
        if p == phase && pct == last { return false }
        phase = p; last = pct
        return true
    }
}

// An IPA download to a file, with progress and a size cap.
final class Download: NSObject, URLSessionDownloadDelegate {
    private let dest: URL, max: Int64
    private let progress: (Double) -> Void
    private let done: (String?) -> Void
    private var finished = false

    private init(_ dest: URL, _ max: Int64, _ progress: @escaping (Double) -> Void, _ done: @escaping (String?) -> Void) {
        self.dest = dest; self.max = max; self.progress = progress; self.done = done
    }

    static func start(_ url: URL, to dest: URL, max: Int64, progress: @escaping (Double) -> Void, done: @escaping (String?) -> Void) {
        let d = Download(dest, max, progress, done)
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 60
        cfg.timeoutIntervalForResource = 60 * 60
        let s = URLSession(configuration: cfg, delegate: d, delegateQueue: nil)
        s.downloadTask(with: url).resume()
        s.finishTasksAndInvalidate()
    }

    private func finish(_ err: String?) {
        guard !finished else { return }
        finished = true
        done(err)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData _: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        if totalBytesWritten > max || totalBytesExpectedToWrite > max {
            downloadTask.cancel()
            return finish("too_large: the IPA is bigger than \(max >> 30) GB")
        }
        if totalBytesExpectedToWrite > 0 { progress(Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)) }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        if let http = downloadTask.response as? HTTPURLResponse, http.statusCode >= 400 {
            return finish("network: the server answered \(http.statusCode)")
        }
        do {
            try? FileManager.default.removeItem(at: dest)
            try FileManager.default.moveItem(at: location, to: dest)
            finish(nil)
        } catch { finish("network: \(error.localizedDescription)") }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let e = error as? URLError { finish(e.code == .timedOut ? "timeout: \(e.localizedDescription)" : "network: \(e.localizedDescription)") }
        else if let e = error { finish("network: \(e.localizedDescription)") }
        else { finish(nil) }
    }
}
