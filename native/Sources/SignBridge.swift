// The bridge calls for signing and installing IPAs on the phone (I6), sideload build only. In jailbreak mode they
// answer code "jailbreak": there the N2 helper installs IPAs itself and none of this is needed.
//
//   signing.status              {mode, identity: {name, team, expires, profile: {...}} | null, identityProblem?}: F69, why
//                               a certificate that was imported doesn't show
//   signing.import {p12, password, profile}   (both files base64) -> status; the .p12 goes into the Keychain
//   signing.remove              forgets the identity, the kept .p12 and the profile -> status
//   signing.export              F73: {p12, profile, password} (files base64) as imported, for iFizBox Account's
//                               certificate sync (screens/account.js) | null
//                               when there is no certificate or it was imported before F73
//   signing.install {url, manifestServer} (stream: {phase: "downloading"|"reading"|"signing"|"installing", progress})
//                               downloads, signs and opens the itms-services link -> {bundleId, originalBundleId,
//                               name, version, removed}; F14 moved it to Sideload.swift, which adds the user's edits
//                               and the calls listed there
//   signing.cancel              F196: the progress page's Cancel stops the running signing.install, library.sign or
//                               library.install (download, signing, serving the IPA to iOS; SignJob) and any
//                               signing.progress watch -> {cancelled: bool} (false: nothing was running)
//
// F75: the old local HTTPS mode (signing.trust, resetTrust, testServer, its CA) is gone: installs always take the
// manifest from the Signing Server (manifestServer), and without one signing.install answers no_server.
//
// Error codes: jailbreak, no_identity, no_server, wrong_password, bad_p12, bad_profile, profile_expired,
// cert_expired, cert_not_in_profile, bad_ipa, encrypted, bad_url, network, too_large, keychain, server.
// docs/signing.md, "On the phone (I6)".
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import UIKit

enum SignBridge {
    static let maxIPA: Int64 = 4 << 30
    static let work: URL = {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent("ifizbox-sign", isDirectory: true)
        try? FileManager.default.removeItem(at: d) // leftovers of an earlier run
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    static let queue = DispatchQueue(label: "ifizbox.sign", qos: .userInitiated)

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
        b.on("signing.install") { c in Sideload.install(c) } // F14: with the user's edits, keep-alive and a record
        b.on("signing.cancel") { c in Sideload.cancel(c) } // F196: the progress page's Cancel
        Sideload.register(b) // F14: inspect, progress, installed, forget, resignAll, checkCertificate, remind
        MyIPAs.register(b) // F77: library.*, My IPAs under Installed (MyIPAs.swift)
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
                prof["device"] = PhoneID.check(p).json // F236: {state: in|out|unknown|skip, udid?, count, shared}
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
        return out
    }

    // ---- F75: the certificate that came inside iFizBox's own IPA (BundledIdentity, native/sign/Handoff.swift)

    // At launch, sideload build only: imports Payload/iFizBox.app/ifizbox-identity.plist into the Keychain unless the
    // Keychain already holds an identity or this same file was looked at before (its digest in UserDefaults; the
    // bundle is read-only, so the file stays until the next update replaces it). Also clears the old Local Install's
    // leftovers. Never throws; a file that doesn't import is remembered too, so it isn't tried on every launch.
    static func importBundled() {
        guard AppMode.current == .sideload else { return }
        queue.async {
            SignStore.removeOldInstallCA()
            guard let url = Bundle.main.url(forResource: "ifizbox-identity", withExtension: "plist"),
                  let data = try? Data(contentsOf: url) else { return }
            let digest = BundledIdentity.digest(data)
            let seen = UserDefaults.standard.string(forKey: BundledIdentity.seenKey)
            guard BundledIdentity.shouldImport(digest: digest, seen: seen, hasIdentity: SignStore.identity() != nil) else { return }
            UserDefaults.standard.set(digest, forKey: BundledIdentity.seenKey)
            guard let c = BundledIdentity.parse(data) else { return }
            do {
                _ = try SignStore.importIdentity(p12: c.p12, password: c.password, profile: c.profile)
                try confirmImport(p12: c.p12, password: c.password)
            } catch {
                NSLog("\(Brand.name): the certificate inside the app didn't import: %@", text(error))
            }
        }
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
    private var session: URLSession?

    private init(_ dest: URL, _ max: Int64, _ progress: @escaping (Double) -> Void, _ done: @escaping (String?) -> Void) {
        self.dest = dest; self.max = max; self.progress = progress; self.done = done
    }

    @discardableResult
    static func start(_ url: URL, to dest: URL, max: Int64, progress: @escaping (Double) -> Void, done: @escaping (String?) -> Void) -> Download {
        let d = Download(dest, max, progress, done)
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 60
        cfg.timeoutIntervalForResource = 60 * 60
        let s = URLSession(configuration: cfg, delegate: d, delegateQueue: nil)
        d.session = s
        s.downloadTask(with: url).resume()
        s.finishTasksAndInvalidate()
        return d
    }

    // F196: the progress page's Cancel: the download stops and `done` gets "cancelled: Cancelled" (once).
    func cancel() {
        session?.invalidateAndCancel()
        finish("cancelled: Cancelled")
    }

    private let lock = NSLock()
    private func finish(_ err: String?) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        finished = true
        lock.unlock()
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
