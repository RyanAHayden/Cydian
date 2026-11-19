// F14: the sideload build's install flow around I6's signer. Look before signing (entitlements, permissions,
// extensions), sign with the user's edits (name, bundle ID, icon, extensions left out, arm64e fix-up), keep iFizBox
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
//   signing.openApp {bundleId}   -> {opened: true | false}: F155, launches an installed app (the progress page's Open)
//   signing.forget {bundleId}    -> {apps}
//   signing.isInstalled {bundleIds} -> {installed: {bundleId: true | false | null}}: B46, what iOS has now
//   apps.isInstalled {bundleIds} -> the same, in every build (F219: the jailbreak build refuses signing.*)
//   signing.resignAll (stream: {index, count, name, phase, progress}) -> {done: [bundleId], failed: [{bundleId, name, error}]}
//   signing.resign {bundleId} (stream and reply as resignAll, one app) -> F91's queue job "resign"; not_signed: when
//        iFizBox has no record of that app (by installed or original bundle ID)
//   signing.checkCertificate     -> {status: "good" | "revoked" | "unknown", checked, revokedAt?}
//   signing.remind {days}        -> {at | null}: the re-sign reminder, 0 = off
//   signing.cancel               -> {cancelled}: F196, stops the running install job (cancel below, SignJob)
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
        b.on("signing.openApp") { c in openApp(c) }
        b.on("signing.forget") { c in
            SignBridge.run(c) {
                let id = c.params["bundleId"] as? String ?? ""
                saveRecords(records().filter { $0.bundleID != id })
                reschedule()
                return installedJSON()
            }
        }
        // B46: whether iOS has each app now (LSApplicationWorkspace applicationIsInstalled:), so Installed's Remove
        // from List never hides a row for an app that is still on the phone. null where iOS can't be asked.
        b.on("signing.isInstalled") { c in
            SignBridge.run(c) {
                let ids = (c.params["bundleIds"] as? [String] ?? []).prefix(512)
                var out = [String: Any]()
                for id in ids { out[id] = Workspace.isInstalled(id).map { $0 as Any } ?? NSNull() }
                return ["installed": out]
            }
        }
        // F219: the same question in every build. signing.* calls are refused in the jailbreak build (SignBridge.run),
        // and its package page's Share asks which package managers (Cydia, Sileo, Zebra, Irisin) the phone has.
        b.on("apps.isInstalled") { c in
            DispatchQueue.global(qos: .userInitiated).async {
                let ids = (c.params["bundleIds"] as? [String] ?? []).prefix(64)
                var out = [String: Any]()
                for id in ids { out[id] = Workspace.isInstalled(id).map { $0 as Any } ?? NSNull() }
                Apt.reply(c, ["installed": out], nil)
            }
        }
        b.on("signing.resignAll") { c in resignAll(c) }
        b.on("signing.resign") { c in resignOne(c) }
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

    // The signing server whose GET /sign/manifest hands iOS the manifest for an IPA iFizBox serves over plain HTTP
    // at 127.0.0.1 (Feather's "Semi Local", on our own server): no certificate to trust on the phone, the key never
    // leaves it, the server sees only the app's ID, version and name. Set by each signing.install (and resignAll)
    // call's `manifestServer`; F75: there is no install without one (iOS's installer ignores a hand-trusted CA, so
    // the old fully local HTTPS mode never worked), and without one the call answers no_server.
    // `host` is set (to the same Signing Server) only when the call says `host: true`, i.e. the IPA is iFizBox itself:
    // iOS closes iFizBox, and its install server with it, as it installs over it, so the signed IPA goes up to the
    // server's POST /sign/host and installs from there. Signing still happens here; the key never leaves the phone.
    // B64: both belong to one call and travel with it (signAndOpen's, serveAndOpen's `servers`). They were once shared
    // statics, and iFizBox's own job, started while another app still signed, made that app upload to /sign/host.
    struct Servers {
        let manifest: String
        let host: String?
    }

    static let noServer = "no_server: installing needs a Signing Server: set one in Settings > Signing"

    // A call's servers: `manifestServer` (an https:// address, else nil: no_server) and, with `host: true`, the same as
    // the host; `allowHost: false` (My IPAs) never hosts.
    static func servers(_ c: Bridge.Call, allowHost: Bool = true) -> Servers? {
        let ms = (c.params["manifestServer"] as? String)?.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        guard let m = ms, m.hasPrefix("https://") else { return nil }
        return Servers(manifest: m, host: allowHost && (c.params["host"] as? Bool ?? false) ? m : nil)
    }

    static func install(_ c: Bridge.Call) {
        guard let (id, profile) = ready(c) else { return }
        guard let servers = servers(c) else { return Apt.reply(c, nil, noServer) }
        let options: SignOptions
        do { options = try SignOptions(json: c.params) } catch { return Apt.reply(c, nil, SignBridge.text(error)) }
        let job = SignJob.begin() // F196: what signing.cancel stops
        let throttle = Throttle()
        let emit = { (phase: String, p: Double) in
            if throttle.pass(phase, p) { c.emitOnMain([["phase": phase, "progress": p]]) }
        }
        // The progress page's console (signing-client.js): what each step did, a line each.
        let log = { (s: String) in c.emitOnMain([["log": s]]) }
        let finish = { (r: Result<(SignedApp, SignedRecord), Error>) in
            switch r {
            case .failure(let e):
                job.end()
                Apt.reply(c, nil, SignBridge.text(job.cancelled ? SignJob.cancelledError : e))
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
                    job.end()
                    return Apt.reply(c, nil, "gone: that IPA was looked at more than 15 minutes ago; start again")
                }
                log("Using the IPA downloaded for the look-first sheet (\(p.url))")
                signAndOpen(p.file, url: p.url, id: id, profile: profile, options: options, servers: servers, emit: emit, log: log, job: job, opened: finish)
            }
            return
        }
        guard let url = Apt.httpURL(c.params["url"]) else { job.end(); return Apt.reply(c, nil, "bad_url: not an http(s) URL") }
        log("Downloading \(url.absoluteString)")
        let d = download(url, emit: emit) { res in
            switch res {
            case .failure(let e): finish(.failure(e))
            case .success(let file):
                log("Downloaded \(Sideload.size(file))")
                signAndOpen(file, url: url.absoluteString, id: id, profile: profile, options: options, servers: servers, emit: emit, log: log, job: job, opened: finish)
            }
        }
        job.onCancel { d.cancel() }
    }

    // ---- F196: the progress page's Cancel (web/app/signing-client.js stopNative)

    // Bumped by signing.cancel; a signing.progress watch started before it ends (main queue only).
    static var watchCancels = 0

    // Stops the running job: its download, its signing (at the signer's next step), the IPA's serving to iOS (the
    // install server's route and listener, KeepAlive), and any signing.progress watch. The job's own call answers
    // "cancelled: Cancelled" if it hasn't answered yet. iOS's own install, once it has the whole IPA, goes on.
    static func cancel(_ c: Bridge.Call) {
        guard AppMode.current != .jailbreak else { return Apt.reply(c, nil, "jailbreak: the jailbreak app installs IPAs through its helper") }
        DispatchQueue.main.async {
            watchCancels += 1
            c.reply(["cancelled": SignJob.cancelCurrent()], nil)
        }
    }

    // "12.3 MB" for a file, for the console.
    static func size(_ file: URL) -> String {
        let n = (try? FileManager.default.attributesOfItem(atPath: file.path))?[.size] as? Int64
        return n.map { ByteCountFormatter.string(fromByteCount: $0, countStyle: .file) } ?? "? bytes"
    }

    struct Failed: LocalizedError { let text: String; var errorDescription: String? { text } } // the text, not "Sideload.Failed error 1"

    @discardableResult
    static func download(_ url: URL, emit: @escaping (String, Double) -> Void, done: @escaping (Result<URL, Error>) -> Void) -> Download {
        let file = SignBridge.work.appendingPathComponent("\(SignBridge.token())-in.ipa")
        return Download.start(url, to: file, max: SignBridge.maxIPA, progress: { emit("downloading", $0) }) { err in
            if let e = err { try? FileManager.default.removeItem(at: file); return done(.failure(Failed(text: e))) }
            SignBridge.queue.async { done(.success(file)) }
        }
    }

    // Signs `input` (deleted after), serves it on the local HTTP server and opens the itms-services link (the
    // manifest from `servers.manifest`), or, for iFizBox's own call (`servers.host`), uploads it there. `opened`
    // gets the result once iOS has been handed the link; `served` once iOS has fetched the whole IPA (or it expired
    // unfetched: false). Runs on SignBridge.queue.
    // iFizBox's own update: upload the IPA signed here to the server, which holds it for its 10 minutes and answers the
    // itms-services link; then iOS installs from the server, unaffected by iFizBox closing.
    static func hostAndOpen(_ output: URL, server: String, app: SignedApp, record: SignedRecord, job: SignJob? = nil,
                            opened: @escaping (Result<(SignedApp, SignedRecord), Error>) -> Void, served: ((Bool) -> Void)?) {
        // The Worker (worker/src/index.js) doesn't open the IPA: the app says what it is.
        var q = URLComponents(string: server + "/sign/host")!
        q.queryItems = [URLQueryItem(name: "bundleid", value: app.bundleID), URLQueryItem(name: "version", value: app.version),
                        URLQueryItem(name: "title", value: app.name)]
        var req = URLRequest(url: q.url!)
        req.httpMethod = "POST"
        req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 300
        let upload = URLSession.shared.uploadTask(with: req, fromFile: output) { data, resp, error in
            try? FileManager.default.removeItem(at: output)
            job?.end()
            if job?.cancelled == true { opened(.failure(SignJob.cancelledError)); served?(false); return } // F196
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
        }
        job?.onCancel { upload.cancel() } // F196
        upload.resume()
    }

    static func signAndOpen(_ input: URL, url: String, id: SecIdentity, profile: Profile, options: SignOptions, servers: Servers,
                            emit: @escaping (String, Double) -> Void, log: ((String) -> Void)? = nil, job: SignJob? = nil,
                            opened: @escaping (Result<(SignedApp, SignedRecord), Error>) -> Void,
                            served: ((Bool) -> Void)? = nil) {
        let tok = SignBridge.token()
        let output = SignBridge.work.appendingPathComponent("\(tok).ipa")
        defer { try? FileManager.default.removeItem(at: input) }
        let app: SignedApp, identity: KeychainIdentity
        do {
            identity = try KeychainIdentity(id)
            if let log = log {
                let cert = try? Certificate(der: identity.certificate)
                log("Certificate: \(cert?.commonName ?? "?") (team \(cert?.team ?? profile.team))")
                log("Profile: \(profile.name), \(profile.kind.rawValue), app ID \(profile.appID)"
                    + (profile.expires.map { ", expires \(ISO8601DateFormatter().string(from: $0))" } ?? ""))
            }
            if let p = profile.problem(with: identity.certificate) { throw p }
            try job?.check() // F196: Cancel while it downloaded
            let signer = IPASigner(profile: profile, identity: identity)
            signer.options = options
            if let job = job { signer.stop = { job.cancelled } }
            if let log = log { let nslog = signer.log; signer.log = { nslog($0); log($0) } }
            app = try signer.sign(input, to: output) { emit($0, $1) }
            log?("Signed \(app.name) \(app.version) as \(app.bundleID), \(Sideload.size(output))")
            try job?.check()
        } catch {
            try? FileManager.default.removeItem(at: output)
            opened(.failure(error)); served?(false)
            return
        }
        let record = SignedRecord(bundleID: app.bundleID, originalBundleID: app.originalBundleID, name: app.name,
                                  version: app.version, url: url, signed: Date(),
                                  expires: profile.signatureExpiry(certificate: identity.certificate), options: options.stored)
        emit("installing", 0)
        if let host = servers.host { // B64: this call's own choice, made when it started
            log?("Uploading to \(host)/sign/host (\(app.name) replaces this app, so iOS installs it from the server)")
            hostAndOpen(output, server: host, app: app, record: record, job: job, opened: opened, served: served)
            return
        }
        serveAndOpen(output, server: servers.manifest, app: app, record: record, log: log, job: job, opened: opened, served: served)
    }

    // F77: the second half of signAndOpen, for an IPA signed already (My IPAs' signed copy): serves `output` (deleted
    // after) on the local HTTP server, records it and opens the itms-services link with `server`'s manifest.
    // F196: `job` (signing.install's, library.install's) stays the one signing.cancel stops until iOS has fetched the
    // IPA or the link expired; Cancel then stops serving it at once and releases KeepAlive.
    static func serveAndOpen(_ output: URL, server remote: String, app: SignedApp, record: SignedRecord, log: ((String) -> Void)? = nil,
                             job: SignJob? = nil, opened: @escaping (Result<(SignedApp, SignedRecord), Error>) -> Void,
                             served: ((Bool) -> Void)? = nil) {
        let ipaPath = "/\(SignBridge.token())/app.ipa"
        let server = InstallServer.plain
        server.start { res in
            switch res {
            case .failure(let e):
                try? FileManager.default.removeItem(at: output)
                opened(.failure(Failed(text: "server: \(e.localizedDescription)"))); served?(false)
            case .success:
                if job?.cancelled == true { // F196: Cancel while the server started
                    try? FileManager.default.removeItem(at: output)
                    opened(.failure(SignJob.cancelledError)); served?(false)
                    return
                }
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
                log?("Serving the IPA at http://127.0.0.1:\(server.port)\(ipaPath)")
                log?("Manifest: \(q.url!.absoluteString)")
                // B30: iOS shows nothing at all when it can't load the manifest, so fetch it first, here.
                checkManifest(q.url!, job: job) { failure in
                    if job?.cancelled == true {
                        try? FileManager.default.removeItem(at: output)
                        opened(.failure(SignJob.cancelledError)); served?(false)
                        return
                    }
                    if let text = failure {
                        log?(String(text.dropFirst("no_manifest: ".count)))
                        try? FileManager.default.removeItem(at: output)
                        opened(.failure(Failed(text: text))); served?(false)
                        return
                    }
                    log?(ManifestCheck.okLine(host: ManifestCheck.host(of: q.url!)))
                    serveChecked(output, server: server, ipaPath: ipaPath, link: link, app: app, record: record, log: log,
                                 job: job, opened: opened, served: served)
                }
            }
        }
    }

    // B30: GET the exact manifest URL iOS will be handed (ManifestCheck.timeout); calls back on SignBridge.queue
    // with nil when it is a manifest iOS can read, else the page's error ("no_manifest: ..."). Cancel (`job`) ends
    // the request at once; the caller sees job.cancelled.
    static func checkManifest(_ url: URL, job: SignJob? = nil, done: @escaping (String?) -> Void) {
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: ManifestCheck.timeout)
        req.httpMethod = "GET"
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = ManifestCheck.timeout
        cfg.timeoutIntervalForResource = ManifestCheck.timeout
        cfg.waitsForConnectivity = false
        let session = URLSession(configuration: cfg)
        let task = session.dataTask(with: req) { data, resp, error in
            session.finishTasksAndInvalidate()
            let status = (resp as? HTTPURLResponse)?.statusCode
            let text = ManifestCheck.problem(status: status, body: data, error: error).map {
                ManifestCheck.errorText(host: ManifestCheck.host(of: url), reason: $0, reached: error == nil && status != nil)
            }
            SignBridge.queue.async { done(text) }
        }
        job?.onCancel { task.cancel() }
        task.resume()
    }

    // The rest of serveAndOpen once the manifest checked out (B30): serve the IPA, record it, hand iOS the link.
    private static func serveChecked(_ output: URL, server: InstallServer, ipaPath: String, link: String, app: SignedApp,
                                     record: SignedRecord, log: ((String) -> Void)?, job: SignJob?,
                                     opened: @escaping (Result<(SignedApp, SignedRecord), Error>) -> Void,
                                     served: ((Bool) -> Void)?) {
        let once = Once()
        KeepAlive.shared.begin()
        // B29: the bundle ID iOS is told to install (the manifest's, the signed Info.plist's) and what the
        // server sends, in the install log; the server's lines reach the page through signing.progress.
        InstallLog.reset(app.bundleID)
        log?("Bundle ID: \(app.bundleID)" + (app.bundleID == app.originalBundleID ? "" : " (the app's own: \(app.originalBundleID))")
             + ", version \(app.version); serving \(Sideload.size(output))")
        let bid = app.bundleID
        let serverLog = { (s: String) in InstallLog.say(bid, s) }
        let end = { (ok: Bool) in
            guard once.first() else { return }
            job?.end()
            if !ok { serverLog("iOS didn't fetch the whole IPA within 15 minutes; it is no longer served"); server.remove(ipaPath) }
            // B29: served: the route stays for the grace too. iOS's installer may ask again for parts, and
            // a route removed the moment one request reached the last byte answered those with 404.
            SignBridge.queue.asyncAfter(deadline: .now() + servedGrace) {
                if ok { server.remove(ipaPath) }
                try? FileManager.default.removeItem(at: output)
                KeepAlive.shared.end()
            }
            served?(ok)
        }
        server.serve(ipaPath, .init(type: "application/octet-stream", body: .file(output), log: serverLog,
                                    onServed: { serverLog("iOS has the whole IPA"); end(true) }))
        // F196: Cancel: no more serving, no minute's grace, the listener ends when nothing else is served.
        job?.onCancel {
            guard once.first() else { return }
            log?("Cancelled: the IPA is no longer served")
            server.cancel(ipaPath)
            SignBridge.queue.async {
                try? FileManager.default.removeItem(at: output)
                KeepAlive.shared.end()
            }
            served?(false)
        }
        SignBridge.queue.asyncAfter(deadline: .now() + 15 * 60) { end(false) }
        SignBridge.queue.async {
            saveRecords(SignedRecords.adding(record, to: records()))
            reschedule()
        }
        DispatchQueue.main.async {
            log?("Handing iOS the install link; it asks \"Install \(app.name)?\"")
            UIApplication.shared.open(URL(string: link)!)
            opened(.success((app, record)))
        }
    }

    // iOS's own install progress for an app, until it is done: at most 15 minutes, or 45 s with no progress seen.
    // B29: meanwhile the install server's lines for it (InstallLog) go to the page's console as {log} events.
    static func progress(_ c: Bridge.Call) {
        guard AppMode.current != .jailbreak else { return Apt.reply(c, nil, "jailbreak: not in the jailbreak app") }
        guard let bid = c.params["bundleId"] as? String, !bid.isEmpty else { return Apt.reply(c, nil, "bad_request: bundleId") }
        DispatchQueue.main.async { InstallLog.attach(bid) { c.emitOnMain([["log": $0]]) } }
        watch(bid, onProgress: { c.emitOnMain([["phase": "installing", "progress": $0]]) }) { installed in
            DispatchQueue.main.async { InstallLog.detach(bid) }
            Apt.reply(c, ["installed": installed.map { $0 as Any } ?? NSNull()], nil)
        }
    }

    // B29: how long a fully fetched IPA stays served (and KeepAlive held) for iOS's late or repeated requests.
    static let servedGrace: TimeInterval = 120

    // F155: the progress page's "Open <app>" once iOS says it installed it. False when iOS refuses (or lacks the call).
    static func openApp(_ c: Bridge.Call) {
        guard let bid = c.params["bundleId"] as? String, !bid.isEmpty else { return Apt.reply(c, nil, "bad_request: bundleId") }
        DispatchQueue.main.async { Apt.reply(c, ["opened": Workspace.open(bid)], nil) }
    }

    // B28: once progress was seen, a nil read doesn't end the watch at once: iOS drops the progress object for a moment
    // between its download and install steps (big IPAs), and an update's old app (or a new one's placeholder) answers
    // isInstalled true all along. Only nil for `nilGrace` seconds in a row ends it (`nilGraceDone` once it reached 100%).
    static let nilGrace: TimeInterval = 6, nilGraceDone: TimeInterval = 1.5

    // nil: the private API isn't there, so it can't be told.
    static func watch(_ bid: String, onProgress: @escaping (Double) -> Void, done: @escaping (Bool?) -> Void) {
        guard Workspace.available else { return done(nil) }
        let start = Date()
        var cancels: Int?
        var seen = false, last = -1
        var nilSince: Date?
        func tick() {
            if cancels == nil { cancels = watchCancels }
            if cancels != watchCancels { return done(nil) } // F196: signing.cancel
            if let p = Workspace.installProgress(bid) {
                seen = true
                nilSince = nil
                let pct = Int(p.fractionCompleted * 100)
                if pct != last { last = pct; onProgress(p.fractionCompleted) }
            } else if seen {
                let since = nilSince ?? Date()
                nilSince = since
                if Date().timeIntervalSince(since) >= (last >= 100 ? nilGraceDone : nilGrace) {
                    return done(Workspace.isInstalled(bid))
                }
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

    static func resignAll(_ c: Bridge.Call) { resign(c, allowHost: false) { $0 } }

    // F91: one app, from the queue's "resign" job: the same path with only its record.
    static func resignOne(_ c: Bridge.Call) {
        let bid = c.params["bundleId"] as? String ?? ""
        guard !SignedRecords.only(records(), bundleID: bid).isEmpty else {
            return Apt.reply(c, nil, "not_signed: \(Brand.name) has no record of signing \(bid.isEmpty ? "that app" : bid)")
        }
        resign(c) { SignedRecords.only($0, bundleID: bid) }
    }

    static func resign(_ c: Bridge.Call, allowHost: Bool = true, pick: @escaping ([SignedRecord]) -> [SignedRecord]) {
        guard let (id, profile) = ready(c) else { return }
        // F91: iFizBox's own re-sign (signing.resign with `host: true`, one record) is hosted; Re-sign All never is.
        guard let servers = servers(c, allowHost: allowHost) else { return Apt.reply(c, nil, noServer) }
        SignBridge.queue.async {
            let list = pick(records())
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
                    signAndOpen(file, url: r.url, id: id, profile: profile, options: SignOptions(r.options), servers: servers, emit: emit,
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

    static let ocspKey = "ifizbox.signing.ocsp"

    static func checkCertificate(_ c: Bridge.Call) {
        guard let (sid, _) = ready(c) else { return }
        SignBridge.queue.async {
            do {
                let ident = try KeychainIdentity(sid)
                guard let issuer = ident.chain.first else { throw SignError("ocsp", "The certificate's issuer isn't one \(Brand.name) knows.") }
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

    static let remindKey = "ifizbox.signing.remindDays"
    static let reminderID = "ifizbox.resign"

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
        // Badges too: iOS asks once, so a first ask without them left the icon badge off for good (user 2026-11-18).
        if ask { center.requestAuthorization(options: [.alert, .badge, .sound]) { ok, _ in if ok { schedule() } } }
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

// Silent audio while iOS downloads an IPA from iFizBox (Feather's BackgroundAudioManager, docs/sideload.md): the
// install sheet sends iFizBox to the background, and beginBackgroundTask alone gives about 30 s, too little for a big
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
// UIApplication+open_private): install progress, whether an app is installed, and opening it (F155). Looked up at run time; when iOS
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

    static func open(_ id: String) -> Bool {
        let sel = NSSelectorFromString("openApplicationWithBundleID:")
        guard let ws = shared, let m = class_getInstanceMethod(type(of: ws), sel) else { return false }
        typealias F = @convention(c) (NSObject, Selector, NSString) -> Bool
        let f = unsafeBitCast(method_getImplementation(m), to: F.self)
        return f(ws, sel, id as NSString)
    }
}

// iOS doesn't finish installing a new iFizBox over the one that's running (user 2026-11-18: the update waited until
// iFizBox was closed by hand). Once iOS's "would like to install iFizBox" prompt has been answered (iFizBox becomes
// active again), iFizBox leaves a notification and closes, so the install finishes; the notification opens the new one.
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
            // It arrives 8 s later, by when iOS has usually finished (user 2026-11-18: "tap when it's done" read wrong).
            c.title = "\(Brand.name) Updated"
            c.body = "Tap to open the new version."
            let req = UNNotificationRequest(identifier: "ifizbox.updating", content: c,
                                            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 8, repeats: false))
            UNUserNotificationCenter.current().add(req) { _ in
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { exit(0) }
            }
        }
    }
}

// B29: the install server's lines (each request iOS makes for the IPA, the bytes it got, a 404 after serving ended)
// for the progress page's console. They come after signing.install (or library.install) has answered, when its
// stream is closed, so they wait here per bundle ID until signing.progress (the page's follow of iOS's install)
// attaches and emits them. Also in the device log. say() from any queue; the rest on the main queue.
enum InstallLog {
    private static var waiting = [String: [String]]()
    private static var sinks = [String: (String) -> Void]()

    static func say(_ bundleID: String, _ line: String) {
        NSLog("\(Brand.name) install \(bundleID): " + line.replacingOccurrences(of: "%", with: "%%"))
        DispatchQueue.main.async {
            if let sink = sinks[bundleID] { return sink(line) }
            var w = waiting[bundleID] ?? []
            w.append(line)
            waiting[bundleID] = Array(w.suffix(200))
        }
    }

    static func attach(_ bundleID: String, _ sink: @escaping (String) -> Void) {
        sinks[bundleID] = sink
        for l in waiting.removeValue(forKey: bundleID) ?? [] { sink(l) }
    }

    static func detach(_ bundleID: String) { sinks.removeValue(forKey: bundleID) }

    // A new install of the app: lines left from an earlier one are dropped.
    static func reset(_ bundleID: String) { DispatchQueue.main.async { waiting.removeValue(forKey: bundleID) } }
}
