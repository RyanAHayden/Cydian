// Swift tests for N9's share sheet and Open in Cydian (native/share/Share.swift), run on Linux by
// native/share/test_share.py against the fake helper (native/fake/cydian-helper) over a copy of
// native/fake/fixture/prefix, and a fake signer:
//   sharetest <fake helper> <fixture prefix> <fake remote> <files dir>
// <files dir> holds what test_share.py made: Demo.ipa (a zip with Payload/Demo.app/Info.plist), Tweak.deb (a fake
// .deb: "!<arch>" then a control stanza, as the fake helper reads one), Bad.deb (unmet dependency), Archive.zip,
// apps.json, notes.txt, Payload.bin (an IPA without the extension). Prints "ok   <name>" per test, "all passed".
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

var failures = 0
var current = ""
func check(_ ok: Bool, _ what: @autoclosure () -> String, line: Int = #line) {
    if !ok { failures += 1; print("FAIL \(current) (line \(line)): \(what())") }
}
func test(_ name: String, _ body: () throws -> Void) {
    current = name
    let before = failures
    do { try body() } catch { failures += 1; print("FAIL \(name): threw \(error)") }
    print(failures == before ? "ok   \(name)" : "FAIL \(name)")
}

let args = CommandLine.arguments
guard args.count == 5 else { print("usage: sharetest <fake helper> <fixture prefix> <fake remote> <files dir>"); exit(2) }
let helperPath = args[1], fixture = args[2], remote = args[3], files = args[4]
let fm = FileManager.default

struct FakeSigner: ShareSigner {
    var why: String?
    func problem() -> String? { why }
}

final class FakeHost: ShareHost {
    let mode: ShareMode
    let prefix: String
    let dirs: ShareDirs
    var signer: ShareSigner?
    var env: [String: String] = [:]
    var log: [[String]] = []
    var inspected: InstalledApp?
    var events: [(String, String)] = []

    init(_ mode: ShareMode, signer: ShareSigner? = FakeSigner(why: nil)) throws {
        self.mode = mode
        self.signer = signer
        let dir = NSTemporaryDirectory() + "share-" + UUID().uuidString
        try fm.copyItem(atPath: fixture, toPath: dir)
        prefix = dir
        dirs = ShareDirs(ipa: dir + "/stage/ipa", deb: dir + "/stage/deb")
    }

    deinit { try? fm.removeItem(atPath: prefix) }

    func exists(_ path: String) -> Bool { fm.fileExists(atPath: prefix + path) }
    func put(_ path: String) throws {
        try fm.createDirectory(atPath: (prefix + path as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
        fm.createFile(atPath: prefix + path, contents: Data("x".utf8))
    }
    func inspect(_ ipa: URL) -> InstalledApp? { inspected }

    func helper(_ words: [String], emit: ((String, String) -> Void)?) throws -> HelperResult {
        log.append(words)
        let status = prefix + "/.status-fd"
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = ["-c", "exec \"$0\" \"$@\" 3>\"$STATUS_FILE\"", helperPath] + words
        var e = ProcessInfo.processInfo.environment
        e["CYDIAN_PREFIX"] = prefix
        e["FAKE_REMOTE"] = remote
        e["STATUS_FILE"] = status
        e["CYDIAN_IPA_DIR"] = dirs.ipa
        e["CYDIAN_DEB_DIR"] = dirs.deb
        for (k, v) in env { e[k] = v }
        p.environment = e
        let out = Pipe(), err = Pipe()
        p.standardOutput = out
        p.standardError = err
        try p.run()
        let o = out.fileHandleForReading.readDataToEndOfFile()
        let r = err.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        let st = (try? String(contentsOfFile: status, encoding: .utf8)) ?? ""
        for l in st.split(separator: "\n") { emit?("status", String(l)); events.append(("status", String(l))) }
        return HelperResult(code: Int(p.terminationStatus), out: String(decoding: o, as: UTF8.self),
                            err: String(decoding: r, as: UTF8.self), status: st)
    }

    func read(_ path: String) -> String? { try? String(contentsOfFile: prefix + path, encoding: .utf8) }
}

func file(_ name: String) -> URL { URL(fileURLWithPath: files + "/" + name) }
func head(_ name: String) -> Data { (try? Data(contentsOf: file(name)))?.prefix(512) ?? Data() }
func classifyFile(_ name: String) -> SharedItem { ShareClassifier.classify(file: file(name), head: head(name)) }
func query(_ u: URL?) -> [String: String] {
    var out = [String: String]()
    for i in URLComponents(url: u!, resolvingAgainstBaseURL: false)?.queryItems ?? [] { out[i.name] = i.value ?? "" }
    return out
}

// ---- classifying

test("classify links: repo, AltStore source, ipa, deb, unknown") {
    let c = { (s: String) in ShareClassifier.classify(link: URL(string: s)!) }
    check(c("https://repo.chariz.com/").kind == .aptRepo, "repo")
    check(c("https://havoc.app").kind == .aptRepo, "repo without a slash")
    check(c("https://apt.procurs.us/dists/1800/").kind == .aptRepo, "dist path")
    check(c("https://cdn.altstore.io/file/altstore/apps.json").kind == .altSource, "AltStore source")
    check(c("https://example.com/Source.JSON?x=1").kind == .altSource, "json, any case, query")
    let ipa = c("https://github.com/x/y/releases/download/v1/My%20App.ipa")
    check(ipa.kind == .ipa && ipa.name == "My App.ipa" && !ipa.isFile, "ipa: \(ipa)")
    check(c("https://example.com/Game.tipa").kind == .ipa, "tipa")
    let deb = c("https://example.com/debs/com.foo_1.0_iphoneos-arm64.deb")
    check(deb.kind == .deb && deb.name == "com.foo_1.0_iphoneos-arm64.deb", "deb: \(deb)")
    check(c("ftp://example.com/a.deb").kind == .unknown, "ftp")
    check(c("mailto:someone@example.com").kind == .unknown, "mailto")
    let itms = c("itms-services://?action=download-manifest&url=https://x/m.plist")
    check(itms.kind == .unknown && itms.why!.contains("itms-services"), "itms-services: \(itms)")
}

test("classify repo managers' links") {
    let c = { (s: String) in ShareClassifier.classify(link: URL(string: s)!) }
    let cy = c("cydia://url/https://cydia.akemi.ai/")
    check(cy.kind == .aptRepo && cy.url?.absoluteString == "https://cydia.akemi.ai/", "cydia: \(cy)")
    check(c("sileo://source/https://havoc.app/").url?.absoluteString == "https://havoc.app/", "sileo")
    check(c("zbra://sources/add/https://repo.chariz.com/").kind == .aptRepo, "zebra")
    check(c("installer://add/https://repo.example/").kind == .aptRepo, "installer")
    let alt = c("altstore://source?url=https://example.com/apps.json")
    check(alt.kind == .altSource && alt.url?.absoluteString == "https://example.com/apps.json", "altstore: \(alt)")
    check(c("sidestore://source?url=https%3A%2F%2Fexample.com%2Fsrc").kind == .altSource, "sidestore, encoded, no .json")
    check(c("sileo://source/javascript:alert(1)").kind == .unknown, "a wrapped non-http link")
    check(c("sileo://package/com.foo").kind == .unknown, "sileo package link isn't a source")
}

test("classify shared text") {
    check(ShareClassifier.classify(text: "add this: https://repo.chariz.com/, thanks").url?.absoluteString == "https://repo.chariz.com/", "trailing comma")
    check(ShareClassifier.classify(text: "<https://x.test/a.ipa>").kind == .ipa, "angle brackets")
    check(ShareClassifier.classify(text: "no links here").kind == .unknown, "none")
}

test("classify files by their bytes, then their name") {
    check(classifyFile("Demo.ipa").kind == .ipa, "ipa")
    check(classifyFile("Payload.bin").kind == .ipa, "ipa without the extension (first entry Payload/)")
    let deb = classifyFile("Tweak.deb")
    check(deb.kind == .deb && deb.isFile && deb.name == "Tweak.deb", "deb: \(deb)")
    check(classifyFile("Archive.zip").kind == .unknown, "zip")
    let json = classifyFile("apps.json")
    check(json.kind == .unknown && json.why!.contains("link"), "a source file: \(json)")
    check(classifyFile("notes.txt").kind == .unknown, "text")
    check(classifyFile("fake.deb").kind == .unknown, "named .deb, isn't one")
    check(classifyFile("fake.ipa").kind == .unknown, "named .ipa, isn't one")
}

// ---- routing, each mode

test("route: sources open Add Source in both modes") {
    for mode in [ShareMode.jailbreak, .sideload] {
        let host = try FakeHost(mode)
        for s in ["https://repo.chariz.com/", "https://example.com/apps.json", "altstore://source?url=https://e.x/a.json"] {
            let r = ShareRouter.route(ShareClassifier.classify(link: URL(string: s)!), host)
            guard case .addSource(let u) = r else { check(false, "\(mode) \(s): \(r)"); continue }
            check(u.scheme == "cydian" && u.host == "add", "\(u)")
            check(ShareRouter.link(r) == u, "the link is N8's cydian://add")
        }
        let r = ShareRouter.route(ShareClassifier.classify(link: URL(string: "https://e.x/a+b/")!), host)
        check(query(ShareRouter.link(r))["url"] == "https://e.x/a+b/", "a + survives: \(String(describing: ShareRouter.link(r)))")
    }
}

test("F144: an APT manager's link is refused in sideload mode, Add Source in jailbreak mode") {
    for s in ["cydia://url/https://repo.chariz.com/", "sileo://source/https://havoc.app/", "zbra://sources/add/https://repo.chariz.com/",
              "installer://add/https://repo.example/"] {
        let item = ShareClassifier.classify(link: URL(string: s)!)
        check(item.aptLink, "\(s): aptLink")
        let r = ShareRouter.route(item, try FakeHost(.sideload))
        guard case .refuse(let t, let m) = r else { check(false, "sideload \(s): \(r)"); continue }
        check(t == "Jailbreak Source" && !m.lowercased().contains("hidden") && !m.contains("Settings"), "\(t): \(m)")
        guard case .addSource = ShareRouter.route(item, try FakeHost(.jailbreak)) else { check(false, "jailbreak \(s)"); continue }
    }
    // a bare https link may be an app source without .json: Add checks it
    guard case .addSource = ShareRouter.route(ShareClassifier.classify(link: URL(string: "https://repo.chariz.com/")!), try FakeHost(.sideload)) else {
        return check(false, "bare https link, sideload")
    }
}

test("route: ipa in jailbreak mode needs AppSync Unified or ldid") {
    let host = try FakeHost(.jailbreak)
    let item = classifyFile("Demo.ipa")
    guard case .refuse(let t, let m) = ShareRouter.route(item, host) else { return check(false, "no installer: refused") }
    check(t == "Can't Install IPAs" && m.contains("AppSync Unified"), "\(t): \(m)")
    try host.put("/usr/bin/ldid")
    check(ShareRouter.route(item, host) == .helperIPA(item), "ldid")
    let h2 = try FakeHost(.jailbreak)
    try h2.put("/usr/lib/TweakInject/AppSyncUnified-installd.dylib")
    check(h2.appInstaller == .appSync, "AppSync (rootless TweakInject)")
    check(ShareRouter.route(item, h2) == .helperIPA(item), "AppSync")
    let link = ShareRouter.link(.helperIPA(item), file: "ABC.ipa")
    check(link?.host == "shared" && query(link) == ["route": "helper-ipa", "file": "ABC.ipa", "name": "Demo.ipa"], "\(String(describing: link))")
    let remote = ShareClassifier.classify(link: URL(string: "https://e.x/App.ipa")!)
    check(query(ShareRouter.link(ShareRouter.route(remote, h2))) == ["route": "helper-ipa", "url": "https://e.x/App.ipa", "name": "App.ipa"], "remote ipa")
}

test("route: ipa in sideload mode is signed with the user's certificate (fake signer)") {
    let item = classifyFile("Demo.ipa")
    let ready = try FakeHost(.sideload)
    check(ShareRouter.route(item, ready) == .signIPA(item), "ready")
    let none = try FakeHost(.sideload, signer: FakeSigner(why: "Import your certificate (.p12) and its profile (.mobileprovision) in Settings > Signing first."))
    guard case .refuse(let t, let m) = ShareRouter.route(item, none) else { return check(false, "no certificate: refused") }
    check(t == "Import Your Certificate" && m.contains(".p12"), "\(t): \(m)")
    let expired = try FakeHost(.sideload, signer: FakeSigner(why: "Your certificate expired on 2026-11-01."))
    guard case .refuse(_, let m2) = ShareRouter.route(item, expired) else { return check(false, "expired: refused") }
    check(m2.contains("expired"), m2)
    let noSigner = try FakeHost(.sideload, signer: nil)
    guard case .refuse = ShareRouter.route(item, noSigner) else { return check(false, "no signer: refused") }
    // AppSync on disk means nothing in sideload mode
    try ready.put("/usr/lib/TweakInject/AppSyncUnified-installd.dylib")
    check(ShareRouter.route(item, ready) == .signIPA(item), "sideload ignores AppSync")
}

test("route: deb is the Confirm sheet in jailbreak mode, needs a jailbreak in sideload mode") {
    let item = classifyFile("Tweak.deb")
    check(ShareRouter.route(item, try FakeHost(.jailbreak)) == .confirmDeb(item), "jailbreak")
    let r = ShareRouter.route(item, try FakeHost(.sideload))
    guard case .refuse(let t, let m) = r else { return check(false, "sideload: refused") }
    check(t == "Needs a Jailbreak" && m.contains("jailbr"), "\(t): \(m)")
    let q = query(ShareRouter.link(r))
    check(q["route"] == "refuse" && q["title"] == t && q["message"] == m, "\(q)")
    let remote = ShareClassifier.classify(link: URL(string: "https://e.x/a.deb")!)
    guard case .refuse = ShareRouter.route(remote, try FakeHost(.sideload)) else { return check(false, "remote deb, sideload") }
}

test("route: unknown says why") {
    let r = ShareRouter.route(classifyFile("Archive.zip"), try FakeHost(.jailbreak))
    guard case .refuse(let t, let m) = r else { return check(false, "\(r)") }
    check(t == "Can't Open This" && m.contains("zip"), m)
}

// ---- staging and running (fake helper)

test("stage: a fresh copy with a name the helper takes") {
    let host = try FakeHost(.jailbreak)
    let p = try ShareInbox.stage(file("Demo.ipa"), kind: .ipa, dirs: host.dirs, token: "T-1/../x")
    check(p == host.dirs.ipa + "/T-1x.ipa", p)
    check(fm.fileExists(atPath: file("Demo.ipa").path), "a copy, the original stays")
    check(ShareInbox.path("T-1x.ipa", kind: .ipa, dirs: host.dirs) == p, "path back")
    for bad in ["../x.ipa", "a/b.ipa", ".x.ipa", "x.deb", "x y.ipa", "x..ipa"] {
        check(ShareInbox.path(bad, kind: .ipa, dirs: host.dirs) == nil, "refused: \(bad)")
    }
    let empty = host.prefix + "/empty.deb"
    fm.createFile(atPath: empty, contents: Data())
    check((try? ShareInbox.stage(URL(fileURLWithPath: empty), kind: .deb, dirs: host.dirs)) == nil, "empty refused")
    check((try? ShareInbox.stage(file("notes.txt"), kind: .unknown, dirs: host.dirs)) == nil, "unknown isn't staged")
}

test("jailbreak ipa: install-ipa through the helper, version for I3") {
    let host = try FakeHost(.jailbreak)
    host.env["FAKE_APPSYNC"] = "1"
    host.inspected = InstalledApp(bundleID: "dev.cydian.demo", name: "Demo", version: "2.1")
    let path = try ShareInbox.stage(file("Demo.ipa"), kind: .ipa, dirs: host.dirs)
    var statuses = [String]()
    let app = try ShareRun.installIPA(path, host) { fd, l in if fd == "status" { statuses.append(l) } }
    check(app == InstalledApp(bundleID: "dev.cydian.demo", name: "Demo", version: "2.1"), "\(app)")
    check(host.log == [["install-ipa", path]], "\(host.log)")
    check(statuses.contains { $0.hasPrefix("pmstatus:dev.cydian.demo:") }, "\(statuses)")
    // neither AppSync nor ldid: the helper's own exit 69
    let bare = try FakeHost(.jailbreak)
    let p2 = try ShareInbox.stage(file("Demo.ipa"), kind: .ipa, dirs: bare.dirs)
    do { _ = try ShareRun.installIPA(p2, bare); check(false, "no_adhoc expected") } catch let e as IntentFailure {
        check(e.message.hasPrefix("no_adhoc: ") && e.message.contains("AppSync"), e.message)
    }
    // a path outside the helper's directory: bad_ipa (64)
    do { _ = try ShareRun.installIPA(file("Demo.ipa").path, host); check(false, "bad_ipa expected") } catch let e as IntentFailure {
        check(e.message.hasPrefix("bad_ipa: "), e.message)
    }
    do { _ = try ShareRun.installIPA(path, try FakeHost(.sideload)); check(false, "sideload refused") } catch {}
}

test("jailbreak deb: simulate-deb resolves dependencies, install-deb installs") {
    let host = try FakeHost(.jailbreak)
    check(try host.helper(["update"], emit: nil).code == 0, "apt update")
    let path = try ShareInbox.stage(file("Tweak.deb"), kind: .deb, dirs: host.dirs)
    let plan = try ShareRun.simulateDeb(path, host)
    check(plan.ok && plan.package == "com.example.shared" && plan.version == "1.2", "\(plan)")
    check(plan.stdout.contains("Inst bash (5.2"), "bash pulled in: \(plan.stdout)")
    let r = try ShareRun.installDeb(path, host)
    check(r.code == 0, r.err)
    let status = host.read("/var/lib/dpkg/status") ?? ""
    check(status.contains("Package: com.example.shared\nStatus: install ok installed"), "installed")
    check(status.contains("Package: bash\nStatus: install ok installed"), "its dependency too")
    check(host.log.map(\.first!) == ["update", "simulate-deb", "install-deb"], "\(host.log)")
    // an unmet dependency: apt says no, the sheet shows why (not an error)
    let bad = try ShareInbox.stage(file("Bad.deb"), kind: .deb, dirs: host.dirs)
    let p2 = try ShareRun.simulateDeb(bad, host)
    check(!p2.ok && p2.code == 100 && p2.output.contains("unmet dependencies"), "\(p2)")
    // refused by the helper (outside its directory): an error
    do { _ = try ShareRun.simulateDeb(file("Tweak.deb").path, host); check(false, "refused") } catch let e as IntentFailure {
        check(e.message.contains("bad .deb path"), e.message)
    }
    host.env["FAKE_FAIL"] = "install-deb"
    check(try ShareRun.installDeb(path, host).code == 100, "apt's failure is apt's exit, for the console")
    do { _ = try ShareRun.simulateDeb(path, try FakeHost(.sideload)); check(false, "sideload refused") } catch {}
}

test("apt's plan names the shared package") {
    let out = "Note, selecting 'com.foo' instead of '/var/tmp/cydian-deb.X/deb.deb'\nInst dep (1 r [a])\nInst com.foo [0.9] (1.0 [iphoneos-arm64])\n"
    check(ShareRun.ownPackage(out)! == ("com.foo", "1.0"), "old apt, no origin")
    check(ShareRun.ownPackage("Inst a (1 local-deb [x])\n")! == ("a", "1"), "local-deb")
    check(ShareRun.ownPackage("Inst a (1 r [x])\n") == nil, "nothing to go on")
}

test("F133: a downloaded .deb checked against its stanza's SHA256 or MD5sum") {
    let dir = NSTemporaryDirectory() + "/sharetest-sum-" + UUID().uuidString
    try fm.createDirectory(atPath: dir, withIntermediateDirectories: true)
    defer { try? fm.removeItem(atPath: dir) }
    let f = URL(fileURLWithPath: dir + "/a.deb")
    try Data("!<arch>\nPackage: com.example.linked\nVersion: 1.0\n".utf8).write(to: f)
    let sha = "3b8d4b223885791e961e669b6d23b7311b5c1b3de5ae3f9aa603bd77e7468a9b", md5 = "ca04ec38027c07c41a28c17e97ca13a9"
    check(DebChecksum.check(f, sha256: nil, md5: nil) == nil, "no hash: nothing to check")
    check(DebChecksum.check(f, sha256: sha, md5: nil) == nil, "SHA256 matches")
    check(DebChecksum.check(f, sha256: " " + sha.uppercased() + "\n", md5: nil) == nil, "case and spaces don't matter")
    check(DebChecksum.check(f, sha256: nil, md5: md5) == nil, "MD5 matches")
    check(DebChecksum.check(f, sha256: sha, md5: String(repeating: "0", count: 32)) == nil, "SHA256 wins over MD5")
    let bad = DebChecksum.check(f, sha256: String(repeating: "a", count: 64), md5: md5) ?? ""
    check(bad.hasPrefix("bad_hash: ") && bad.contains(sha), bad)
    check((DebChecksum.check(f, sha256: nil, md5: String(repeating: "b", count: 32)) ?? "").contains(md5), "MD5 mismatch")
    check((DebChecksum.check(f, sha256: "xyz", md5: nil) ?? "").hasPrefix("bad_hash: "), "not a hash: refused")
    check((DebChecksum.check(URL(fileURLWithPath: dir + "/none.deb"), sha256: sha, md5: nil) ?? "").hasPrefix("bad_hash: "), "missing file")
    // MD5 against RFC 1321's vectors, and pieces across block edges
    func md5hex(_ parts: [Data]) -> String { var m = MD5(); for p in parts { m.update(p) }; return DebChecksum.hex(m.final()) }
    check(md5hex([]) == "d41d8cd98f00b204e9800998ecf8427e", "empty")
    check(md5hex([Data("abc".utf8)]) == "900150983cd24fb0d6963f7d28e17f72", "abc")
    check(md5hex([Data("12345678901234567890123456789012345678901234567890123456789012345678901234567890".utf8)]) == "57edf4a22be3c955ac49da2e2107b67a", "80 digits")
    let big = Data((0..<256000).map { UInt8($0 % 256) })
    check(md5hex([big.prefix(63), big.dropFirst(63).prefix(65), big.dropFirst(128)]) == "1da708a75e25110b1341d16814feb52d", "pieces")
}

print(failures == 0 ? "all passed" : "\(failures) failed")
exit(failures == 0 ? 0 : 1)
