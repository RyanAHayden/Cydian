// F14: the sideload build's install flow around I6's signer. Look before signing (entitlements, permissions,
// extensions), sign with the user's edits (name, bundle ID, icon, extensions left out, arm64e fix-up), keep iFizBox
// alive with silent audio while iOS downloads the IPA from it, watch iOS install it (private LSApplicationWorkspace,
// as Feather does), remember what was signed so Re-sign All can do it again, check the certificate with Apple's
// OCSP responder, and remind before signatures expire. docs/signing.md, "On the phone (I6)" and "F14".
//
//   signing.inspect {url} (stream: {phase: "downloading", progress})
//        -> {token, app: {name, bundleId, version, minimumOS, size, entitlements, permissions, extensions},
//            icon (base64 PNG, may be Apple's CgBI form) | null, missing: [entitlement], signsAs, profileKind,
//            appIdAs, keepBundleId, push, wildcard, profileAppId}   (params keepBundleId?: Keep Bundle IDs, absent on)
//   signing.install {url | token, name?, bundleId?, icon?, removeExtensions?, fixArm64e?, keepBundleId?} (stream as I6)
//        -> I6's reply + {fixedArm64e, expires}
//   signing.progress {bundleId} (stream: {phase: "installing", progress}) -> {installed: true | false | null}
//        + handedOff (B76): true when a false became null because iFizBox lost sight of the install (Handoff below)
//        + dismissed (B85): true when the false is iOS's prompt closed without iOS asking for the IPA (Cancel, or a
//        frozen server; B91: it stays served for Try Again); the itms-services link opens through InstallPrompt.swift,
//        one prompt at a time
//   signing.reprompt {bundleId} -> {reopened}: B85, opens that app's install link again (its IPA still served; B91:
//        the Signing Server's link once iOS froze iFizBox). Only the user's tap: iFizBox never re-opens by itself
//   signing.selfUpdate (stream: {state}) -> {state}: B83, iFizBox's own update after iOS's prompt (CloseForUpdate):
//        prompt | waiting | downloading, then finished (it exits) | notStarted | stalled | guessed; null: none running
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
//   F235: signing.cancel {tag} stops one app of the IPA queue's run; signing.progress {bundleId, wait?, tag?} waits up
//        to `wait` s for iOS to start (Install tapped) and ends on that tag's cancel. signing.prepare/open: SignAhead.swift
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
        // B83: iFizBox's own update after the prompt (CloseForUpdate): streams {state} and answers the last one
        b.on("signing.selfUpdate") { c in
            DispatchQueue.main.async {
                CloseForUpdate.watch { s in
                    if let s = s { c.emit([["state": s.rawValue]]) }
                    guard s?.ends ?? true else { return true }
                    c.reply(["state": s.map { $0.rawValue as Any } ?? NSNull()], nil)
                    return false
                }
            }
        }
        b.on("signing.installed") { c in SignBridge.run(c) { installedJSON() } }
        b.on("signing.openApp") { c in openApp(c) }
        // B85: the IPA run's "Tap Install on the iOS prompt" row: open that app's install link again (InstallPrompt)
        b.on("signing.reprompt") { c in
            guard AppMode.current != .jailbreak else { return Apt.reply(c, nil, "jailbreak: not in the jailbreak app") }
            let bid = c.params["bundleId"] as? String ?? ""
            DispatchQueue.main.async { Apt.reply(c, ["reopened": InstallPrompt.reprompt(bid)], nil) }
        }
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
        PhoneID.register(b) // F236: device.udid, every build
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
        // B104: download's http rules (the https twin, or "insecure" for the page to ask; insecure: true is plain http)
        download(url, http: httpPolicy(c), emit: { phase, p in
            if throttle.pass(phase, p) { c.emitOnMain([["phase": phase, "progress": p]]) }
        }) { res in
            let file: URL
            switch res {
            case .failure(let e): return Apt.reply(c, nil, (e as? Failed)?.text ?? SignBridge.text(e))
            case .success(let f): file = f
            }
            SignBridge.queue.async {
                do {
                    let d = try Inspect.ipa(file)
                    var icon: Any = NSNull()
                    if let path = d.iconPath, let z = try? ZipReader(url: file), let e = z.entries.first(where: { $0.name == path }),
                       let png = try? z.data(e, limit: 4 << 20) { icon = png.base64EncodedString() }
                    prepared[tok] = Prepared(url: url.absoluteString, file: file, details: d)
                    SignBridge.queue.asyncAfter(deadline: .now() + 15 * 60) { forgetPrepared(tok) }
                    // F237: signsAs follows Keep Bundle IDs (params keepBundleId, absent: on); appIdAs is the
                    // profile's App ID the entitlements get either way, and the sheet's warnings read push.
                    var o = SignOptions(); if let k = c.params["keepBundleId"] as? Bool { o.keepBundleID = k }
                    let ids = (try? profile.signingIDs(for: d.bundleID, keep: o.keeps(d.bundleID))) ?? (bundleID: d.bundleID, entitlementsID: d.bundleID)
                    Apt.reply(c, ["token": tok, "app": d.json, "icon": icon, "missing": d.missing(from: profile),
                                  "signsAs": ids.bundleID, "appIdAs": ids.entitlementsID, "keepBundleId": o.keepBundleID,
                                  "push": profile.pushEnvironment ?? NSNull(), "wildcard": profile.isWildcard, "profileAppId": profile.appID,
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
    // `local` (the call's `route: "idevice"`, Settings > Installation > This iPhone): no server at all; the signed IPA
    // goes to this phone's installd through LocalDevVPN (installHere, native/sideload/idevice). It wins over `host`:
    // installd updates iFizBox itself in place.
    struct Servers {
        let manifest: String
        let host: String?
        var local = false
    }

    static let noServer = "no_server: installing needs a Signing Server: set one in Settings > Signing"

    // A call's servers: `manifestServer` (an https:// address, else nil: no_server) and, with `host: true`, the same as
    // the host; `allowHost: false` (My IPAs) never hosts.
    static func servers(_ c: Bridge.Call, allowHost: Bool = true) -> Servers? {
        let ms = (c.params["manifestServer"] as? String)?.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        if c.params["route"] as? String == "idevice" { return Servers(manifest: ms ?? "", host: nil, local: true) }
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
        // B111: This iPhone's steps on their own: {here: "copying" | "installing", progress} (signing-client.js hereLabel)
        let stepThrottle = Throttle()
        let step = { (phase: String, p: Double) in
            if stepThrottle.pass(phase, p) { c.emitOnMain([["here": phase, "progress": p]]) }
        }
        // The progress page's console (signing-client.js): what each step did, a line each.
        let log = { (s: String) in c.emitOnMain([["log": s]]) }
        let finish = { (r: Result<(SignedApp, SignedRecord), Error>) in
            switch r {
            case .failure(let e):
                job.end()
                // Failed carries its own code ("offline: …", This iPhone's "timeout: …"), as MyIPAs replies it
                Apt.reply(c, nil, job.cancelled ? SignBridge.text(SignJob.cancelledError) : (e as? Failed)?.text ?? SignBridge.text(e))
            case .success(let (app, rec)):
                var j: [String: Any] = ["bundleId": app.bundleID, "originalBundleId": app.originalBundleID, "name": app.name,
                                        "version": app.version, "removed": app.removed, "fixedArm64e": app.fixedArm64e]
                if let x = rec.expires { j["expires"] = ISO8601DateFormatter().string(from: x) }
                j["device"] = PhoneID.check(profile).json // F236: "unknown" makes a missing app name the likely cause
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
                signAndOpen(p.file, url: p.url, id: id, profile: profile, options: options, servers: servers, emit: emit, log: log, job: job, opened: finish, step: step)
            }
            return
        }
        guard let url = Apt.httpURL(c.params["url"]) else { job.end(); return Apt.reply(c, nil, "bad_url: not an http(s) URL") }
        log("Downloading \(url.absoluteString)")
        let d = download(url, http: httpPolicy(c), emit: emit) { res in
            switch res {
            case .failure(let e): finish(.failure(e))
            case .success(let file):
                log("Downloaded \(Sideload.size(file))")
                signAndOpen(file, url: url.absoluteString, id: id, profile: profile, options: options, servers: servers, emit: emit, log: log, job: job, opened: finish, step: step)
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
        // F235: {tag} stops one app of the IPA queue's run (its download, signing, serving and watch), nothing else
        if let tag = c.params["tag"] as? String, !tag.isEmpty {
            return DispatchQueue.main.async { c.reply(["cancelled": SignJob.cancel(tag: tag)], nil) }
        }
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

    // B104: what an http:// IPA link may do (ATS keeps URLSession, and so Download, off plain http):
    //   ask       the https twin only; when it has none, the call answers "insecure: …" and the page asks
    //             (web/app/signing-client.js askInsecure, the "This Download Is Not Secure" alert)
    //   allow     the page's Install Anyway (params insecure: true): plain http over F238's PlainDownload
    //   fallback  the https twin, else plain http without asking: Re-sign of a recorded app, whose http link the user
    //             already let through when it was installed
    // https links are downloaded as before whatever the policy.
    enum HTTPPolicy { case ask, allow, fallback }
    static func httpPolicy(_ c: Bridge.Call) -> HTTPPolicy { c.params["insecure"] as? Bool == true ? .allow : .ask }

    // The same link over https (port 80 dropped), or nil when it isn't http. web/app/core/insecureipa.js httpsTwin.
    static func httpsTwin(_ url: URL) -> URL? {
        guard url.scheme?.lowercased() == "http", var c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        c.scheme = "https"
        if c.port == 80 { c.port = nil }
        return c.url
    }

    // A twin's failure that means "no https copy here" (try http, or ask), not one the http link would share.
    static func twinMissing(_ err: String) -> Bool {
        !(err.hasPrefix("cancelled:") || err.hasPrefix("too_large:") || err.hasPrefix("offline:"))
    }
    static let twinTimeout: TimeInterval = 20 // a host whose port 443 hangs (BigBoss, B58) asks sooner than Download's 60 s

    // The running part of an http link's download (the twin, then maybe PlainDownload), for the job's Cancel.
    final class HTTPChain: DebFetch {
        private let lock = NSLock()
        private var current: DebFetch?
        private(set) var cancelled = false
        func set(_ d: DebFetch) { lock.lock(); current = d; let stop = cancelled; lock.unlock(); if stop { d.cancel() } }
        func cancel() { lock.lock(); cancelled = true; let d = current; lock.unlock(); d?.cancel() }
    }

    @discardableResult
    static func download(_ url: URL, http: HTTPPolicy = .ask, emit: @escaping (String, Double) -> Void,
                         done: @escaping (Result<URL, Error>) -> Void) -> DebFetch {
        let file = SignBridge.work.appendingPathComponent("\(SignBridge.token())-in.ipa")
        let progress = { (p: Double) in emit("downloading", p) }
        let finished = { (err: String?) in
            if let e = err { try? FileManager.default.removeItem(at: file); return done(.failure(Failed(text: e))) }
            SignBridge.queue.async { done(.success(file)) }
        }
        guard let twin = httpsTwin(url) else {
            return Download.start(url, to: file, max: SignBridge.maxIPA, progress: progress, done: finished)
        }
        if http == .allow {
            NSLog("[sideload] plain http download (Install Anyway): %@", url.absoluteString)
            return PlainDownload.start(url, to: file, max: SignBridge.maxIPA, progress: progress, done: finished)
        }
        let chain = HTTPChain()
        chain.set(Download.start(twin, to: file, max: SignBridge.maxIPA, timeout: twinTimeout, progress: progress) { err in
            guard let e = err else { return finished(nil) }
            if chain.cancelled || !twinMissing(e) { return finished(e) }
            NSLog("[sideload] no https twin for %@ (%@)", url.absoluteString, e)
            guard http == .fallback else {
                return finished("insecure: \(url.host ?? url.absoluteString) offers this IPA only over plain http, without encryption")
            }
            chain.set(PlainDownload.start(url, to: file, max: SignBridge.maxIPA, progress: progress, done: finished))
        })
        return chain
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
            // B83: the link's status route, which says when iOS has the whole IPA (CloseForUpdate)
            let status = (json?["manifest"] as? String).flatMap { m in
                m.hasSuffix("/manifest.plist") ? URL(string: String(m.dropLast("manifest.plist".count)) + "status") : nil
            }
            DispatchQueue.main.async {
                UIApplication.shared.open(link)
                CloseForUpdate.afterPrompt(status: status)
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
                            served: ((Bool) -> Void)? = nil, step: ((String, Double) -> Void)? = nil) {
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
            // F236: a profile without this iPhone fails here with what to do, not later with iOS's "integrity" alert
            let device = PhoneID.check(profile)
            log?("This iPhone in the profile: \(device.state.rawValue) (\(device.count) devices listed)")
            if let p = DeviceCheck.problem(device) { throw p }
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
        if servers.local { // "Installing on this iPhone" (phase "here"), not iOS's own install
            installHere(output, app: app, record: record, emit: emit, log: log, job: job, opened: opened, served: served, step: step)
            return
        }
        emit("installing", 0)
        if let host = servers.host { // B64: this call's own choice, made when it started
            log?("Uploading to \(host)/sign/host (\(app.name) replaces this app, so iOS installs it from the server)")
            hostAndOpen(output, server: host, app: app, record: record, job: job, opened: opened, served: served)
            return
        }
        serveAndOpen(output, server: servers.manifest, app: app, record: record, log: log, job: job, opened: opened, served: served)
    }

    // The "This iPhone" route (Servers.local): `output` (deleted after) goes to installd over LocalDevVPN, AFC upload then
    // installation_proxy (IDevice.install). Progress is the page's "here" phase ("Installing on this iPhone", apart from
    // "Downloading"): connected 2%, the upload up to 30%, then installd's own percentage. Every step has a time limit
    // (IDevice.Limit), so a phone that stops answering ends the install with an error instead of a page left waiting. `opened` and `served` get the result once installd has installed it, so the
    // signing.progress that follows finds the app there. iFizBox itself: installd ends this process while it installs,
    // so its record is kept first.
    static func installHere(_ output: URL, app: SignedApp, record: SignedRecord, emit: ((String, Double) -> Void)?,
                            log: ((String) -> Void)?, job: SignJob?, opened: @escaping (Result<(SignedApp, SignedRecord), Error>) -> Void,
                            served: ((Bool) -> Void)?, step: ((String, Double) -> Void)? = nil) {
        // B111: `step` (the IPA queue's signing.open) gets each step's own fraction: "copying" (the AFC upload's bytes
        // sent) then "installing" (installd's percent), so the run's row shows them and no "iOS prompt" step
        let isSelf = app.bundleID == Bundle.main.bundleIdentifier
        IDevice.ilog("This iPhone: \(app.bundleID) \(app.version), \(Sideload.size(output))")
        log?("Installing on this iPhone through \(Tailscale.useForInstall() ? "Tailscale" : "LocalDevVPN (\(IDevice.address))"); nothing goes to a Signing Server")
        emit?("here", 0)
        if isSelf {
            saveRecords(SignedRecords.adding(record, to: records()))
            log?("\(app.name) replaces this app: iOS closes it while it installs; open it again once it's done")
        }
        DispatchQueue.main.async { KeepAlive.shared.begin() }
        IDevice.queue.async {
            let result: Result<Void, Error>
            do {
                try job?.check()
                log?("Copying the IPA to iOS (\(Sideload.size(output))), then iOS installs it")
                try IDevice.install(output, note: { log?($0) }) { st in
                    switch st {
                    case .connected: emit?("here", 0.02); step?("copying", 0)
                    case .upload(let p): emit?("here", 0.02 + p * 0.28); step?("copying", p)
                    case .install(let p): emit?("here", 0.3 + p * 0.7); step?("installing", p)
                    }
                }
                result = .success(())
            } catch { result = .failure(error) }
            try? FileManager.default.removeItem(at: output)
            DispatchQueue.main.async { KeepAlive.shared.end() }
            SignBridge.queue.async {
                job?.end()
                switch result {
                case .failure(let e):
                    let text = (e as? IDevice.Failure)?.errorDescription ?? SignBridge.text(e)
                    IDevice.ilog("This iPhone: \(app.bundleID) failed: \(text)")
                    log?("This iPhone's install failed: \(text)")
                    opened(.failure(job?.cancelled == true ? SignJob.cancelledError : Failed(text: text))); served?(false)
                case .success:
                    IDevice.ilog("This iPhone: \(app.bundleID) installed")
                    log?("iOS installed \(app.name) \(app.version)")
                    if !isSelf { saveRecords(SignedRecords.adding(record, to: records())) }
                    reschedule()
                    opened(.success((app, record))); served?(true)
                }
            }
        }
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
                    serveChecked(output, server: server, remote: remote, ipaPath: ipaPath, link: link, app: app, record: record, log: log,
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
    private static func serveChecked(_ output: URL, server: InstallServer, remote: String, ipaPath: String, link: String, app: SignedApp,
                                     record: SignedRecord, log: ((String) -> Void)?, job: SignJob?,
                                     opened: @escaping (Result<(SignedApp, SignedRecord), Error>) -> Void,
                                     served: ((Bool) -> Void)?) {
        let once = Once()
        let fallback = HostFallback() // B89
        KeepAlive.shared.begin()
        // B29: the bundle ID iOS is told to install (the manifest's, the signed Info.plist's) and what the
        // server sends, in the install log; the server's lines reach the page through signing.progress.
        InstallLog.reset(app.bundleID)
        Handoff.reset(app.bundleID)
        log?("Bundle ID: \(app.bundleID)" + (app.bundleID == app.originalBundleID ? "" : " (the app's own: \(app.originalBundleID))")
             + ", version \(app.version); serving \(Sideload.size(output))")
        let bid = app.bundleID
        let iosLink = URL(string: link)!
        // B85: any line from the IPA's route is iOS asking for it: Install was tapped (InstallPrompt.heard)
        let serverLog = { (s: String) in InstallPrompt.heard(bid); InstallLog.say(bid, s) }
        let end = { (ok: Bool) in
            guard once.first() else { return }
            fallback.finish() // B89
            InstallPrompt.end(bid, link: iosLink)
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
        var route = InstallServer.Route(type: "application/octet-stream", body: .file(output), log: serverLog,
                                        onServed: { serverLog("iOS has the whole IPA"); Handoff.served(bid); end(true) })
        // B89: iOS froze iFizBox while it served: the IPA goes to the Signing Server too, and iOS gets that link
        let note = { (s: String) in InstallLog.say(bid, s) }
        route.note = note
        route.onFrozen = { f in
            SignBridge.queue.asyncAfter(deadline: .now() + frozenGrace) {
                guard !server.asked(ipaPath, since: f.to) else {
                    return note("iOS asked for the IPA again after the freeze; it stays served here")
                }
                hostAfterFreeze(output, remote: remote, app: app, state: fallback, job: job, note: note) { ok in
                    if ok { Handoff.served(bid) }
                    end(ok)
                }
            }
        }
        server.serve(ipaPath, route)
        // F196: Cancel: no more serving, no minute's grace, the listener ends when nothing else is served.
        job?.onCancel {
            guard once.first() else { return }
            InstallPrompt.end(bid, link: iosLink)
            log?("Cancelled: the IPA is no longer served")
            server.cancel(ipaPath)
            SignBridge.queue.async {
                try? FileManager.default.removeItem(at: output)
                KeepAlive.shared.end()
            }
            served?(false)
        }
        // B89: an IPA handed to the Signing Server after a freeze ends by that copy's status instead
        SignBridge.queue.asyncAfter(deadline: .now() + 15 * 60) { if !fallback.hosting { end(false) } }
        SignBridge.queue.async {
            saveRecords(SignedRecords.adding(record, to: records()))
            reschedule()
        }
        DispatchQueue.main.async {
            log?("Handing iOS the install link; it asks \"Install \(app.name)?\"")
            // B85: once iFizBox is in front (an earlier app's prompt answered), and again when iOS drops it
            InstallPrompt.open(iosLink, bundleID: bid, name: app.name) { _ in
                if job?.cancelled == true { opened(.failure(SignJob.cancelledError)) } else { opened(.success((app, record))) }
            }
        }
    }

    // iOS's own install progress for an app, until it is done: at most 15 minutes, or 45 s with no progress seen.
    // B29: meanwhile the install server's lines for it (InstallLog) go to the page's console as {log} events.
    static func progress(_ c: Bridge.Call) {
        guard AppMode.current != .jailbreak else { return Apt.reply(c, nil, "jailbreak: not in the jailbreak app") }
        guard let bid = c.params["bundleId"] as? String, !bid.isEmpty else { return Apt.reply(c, nil, "bad_request: bundleId") }
        DispatchQueue.main.async { InstallLog.attach(bid) { c.emitOnMain([["log": $0]]) } }
        // F235: the IPA queue waits longer for the Install tap (`wait` seconds) and stops one app's watch by its `tag`
        let wait = max(45, min(c.params["wait"] as? Double ?? 45, 15 * 60))
        let tag = (c.params["tag"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        watch(bid, ask: wait, tag: tag, onProgress: { c.emitOnMain([["phase": "installing", "progress": $0]]) },
              lost: { seen, away in
            // B76: a false here after a handoff is iFizBox losing sight of iOS's install, not iOS refusing it
            // (B85: a prompt the user dismissed is neither)
            !InstallPrompt.dismissed(bid) && Handoff.lostSight(served: Handoff.wasServed(bid), away: away, seen: seen)
        }) { installed, handedOff in
            DispatchQueue.main.async {
                // B85: a dismissed prompt ends that app's watch, and the run moves on (dismissed: true). B91: it stays
                // served (and hosted after a freeze), so the row's Try Again (signing.reprompt) can ask iOS again; the
                // tag's Stop or Cancel, or the 15-minute expiry, ends it
                let dismissed = installed == false && InstallPrompt.dismissed(bid)
                // B85: what the watch saw, so a row that ends wrong says why
                let seen = "Install watch ended: installed \(installed.map { String($0) } ?? "unknown")"
                    + (handedOff ? " (handed off to iOS)" : "") + (dismissed ? " (prompt dismissed)" : "")
                    + "; " + InstallPrompt.summary(bid) + ", IPA fetched in full \(Handoff.wasServed(bid) ? "yes" : "no")"
                NSLog("\(Brand.name) install \(bid): " + seen.replacingOccurrences(of: "%", with: "%%"))
                c.emit([["log": seen]])
                InstallLog.detach(bid)
                Apt.reply(c, ["installed": installed.map { $0 as Any } ?? NSNull(), "handedOff": handedOff, "dismissed": dismissed], nil)
            }
        }
    }

    // B29: how long a fully fetched IPA stays served (and KeepAlive held) for iOS's late or repeated requests.
    static let servedGrace: TimeInterval = 120

    // ---- B89: the Signing Server's copy when iOS froze iFizBox mid-serve (InstallServer's heartbeat)
    //
    // iOS 27 can suspend iFizBox while it serves an IPA, and its listening socket stays shut: iOS's installer, sent to
    // 127.0.0.1, says "Unable to Install". Once iFizBox runs again (woken, or opened), and iOS hasn't asked for the IPA
    // within `frozenGrace` of that, the signed IPA goes up to the call's Signing Server (POST /sign/host, as iFizBox's
    // own update does). B91: no new prompt opens by itself (the user may have tapped Cancel, which iFizBox can't tell
    // from the freeze): InstallPrompt.rehost makes the row's Try Again (signing.reprompt) hand iOS the server's link.
    // iOS then installs from the server whether iFizBox is frozen again or not; its GET status says when iOS has the
    // whole IPA. The local route stays served meanwhile. Once per IPA.

    static let frozenGrace: TimeInterval = 5
    static let hostedLimit: TimeInterval = 10 * 60 // the Worker keeps a hosted IPA this long

    // One IPA's fallback: begun once, never after the IPA ended (served, expired, cancelled). Any queue.
    final class HostFallback {
        private let lock = NSLock()
        private var begun = false, ended = false, up = false
        var hosting: Bool { lock.lock(); defer { lock.unlock() }; return up }
        var over: Bool { lock.lock(); defer { lock.unlock() }; return ended }
        func begin() -> Bool {
            lock.lock(); defer { lock.unlock() }
            if begun || ended { return false }
            begun = true; up = true
            return true
        }
        func dropped() { lock.lock(); up = false; lock.unlock() } // the upload failed: the local timer ends it again
        func finish() { lock.lock(); ended = true; lock.unlock() }
    }

    // Uploads a copy of `output` (the local route keeps the original) and hands iOS the server's link; `done(true)` once
    // the server says iOS has the whole IPA, `done(false)` when its copy expired unfetched. Not called back on a Cancel
    // (the job's own onCancel ends the IPA) or when the upload failed (the local route's 15 minutes go on).
    static func hostAfterFreeze(_ output: URL, remote: String, app: SignedApp, state: HostFallback, job: SignJob?,
                                note: @escaping (String) -> Void, done: @escaping (Bool) -> Void) {
        guard job?.cancelled != true, state.begin() else { return }
        let bid = app.bundleID
        note("iOS hasn't asked for \(app.name) since the freeze; uploading it to \(remote)/sign/host so iOS can install "
             + "it from there")
        let copy = SignBridge.work.appendingPathComponent("\(SignBridge.token())-host.ipa")
        do { try FileManager.default.copyItem(at: output, to: copy) } catch {
            state.dropped()
            return note("Couldn't copy the IPA for the upload (\(error.localizedDescription)); it stays served here only")
        }
        uploadHosted(copy, server: remote, app: app) { res in
            try? FileManager.default.removeItem(at: copy)
            switch res {
            case .failure(let e):
                state.dropped()
                note("The upload failed (\(e.localizedDescription)); the IPA stays served here only")
            case .success(let (hosted, status)):
                if state.over || job?.cancelled == true { return } // iOS got it here meanwhile, or Cancel
                // B91: no prompt by itself: the user's tap (signing.reprompt) opens the server's link
                InstallPrompt.rehost(bid, link: hosted)
                guard let status = status else {
                    note("The server gave no status route: \(Brand.name) can't tell when iOS has the IPA")
                    return SignBridge.queue.asyncAfter(deadline: .now() + hostedLimit) { done(false) }
                }
                pollHosted(status, bundleID: bid, since: Date(), started: false, job: job, state: state) { finished, started in
                    if started && !finished { return note("iOS is fetching \(app.name) from the Signing Server") }
                    InstallPrompt.end(bid, link: hosted)
                    if job?.cancelled == true || state.over { return }
                    note(finished ? "iOS has the whole IPA (from the Signing Server)"
                         : "iOS didn't fetch the Signing Server's copy within \(Int(hostedLimit / 60)) minutes")
                    done(finished)
                }
            }
        }
    }

    // POST /sign/host (worker/src/index.js): the itms-services link and its status route. On SignBridge.queue.
    static func uploadHosted(_ file: URL, server: String, app: SignedApp, done: @escaping (Result<(URL, URL?), Error>) -> Void) {
        var q = URLComponents(string: server + "/sign/host")!
        q.queryItems = [URLQueryItem(name: "bundleid", value: app.bundleID), URLQueryItem(name: "version", value: app.version),
                        URLQueryItem(name: "title", value: app.name)]
        var req = URLRequest(url: q.url!)
        req.httpMethod = "POST"
        req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 300
        URLSession.shared.uploadTask(with: req, fromFile: file) { data, resp, error in
            let json = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) }) as? [String: Any]
            let result: Result<(URL, URL?), Error>
            if error == nil, (resp as? HTTPURLResponse)?.statusCode == 200, let itms = json?["itms"] as? String,
               let link = URL(string: itms) {
                let status = (json?["manifest"] as? String).flatMap { m in
                    m.hasSuffix("/manifest.plist") ? URL(string: String(m.dropLast("manifest.plist".count)) + "status") : nil
                }
                result = .success((link, status))
            } else {
                let why = (json?["error"] as? String) ?? error?.localizedDescription ?? "the server didn't answer"
                result = .failure(Failed(text: "server: \(why)"))
            }
            SignBridge.queue.async { done(result) }
        }.resume()
    }

    // Polls the hosted link's GET status every 2 s: `step(false, true)` once when iOS begins fetching, then
    // `step(true, _)` when it has the whole IPA or `step(false, false)` after `hostedLimit`. Stops on Cancel or once the
    // IPA ended. On SignBridge.queue.
    private static func pollHosted(_ url: URL, bundleID bid: String, since: Date, started: Bool, job: SignJob?, state: HostFallback,
                                   step: @escaping (Bool, Bool) -> Void) {
        if job?.cancelled == true || state.over { return step(false, false) }
        let req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            let marks = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) }) as? [String: Any]
            let ok = (resp as? HTTPURLResponse)?.statusCode == 200
            SignBridge.queue.async {
                if ok, marks?["finished"] as? Bool == true { return step(true, true) }
                let now = ok && marks?["started"] as? Bool == true
                if now && !started {
                    InstallPrompt.heard(bid) // the prompt was answered with Install
                    step(false, true)
                }
                if Date().timeIntervalSince(since) > hostedLimit { return step(false, false) }
                SignBridge.queue.asyncAfter(deadline: .now() + 2) {
                    pollHosted(url, bundleID: bid, since: since, started: started || now, job: job, state: state, step: step)
                }
            }
        }.resume()
    }

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
    // B76: `lost(seen, away)` is asked before a false is answered: true turns it into (nil, handedOff: true), as iFizBox
    // lost sight of the install (it went to the background during the watch: `away`), it didn't see iOS refuse it.
    static func watch(_ bid: String, ask: TimeInterval = 45, tag: String? = nil, onProgress: @escaping (Double) -> Void,
                      lost: @escaping (_ seen: Bool, _ away: Bool) -> Bool = { _, _ in false },
                      done finish: @escaping (Bool?, Bool) -> Void) {
        guard Workspace.available else { return finish(nil, false) }
        let start = Date()
        var cancels: Int?
        var seen = false, last = -1
        var nilSince: Date?
        // B76: iFizBox in the background at any time during the watch (iOS's home screen showing the install)
        var away = false
        var servedAt: Date?
        let nc = NotificationCenter.default
        let bg = nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in away = true }
        func done(_ installed: Bool?) {
            nc.removeObserver(bg)
            if installed == false, lost(seen, away) { return finish(nil, true) }
            finish(installed, false)
        }
        func tick() {
            if UIApplication.shared.applicationState == .background { away = true }
            if cancels == nil { cancels = watchCancels }
            if cancels != watchCancels { return done(nil) } // F196: signing.cancel
            if let t = tag, SignJob.wasCancelled(tag: t) { return done(nil) } // F235: signing.cancel {tag}
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
            } else if Date().timeIntervalSince(start) > ask {
                return done(false)
            } else if Handoff.wasServed(bid) {
                // B76: iOS has the whole IPA but shows iFizBox no progress: it's iOS's now (the queue needn't wait `ask`)
                let since = servedAt ?? Date()
                servedAt = since
                if Date().timeIntervalSince(since) >= Handoff.servedQuiet { return done(false) }
            } else if InstallPrompt.dismissed(bid) {
                return done(false) // B85: the prompt closed and iOS never asked for the IPA: Cancel was tapped
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
        // B65: the progress page's console gets each app's steps (as signing.install's), so a run that stops shows where
        let log = { (s: String) in c.emitOnMain([["log": s]]) }
        SignBridge.queue.async {
            let list = pick(records())
            var done = [String](), failed = [[String: Any]]()
            var stopped = false // B65: signing.cancel (the page's Cancel, or its stall timeout) ends the whole run
            func step(_ i: Int) {
                if stopped { return Apt.reply(c, nil, SignBridge.text(SignJob.cancelledError)) }
                guard i < list.count else {
                    return Apt.reply(c, ["done": done, "failed": failed], nil)
                }
                let r = list[i]
                let job = SignJob.begin() // B65: what signing.cancel stops, one app at a time
                let next = { job.end(); if job.cancelled { stopped = true }; step(i + 1) }
                log("Re-signing \(r.name) (\(r.bundleID))")
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
                                log: log, job: job,
                                opened: { if case .failure(let e) = $0 { SignBridge.queue.async { fail(e) } } },
                                served: { ok in
                                    SignBridge.queue.async {
                                        if ok { done.append(r.bundleID) }
                                        else if !failed.contains(where: { $0["bundleId"] as? String == r.bundleID }) {
                                            fail(Failed(text: "cancelled: iOS didn't fetch it"))
                                        }
                                        next()
                                    }
                                })
                }
                // F77: an app installed from My IPAs signs from the library's file, not a download.
                if MyIPAs.fileOf(r.url) != nil {
                    do {
                        if let file = try MyIPAs.copyForResign(r.url) { return signThat(file) }
                    } catch { fail(Failed(text: "gone: \(r.name) isn't in My IPAs any more")); return next() }
                }
                guard let url = Apt.httpURL(r.url) else { fail(Failed(text: "bad_url: \(r.url)")); return next() }
                log("Downloading \(url.absoluteString)")
                let d = download(url, http: .fallback, emit: emit) { res in // B104: its http link was let through at install
                    switch res {
                    case .failure(let e): fail(e); next()
                    case .success(let file): log("Downloaded \(Sideload.size(file))"); signThat(file)
                    }
                }
                job.onCancel { d.cancel() }
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
            self.resumeAfterInterruptions()
        }
    }

    // B89: an audio interruption (a call, Siri, another app's audio session) stops the silent loop, and iOS may then
    // suspend iFizBox mid-serve; once the interruption ends, the loop plays again while any install still holds it.
    private var interruptions: NSObjectProtocol?
    private func resumeAfterInterruptions() {
        guard interruptions == nil else { return }
        interruptions = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil,
                                                               queue: .main) { [weak self] n in
            let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            guard let self = self, raw.flatMap(AVAudioSession.InterruptionType.init) == .ended, let p = self.player else { return }
            try? AVAudioSession.sharedInstance().setActive(true)
            p.play()
            NSLog("\(Brand.name) KeepAlive: audio interruption ended; silent loop playing again")
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
// iFizBox was closed by hand), so iFizBox closes itself for its own update, but only once iOS has the whole new IPA.
// B83: closing on a fixed 8 s guess lost updates (user 2026-11-19, 0.9.8 to 0.9.9 while another app installed: the
// notification came before iOS had downloaded the IPA, the user opened the old iFizBox, and iOS wouldn't install over
// it). Now, once iOS's "would like to install" prompt is answered (iFizBox active again), iFizBox stays alive
// (KeepAlive's silent audio) and polls the Signing Server's GET /sign/host/<t>/status (worker/src/index.js): when iOS
// has streamed app.ipa to its end it leaves a notification and exits so the install finishes. If iOS hasn't begun
// the download within `startLimit` (the prompt was cancelled, the link failed) or not finished it within
// `finishLimit` (the link's TTL), it doesn't exit: the progress page (signing.selfUpdate) offers Try Again.
// A server without the status route (404 three times) gets the old 8 s close.
// State on the main queue.
enum CloseForUpdate {
    enum State: String {
        case prompt, waiting, downloading, finished, notStarted, stalled, guessed
        var ends: Bool { [.finished, .notStarted, .stalled, .guessed].contains(self) }
    }
    static var token: NSObjectProtocol?
    private static var resignToken: NSObjectProtocol?
    private static var backgroundToken: NSObjectProtocol? // B123
    // B123: how long iOS's prompt has to make iFizBox resign active before the wait starts without it
    static let promptGrace: TimeInterval = 5
    private(set) static var state: State?
    private static var sinks = [(State?) -> Bool]() // signing.selfUpdate watches; false: done with it
    private static var run = 0 // each afterPrompt bumps it: an older run's polls stop
    static let startLimit: TimeInterval = 120, finishLimit: TimeInterval = 600, pollEvery: TimeInterval = 2

    // `status`: the link's GET status URL (nil: the old 8 s close). Main queue.
    static func afterPrompt(status: URL?) {
        run += 1
        let mine = run
        set(.prompt)
        var resigned = false
        let nc = NotificationCenter.default
        // B123: the wait starts once the prompt is answered (active again after resigning), or when iFizBox goes to
        // the background (Install, then Home: KeepAlive keeps the polls going), or when iOS's prompt never made
        // iFizBox resign active within `promptGrace` (it was left in .prompt for ever, the page locked, nothing closing)
        let begin = {
            guard mine == run, state == .prompt else { return }
            token.map(nc.removeObserver); token = nil
            resignToken.map(nc.removeObserver); resignToken = nil
            backgroundToken.map(nc.removeObserver); backgroundToken = nil
            guard let status = status else { return guess() }
            KeepAlive.shared.begin()
            set(.waiting)
            poll(status, run: mine, since: Date(), misses: 0)
        }
        resignToken.map(nc.removeObserver)
        resignToken = nc.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { _ in resigned = true }
        token.map(nc.removeObserver)
        token = nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
            guard resigned else { return } // the prompt hasn't shown yet
            begin()
        }
        backgroundToken.map(nc.removeObserver)
        backgroundToken = nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in begin() }
        DispatchQueue.main.asyncAfter(deadline: .now() + promptGrace) { if !resigned { begin() } }
    }

    // signing.selfUpdate: `sink` gets the state now (nil: no self-update running) and each change after; it answers
    // false once it is done listening.
    static func watch(_ sink: @escaping (State?) -> Bool) {
        if sink(state) { sinks.append(sink) }
    }

    private static func set(_ s: State) {
        state = s
        sinks = sinks.filter { $0(s) }
    }

    private static func poll(_ url: URL, run mine: Int, since: Date, misses: Int) {
        guard mine == run else { return }
        let req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            let code = (resp as? HTTPURLResponse)?.statusCode
            let marks = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) }) as? [String: Any]
            DispatchQueue.main.async {
                guard mine == run else { return }
                let known = code == 200 && marks?["finished"] != nil
                if known, marks?["finished"] as? Bool == true { return finish() }
                if known, marks?["started"] as? Bool == true, state != .downloading { set(.downloading) }
                // an older Signing Server, without the status route: the old guess
                let miss = !known && code == 404 ? misses + 1 : (known ? 0 : misses)
                if miss >= 3, state == .waiting { return guess() }
                let waited = Date().timeIntervalSince(since)
                if state == .downloading ? waited > finishLimit : waited > startLimit {
                    return giveUp(state == .downloading ? .stalled : .notStarted)
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + pollEvery) { poll(url, run: mine, since: since, misses: miss) }
            }
        }.resume()
    }

    // iOS has the whole IPA: a notification to open the new one, and out, so iOS installs over this one.
    private static func finish() {
        set(.finished)
        let c = UNMutableNotificationContent()
        c.title = "Finishing the \(Brand.name) Update"
        c.body = "iOS has the new version and is installing it. Tap to open it."
        closeWith(c, after: 3)
    }

    private static func guess() {
        set(.guessed)
        let c = UNMutableNotificationContent()
        // It arrives 8 s later, by when iOS has usually finished (user 2026-11-18: "tap when it's done" read wrong).
        c.title = "Updating \(Brand.name)"
        c.body = "Tap to open the new version."
        closeWith(c, after: 8)
    }

    private static func closeWith(_ c: UNMutableNotificationContent, after: TimeInterval) {
        let req = UNNotificationRequest(identifier: "ifizbox.updating", content: c,
                                        trigger: UNTimeIntervalNotificationTrigger(timeInterval: after, repeats: false))
        UNUserNotificationCenter.current().add(req) { _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { exit(0) }
        }
    }

    // Not started, or stalled: iFizBox stays open (the page offers Try Again); from the background, a notification says so.
    private static func giveUp(_ s: State) {
        set(s)
        KeepAlive.shared.end()
        guard UIApplication.shared.applicationState != .active else { return }
        let c = UNMutableNotificationContent()
        c.title = s == .stalled ? "The \(Brand.name) Update Didn't Finish" : "The \(Brand.name) Update Didn't Start"
        c.body = "Open \(Brand.name) to try again."
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "ifizbox.updating", content: c, trigger: nil))
    }
}

// B76: on a stock phone iFizBox can't watch iOS's install once it is in the background, so signing.progress's false
// after a handoff means "lost sight", not "refused". Handed off: iFizBox went to the background during the watch, or
// iOS fetched the whole IPA (the install server's onServed) and no progress was seen after. A false seen while iFizBox
// stayed in front, with iOS never fetching the IPA or with progress seen to the end, stays a refusal.
// State per bundle ID, on the main queue; served/reset from any queue.
enum Handoff {
    private static var fetched = Set<String>()

    static func reset(_ bundleID: String) { DispatchQueue.main.async { fetched.remove(bundleID) } }
    static func served(_ bundleID: String) { DispatchQueue.main.async { fetched.insert(bundleID) } }
    static func wasServed(_ bundleID: String) -> Bool { fetched.contains(bundleID) }

    static func lostSight(served: Bool, away: Bool, seen: Bool) -> Bool { away || (served && !seen) }

    // How long a watch waits, once iOS has the whole IPA, for install progress to show before calling it handed off.
    static let servedQuiet: TimeInterval = 30
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
