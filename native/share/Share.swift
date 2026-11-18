// N9: what the share sheet and Open in iFizBox do with what they're handed, Foundation only, so it builds and is tested
// on Linux (native/share/test_share.py, against the fake helper and a fake signer). The phone's parts are in App/
// (the shell's side) and Extension/ (the share extension, which only turns a shared link into ifizbox://share?url=…).
//
//   ShareClassifier.classify(link:)            an http(s) link, or a repo manager's link wrapping one -> SharedItem
//   ShareClassifier.classify(file:head:)       a file (its first bytes decide, then its extension) -> SharedItem
//   ShareClassifier.classify(text:)            shared text: its first link
//   ShareRouter.route(item, host)              -> ShareRoute: what this build does with it
//                jailbreak  repo or AltStore source: Add Source's alert | .ipa: the N2 helper (AppSync Unified or ldid)
//                           | .deb: the N4 Confirm sheet (apt-get -s install ./file.deb), then the console
//                sideload   repo or source: Add Source's alert (F144: an APT manager's link is refused: jailbreak source) | .ipa: My IPAs, signed on the phone with the user's
//                           certificate and installed through the in-app server (Sideload.swift) | .deb: needs a jailbreak
//   ShareRoute.link(…)                         the ifizbox:// link the shell hands the page (web/app/share.js)
//   ShareInbox.stage(file, kind, dirs)         a copy where the helper takes it from (HELPER_IPA_DIR, HELPER_DEB_DIR)
//   ShareRun.installIPA / simulateDeb / installDeb   the helper's install-ipa, simulate-deb and install-deb, read
//
// No server of ours anywhere: a link is fetched by the phone, an IPA signed on the phone (R5, docs/sideload.md).
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum ShareMode: String { case jailbreak, sideload }

struct SharedItem: Equatable {
    enum Kind: String { case aptRepo = "repo", altSource = "source", ipa, deb, unknown }
    var kind: Kind
    var url: URL?            // the link, or the file
    var isFile = false
    var name = ""            // what to call it: the file's name, the link's last part
    var why: String? = nil   // unknown: why iFizBox can't take it
    var aptLink = false      // F144: unwrapped from an APT manager's link (cydia://, sileo://, zbra://, installer://)

    static func unknown(_ why: String, name: String = "") -> SharedItem { SharedItem(kind: .unknown, url: nil, name: name, why: why) }
}

// ---- classifying

enum ShareClassifier {
    static let maxText = 64 * 1024

    // A shared link. Repo managers' own links are unwrapped first: cydia://url/<url>, sileo://source/<url>,
    // zbra://sources/add/<url>, installer://add/<url> (APT repos), altstore://source?url=<url>,
    // sidestore://source?url=<url>, feather://source/<url> (app sources).
    static func classify(link: URL) -> SharedItem {
        var url = link
        var forced: SharedItem.Kind?
        if let (inner, kind) = unwrap(link) { url = inner; forced = kind }
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host, !host.isEmpty else {
            if link.scheme?.lowercased() == "itms-services" {
                return .unknown("That's an install link for iOS itself (itms-services). Open it in Safari, or share the .ipa's own link with \(Brand.name).")
            }
            return .unknown("\(Brand.name) takes http and https links, .ipa and .deb files, APT repos and app sources.",
                            name: link.absoluteString)
        }
        let name = url.lastPathComponent.removingPercentEncoding ?? url.lastPathComponent
        if let forced { return SharedItem(kind: forced, url: url, name: host, aptLink: forced == .aptRepo) }
        switch url.pathExtension.lowercased() {
        case "ipa", "tipa": return SharedItem(kind: .ipa, url: url, name: name)
        case "deb": return SharedItem(kind: .deb, url: url, name: name)
        case "json": return SharedItem(kind: .altSource, url: url, name: host)
        default:
            // Anything else is offered as an APT repo, as Cydia's Add Source takes any URL: the alert shows it and
            // Verifying URL says when there's no repo there (an AltStore source without .json is found the same way).
            return SharedItem(kind: .aptRepo, url: url, name: host)
        }
    }

    static func unwrap(_ link: URL) -> (URL, SharedItem.Kind)? {
        guard let scheme = link.scheme?.lowercased() else { return nil }
        let s = link.absoluteString
        func after(_ prefix: String) -> URL? {
            guard s.lowercased().hasPrefix(prefix) else { return nil }
            let rest = String(s.dropFirst(prefix.count))
            let decoded = rest.lowercased().hasPrefix("http") ? rest : (rest.removingPercentEncoding ?? rest)
            return URL(string: decoded)
        }
        func query() -> URL? {
            URLComponents(url: link, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "url" }?.value.flatMap(URL.init(string:))
        }
        switch scheme {
        case "cydia": return after("cydia://url/").map { ($0, .aptRepo) }
        case "sileo": return after("sileo://source/").map { ($0, .aptRepo) }
        case "zbra": return after("zbra://sources/add/").map { ($0, .aptRepo) }
        case "installer": return after("installer://add/").map { ($0, .aptRepo) }
        case "altstore", "sidestore": return query().map { ($0, .altSource) }
        case "feather": return (after("feather://source/") ?? query()).map { ($0, .altSource) }
        default: return nil
        }
    }

    // Shared text (Notes, Messages): the first link in it.
    static func classify(text: String) -> SharedItem {
        let t = String(text.prefix(maxText))
        for word in t.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" || $0 == "\r" || $0 == "<" || $0 == ">" || $0 == "\"" }) {
            var w = String(word)
            while let last = w.last, ".,;)]".contains(last) { w.removeLast() }
            guard w.contains("://"), let u = URL(string: w), u.scheme != nil else { continue }
            return classify(link: u)
        }
        return .unknown("There's no link in what was shared.")
    }

    // A file another app handed over. Its first bytes decide (a .deb is an ar archive, an IPA a zip whose first
    // entry is under Payload/), then its extension.
    static func classify(file: URL, head: Data) -> SharedItem {
        let name = file.lastPathComponent
        let ext = file.pathExtension.lowercased()
        let b = [UInt8](head.prefix(512))
        func item(_ k: SharedItem.Kind) -> SharedItem { SharedItem(kind: k, url: file, isFile: true, name: name) }
        if b.starts(with: Array("!<arch>\n".utf8)) {
            return ext == "deb" || String(decoding: b, as: UTF8.self).contains("debian-binary") ? item(.deb)
                : .unknown("That's an ar archive but not a Debian package.", name: name)
        }
        if b.starts(with: [0x50, 0x4B, 0x03, 0x04]) {
            if ext == "ipa" || ext == "tipa" || zipFirstName(b).hasPrefix("Payload/") { return item(.ipa) }
            return .unknown("That's a zip file, not an IPA (an IPA holds Payload/<App>.app).", name: name)
        }
        if ext == "json" || b.first(where: { ![0x20, 0x09, 0x0A, 0x0D, 0xEF, 0xBB, 0xBF].contains($0) }) == UInt8(ascii: "{") {
            return .unknown("That's a file, not a link. Add an app source by its link (https://…/apps.json) so \(Brand.name) can check it for updates.", name: name)
        }
        if ext == "deb" { return .unknown("That file is named .deb but isn't a Debian package.", name: name) }
        if ext == "ipa" { return .unknown("That file is named .ipa but isn't an IPA (not a zip).", name: name) }
        return .unknown("\(Brand.name) opens .ipa and .deb files, and links to APT repos and app sources.", name: name)
    }

    // The first entry's name in a zip's local file header.
    static func zipFirstName(_ b: [UInt8]) -> String {
        guard b.count >= 30 else { return "" }
        let n = Int(b[26]) | Int(b[27]) << 8
        guard n > 0, b.count >= 30 + n else { return "" }
        return String(decoding: b[30..<30 + n], as: UTF8.self)
    }
}

// ---- routing

// What the phone tells the router: the mode, whether the jailbreak can install an IPA, whether signing is set up.
protocol ShareSigner {
    // nil when the user's certificate (.p12) and profile (.mobileprovision) are imported and fit together; else
    // what's missing, said to the user.
    func problem() -> String?
}

enum AppInstaller: String { case appSync, ldid, none }

protocol ShareHost {
    var mode: ShareMode { get }
    var prefix: String { get }
    func exists(_ path: String) -> Bool     // a file under the prefix
    var signer: ShareSigner? { get }
    func helper(_ words: [String], emit: ((String, String) -> Void)?) throws -> HelperResult // fd ("out"|"err"|"status"), line
    func inspect(_ ipa: URL) -> InstalledApp? // the IPA's own bundle ID, name and version
}

extension ShareHost {
    // As native/helper/ipa.c looks for them: AppSync Unified's installd dylib, else ldid to sign ad hoc.
    var appInstaller: AppInstaller {
        if exists("/Library/MobileSubstrate/DynamicLibraries/AppSyncUnified-installd.dylib") ||
            exists("/usr/lib/TweakInject/AppSyncUnified-installd.dylib") { return .appSync }
        return exists("/usr/bin/ldid") ? .ldid : .none
    }
}

enum ShareRoute: Equatable {
    case addSource(URL)                         // both modes: Add Source's alert, filled in
    case helperIPA(SharedItem)                  // jailbreak: ifizbox-helper install-ipa
    case signIPA(SharedItem)                    // sideload: My IPAs, signed on the phone, installed through Sideload
    case confirmDeb(SharedItem)                 // jailbreak: Confirm sheet (simulate-deb), console (install-deb)
    case refuse(title: String, message: String)

    var name: String {
        switch self {
        case .addSource: return "add"
        case .helperIPA: return "helper-ipa"
        case .signIPA: return "sign-ipa"
        case .confirmDeb: return "deb"
        case .refuse: return "refuse"
        }
    }
}

enum ShareRouter {
    static let needsJailbreak = (title: "Needs a Jailbreak",
                                 message: "A .deb is a jailbreak package: installing it needs a jailbroken iPhone and \(Brand.name)'s jailbreak build. This is the sideloaded \(Brand.name), which can install IPAs but not .debs.")
    static let noInstaller = (title: "Can't Install IPAs",
                              message: "Installing an IPA on this jailbreak needs AppSync Unified (or ldid, to sign it ad hoc). Install AppSync Unified from its repo, then share the IPA with \(Brand.name) again.")

    // F144: the sideload build keeps no APT sources. A link only an APT manager opens is refused here, with the words
    // the page's Add uses (web/app/core/altstore.js JAILBREAK_SOURCE_TITLE/MESSAGE); a bare https link may still be an
    // app source, so it goes to Add, which checks it and refuses an APT repo the same way.
    static let jailbreakSource = (title: "Jailbreak Source",
                                  message: "This source lists tweaks for jailbroken iPhones. \(Brand.name) adds app sources here.")

    static func route(_ item: SharedItem, _ host: ShareHost) -> ShareRoute {
        switch item.kind {
        case .aptRepo where item.aptLink && host.mode == .sideload:
            return .refuse(title: jailbreakSource.title, message: jailbreakSource.message)
        case .aptRepo, .altSource:
            guard let u = item.url, let link = try? IntentsCore.addSourceLink(u) else {
                return .refuse(title: "Can't Add Source", message: "That link can't be added as a source.")
            }
            return .addSource(link)
        case .ipa:
            switch host.mode {
            case .jailbreak:
                if host.appInstaller == .none { return .refuse(title: noInstaller.title, message: noInstaller.message) }
                return .helperIPA(item)
            case .sideload:
                guard host.signer != nil else {
                    return .refuse(title: "Can't Sign", message: "This \(Brand.name) can't sign apps on the phone.")
                }
                // B39: always into My IPAs and its page, certificate or not. The page and its Install decide with
                // signing.status, the rule Settings > Signing shows (web/app/signing-client.js statusReady); a check
                // of its own here (signer.problem: the profile too, and its dates) refused an IPA, and dropped the
                // file, while Signing showed the certificate as set up.
                return .signIPA(item)
            }
        case .deb:
            guard host.mode == .jailbreak else { return .refuse(title: needsJailbreak.title, message: needsJailbreak.message) }
            return .confirmDeb(item)
        case .unknown:
            return .refuse(title: "Can't Open This", message: item.why ?? "\(Brand.name) can't open that.")
        }
    }

    // The link the shell hands the page (web/app/share.js): ifizbox://add?url=… for sources (N8's, the Add Source
    // alert), else ifizbox://shared?route=<name>&… with `file` (a staged file's name: the helper's directory, or My
    // IPAs), `url` (a link the page downloads through the shell), `name`, and for refuse `title` and `message`.
    static func link(_ route: ShareRoute, file: String? = nil) -> URL? {
        var q = [URLQueryItem(name: "route", value: route.name)]
        func add(_ item: SharedItem) {
            if let file { q.append(URLQueryItem(name: "file", value: file)) }
            else if let u = item.url, !item.isFile { q.append(URLQueryItem(name: "url", value: u.absoluteString)) }
            if !item.name.isEmpty { q.append(URLQueryItem(name: "name", value: String(item.name.prefix(200)))) }
        }
        switch route {
        case .addSource(let u): return u
        case .helperIPA(let i), .signIPA(let i), .confirmDeb(let i): add(i)
        case .refuse(let t, let m):
            q.append(URLQueryItem(name: "title", value: t))
            q.append(URLQueryItem(name: "message", value: String(m.prefix(1000))))
        }
        var c = URLComponents()
        c.scheme = "ifizbox"
        c.host = "shared"
        c.queryItems = q
        // URLComponents leaves + alone; the page's URLSearchParams would read it as a space.
        c.percentEncodedQuery = c.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        return c.url
    }
}

// ---- staging

// Where a shared file goes before the helper sees it: a fresh copy, owned by the app's user, one link, a name the
// helper takes ([A-Za-z0-9][A-Za-z0-9._-]*.ipa|.deb). The jailbreak app is no-container, so these are mobile's own
// Caches (native/helper/policy.h HELPER_IPA_DIR, HELPER_DEB_DIR); the tests use their own.
struct ShareDirs {
    var ipa = "/var/mobile/Library/Caches/com.ryha.ifizbox/ipa"
    var deb = "/var/mobile/Library/Caches/com.ryha.ifizbox/deb"
}

enum ShareInbox {
    static let maxDeb: Int64 = 1 << 30
    static let maxIPA: Int64 = 8 << 30

    // Copy (or move, for iOS's Inbox copy) `file` into the helper's directory for its kind. -> the staged path.
    static func stage(_ file: URL, kind: SharedItem.Kind, dirs: ShareDirs = ShareDirs(), move: Bool = false,
                      token: String = UUID().uuidString) throws -> String {
        let fm = FileManager.default
        let (dir, ext, max): (String, String, Int64)
        switch kind {
        case .ipa: (dir, ext, max) = (dirs.ipa, "ipa", maxIPA)
        case .deb: (dir, ext, max) = (dirs.deb, "deb", maxDeb)
        default: throw IntentFailure("Only .ipa and .deb files are staged.")
        }
        let attrs = try? fm.attributesOfItem(atPath: file.path)
        let size = (attrs?[.size] as? NSNumber)?.int64Value ?? 0
        guard size > 0 else { throw IntentFailure("That file is empty.") }
        guard size <= max else { throw IntentFailure("That file is too big.") }
        try fm.createDirectory(atPath: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let safe = token.filter { $0.isLetter || $0.isNumber || $0 == "-" }
        let out = dir + "/" + (safe.isEmpty ? "shared" : safe) + "." + ext
        try? fm.removeItem(atPath: out)
        if move { do { try fm.moveItem(atPath: file.path, toPath: out); return out } catch { /* copy below */ } }
        try fm.copyItem(atPath: file.path, toPath: out)
        return out
    }

    // A staged file's name, back to its path: only a plain name in that directory.
    static func path(_ name: String, kind: SharedItem.Kind, dirs: ShareDirs = ShareDirs()) -> String? {
        let ext = kind == .ipa ? ".ipa" : kind == .deb ? ".deb" : nil
        guard let ext, name.hasSuffix(ext), name.count <= 255, !name.contains("/"), !name.hasPrefix("."), !name.contains(".."),
              name.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || "._-".contains($0)) }) else { return nil }
        return (kind == .ipa ? dirs.ipa : dirs.deb) + "/" + name
    }
}

// ---- running the helper

// What I3 remembers about an installed app, so a source listing a newer version shows it as an update.
struct InstalledApp: Equatable {
    var bundleID: String
    var name: String
    var version: String
}

struct DebPlan: Equatable {
    var ok: Bool
    var code: Int
    var output: String      // apt's stdout then stderr, for the Confirm sheet's raw output
    var stdout: String
    var package: String?    // the shared .deb's own package and version, from apt's plan
    var version: String?
}

enum ShareRun {
    // jailbreak: ifizbox-helper install-ipa <staged>. The result is what to record for I3 (the IPA's own Info.plist,
    // the bundle ID the helper installed).
    static func installIPA(_ path: String, _ host: ShareHost, emit: ((String, String) -> Void)? = nil) throws -> InstalledApp {
        guard host.mode == .jailbreak else { throw IntentFailure.needsJailbreak }
        let info = host.inspect(URL(fileURLWithPath: path))
        let r = try host.helper(["install-ipa", path], emit: emit)
        guard r.code == 0 else { throw IntentFailure(ipaError(r)) }
        let id = r.out.split(separator: "\n").last { $0.hasPrefix("Installed ") }.map { String($0.dropFirst(10)) }
            ?? info?.bundleID ?? ""
        return InstalledApp(bundleID: id, name: info?.name ?? id, version: info?.version ?? "")
    }

    // ipa.install's error kinds (Apt.swift IPAInstall), so the page explains them the same way.
    static func ipaError(_ r: HelperResult) -> String {
        let why = r.err.split(separator: "\n").last { $0.hasPrefix("ifizbox-helper: ") }.map { String($0.dropFirst(16)) }
            ?? "ifizbox-helper exited with \(r.code)"
        let kind = r.code == 64 ? "bad_ipa" : r.code == 69 ? "no_adhoc" : r.code == 77 ? "helper" : "install"
        return "\(kind): \(why)"
    }

    static func simulateDeb(_ path: String, _ host: ShareHost) throws -> DebPlan {
        guard host.mode == .jailbreak else { throw IntentFailure(ShareRouter.needsJailbreak.message) }
        let r = try host.helper(["simulate-deb", path], emit: nil)
        if [64, 77, 126].contains(r.code) { throw IntentFailure("helper: \(IntentsCore.lastError(r))") }
        let output = [r.out, r.err].filter { !$0.isEmpty }.joined(separator: r.out.hasSuffix("\n") ? "" : "\n")
        let own = ownPackage(r.out)
        return DebPlan(ok: r.code == 0, code: r.code, output: output, stdout: r.out, package: own?.0, version: own?.1)
    }

    static func installDeb(_ path: String, _ host: ShareHost, emit: ((String, String) -> Void)? = nil) throws -> HelperResult {
        guard host.mode == .jailbreak else { throw IntentFailure(ShareRouter.needsJailbreak.message) }
        let r = try host.helper(["install-deb", path], emit: emit)
        if [64, 77, 126].contains(r.code) { throw IntentFailure("helper: \(IntentsCore.lastError(r))") }
        return r
    }

    // apt names the file's package in "Note, selecting '<pkg>' instead of '<file>'", and its Inst line says
    // "(<version> local-deb [arch])" (apt 1.1+; older apt says "(<version> [arch])" with no origin).
    static func ownPackage(_ out: String) -> (String, String)? {
        var pkg: String?
        for line in out.split(separator: "\n") where line.hasPrefix("Note, selecting '") {
            let rest = line.dropFirst(17)
            if let q = rest.firstIndex(of: "'"), rest[q...].contains("instead of '") { pkg = String(rest[..<q]) }
        }
        for line in out.split(separator: "\n") where line.hasPrefix("Inst ") {
            let w = line.dropFirst(5).split(separator: " ")
            guard let id = w.first, pkg == nil || String(id) == pkg else { continue }
            guard let open = line.firstIndex(of: "(") else { continue }
            let inner = line[line.index(after: open)...].split(separator: " ")
            guard let v = inner.first else { continue }
            if pkg != nil || line.contains(" local-deb") { return (String(id), String(v)) }
        }
        return nil
    }
}

// ---- F133: checking a downloaded .deb against its Packages stanza

// F131's links (a Filename that is a full URL) are downloaded by the shell, not apt, so apt's hash check never runs
// on them. share.debFetch takes the stanza's SHA256 (or, when a repo gives none, its MD5sum) and this checks the
// file: nil when it matches (or no hash was given), else the sentence for the Cannot Comply sheet. SHA256 is
// sign/Hash.swift's (CommonCrypto on the phone); MD5 is below, plain Swift (CC_MD5 is deprecated on iOS 13+).
enum DebChecksum {
    static func check(_ file: URL, sha256 want256: String?, md5 wantMD5: String?) -> String? {
        let w256 = clean(want256), wMD5 = clean(wantMD5)
        let (kind, want): (String, String)
        if let w = w256 { (kind, want) = ("SHA256", w) } else if let w = wMD5 { (kind, want) = ("MD5", w) } else { return nil }
        guard want.count == (kind == "SHA256" ? 64 : 32), want.allSatisfy(\.isHexDigit) else {
            return "bad_hash: its source lists a \(kind) that isn't one (\(want.prefix(80)))"
        }
        guard let h = try? FileHandle(forReadingFrom: file) else { return "bad_hash: the download couldn't be read" }
        defer { try? h.close() }
        var s256 = SHA256(), m = MD5()
        while true {
            let d = h.readData(ofLength: 1 << 20)
            if d.isEmpty { break }
            if kind == "SHA256" { s256.update(d) } else { m.update(d) }
        }
        let got = hex(kind == "SHA256" ? s256.final() : m.final())
        return got == want ? nil : "bad_hash: the download's \(kind) is \(got), not the \(want) its source lists"
    }

    static func clean(_ s: String?) -> String? {
        let t = (s ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return t.isEmpty ? nil : t
    }

    static func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }
}

// RFC 1321 MD5, streamed: update() with pieces, then final(). Only for repos whose stanzas have no SHA256.
struct MD5 {
    private var h: [UInt32] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]
    private var buf = [UInt8]()
    private var len: UInt64 = 0
    private static let s: [UInt32] = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
                                      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
                                      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
                                      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21]
    private static let k: [UInt32] = (0..<64).map { UInt32(truncatingIfNeeded: Int64(abs(sin(Double($0 + 1))) * 4294967296.0)) }

    mutating func update(_ d: Data) {
        len &+= UInt64(d.count)
        buf.append(contentsOf: d)
        var i = 0
        while buf.count - i >= 64 { block(buf, i); i += 64 }
        if i > 0 { buf.removeFirst(i) }
    }

    mutating func final() -> Data {
        let bits = len &* 8
        var tail: [UInt8] = [0x80]
        while (buf.count + tail.count) % 64 != 56 { tail.append(0) }
        for i in 0..<8 { tail.append(UInt8(truncatingIfNeeded: bits >> (8 * UInt64(i)))) }
        buf.append(contentsOf: tail)
        var i = 0
        while i < buf.count { block(buf, i); i += 64 }
        buf = []
        var out = Data()
        for v in h { for j in 0..<4 { out.append(UInt8(truncatingIfNeeded: v >> (8 * UInt32(j)))) } }
        return out
    }

    private mutating func block(_ b: [UInt8], _ o: Int) {
        var m = [UInt32](repeating: 0, count: 16)
        for i in 0..<16 {
            m[i] = UInt32(b[o + 4 * i]) | UInt32(b[o + 4 * i + 1]) << 8 | UInt32(b[o + 4 * i + 2]) << 16 | UInt32(b[o + 4 * i + 3]) << 24
        }
        var a = h[0], bb = h[1], c = h[2], d = h[3]
        for i in 0..<64 {
            var f: UInt32, g: Int
            switch i {
            case 0..<16: f = (bb & c) | (~bb & d); g = i
            case 16..<32: f = (d & bb) | (~d & c); g = (5 * i + 1) % 16
            case 32..<48: f = bb ^ c ^ d; g = (3 * i + 5) % 16
            default: f = c ^ (bb | ~d); g = (7 * i) % 16
            }
            f = f &+ a &+ MD5.k[i] &+ m[g]
            a = d; d = c; c = bb
            bb = bb &+ ((f << MD5.s[i]) | (f >> (32 - MD5.s[i])))
        }
        h[0] &+= a; h[1] &+= bb; h[2] &+= c; h[3] &+= d
    }
}
