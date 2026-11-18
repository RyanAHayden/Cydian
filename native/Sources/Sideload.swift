// F14: the sideload build's install flow around I6's signer. Look before signing (entitlements, permissions,
// extensions), sign with the user's edits (name, bundle ID, icon, extensions left out, arm64e fix-up), keep Cydian
// alive with silent audio while iOS downloads the IPA from it, watch iOS install it (private LSApplicationWorkspace,
// as Feather does), remember what was signed so Re-sign All can do it again, check the certificate with Apple's
// OCSP responder, and remind before signatures expire. docs/signing.md, "On the phone (I6)" and "F14".
//
//   signing.inspect {url} (stream: {phase: "downloading", progress})
//        -> {token, app: {name, bundleId, version, minimumOS, size, entitlements, permissions, extensions},
//            icon (base64 PNG, may be Apple's CgBI form) | null, missing: [entitlement], signsAs, profileKind}
//   signing.install {url | token, name?, bundleId?, icon?, removeExtensions?, fixArm64e?} (stream as I6)
//        -> I6's reply + {fixedArm64e, expires}
//   signing.progress {bundleId} (stream: {phase: "installing", progress}) -> {installed: true | false | null}
//   signing.installed            -> {apps: [record], next: {expires, apps} | null}
//   signing.forget {bundleId}    -> {apps}
//   signing.resignAll (stream: {index, count, name, phase, progress}) -> {done: [bundleId], failed: [{bundleId, name, error}]}
//   signing.checkCertificate     -> {status: "good" | "revoked" | "unknown", checked, revokedAt?}
//   signing.remind {days}        -> {at | null}: the re-sign reminder, 0 = off
// F77: My IPAs' library.* calls are MyIPAs.swift; they install through serveAndOpen, and Re-sign All signs an app
// recorded from there (url "library:<file>") from the library's file.
// SPDX-License-Identifier: GPL-3.0-or-later
import AVFoundation
import Foundation
import ObjectiveC
import UIKit
import UserNotifications

enum Sideload {
    // ---- IPAs looked at, waiting for the user's choices (15 minutes)

    private struct Prepared { let url: String; let file: URL; let details: AppDetails }
    private static var prepared = [String: Prepared]() // on SignBridge.queue

    static func register(_ b: Bridge) {
        b.on("signing.inspect") { c in inspect(c) }
        b.on("signing.progress") { c in progress(c) }
        b.on("signing.installed") { c in SignBridge.run(c) { installedJSON() } }
        b.on("signing.forget") { c in
            SignBridge.run(c) {
                let id = c.params["bundleId"] as? String ?? ""
                saveRecords(records().filter { $0.bundleID != id })
                reschedule()
                return installedJSON()
            }
        }
        b.on("signing.resignAll") { c in resignAll(c) }
        b.on("signing.checkCertificate") { c in checkCertificate(c) }
        b.on("signing.remind") { c in
            SignBridge.run(c) {
                UserDefaults.standard.set(c.params["days"] as? Int ?? 0, forKey: remindKey)
                let at = reschedule(ask: true)
                let when: Any = at.map { ISO8601DateFormatter().string(from: $0) } ?? NSNull()
                return ["at": when]
            }
        }
    }

    static func ready(_ c: Bridge.Call) -> (SecIdentity, Profile)? {
        guard AppMode.current != .jailbreak else { Apt.reply(c, nil, "jailbreak: the jailbreak app installs IPAs through its helper"); return nil }
        guard let id = SignStore.identity(), let profile = SignStore.profile() else {
            Apt.reply(c, nil, "no_identity: import a certificate in Settings > Signing first"); return nil
        }
        return (id, profile)
    }

    static func inspect(_ c: Bridge.Call) {
        guard let (_, profile) = ready(c) else { return }
        guard let url = Apt.httpURL(c.params["url"]) else { return Apt.reply(c, nil, "bad_url: not an http(s) URL") }
        let throttle = Throttle()
        let tok = SignBridge.token()
        let file = SignBridge.work.appendingPathComponent("\(tok)-look.ipa")
        Download.start(url, to: file, max: SignBridge.maxIPA, progress: { p in
            if throttle.pass("downloading", p) { c.emitOnMain([["phase": "downloading", "progress": p]]) }
        }) { err in
            if let e = err { return Apt.reply(c, nil, e) }
            SignBridge.queue.async {
                do {
                    let d = try Inspect.ipa(file)
                    var icon: Any = NSNull()
                    if let path = d.iconPath, let z = try? ZipReader(url: file), let e = z.entries.first(where: { $0.name == path }),
                       let png = try? z.data(e, limit: 4 << 20) { icon = png.base64EncodedString() }
                    prepared[tok] = Prepared(url: url.absoluteString, file: file, details: d)
                    SignBridge.queue.asyncAfter(deadline: .now() + 15 * 60) { forgetPrepared(tok) }
                    Apt.reply(c, ["token": tok, "app": d.json, "icon": icon, "missing": d.missing(from: profile),
                                  "signsAs": (try? profile.bundleID(for: d.bundleID)) ?? d.bundleID,
                                  "profileKind": profile.kind.rawValue], nil)
                } catch {
                    try? FileManager.default.removeItem(at: file)
                    Apt.reply(c, nil, SignBridge.text(error))
                }
            }
        }
    }

    private static func forgetPrepared(_ tok: String) {
        if let p = prepared.removeValue(forKey: tok) { try? FileManager.default.removeItem(at: p.file) }
    }

    // ---- install

    // The signing server whose GET /sign/manifest hands iOS the manifest for an IPA Cydian serves over plain HTTP
    // at 127.0.0.1 (Feather's "Semi Local", on our own server): no certificate to trust on the phone, the key never
    // leaves it, the server sees only the app's ID, version and name. Set by each signing.install (and resignAll)
    // call's `manifestServer`; F75: there is no install without one (iOS's installer ignores a hand-trusted CA, so
    // the old fully local HTTPS mode never worked), and without one the call answers no_server.
    static var manifestServer: String?
    // Set (to the Signing Server) when the IPA is Cydian itself: iOS closes Cydian, and its install server with it, as
    // it installs over it, so the signed IPA goes up to the server's POST /sign/host and installs from there. Signing
    // still happens here; the key never leaves the phone. Set by each signing.install call's `host`.
    static var hostServer: String?

    static let noServer = "no_server: installing needs a Signing Server: set one in Settings > Signing"

    // `manifestServer` from a call's params: an https:// address, or nil.
    static func takeServer(_ c: Bridge.Call) -> String? {
        let ms = (c.params["manifestServer"] as? String)?.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        manifestServer = (ms?.hasPrefix("https://") ?? false) ? ms : nil
        return manifestServer
    }

    static func install(_ c: Bridge.Call) {
        guard let (id, profile) = ready(c) else { return }
        guard takeServer(c) != nil else { return Apt.reply(c, nil, noServer) }
        hostServer = (c.params["host"] as? Bool ?? false) ? manifestServer : nil
        let options: SignOptions
        do { options = try SignOptions(json: c.params) } catch { return Apt.reply(c, nil, SignBridge.text(error)) }
        let throttle = Throttle()
        let emit = { (phase: String, p: Double) in
            if throttle.pass(phase, p) { c.emitOnMain([["phase": phase, "progress": p]]) }
        }
        let finish = { (r: Result<(SignedApp, SignedRecord), Error>) in
            switch r {
            case .failure(let e): Apt.reply(c, nil, SignBridge.text(e))
            case .success(let (app, rec)):
                var j: [String: Any] = ["bundleId": app.bundleID, "originalBundleId": app.originalBundleID, "name": app.name,
                                        "version": app.version, "removed": app.removed, "fixedArm64e": app.fixedArm64e]
                if let x = rec.expires { j["expires"] = ISO8601DateFormatter().string(from: x) }
                Apt.reply(c, j, nil)
            }
        }
        if let tok = c.params["token"] as? String {
            SignBridge.queue.async {
                guard let p = prepared.removeValue(forKey: tok) else {
                    return Apt.reply(c, nil, "gone: that IPA was looked at more than 15 minutes ago; start again")
                }
                signAndOpen(p.file, url: p.url, id: id, profile: profile, options: options, emit: emit, opened: finish)
            }
            return
        }
        guard let url = Apt.httpURL(c.params["url"]) else { return Apt.reply(c, nil, "bad_url: not an http(s) URL") }
        download(url, emit: emit) { res in
            switch res {
            case .failure(let e): finish(.failure(e))
            case .success(let file):
                signAndOpen(file, url: url.absoluteString, id: id, profile: profile, options: options, emit: emit, opened: finish)
            }
        }
    }

    struct Failed: LocalizedError { let text: String; var errorDescription: String? { text } } // the text, not "Sideload.Failed error 1"

    static func download(_ url: URL, emit: @escaping (String, Double) -> Void, done: @escaping (Result<URL, Error>) -> Void) {
        let file = SignBridge.work.appendingPathComponent("\(SignBridge.token())-in.ipa")
        Download.start(url, to: file, max: SignBridge.maxIPA, progress: { emit("downloading", $0) }) { err in
            if let e = err { return done(.failure(Failed(text: e))) }
            SignBridge.queue.async { done(.success(file)) }
        }
    }

    // Signs `input` (deleted after), serves it on the local HTTP server and opens the itms-services link (the
    // manifest from `manifestServer`). `opened`
    // gets the result once iOS has been handed the link; `served` once iOS has fetched the whole IPA (or it expired
    // unfetched: false). Runs on SignBridge.queue.
    // Cydian's own update: upload the IPA signed here to the server, which holds it for its 10 minutes and answers the
    // itms-services link; then iOS installs from the server, unaffected by Cydian closing.
    static func hostAndOpen(_ output: URL, server: String, app: SignedApp, record: SignedRecord,
                            opened: @escaping (Result<(SignedApp, SignedRecord), Error>) -> Void, served: ((Bool) -> Void)?) {
        // The Worker (worker/src/index.js) doesn't open the IPA: the app says what it is.
        var q = URLComponents(string: server + "/sign/host")!
        q.queryItems = [URLQueryItem(name: "bundleid", value: app.bundleID), URLQueryItem(name: "version", value: app.version),
                        URLQueryItem(name: "title", value: app.name)]
        var req = URLRequest(url: q.url!)
        req.httpMethod = "POST"
        req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 300
        URLSession.shared.uploadTask(with: req, fromFile: output) { data, resp, error in
            try? FileManager.default.removeItem(at: output)
            let json = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) }) as? [String: Any]
            guard error == nil, (resp as? HTTPURLResponse)?.statusCode == 200, let itms = json?["itms"] as? String,
                  let link = URL(string: itms) else {
                let why = (json?["error"] as? String) ?? error?.localizedDescription ?? "the server didn't answer"
                opened(.failure(Failed(text: "server: \(why)"))); served?(false)
                return
            }
            SignBridge.queue.async {
                saveRecords(SignedRecords.adding(record, to: records()))
                reschedule()
            }
            DispatchQueue.main.async {
                UIApplication.shared.open(link)
                CloseForUpdate.afterPrompt()
                opened(.success((app, record)))
                served?(true)
            }
        }.resume()
    }

    static func signAndOpen(_ input: URL, url: String, id: SecIdentity, profile: Profile, options: SignOptions,
                            emit: @escaping (String, Double) -> Void,
                            opened: @escaping (Result<(SignedApp, SignedRecord), Error>) -> Void,
                            served: ((Bool) -> Void)? = nil) {
        let tok = SignBridge.token()
        let output = SignBridge.work.appendingPathComponent("\(tok).ipa")
        defer { try? FileManager.default.removeItem(at: input) }
        let app: SignedApp, identity: KeychainIdentity
        do {
            identity = try KeychainIdentity(id)
            if let p = profile.problem(with: identity.certificate) { throw p }
            let signer = IPASigner(profile: profile, identity: identity)
            signer.options = options
            app = try signer.sign(input, to: output) { emit($0, $1) }
        } catch {
            try? FileManager.default.removeItem(at: output)
            opened(.failure(error)); served?(false)
            return
        }
        let record = SignedRecord(bundleID: app.bundleID, originalBundleID: app.originalBundleID, name: app.name,
                                  version: app.version, url: url, signed: Date(),
                                  expires: profile.signatureExpiry(certificate: identity.certificate), options: options.stored)
        emit("installing", 0)
        if let host = hostServer {
            hostAndOpen(output, server: host, app: app, record: record, opened: opened, served: served)
            return
        }
        serveAndOpen(output, app: app, record: record, opened: opened, served: served)
    }

    // F77: the second half of signAndOpen, for an IPA signed already (My IPAs' signed copy): serves `output` (deleted
    // after) on the local HTTP server, records it and opens the itms-services link with the manifestServer's manifest.
    static func serveAndOpen(_ output: URL, app: SignedApp, record: SignedRecord,
                             opened: @escaping (Result<(SignedApp, SignedRecord), Error>) -> Void,
                             served: ((Bool) -> Void)? = nil) {
        let ipaPath = "/\(SignBridge.token())/app.ipa"
        guard let remote = manifestServer else {
            try? FileManager.default.removeItem(at: output)
            opened(.failure(Failed(text: noServer))); served?(false)
            return
        }
        let server = InstallServer.plain
        server.start { res in
            switch res {
            case .failure(let e):
                try? FileManager.default.removeItem(at: output)
                opened(.failure(Failed(text: "server: \(e.localizedDescription)"))); served?(false)
            case .success:
                guard var q = URLComponents(string: remote + "/sign/manifest") else {
                    try? FileManager.default.removeItem(at: output)
                    opened(.failure(Failed(text: noServer))); served?(false)
                    return
                }
                q.queryItems = [URLQueryItem(name: "bundleid", value: app.bundleID), URLQueryItem(name: "version", value: app.version),
                                URLQueryItem(name: "title", value: app.name),
                                // port and path, not the URL: proxies refuse queries holding "http://127.0.0.1"
                                URLQueryItem(name: "port", value: String(server.port)),
                                URLQueryItem(name: "path", value: String(ipaPath.dropFirst()))]
                let link = InstallManifest.itmsURL(manifest: q.url!.absoluteString)
                let once = Once()
                KeepAlive.shared.begin()
                let end = { (ok: Bool) in
                    guard once.first() else { return }
                    server.remove(ipaPath)
                    SignBridge.queue.asyncAfter(deadline: .now() + 60) {
                        try? FileManager.default.removeItem(at: output)
                        KeepAlive.shared.end() // a minute more: iOS may ask again for the last bytes
                    }
                    served?(ok)
                }
                server.serve(ipaPath, .init(type: "application/octet-stream", body: .file(output)) { end(true) })
                SignBridge.queue.asyncAfter(deadline: .now() + 15 * 60) { end(false) }
                SignBridge.queue.async {
                    saveRecords(SignedRecords.adding(record, to: records()))
                    reschedule()
                }
                DispatchQueue.main.async {
                    UIApplication.shared.open(URL(string: link)!)
                    opened(.success((app, record)))
                }
            }
        }
    }

    // iOS's own install progress for an app, until it is done: at most 15 minutes, or 45 s with no progress seen.
    static func progress(_ c: Bridge.Call) {
        guard AppMode.current != .jailbreak else { return Apt.reply(c, nil, "jailbreak: not in the jailbreak app") }
        guard let bid = c.params["bundleId"] as? String, !bid.isEmpty else { return Apt.reply(c, nil, "bad_request: bundleId") }
        watch(bid, onProgress: { c.emitOnMain([["phase": "installing", "progress": $0]]) }) { installed in
            Apt.reply(c, ["installed": installed.map { $0 as Any } ?? NSNull()], nil)
        }
    }

    // nil: the private API isn't there, so it can't be told.
    static func watch(_ bid: String, onProgress: @escaping (Double) -> Void, done: @escaping (Bool?) -> Void) {
        guard Workspace.available else { return done(nil) }
        let start = Date()
        var seen = false, last = -1
        func tick() {
            if let p = Workspace.installProgress(bid) {
                seen = true
                let pct = Int(p.fractionCompleted * 100)
                if pct != last { last = pct; onProgress(p.fractionCompleted) }
            } else if seen {
                return done(Workspace.isInstalled(bid))
            } else if Date().timeIntervalSince(start) > 45 {
                return done(false)
            }
            if Date().timeIntervalSince(start) > 15 * 60 { return done(seen ? Workspace.isInstalled(bid) : false) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: tick)
        }
        DispatchQueue.main.async(execute: tick)
    }

    // ---- Re-sign All: each recorded app downloaded again from its URL, signed as before, installed one by one (the
    // next starts once iOS has fetched the previous IPA, or that link expired).

    static func resignAll(_ c: Bridge.Call) {
        guard let (id, profile) = ready(c) else { return }
        guard takeServer(c) != nil else { return Apt.reply(c, nil, noServer) }
        SignBridge.queue.async {
            let list = records()
            var done = [String](), failed = [[String: Any]]()
            func step(_ i: Int) {
                guard i < list.count else {
                    return Apt.reply(c, ["done": done, "failed": failed], nil)
                }
                let r = list[i]
                let throttle = Throttle()
                let emit = { (phase: String, p: Double) in
                    if throttle.pass(phase, p) {
                        c.emitOnMain([["index": i, "count": list.count, "name": r.name, "phase": phase, "progress": p]])
                    }
                }
                let fail = { (e: Error) in
                    failed.append(["bundleId": r.bundleID, "name": r.name,
                                   "error": (e as? Failed)?.text ?? SignBridge.text(e)])
                }
                let signThat = { (file: URL) in
                    signAndOpen(file, url: r.url, id: id, profile: profile, options: SignOptions(r.options), emit: emit,
                                opened: { if case .failure(let e) = $0 { SignBridge.queue.async { fail(e) } } },
                                served: { ok in
                                    SignBridge.queue.async {
                                        if ok { done.append(r.bundleID) }
                                        else if !failed.contains(where: { $0["bundleId"] as? String == r.bundleID }) {
                                            fail(Failed(text: "cancelled: iOS didn't fetch it"))
                                        }
                                        step(i + 1)
                                    }
                                })
                }
                // F77: an app installed from My IPAs signs from the library's file, not a download.
                if MyIPAs.fileOf(r.url) != nil {
                    do {
                        if let file = try MyIPAs.copyForResign(r.url) { return signThat(file) }
                    } catch { fail(Failed(text: "gone: \(r.name) isn't in My IPAs any more")); return step(i + 1) }
                }
                guard let url = Apt.httpURL(r.url) else { fail(Failed(text: "bad_url: \(r.url)")); return step(i + 1) }
                download(url, emit: emit) { res in
                    switch res {
                    case .failure(let e): fail(e); step(i + 1)
                    case .success(let file): signThat(file)
                    }
                }
            }
            step(0)
        }
    }

    // ---- the record of signed apps (Application Support/Signing/signed.json)

    static var recordsURL: URL { SignStore.dir.appendingPathComponent("signed.json") }
    static func records() -> [SignedRecord] { (try? Data(contentsOf: recordsURL)).map(SignedRecords.decode) ?? [] }
    static func saveRecords(_ list: [SignedRecord]) {
        try? SignedRecords.encode(list).write(to: recordsURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    static func installedJSON() -> [String: Any] {
        let list = records()
        var out: [String: Any] = ["apps": list.map(\.json)]
        if let (x, names) = SignedRecords.nextExpiry(list) {
            out["next"] = ["expires": ISO8601DateFormatter().string(from: x), "apps": names]
        } else { out["next"] = NSNull() }
        return out
    }

    // ---- the certificate's revocation status (cached; I6's status() shows the last answer)

    static let ocspKey = "cydian.signing.ocsp"

    static func checkCertificate(_ c: Bridge.Call) {
        guard let (sid, _) = ready(c) else { return }
        SignBridge.queue.async {
            do {
                let ident = try KeychainIdentity(sid)
                guard let issuer = ident.chain.first else { throw SignError("ocsp", "The certificate's issuer isn't one Cydian knows.") }
                let cert = ident.certificate
                guard let responder = OCSP.responder(cert) else { throw SignError("ocsp", "The certificate names no OCSP responder.") }
                var req = URLRequest(url: responder, timeoutInterval: 20)
                req.httpMethod = "POST"
                req.setValue("application/ocsp-request", forHTTPHeaderField: "Content-Type")
                req.httpBody = try OCSP.request(certificate: cert, issuer: issuer)
                URLSession.shared.dataTask(with: req) { data, resp, err in
                    SignBridge.queue.async {
                        do {
                            if let e = err { throw Failed(text: "network: \(e.localizedDescription)") }
                            guard let d = data, (resp as? HTTPURLResponse)?.statusCode == 200 else {
                                throw Failed(text: "network: the OCSP responder answered \((resp as? HTTPURLResponse)?.statusCode ?? 0)")
                            }
                            let st = try OCSP.status(d, certificate: cert)
                            var j: [String: Any] = ["status": st.name, "checked": ISO8601DateFormatter().string(from: Date()),
                                                    "cert": sha256(cert).base64EncodedString()]
                            if case .revoked(let at?) = st { j["revokedAt"] = ISO8601DateFormatter().string(from: at) }
                            UserDefaults.standard.set(j, forKey: ocspKey)
                            j.removeValue(forKey: "cert")
                            Apt.reply(c, j, nil)
                        } catch { Apt.reply(c, nil, (error as? Failed)?.text ?? SignBridge.text(error)) }
                    }
                }.resume()
            } catch { Apt.reply(c, nil, SignBridge.text(error)) }
        }
    }

    // The last OCSP answer for this certificate, for signing.status.
    static func cachedRevocation(_ cert: Data) -> [String: Any]? {
        guard var j = UserDefaults.standard.dictionary(forKey: ocspKey),
              j["cert"] as? String == sha256(cert).base64EncodedString() else { return nil }
        j.removeValue(forKey: "cert")
        return j
    }

    // ---- the re-sign reminder: one local notification, moved whenever the apps or the setting change

    static let remindKey = "cydian.signing.remindDays"
    static let reminderID = "cydian.resign"

    @discardableResult
    static func reschedule(ask: Bool = false) -> Date? {
        let days = UserDefaults.standard.integer(forKey: remindKey)
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [reminderID])
        var expiry: Date?, names = [String]()
        if let (x, n) = SignedRecords.nextExpiry(records()) { expiry = x; names = n }
        else if let sid = SignStore.identity(), let der = SignStore.certificateDER(sid), let p = SignStore.profile() {
            expiry = p.signatureExpiry(certificate: der)
        }
        guard let x = expiry, let at = Reminder.date(expiry: x, daysBefore: days) else { return nil }
        let words = Reminder.text(apps: names, expiry: x, now: at)
        let schedule = {
            let content = UNMutableNotificationContent()
            content.title = words.title
            content.body = words.body
            content.sound = .default
            let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: at)
            center.add(UNNotificationRequest(identifier: reminderID, content: content,
                                             trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
        }
        if ask { center.requestAuthorization(options: [.alert, .sound]) { ok, _ in if ok { schedule() } } }
        else { schedule() }
        return at
    }
}

// True the first time only.
final class Once {
    private var done = false
    private let lock = NSLock()
    func first() -> Bool { lock.lock(); defer { lock.unlock() }; if done { return false }; done = true; return true }
}

// Silent audio while iOS downloads an IPA from Cydian (Feather's BackgroundAudioManager, docs/sideload.md): the
// install sheet sends Cydian to the background, and beginBackgroundTask alone gives about 30 s, too little for a big
// IPA. UIBackgroundModes has `audio` in the sideload build (Info-sideload.plist). Mixed with others, so the user's
// music keeps playing; held while any install needs it.
final class KeepAlive {
    static let shared = KeepAlive()
    private var player: AVAudioPlayer?
    private var holds = 0

    func begin() {
        DispatchQueue.main.async {
            self.holds += 1
            guard self.player == nil else { return }
            let s = AVAudioSession.sharedInstance()
            try? s.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try? s.setActive(true)
            if let p = try? AVAudioPlayer(data: KeepAlive.silence) {
                p.numberOfLoops = -1
                p.volume = 0
                p.play()
                self.player = p
            }
        }
    }

    func end() {
        DispatchQueue.main.async {
            self.holds = max(0, self.holds - 1)
            guard self.holds == 0, let p = self.player else { return }
            p.stop()
            self.player = nil
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    // One second of silence: a WAV, 8 kHz, 16-bit mono.
    static let silence: Data = {
        let rate: UInt32 = 8000, samples = 8000
        var d = Data()
        func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
        func u16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
        d.append(contentsOf: Array("RIFF".utf8)); u32(UInt32(36 + samples * 2)); d.append(contentsOf: Array("WAVE".utf8))
        d.append(contentsOf: Array("fmt ".utf8)); u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16)
        d.append(contentsOf: Array("data".utf8)); u32(UInt32(samples * 2)); d.append(Data(count: samples * 2))
        return d
    }()
}

// Private LSApplicationWorkspace calls that work from a sideloaded app (docs/sideload.md, Feather's
// UIApplication+open_private): install progress and whether an app is installed. Looked up at run time; when iOS
// lacks one, `available` is false and the callers say they can't tell.
enum Workspace {
    static var shared: NSObject? {
        guard let cls = NSClassFromString("LSApplicationWorkspace") as? NSObject.Type else { return nil }
        let sel = NSSelectorFromString("defaultWorkspace")
        guard cls.responds(to: sel) else { return nil }
        return cls.perform(sel)?.takeUnretainedValue() as? NSObject
    }

    static var available: Bool {
        shared?.responds(to: NSSelectorFromString("installProgressForBundleID:makeSynchronous:")) == true
    }

    static func installProgress(_ id: String) -> Progress? {
        let sel = NSSelectorFromString("installProgressForBundleID:makeSynchronous:")
        guard let ws = shared, let m = class_getInstanceMethod(type(of: ws), sel) else { return nil }
        typealias F = @convention(c) (NSObject, Selector, NSString, Bool) -> Unmanaged<NSObject>?
        let f = unsafeBitCast(method_getImplementation(m), to: F.self)
        return f(ws, sel, id as NSString, true)?.takeUnretainedValue() as? Progress
    }

    static func isInstalled(_ id: String) -> Bool? {
        let sel = NSSelectorFromString("applicationIsInstalled:")
        guard let ws = shared, let m = class_getInstanceMethod(type(of: ws), sel) else { return nil }
        typealias F = @convention(c) (NSObject, Selector, NSString) -> Bool
        let f = unsafeBitCast(method_getImplementation(m), to: F.self)
        return f(ws, sel, id as NSString)
    }
}

// iOS doesn't finish installing a new Cydian over the one that's running (user 2026-11-18: the update waited until
// Cydian was closed by hand). Once iOS's "would like to install Cydian" prompt has been answered (Cydian becomes
// active again), Cydian leaves a notification and closes, so the install finishes; the notification opens the new one.
enum CloseForUpdate {
    static var token: NSObjectProtocol?
    static func afterPrompt() {
        var resigned = false
        let nc = NotificationCenter.default
        let off = nc.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { _ in resigned = true }
        token.map(nc.removeObserver)
        token = nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
            guard resigned else { return } // the prompt hasn't shown yet
            token.map(nc.removeObserver); token = nil; nc.removeObserver(off)
            let c = UNMutableNotificationContent()
            c.title = "Cydian"
            c.body = "Updating Cydian. Tap to open it when it's done."
            let req = UNNotificationRequest(identifier: "cydian.updating", content: c,
                                            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 8, repeats: false))
            UNUserNotificationCenter.current().add(req) { _ in
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { exit(0) }
            }
        }
    }
}
