// N9: the shell's side of the share sheet and Open in iFizBox. What to do with each item is ../Share.swift (tested on
// Linux); this file is the phone's half: files iOS hands over (the document types in Info.plist and
// Info-sideload.plist: .ipa, .deb), ifizbox://share?url=… from the share extension (../Extension/), and the bridge
// calls web/app/share.js runs.
//
//   SharedInbox.receive(url)    App.swift's Incoming calls it first. A file: classified by its bytes, staged where the
//                               helper takes it (or put in My IPAs, sideload), then ifizbox://shared?route=… for the page.
//                               ifizbox://share?url=…|text=…: the link classified, then ifizbox://add?url=… (sources) or
//                               ifizbox://shared?route=… with the link. False for anything else.
//   share.ipaInstall {file, stream}  jailbreak: ifizbox-helper install-ipa <staged>; -> {code: 0, stdout, stderr, bundleId,
//                               name, version} (the version for I3), errors as ipa.install's (bad_ipa, no_adhoc, ...)
//   share.debFetch {url, sha256?, md5?}  jailbreak: a .deb link downloaded into the helper's directory -> {file, name,
//                               checked: "SHA256" | "MD5" | null}; F133: with a hash (the Packages stanza's) a file
//                               that doesn't match is removed and the call fails "bad_hash: …" (../Share.swift DebChecksum)
//   share.debSimulate {file}    jailbreak: ifizbox-helper simulate-deb -> {ok, code, output, stdout, package, version}
//   share.debInstall {file, stream}  jailbreak: ifizbox-helper install-deb, streamed as helper.run -> {code, stdout,
//                               stderr}; the staged file is removed afterwards
//   share.discard {file, kind}  a staged file nobody installed (Cancel)
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

final class PhoneShareHost: ShareHost {
    var mode: ShareMode { AppMode.current == .jailbreak ? .jailbreak : .sideload }
    var prefix: String { Jailbreak.prefix }
    func exists(_ path: String) -> Bool { FileManager.default.fileExists(atPath: prefix + path) }
    var signer: ShareSigner? { mode == .sideload ? PhoneSigner() : nil }

    func helper(_ words: [String], emit: ((String, String) -> Void)?) throws -> HelperResult {
        let pass: (([[String: Any]]) -> Void)? = emit.map { e in
            { events in for ev in events { e(ev["fd"] as? String ?? "out", ev["line"] as? String ?? "") } }
        }
        do {
            let r = try Helper.run(words, emit: pass)
            return HelperResult(code: r["code"] as? Int ?? 1, out: r["stdout"] as? String ?? "",
                                err: r["stderr"] as? String ?? "", status: "")
        } catch let e as BridgeError { throw IntentFailure(e.text) }
    }

    func inspect(_ ipa: URL) -> InstalledApp? {
        (try? Inspect.ipa(ipa)).map { InstalledApp(bundleID: $0.bundleID, name: $0.name, version: $0.version) }
    }
}

// The sideload build's certificate and profile (Settings > Signing, SignStore).
struct PhoneSigner: ShareSigner {
    func problem() -> String? {
        guard let id = SignStore.identity(), let cert = SignStore.certificateDER(id), let profile = SignStore.profile() else {
            return "\(Brand.name) signs the app on this iPhone with your own certificate. Import it (.p12 and its password) and its provisioning profile (.mobileprovision) in Settings > Signing, then share the IPA again. It is in My IPAs meanwhile."
        }
        return profile.problem(with: cert).map { "\($0.message) Fix it in Settings > Signing." }
    }
}

enum SharedInbox {
    static let queue = DispatchQueue(label: "com.ryha.ifizbox.share", qos: .userInitiated)
    static let dirs = ShareDirs()

    static func receive(_ url: URL) -> Bool {
        if url.scheme?.lowercased() == "ifizbox", url.host?.lowercased() == "share" { link(url); return true }
        guard url.isFileURL else { return false }
        let host = PhoneShareHost()
        let ext = url.pathExtension.lowercased()
        // Sideload IPAs that can't be signed yet, and ones already in Documents (tapped in Files): My IPAs as before (F77).
        if host.mode == .sideload, ext == "ipa" || ext == "tipa" {
            if host.signer?.problem() != nil { return false }
            let docs = MyIPAs.library.root.standardizedFileURL.resolvingSymlinksInPath().path
            if url.standardizedFileURL.resolvingSymlinksInPath().deletingLastPathComponent().path == docs { return false }
        }
        queue.async { file(url, host) }
        return true
    }

    // A file another app handed over.
    static func file(_ url: URL, _ host: PhoneShareHost) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let head = (try? FileHandle(forReadingFrom: url)).map { h -> Data in defer { try? h.close() }; return h.readData(ofLength: 512) } ?? Data()
        let item = ShareClassifier.classify(file: url, head: head)
        let route = ShareRouter.route(item, host)
        // iOS's Documents/Inbox copy is ours: moved, or removed once handled.
        let inbox = url.deletingLastPathComponent().lastPathComponent == "Inbox"
        defer { if inbox { try? FileManager.default.removeItem(at: url) } }
        var staged: String?
        do {
            switch route {
            case .helperIPA: staged = (try ShareInbox.stage(url, kind: .ipa, dirs: dirs, move: inbox) as NSString).lastPathComponent
            case .confirmDeb: staged = (try ShareInbox.stage(url, kind: .deb, dirs: dirs, move: inbox) as NSString).lastPathComponent
            case .signIPA: staged = try MyIPAs.library.add(url, name: url.lastPathComponent, move: inbox)
            default: break
            }
        } catch {
            return hand(ShareRouter.link(.refuse(title: "Couldn't Open", message: "\(Brand.name) couldn't keep a copy of \(item.name): \(error.localizedDescription)")))
        }
        hand(ShareRouter.link(route, file: staged))
    }

    // ifizbox://share?url=<link> or ?text=<text>, from the share extension.
    static func link(_ url: URL) {
        let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let item: SharedItem
        if let s = q.first(where: { $0.name == "url" })?.value, let u = URL(string: s) { item = ShareClassifier.classify(link: u) }
        else if let t = q.first(where: { $0.name == "text" })?.value { item = ShareClassifier.classify(text: t) }
        else { item = .unknown("Nothing came with that link.") }
        hand(ShareRouter.link(ShareRouter.route(item, PhoneShareHost())))
    }

    static func hand(_ link: URL?) {
        guard let link else { return }
        DispatchQueue.main.async { Incoming.receive(link) }
    }

    // Staged files older than a day (shared, then never installed or cancelled).
    static func sweep() {
        let fm = FileManager.default
        for dir in [dirs.ipa, dirs.deb] {
            for n in (try? fm.contentsOfDirectory(atPath: dir)) ?? [] {
                let p = dir + "/" + n
                if let d = (try? fm.attributesOfItem(atPath: p))?[.modificationDate] as? Date, d < Date(timeIntervalSinceNow: -86400) {
                    try? fm.removeItem(atPath: p)
                }
            }
        }
    }
}

enum ShareBridge {
    static func register(_ b: Bridge) {
        SharedInbox.queue.async { if AppMode.current == .jailbreak { SharedInbox.sweep() } }
        b.on("share.ipaInstall") { c in
            guard let path = staged(c, .ipa) else { return }
            let emit = emitter(c)
            SharedInbox.queue.async {
                defer { try? FileManager.default.removeItem(atPath: path) }
                do {
                    let app = try ShareRun.installIPA(path, PhoneShareHost(), emit: emit)
                    Apt.reply(c, ["code": 0, "stdout": "", "stderr": "", "bundleId": app.bundleID, "name": app.name,
                                  "version": app.version], nil)
                } catch { Apt.reply(c, nil, text(error)) }
            }
        }
        b.on("share.debFetch") { c in
            guard AppMode.current == .jailbreak else { return Apt.reply(c, nil, "jailbreak: \(ShareRouter.needsJailbreak.message)") }
            guard let url = Apt.httpURL(c.params["url"]) else { return Apt.reply(c, nil, "bad_url: not an http(s) URL") }
            let name = UUID().uuidString + ".deb"
            let dest = URL(fileURLWithPath: SharedInbox.dirs.deb + "/" + name)
            do {
                try FileManager.default.createDirectory(atPath: SharedInbox.dirs.deb, withIntermediateDirectories: true,
                                                        attributes: [.posixPermissions: 0o700])
            } catch { return Apt.reply(c, nil, "internal: \(error.localizedDescription)") }
            Download.start(url, to: dest, max: ShareInbox.maxDeb, progress: { _ in }) { err in
                if let e = err { try? FileManager.default.removeItem(at: dest); return Apt.reply(c, nil, e) }
                let head = (try? FileHandle(forReadingFrom: dest)).map { h -> Data in defer { try? h.close() }; return h.readData(ofLength: 512) } ?? Data()
                guard ShareClassifier.classify(file: dest, head: head).kind == .deb else {
                    try? FileManager.default.removeItem(at: dest)
                    return Apt.reply(c, nil, "not_deb: \(url.absoluteString) didn't give a Debian package")
                }
                // F133: hashing a large .deb takes a while; off the download's callback queue.
                let sha = c.params["sha256"] as? String, md5 = c.params["md5"] as? String
                SharedInbox.queue.async {
                    if let bad = DebChecksum.check(dest, sha256: sha, md5: md5) {
                        try? FileManager.default.removeItem(at: dest)
                        return Apt.reply(c, nil, bad)
                    }
                    let kind: String? = DebChecksum.clean(sha) != nil ? "SHA256" : DebChecksum.clean(md5) != nil ? "MD5" : nil
                    let checked: Any = kind ?? NSNull()
                    Apt.reply(c, ["file": name, "name": url.lastPathComponent, "checked": checked], nil)
                }
            }
        }
        b.on("share.debSimulate") { c in
            guard let path = staged(c, .deb) else { return }
            SharedInbox.queue.async {
                do {
                    let p = try ShareRun.simulateDeb(path, PhoneShareHost())
                    var out: [String: Any] = ["ok": p.ok, "code": p.code, "output": p.output, "stdout": p.stdout]
                    if let id = p.package { out["package"] = id }
                    if let v = p.version { out["version"] = v }
                    Apt.reply(c, out, nil)
                } catch { Apt.reply(c, nil, text(error)) }
            }
        }
        b.on("share.debInstall") { c in
            guard let path = staged(c, .deb) else { return }
            let emit = emitter(c)
            SharedInbox.queue.async {
                defer { try? FileManager.default.removeItem(atPath: path) }
                do {
                    let r = try ShareRun.installDeb(path, PhoneShareHost(), emit: emit)
                    Apt.reply(c, ["code": r.code, "stdout": r.out, "stderr": r.err], nil)
                } catch { Apt.reply(c, nil, text(error)) }
            }
        }
        b.on("share.discard") { c in
            let kind: SharedItem.Kind = (c.params["kind"] as? String) == "ipa" ? .ipa : .deb
            if let n = c.params["file"] as? String, let p = ShareInbox.path(n, kind: kind, dirs: SharedInbox.dirs) {
                try? FileManager.default.removeItem(atPath: p)
            }
            Apt.reply(c, nil, nil)
        }
    }

    static func staged(_ c: Bridge.Call, _ kind: SharedItem.Kind) -> String? {
        guard AppMode.current == .jailbreak else {
            Apt.reply(c, nil, "jailbreak: \(ShareRouter.needsJailbreak.message)")
            return nil
        }
        guard let n = c.params["file"] as? String, let p = ShareInbox.path(n, kind: kind, dirs: SharedInbox.dirs),
              FileManager.default.fileExists(atPath: p) else {
            Apt.reply(c, nil, "gone: that shared file isn't there any more; share it again")
            return nil
        }
        return p
    }

    static func emitter(_ c: Bridge.Call) -> ((String, String) -> Void)? {
        guard c.params["stream"] as? Bool == true else { return nil }
        return { fd, line in c.emitOnMain([["fd": fd, "line": line]]) }
    }

    static func text(_ e: Error) -> String {
        if let f = e as? IntentFailure {
            return f.message.range(of: #"^[a-z_]+: "#, options: .regularExpression) != nil ? f.message : "install: \(f.message)"
        }
        return "internal: \(e.localizedDescription)"
    }
}
