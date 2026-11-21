// F235: the IPA queue's run signs every app first and hands them to iOS one at a time (web/app/core/apprun.js,
// screens/apprun.js). signing.install does both in one call, so the queue uses these two halves instead:
//
//   signing.prepare {url, name?, bundleId?, icon?, removeExtensions?, fixArm64e?, tag}   an app from its IPA's url, or
//   signing.prepare {record: bundleId, tag}       an app iFizBox signed before, from its record (Re-sign: its url or
//                                                 My IPAs file, its stored edits)
//   signing.prepare {library: file, edits?, tag}  a My IPAs file
//        (stream: {phase: "downloading" | "reading" | "signing", progress}, {log})
//        -> {token, bundleId, originalBundleId, name, version, expires?, device}: the signed IPA is kept for `life`;
//        KeepAlive is held from the call to its answer (B257), so it signs with the app in the background
//   signing.open {token, manifestServer, host?, tag}   serves the kept IPA and opens iOS's Install prompt (host: iFizBox's
//        own, uploaded to the Signing Server as signing.install's) -> signing.install's reply; records the app
//        route: "idevice" (This iPhone): installd installs it, no prompt (stream: {phase: "copying" | "installing",
//        progress}); the reply comes once it is installed and says installed: true
//   signing.discard {token}                       forgets a kept IPA that will not be installed -> {discarded}
//
// `tag` is the app's (one per try): signing.cancel {tag} stops that app's download, signing or serving only
// (SignJob.cancel(tag:)), and signing.progress {bundleId, tag} ends its watch. The kept IPAs live in SignBridge.work
// (emptied at launch) and go once opened, discarded or after `life`.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum SignAhead {
    private struct Kept { let output: URL; let app: SignedApp; let record: SignedRecord }
    private static var kept = [String: Kept]() // on SignBridge.queue
    static let life: TimeInterval = 30 * 60

    static func register(_ b: Bridge) {
        b.on("signing.prepare") { c in prepare(c) }
        b.on("signing.open") { c in open(c) }
        b.on("signing.discard") { c in
            guard AppMode.current != .jailbreak else { return Apt.reply(c, nil, "jailbreak: the jailbreak app installs IPAs through its helper") }
            let tok = c.params["token"] as? String ?? ""
            SignBridge.queue.async { Apt.reply(c, ["discarded": forget(tok)], nil) }
        }
    }

    @discardableResult
    private static func forget(_ tok: String) -> Bool {
        guard let k = kept.removeValue(forKey: tok) else { return false }
        try? FileManager.default.removeItem(at: k.output)
        return true
    }

    static func prepare(_ c: Bridge.Call) {
        guard let (id, profile) = Sideload.ready(c) else { return }
        let tag = (c.params["tag"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? SignBridge.token()
        let job = SignJob.begin(tag: tag)
        // B257: KeepAlive from the call to its answer (as Sideload.install's), so the signing after the download's own
        // hold ends goes on with the app in the background; every answer below goes through `answer`, which lets go
        let released = Sideload.holdUntilAnswer()
        let answer = { (j: [String: Any]?, e: String?) in
            released()
            Apt.reply(c, j, e)
        }
        let throttle = Throttle()
        let emit = { (phase: String, p: Double) in
            if throttle.pass(phase, p) { c.emitOnMain([["phase": phase, "progress": p]]) }
        }
        let log = { (s: String) in c.emitOnMain([["log": s]]) }
        let fail = { (e: Error) in
            job.end()
            answer(nil, job.cancelled ? SignBridge.text(SignJob.cancelledError) : (e as? Sideload.Failed)?.text ?? SignBridge.text(e))
        }
        SignBridge.queue.async {
            // where the IPA comes from, and the edits it is signed with
            let source: String, options: SignOptions
            if let bid = c.params["record"] as? String, !bid.isEmpty {
                guard let r = SignedRecords.only(Sideload.records(), bundleID: bid).first else {
                    job.end()
                    return answer(nil, "not_signed: \(Brand.name) has no record of signing \(bid)")
                }
                source = r.url
                var o = SignOptions(r.options)
                // F302a: a tweak update re-signs from the record with the tweaks the page sends (the newer .deb)
                if let t = c.params["tweaks"] {
                    do { o.tweaks = try SignOptions(json: ["tweaks": t]).tweaks } catch { return fail(error) }
                }
                options = o
            } else {
                var o: SignOptions
                do { o = try SignOptions(json: c.params) } catch { return fail(error) }
                // a My IPAs file (library: its name) signs from the library, and its record says so for Re-sign
                if let f = c.params["library"] as? String, !f.isEmpty {
                    source = MyIPAs.libraryURL(f)
                    if c.params["tweaks"] == nil { o.tweaks = MyIPAs.library.options(f).tweaks } // F288: its Sign Options' tweaks
                }
                else { source = c.params["url"] as? String ?? "" }
                options = o
            }
            let signThat = { (file: URL) in
                SignBridge.queue.async {
                    do {
                        // F292: the IPA's hash before signing; a known-malware one stops here
                        let sha: String?
                        do { sha = try IPAHash.check(file, refuse: IPAHash.refuse(c.params), log: log) } catch {
                            try? FileManager.default.removeItem(at: file)
                            throw error
                        }
                        let (app, record, output) = try sign(file, url: source, id: id, profile: profile, options: options, emit: emit, log: log, job: job)
                        keepInLibrary(c, output: output, app: app, record: record, options: options, id: id, log: log) // B229
                        let tok = SignBridge.token()
                        kept[tok] = Kept(output: output, app: app, record: record)
                        SignBridge.queue.asyncAfter(deadline: .now() + life) { forget(tok) }
                        job.end()
                        var j: [String: Any] = ["token": tok, "bundleId": app.bundleID, "originalBundleId": app.originalBundleID,
                                                "name": options.shownName(app.name), "version": app.version] // B247
                        if let x = record.expires { j["expires"] = ISO8601DateFormatter().string(from: x) }
                        j["device"] = PhoneID.check(profile).json
                        if let s = sha { j["sha256"] = s } // F292
                        answer(j, nil)
                    } catch { fail(error) }
                }
            }
            // F77: an app recorded from My IPAs signs from the library's file
            if MyIPAs.fileOf(source) != nil {
                do {
                    if let file = try MyIPAs.copyForResign(source) { return signThat(file) }
                } catch { return fail(Sideload.Failed(text: "gone: that app isn't in My IPAs any more")) }
            }
            guard let url = Apt.httpURL(source) else { job.end(); return answer(nil, "bad_url: not an http(s) URL") }
            log("Downloading \(url.absoluteString)")
            // B104: a recorded app's http link was let through at install; a new one follows the page's insecure
            let http: Sideload.HTTPPolicy = (c.params["record"] as? String ?? "").isEmpty ? Sideload.httpPolicy(c) : .fallback
            let started = Date()
            let d = Sideload.download(url, http: http, emit: emit, // B262: the Log's line and the row's MB/s once a second
                                      bytes: Sideload.downloadTicks(log: log, event: { c.emitOnMain([$0]) })) { res in
                switch res {
                case .failure(let e): fail(e)
                case .success(let file):
                    log(Sideload.downloaded(file, since: started))
                    signThat(file)
                }
            }
            job.onCancel { d.cancel() }
        }
    }

    // B229: a My IPAs file signed for the queue ({library}) keeps that signed copy in My IPAs too, as library.sign
    // would (IPALibrary.keepSigned: only when it was signed with the IPA's own Sign Options), so its row reads Signed.
    private static func keepInLibrary(_ c: Bridge.Call, output: URL, app: SignedApp, record: SignedRecord, options: SignOptions,
                                      id: SecIdentity, log: (String) -> Void) {
        guard let f = c.params["library"] as? String, !f.isEmpty, let cert = try? KeychainIdentity(id).certificate else { return }
        do {
            if try MyIPAs.library.keepSigned(f, from: output, app: app, options: options, certificate: cert, signed: record.signed,
                                             expires: record.expires, keep: MyIPAs.keep(c)) {
                log("Kept the signed copy in My IPAs")
            }
        } catch { log("Couldn't keep the signed copy in My IPAs: \(error.localizedDescription)") }
    }

    // signAndOpen's first half (Sideload.swift): the same checks, logs and signer. `input` is deleted after.
    private static func sign(_ input: URL, url: String, id: SecIdentity, profile: Profile, options: SignOptions,
                             emit: @escaping (String, Double) -> Void, log: @escaping (String) -> Void,
                             job: SignJob) throws -> (SignedApp, SignedRecord, URL) {
        let output = SignBridge.work.appendingPathComponent("\(SignBridge.token())-ahead.ipa")
        defer { try? FileManager.default.removeItem(at: input) }
        do {
            try job.check()
            let identity = try KeychainIdentity(id)
            let cert = try? Certificate(der: identity.certificate)
            log("Certificate: \(cert?.commonName ?? "?") (team \(cert?.team ?? profile.team))")
            if let p = profile.problem(with: identity.certificate) { throw p }
            let device = PhoneID.check(profile)
            if let p = DeviceCheck.problem(device) { throw p }
            let signer = IPASigner(profile: profile, identity: identity)
            signer.options = options
            signer.stop = { job.cancelled }
            let nslog = signer.log
            signer.log = { nslog($0); log($0) }
            let app = try signer.sign(input, to: output) { emit($0, $1) }
            log("Signed \(options.shownName(app.name)) \(app.version) as \(app.bundleID), \(Sideload.size(output))")
            try job.check()
            let record = SignedRecord(bundleID: app.bundleID, originalBundleID: app.originalBundleID, name: app.name,
                                      version: app.version, url: url, signed: Date(),
                                      expires: profile.signatureExpiry(certificate: identity.certificate), options: options.stored,
                                      signer: app.stamp) // B259
            return (app, record, output)
        } catch {
            try? FileManager.default.removeItem(at: output)
            throw error
        }
    }

    static func open(_ c: Bridge.Call) {
        guard Sideload.ready(c) != nil else { return }
        guard let servers = Sideload.servers(c) else { return Apt.reply(c, nil, Sideload.noServer) }
        let tag = (c.params["tag"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? SignBridge.token()
        let tok = c.params["token"] as? String ?? ""
        let log = { (s: String) in c.emitOnMain([["log": s]]) }
        SignBridge.queue.async {
            guard let k = kept.removeValue(forKey: tok) else {
                return Apt.reply(c, nil, "gone: the signed copy is gone (kept 30 minutes); sign it again")
            }
            let job = SignJob.begin(tag: tag) // until iOS has fetched the IPA (serveAndOpen ends it)
            if job.cancelled {
                try? FileManager.default.removeItem(at: k.output)
                job.end()
                return Apt.reply(c, nil, SignBridge.text(SignJob.cancelledError))
            }
            let opened = { (r: Result<(SignedApp, SignedRecord), Error>) in
                switch r {
                case .failure(let e):
                    job.end()
                    Apt.reply(c, nil, job.cancelled ? SignBridge.text(SignJob.cancelledError) : (e as? Sideload.Failed)?.text ?? SignBridge.text(e))
                case .success(let (app, rec)):
                    var j: [String: Any] = ["bundleId": app.bundleID, "originalBundleId": app.originalBundleID, "name": app.name,
                                            "version": app.version, "removed": app.removed, "fixedArm64e": app.fixedArm64e]
                    if let x = rec.expires { j["expires"] = ISO8601DateFormatter().string(from: x) }
                    if servers.local { j["installed"] = true } // B111: installd has it, no iOS prompt to wait for
                    Apt.reply(c, j, nil)
                }
            }
            if servers.local {
                // B111: {phase: "copying" | "installing", progress} as installHere goes (the run's row and bar)
                let throttle = Throttle()
                let step = { (phase: String, p: Double) in
                    if throttle.pass(phase, p) { c.emitOnMain([["phase": phase, "progress": p]]) }
                }
                Sideload.installHere(k.output, app: k.app, record: k.record, emit: nil, log: log, job: job, opened: opened, served: nil, step: step)
                return
            }
            if let host = servers.host {
                log("Uploading to \(host)/sign/host (\(k.app.name) replaces this app, so iOS installs it from the server)")
                Sideload.hostAndOpen(k.output, server: host, app: k.app, record: k.record, job: job, opened: opened, served: nil)
                return
            }
            Sideload.serveAndOpen(k.output, server: servers.manifest, app: k.app, record: k.record, log: log, job: job, opened: opened, served: nil)
        }
    }
}
