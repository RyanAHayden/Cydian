// The bridge calls for signing and installing IPAs on the phone (I6), sideload build only. In jailbreak mode they
// answer code "jailbreak": there the N2 helper installs IPAs itself and none of this is needed.
//
//   signing.status              {mode, identity: {name, team, expires, profile: {...}} | null, trust: {ca, trusted, name},
//                               identityProblem?}: F69, why a certificate that was imported doesn't show
//   signing.import {p12, password, profile}   (both files base64) -> status; the .p12 goes into the Keychain
//   signing.remove              forgets the identity, the kept .p12 and the profile -> status
//   signing.export              F73: {p12, profile, password} (files base64) as imported, for the Signing Server when
//                               Cydian updates itself (essential-ui.js installSelf, which asks the user first) | null
//                               when there is no certificate or it was imported before F73
//   signing.trust               makes the local CA if needed and opens its profile in Safari -> {url, signed}; F69:
//                               the profile is CMS-signed with the user's certificate when one is imported
//   signing.resetTrust          throws the local CA away (the user removes the old profile in Settings) -> status
//   signing.testServer {open?}  a test page on the install server; open: in Safari, Cydian in the background -> {url}
//   signing.install {url} (stream: {phase: "downloading"|"reading"|"signing"|"installing", progress})
//                               downloads, signs and opens the itms-services link -> {bundleId, originalBundleId,
//                               name, version, removed}; F14 moved it to Sideload.swift, which adds the user's edits
//                               and the calls listed there
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
                let password = c.params["password"] as? String ?? ""
                _ = try SignStore.importIdentity(p12: p12, password: password, profile: prof)
                try confirmImport(p12: p12, password: password) // F69: status must see what was imported
                return status()
            }
        }
        b.on("signing.export") { c in run(c) { export() } } // F73
        b.on("signing.remove") { c in run(c) { SignStore.removeIdentity(); return status() } }
        b.on("signing.resetTrust") { c in run(c) { InstallServer.secure.stop(); LocalTrust.reset(); return status() } }
        b.on("signing.trust") { c in
            guard AppMode.current != .jailbreak else { return Apt.reply(c, nil, "jailbreak: the jailbreak app installs IPAs through its helper") }
            queue.async {
                do {
                    let ca = try LocalTrust.ensureCA()
                    _ = try LocalTrust.tlsIdentity()
                    let plist = try LocalCA.mobileconfig(ca: ca, label: LocalTrust.label() ?? "iPhone")
                    // F69: signed with the user's certificate when there is one, so iOS shows it Verified
                    let signer = SignStore.identity().flatMap { try? KeychainIdentity($0) }
                    let (profile, signed) = ProfileSign.profile(plist, id: signer)
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
                                c.reply(["url": url, "signed": signed], nil)
                            }
                        }
                    }
                } catch { Apt.reply(c, nil, text(error)) }
            }
        }
        // A test page on the install server (Settings > Signing > Test Install Server): served over the same HTTPS
        // and certificate as installs, with the same keep-alive. open: true also opens it in Safari, which puts Cydian
        // in the background exactly as an install does. -> {url}
        b.on("signing.testServer") { c in
            guard AppMode.current != .jailbreak else { return Apt.reply(c, nil, "jailbreak: the jailbreak app installs IPAs through its helper") }
            let open = c.params["open"] as? Bool ?? false
            let path = "/\(token())/test.html"
            let page = "<!doctype html><meta name=viewport content='width=device-width'><body style='font:17px -apple-system;padding:30px;text-align:center'><h2>Cydian's install server works</h2><p>Reached over HTTPS at 127.0.0.1 with Cydian's own certificate, while Cydian was in the background. Installs can reach it too. Go back to Cydian.</p>"
            InstallServer.secure.serve(path, .init(type: "text/html; charset=utf-8", body: .data(Data(page.utf8)), onServed: nil), ttl: 3 * 60)
            InstallServer.secure.start { res in
                switch res {
                case .failure(let e): Apt.reply(c, nil, "server: \(e.localizedDescription)")
                case .success:
                    let url = InstallServer.secure.base + path
                    if open {
                        KeepAlive.shared.begin()
                        SignBridge.queue.asyncAfter(deadline: .now() + 120) { KeepAlive.shared.end() }
                        DispatchQueue.main.async { UIApplication.shared.open(URL(string: url)!) }
                    }
                    c.reply(["url": url], nil)
                }
            }
        }
        b.on("signing.install") { c in Sideload.install(c) } // F14: with the user's edits, keep-alive and a record
        Sideload.register(b) // F14: inspect, progress, installed, forget, resignAll, checkCertificate, remind
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
                prof["kind"] = p.kind.rawValue // F14
                if let x = p.signatureExpiry(certificate: der) { ident["signatureExpires"] = iso.string(from: x) }
                ident["profile"] = prof
            }
            ident["revocation"] = Sideload.cachedRevocation(der) ?? NSNull() // F14: the last OCSP answer
            out["identity"] = ident
        } else {
            out["identity"] = NSNull()
            // F69: a certificate was imported but the Keychain doesn't hand back the pair (or it can't be read):
            // say so, rather than the page looking set up while Install finds nothing
            if UserDefaults.standard.string(forKey: SignStore.certKey) != nil {
                out["identityProblem"] = SignStore.identity() == nil
                    ? "The Keychain doesn't return the imported certificate with its key. Remove the certificate and import it again."
                    : "The certificate in the Keychain can't be read. Remove it and import it again."
            }
        }
        out["trust"] = ["ca": LocalTrust.ca() != nil, "trusted": LocalTrust.ca() != nil && LocalTrust.trusted(),
                        "name": LocalTrust.label() ?? ""] as [String: Any]
        return out
    }

    // ---- F73: the certificate for the Signing Server

    // Only when the identity in use is readable and its profile is there: the same certificate status() shows.
    static func export() -> Any {
        guard SignStore.identity() != nil, let kept = SignStore.exportP12(),
              let prof = try? Data(contentsOf: SignStore.profileURL) else { return NSNull() }
        return ["p12": kept.p12.base64EncodedString(), "profile": prof.base64EncodedString(), "password": kept.password]
    }

    // ---- F69: an import that status() can see

    // After SignStore.importIdentity: the identity must come back from the Keychain the way status() and Install
    // look for it. It didn't when a certificate or key of an earlier import was still there (SecItemAdd then answers
    // errSecDuplicateItem for half of the pair and importIdentity keeps "that one", which may not pair up). Then
    // whatever matches the certificate's public key is deleted and the identity added once more; if it still isn't
    // found, the import fails with a keychain error instead of the page looking set up while Install finds nothing.
    static func confirmImport(p12: Data, password: String) throws {
        if let id = SignStore.identity(), let der = SignStore.certificateDER(id), (try? Certificate(der: der)) != nil { return }
        var items: CFArray?
        guard SecPKCS12Import(p12 as CFData, [kSecImportExportPassphrase as String: password] as CFDictionary, &items) == errSecSuccess,
              let first = (items as? [[String: Any]])?.first, let ref = first[kSecImportItemIdentity as String] else {
            throw SignError("keychain", "The certificate was imported but can't be read back.")
        }
        let identity = ref as! SecIdentity // swiftlint:disable:this force_cast
        var cert: SecCertificate?
        guard SecIdentityCopyCertificate(identity, &cert) == errSecSuccess, let c = cert else {
            throw SignError("keychain", "The certificate was imported but can't be read back.")
        }
        if let pub = SecCertificateCopyKey(c), let ext = SecKeyCopyExternalRepresentation(pub, nil) as Data? {
            let hash = sha1(ext) // iOS's kSecAttrPublicKeyHash (certificates) and kSecAttrApplicationLabel (keys)
            SecItemDelete([kSecClass as String: kSecClassCertificate, kSecAttrPublicKeyHash as String: hash] as CFDictionary)
            SecItemDelete([kSecClass as String: kSecClassKey, kSecAttrApplicationLabel as String: hash] as CFDictionary)
        }
        SecItemDelete([kSecClass as String: kSecClassCertificate, kSecAttrLabel as String: SignStore.label] as CFDictionary)
        let st = SecItemAdd([kSecValueRef as String: identity, kSecAttrLabel as String: SignStore.label,
                             kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly] as CFDictionary, nil)
        guard st == errSecSuccess || st == errSecDuplicateItem, SignStore.identity() != nil else {
            throw SignError("keychain", "The Keychain took the certificate but doesn't pair it with its key (\(st)). Remove the certificate and import it again.")
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
